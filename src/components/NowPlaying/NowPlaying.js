(() => {
  const N=window.NowPlaying,M=window.MediaState;
  // Staff tags at the top of an LRC. Showing them one after another looks like a dropdown.
  const CREDIT=/^(?:作词|作曲|编曲|写词|填词|词|曲|制作人?|录音|混音|母带|吉他|贝斯|鼓|和声|和音|弦乐|出品|企划|原唱|演唱|翻唱|监制|混缩|缩混|策划|音频)\s*[:：]|^(?:op|sp|pv|mv|lyrics|lyricist|composer|arranger|producer)\s*[:：]/i;
  N.NowPlaying=class {
    constructor(root,state,{demo=false}={}){
      this.root=root;this.state=state;this.demo=demo;this.offset=0;this.showLyrics=true;this.coverVersion=0;this.defaultCover='assets/kurisu-resting.png';this.lastLyric='';
      this.$=id=>root.querySelector('#'+id);
      this.$('cover').onerror=()=>{if(this.$('cover').getAttribute('src')!==this.defaultCover)this.$('cover').src=this.defaultCover;};
    }
    text(id,value){const e=this.$(id);if(e.textContent!==value)e.textContent=value;}
    meta(text){const head=String(text||'').split('\n')[0].trim();return !!head&&(CREDIT.test(head)||/^https?:\/\//i.test(head));}
    header(text){const line=N.normalize(String(text||'').split('\n')[0]),title=N.normalize(this.songTitle),artist=N.normalize(this.songArtist);if(!line)return true;if(title&&(line===title||line===artist+' '+title||line===title+' '+artist))return true;return !!artist&&line===artist;}
    parts(line){const rows=String(line?.text||'').split('\n').map(x=>x.trim()).filter(Boolean);const translation=String(line?.translation||'').trim();return {main:rows[0]||'',sub:translation||rows.slice(1).join(' ')};}
    blank(text){return !text||/^[♪♫\-—~.·。\s]+$/.test(text);}
    usable(line){const main=this.parts(line).main;return !this.blank(main)&&!this.meta(main)&&!this.header(main);}
    real(lines,from,any=false){for(let i=Math.max(0,from);i<lines.length;i++){if(any?!this.blank(this.parts(lines[i]).main):this.usable(lines[i]))return i;}return -1;}
    // Hold the first sung line through the intro. Title and credit rows are not lyrics.
    shown(lines,seconds,synced){if(!lines.length)return -1;const first=this.real(lines,0),fallback=first>=0?first:this.real(lines,0,true);if(fallback<0)return -1;if(!synced||seconds<lines[fallback].time)return fallback;const found=N.lyricIndex(lines,seconds);if(found<0||this.usable(lines[found]))return found<0?fallback:found;for(let i=found;i>=0;i--)if(this.usable(lines[i]))return i;const upcoming=this.real(lines,found+1);return upcoming>=0?upcoming:fallback;}
    paintLyric(main,sub){const cur=this.$('lyric-current'),mainEl=cur.querySelector('.lyric-main'),subEl=cur.querySelector('.lyric-sub'),nextEl=this.$('lyric-next');if(mainEl.textContent!==main)mainEl.textContent=main;if(subEl.textContent!==sub)subEl.textContent=sub;subEl.hidden=!sub;nextEl.textContent='';nextEl.classList.add('is-empty');}
    configure(p){if(p.showlyrics)this.showLyrics=!!p.showlyrics.value;if(p.lyricoffset)this.offset=M.clamp(Number(p.lyricoffset.value)||0,-5,5);this.tick(performance.now(),this.bridgeReady);}
    render(bridgeReady=false){
      this.bridgeReady=bridgeReady;const s=this.state;
      this.text('title',s.title||'等一首歌');this.$('title').title=s.title||'';
      this.text('artist',s.artist||(s.title?'未知歌手':'播放音乐，让黄昏有声音'));
      this.text('album',s.album||'');this.$('album').hidden=!s.album;this.$('album').title=s.album;
      this.text('status',this.demo?'演示预览':!s.enabled?'同步已关闭':s.playback==='playing'?'正在播放':s.playback==='paused'?'已暂停':s.title?'已连接':'等待音乐');
      document.body.classList.toggle('playing',s.playback==='playing');
      this.$('play-icon').toggleAttribute('hidden',s.playback==='playing');this.$('pause-icon').toggleAttribute('hidden',s.playback!=='playing');
      this.$('toggle').setAttribute('aria-label',s.playback==='playing'?'暂停':'播放');
      this.renderCover();this.tick(performance.now(),bridgeReady);
    }
    renderCover(){
      const s=this.state,base=this.$('cover'),hd=this.$('cover-hd'),fallback=s.fallbackCover||s.thumbnail||this.defaultCover;
      if(base.getAttribute('src')!==fallback)base.src=fallback;
      base.classList.toggle('album',fallback!==this.defaultCover);base.alt=fallback===this.defaultCover?'牧濑红莉栖封面占位图':'当前歌曲封面';this.$('art-caption').hidden=fallback!==this.defaultCover||!!s.hdCover;
      const signature=s.trackKey+'|'+s.hdCover;if(signature===this.coverSignature)return;this.coverSignature=signature;const version=++this.coverVersion;
      clearTimeout(this.coverTimer);if(this.pendingImage){this.pendingImage.onload=null;this.pendingImage.onerror=null;this.pendingImage.src='';}
      hd.classList.remove('ready');hd.removeAttribute('src');if(!s.hdCover)return;
      const img=this.pendingImage=new Image();img.referrerPolicy='no-referrer';
      const fail=()=>{if(version===this.coverVersion){clearTimeout(this.coverTimer);img.onload=img.onerror=null;this.$('art-caption').hidden=fallback!==this.defaultCover;N.log('HD image failed; keeping fallback');}};
      img.onload=()=>{if(version!==this.coverVersion)return;clearTimeout(this.coverTimer);hd.src=img.src;hd.classList.add('ready');};img.onerror=fail;
      this.coverTimer=setTimeout(fail,12000);img.src=s.hdCover;
    }
    tick(now,bridgeReady=false){
      const s=this.state,stale=s.isTimelineStale(now);
      const position=s.current(now),ratio=s.hasTimeline?position/s.duration:0;
      document.body.classList.toggle('timeline-unavailable',!!s.title&&!s.hasTimeline);
      this.$('progress-fill').style.width=ratio*100+'%';
      const second=Math.floor(position),label=s.hasTimeline?M.formatTime(second)+' / '+M.formatTime(s.duration):bridgeReady?'暂未读取到歌曲时间':this.connectionIssue?'暂无时间 · '+this.connectionIssue:'暂无时间 · 控制器未连接';
      if(this.$('progress').getAttribute('aria-valuetext')!==label){this.$('progress').setAttribute('aria-valuetext',label);this.$('progress').setAttribute('aria-valuenow',String(Math.round(ratio*100)));}
      this.text('elapsed',s.hasTimeline?M.formatTime(position):s.title?label:'--:--');this.text('duration',s.hasTimeline?M.formatTime(s.duration):'--:--');
      this.root.querySelector('.timeline').classList.toggle('is-stale',stale);
      this.root.querySelector('.timeline').title=stale?'时间读取暂时中断，保留最近位置，等待重新同步':s.timelineSource==='kugou-window'?'同步酷狗界面时间':s.hasTimeline?'同步系统媒体时间':'没有可靠播放位置时不自动滚动歌词；酷狗可通过可选本机控制器补充时间。';
      const lyrics=s.lyrics;this.songTitle=s.title;this.songArtist=s.artist;
      const status=this.$('lyric-status');
      if(status){
        const messages={loading:'正在查找歌词…',unavailable:'歌词服务暂时不可用，稍后重试', 'missing-artist':'缺少歌手信息，暂无法确认歌词','not-found':'暂未找到匹配歌词'};
        const message=this.showLyrics&&s.title&&!lyrics?messages[s.lyricsStatus]||'':'';
        if(status.textContent!==message)status.textContent=message;status.hidden=!message;
      }
      if(this.lyricsData!==lyrics){this.lyricsData=lyrics;this.lastLyric='';}
      const lines=lyrics&&Array.isArray(lyrics.lines)?lyrics.lines:[];
      const synced=!!(lyrics&&lyrics.kind==='synced'&&s.hasTimeline&&lines.length>1);
      const index=lyrics?this.shown(lines,position+this.offset,synced):-1;
      let main='',sub='',next='';
      if(index>=0){const p=this.parts(lines[index]);main=p.main;sub=p.sub;}
      else if(lyrics&&lyrics.kind!=='instrumental'){const raw=String(lyrics.plain||'').split(/\n/).map(x=>x.trim()).filter(Boolean),use=raw.filter(x=>!this.meta(x));const rows=use.length?use:raw;main=rows[0]||'';next=rows[1]||'';}
      if(!this.showLyrics||!lyrics||lyrics.kind==='instrumental'||!main){this.$('lyrics').hidden=true;s.currentLyricIndex=-1;return;}
      s.currentLyricIndex=index;
      const signature=s.trackKey+'|'+lyrics.id+'|'+synced+'|'+index;
      this.$('lyrics').classList.toggle('unsynced',!synced);
      if(signature!==this.lastLyric){this.lastLyric=signature;this.paintLyric(main,sub);this.text('lyric-source',(lyrics.source||'')+(synced?' · 同步歌词':lyrics.kind==='synced'?' · 暂无播放时间':' · 普通歌词'));}
      this.$('lyrics').hidden=false;
    }
  };
})();
