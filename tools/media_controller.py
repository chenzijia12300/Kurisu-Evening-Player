"""Loopback-only controller for five Windows media keys. Python 3.9+, no packages."""
import argparse
import ctypes
from ctypes import wintypes
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import base64
import re
import secrets
import subprocess
import threading
import time
import unicodedata
from urllib.parse import parse_qs, urlsplit, urlencode
from urllib.request import Request, urlopen

ACTIONS = {'toggle': 0xB3, 'previous': 0xB1, 'next': 0xB0, 'volume-down': 0xAE, 'volume-up': 0xAF}
NOISE = ('伴奏', '翻唱', 'cover', '钢琴', 'live', 'remix', 'dj', 'instrumental')


def fold_name(value):
    text = unicodedata.normalize('NFKC', value or '').lower()
    text = re.sub(r'[^0-9a-z\u3040-\u30ff\u4e00-\u9fff]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def http_json(url, timeout=8):
    request = Request(url, headers={'User-Agent': 'KurisuEveningPlayer', 'Accept': 'application/json', 'Referer': 'https://www.kugou.com'})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8', 'replace'))


def fetch_kugou_lyrics(title, artist, duration=0):
    """Kugou's public song and lyric endpoints. No playback control and no account."""
    title, artist = (title or '').strip()[:120], (artist or '').strip()[:120]
    if not title or not artist:
        return {'available': False}
    query = urlencode({'format': 'json', 'keyword': title + ' ' + artist, 'page': 1, 'pagesize': 20})
    songs = http_json('https://mobileservice.kugou.com/api/v3/search/song?' + query).get('data', {}).get('info') or []
    wanted_title, wanted_artist = fold_name(title), fold_name(artist)
    best, best_score = None, 0
    for row in songs:
        name, singer = fold_name(row.get('songname') or ''), fold_name(row.get('singername') or '')
        if not name or (any(flag in name for flag in NOISE) and not any(flag in wanted_title for flag in NOISE)):
            continue
        if wanted_title != name and wanted_title not in name and name not in wanted_title:
            continue
        score = 0.7 if wanted_title == name else 0.45
        if wanted_artist and wanted_artist not in singer and singer not in wanted_artist:
            continue
        score += 0.35 if wanted_artist else 0
        length = int(row.get('duration') or 0)
        if duration and length and abs(duration - length) > max(30, duration * 0.15):
            continue
        if duration and length:
            score += 0.15 if abs(duration - length) <= 8 else 0.05
        if score > best_score and row.get('hash'):
            best, best_score = row, score
    if not best or best_score < 0.7:
        return {'available': False}
    lyric_query = urlencode({'ver': 1, 'man': 'yes', 'client': 'pc', 'keyword': (best.get('songname') or '') + '-' + (best.get('singername') or ''), 'duration': int(best.get('duration') or duration or 0) * 1000, 'hash': best['hash']})
    candidates = http_json('https://lyrics.kugou.com/search?' + lyric_query).get('candidates') or []
    candidate = next((item for item in candidates if item.get('id') and item.get('accesskey')), None)
    if not candidate:
        return {'available': False}
    download = http_json('https://lyrics.kugou.com/download?' + urlencode({'ver': 1, 'client': 'pc', 'id': candidate['id'], 'accesskey': candidate['accesskey'], 'fmt': 'lrc', 'charset': 'utf8'}))
    raw = download.get('content') or ''
    try:
        lyric = base64.b64decode(raw).decode('utf-8', 'replace')
    except (ValueError, TypeError):
        lyric = raw if str(raw).lstrip().startswith('[') else ''
    if '[00:' not in lyric and '[0' not in lyric:
        return {'available': False}
    return {'available': True, 'source': 'kugou', 'id': str(candidate['id']), 'title': best.get('songname') or title, 'artist': best.get('singername') or artist, 'album': best.get('album_name') or '', 'duration': int(best.get('duration') or 0), 'lyric': lyric[:200000]}


class KugouTimeline:
    """Read only KuGou's displayed timeline; no hooks, playback changes or external requests."""
    def __init__(self):
        self.lock = threading.Lock()
        self.sample = None
        self.received = 0
        self.requested = 0
        self.process = None
        self.thread = None
        self.closed = False

    def get(self):
        now = time.monotonic()
        with self.lock:
            self.requested = now
            if not self.closed and (self.thread is None or not self.thread.is_alive()):
                self.thread = threading.Thread(target=self.run, daemon=True)
                self.thread.start()
            if self.sample and now - self.received < 5:
                return dict(self.sample, ageMs=round((now-self.received)*1000))
        return {'available': False, 'source': 'kugou-window', 'reason': 'waiting-for-visible-timeline'}

    def run(self):
        if os.name != 'nt':
            return
        process = None
        try:
            process = subprocess.Popen(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(Path(__file__).with_name('kugou-timeline.ps1')), '-Watch'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8-sig', creationflags=subprocess.CREATE_NO_WINDOW)
            with self.lock:
                self.process = process
            for line in process.stdout:
                if self.closed or time.monotonic()-self.requested > 10:
                    break
                try:
                    sample = json.loads(line)
                    if not isinstance(sample, dict):
                        continue
                    with self.lock:
                        self.sample = sample
                        self.received = time.monotonic()
                except ValueError:
                    continue
        finally:
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                if process.stdout:
                    process.stdout.close()
            with self.lock:
                self.process = None

    def close(self):
        self.closed = True
        with self.lock:
            process = self.process
        if process is not None and process.poll() is None:
            process.terminate()


def send_media_key(action):
    if action not in ACTIONS:
        raise ValueError('Unsupported media action')
    if os.name != 'nt':
        raise OSError('Media controls require Windows')
    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]
    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('mouseData', wintypes.DWORD), ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]
    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [('uMsg', wintypes.DWORD), ('wParamL', wintypes.WORD), ('wParamH', wintypes.WORD)]
    class INPUTUNION(ctypes.Union):
        _fields_ = [('ki', KEYBDINPUT), ('mi', MOUSEINPUT), ('hi', HARDWAREINPUT)]
    class INPUT(ctypes.Structure):
        _anonymous_ = ('u',)
        _fields_ = [('type', wintypes.DWORD), ('u', INPUTUNION)]
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    user32.SendInput.restype = wintypes.UINT
    entries = (INPUT * 2)()
    for index, flags in enumerate((1, 3)):  # EXTENDEDKEY; EXTENDEDKEY | KEYUP
        entries[index].type = 1
        entries[index].ki = KEYBDINPUT(ACTIONS[action], 0, flags, 0, 0)
    if user32.SendInput(2, entries, ctypes.sizeof(INPUT)) != 2:
        raise OSError('Windows rejected the media key; check application privilege levels')


def allowed_origin(origin):
    if origin in (None, 'null', 'file://'):
        return True
    try:
        u = urlsplit(origin)
        return u.scheme == 'http' and u.hostname in ('127.0.0.1', 'localhost')
    except ValueError:
        return False


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def log_message(self, *_):
        pass

    def respond(self, status, data):
        raw = json.dumps(data).encode('utf-8')
        self.send_response(status)
        origin = self.headers.get('Origin')
        if origin and allowed_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Kurisu-Token')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def valid_request(self, authenticate=True):
        if self.headers.get('Host') not in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}') or not allowed_origin(self.headers.get('Origin')):
            self.respond(403, {'error': 'Origin or host rejected'})
            return False
        supplied = self.headers.get('X-Kurisu-Token', '')
        if authenticate and not hmac.compare_digest(supplied.encode(), self.server.token.encode()):
            self.respond(401, {'error': 'Connection code required'})
            return False
        return True

    def do_OPTIONS(self):
        if self.valid_request(False):
            self.respond(200, {'ok': True})

    def do_GET(self):
        if not self.valid_request():
            return
        path = urlsplit(self.path).path
        if path == '/timeline':
            self.respond(200, self.server.timeline.get() if not self.server.dry_run else {'available': False, 'reason': 'dry-run'})
            return
        if path == '/lyrics':
            if self.server.dry_run:
                self.respond(200, {'available': False, 'reason': 'dry-run'})
                return
            query = parse_qs(urlsplit(self.path).query)
            try:
                duration = int(float((query.get('duration') or ['0'])[0]))
            except ValueError:
                duration = 0
            try:
                payload = fetch_kugou_lyrics((query.get('title') or [''])[0], (query.get('artist') or [''])[0], duration)
            except Exception:
                payload = {'available': False}
            self.respond(200, payload)
            return
        if path != '/health':
            self.respond(404, {'error': 'Not found'})
            return
        self.respond(200, {'ok': True, 'version': 5, 'timelineFallback': 'kugou-window', 'timelineMethod': 'msaa', 'lyrics': 'kugou', 'dryRun': self.server.dry_run, 'actions': list(ACTIONS)})

    def do_POST(self):
        if not self.valid_request():
            return
        if self.path != '/command':
            self.respond(404, {'error': 'Not found'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 256 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('Invalid request body')
            data = json.loads(self.rfile.read(length))
            action = data.get('action')
            if action not in ACTIONS:
                raise ValueError('Unsupported media action')
        except (ValueError, TypeError, AttributeError):
            self.respond(400, {'error': 'Invalid media action'})
            return
        try:
            if not self.server.dry_run:
                send_media_key(action)
            self.respond(200, {'ok': True, 'action': action, 'dryRun': self.server.dry_run})
        except OSError as error:
            self.respond(500, {'error': str(error)})


def create_server(port, token, dry_run=False):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.token = token
    server.dry_run = dry_run
    server.timeline = KugouTimeline()
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18743)
    parser.add_argument('--dry-run', action='store_true', help='Validate requests without sending media keys')
    parser.add_argument('--quiet', action='store_true', help='Run without printing the connection code')
    args = parser.parse_args()
    token_file = Path(__file__).with_name('.connection-code')
    token = token_file.read_text().strip() if token_file.exists() else secrets.token_urlsafe(24)
    if not token_file.exists():
        token_file.write_text(token)
    if not args.quiet:
        print('\nKurisu music controller | Local only: 127.0.0.1:' + str(args.port), flush=True)
        print('Connection code (paste into wallpaper player settings):\n\n' + token + '\n', flush=True)
        print('Keep this controller running. Close it or press Ctrl+C to stop.', flush=True)
    if args.dry_run and not args.quiet:
        print('DRY RUN: no media keys will be sent.', flush=True)
    server = create_server(args.port, token, args.dry_run)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.timeline.close()
        server.server_close()


if __name__ == '__main__':
    main()
