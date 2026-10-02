(() => {
  'use strict';
  const N=window.NowPlaying;
  const {unique,splitArtists,titleInfo}=N.lyricsMatch;

  N.LrclibProvider=class extends N.LyricsProvider {
    constructor(){super();this.fallback=true;}
    score(track,row){return N.lyricsMatch.score(track,row);}
    async find(track,signal){
      if(!track.title||!track.artist)return null;
      const candidates=new Map(),requested=new Set();let queryError=null,requests=0;
      const collect=data=>{
        for(const r of (Array.isArray(data)?data:data?[data]:[]).slice(0,200)){
          if(!r||typeof r.trackName!=='string'||typeof r.artistName!=='string')continue;
          const row={...r,title:r.trackName,artist:r.artistName,album:r.albumName||'',duration:Number(r.duration)||0};
          const key=r.id??JSON.stringify([row.title,row.artist,row.album,row.duration]);
          if(candidates.size<1000||candidates.has(key))candidates.set(key,row);
        }
      };
      const select=()=>{
        const ranked=[...candidates.values()].map(row=>this.score(track,row)).filter(x=>x&&x.score>=.86)
          .sort((a,b)=>b.score-a.score||a.gap-b.gap||String(a.row.id).localeCompare(String(b.row.id)));
        const usable=[];
        for(const item of ranked){
          const r=item.row,lines=N.parseLRC(r.syncedLyrics),plain=String(r.plainLyrics||'').slice(0,200000);
          const words=lines.filter(line=>line.text.trim());
          if(!r.instrumental&&!plain.trim()&&!words.length)continue;
          usable.push({...item,result:{kind:r.instrumental?'instrumental':words.length>1?'synced':'plain',lines,
            plain:plain||lines.map(line=>line.text).join('\n'),source:'LRCLIB',id:r.id,
            match:{score:item.score,title:r.title,artist:r.artist,album:r.album,duration:r.duration}}});
        }
        if(!usable.length)return null;
        // Timing preference is limited to recordings with nearly the same confidence.
        return usable.find(item=>item.score>=usable[0].score-.02&&item.gap<=usable[0].gap+2&&item.result.kind==='synced')||usable[0];
      };
      const query=async(path,params)=>{
        if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
        if(queryError||requests>=18)return;
        const url=new URL('https://lrclib.net/api/'+path);
        for(const [key,value] of Object.entries(params))if(value!==''&&value!==undefined)url.searchParams.set(key,value);
        if(requested.has(url.href))return;
        requested.add(url.href);requests++;
        try{
          const data=await N.requestJSON(url.href,signal,'lyrics');
          if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
          collect(data);
        }
        catch(error){if(signal?.aborted||error.name==='AbortError')throw error;queryError=error;}
      };
      const ready=()=>{const best=select();return best&&best.score>=.94&&(best.result.kind==='synced'||best.result.kind==='instrumental')?best.result:null;};
      const full={track_name:track.title,artist_name:track.artist};
      // 1. Exact metadata lookup, then exact structured search (also without a timeline).
      if(track.duration>0){
        await query('get',{...full,album_name:track.album,duration:Math.round(track.duration)});
        let result=ready();if(result)return result;
        if(track.album){await query('get',{...full,duration:Math.round(track.duration)});result=ready();if(result)return result;}
      }
      await query('search',full);let result=ready();if(result)return result;
      // 2. NFKC, case, punctuation, whitespace, and Chinese character normalization.
      await query('search',{track_name:N.normalize(track.title),artist_name:N.normalize(track.artist)});
      result=ready();if(result)return result;
      // 3. Query each artist separately; always score against the original main artist.
      const artists=splitArtists(track.artist);
      if(artists.length>1)for(const artist of artists){await query('search',{track_name:track.title,artist_name:artist});result=ready();if(result)return result;}
      // 4. Strip recognized suffixes/feat credits for discovery, preserve them in scoring.
      const base=titleInfo(track.title).base;
      if(base!==track.title)for(const artist of unique([track.artist,...artists])){
        await query('search',{track_name:base,artist_name:artist});result=ready();if(result)return result;
      }
      // 5. Broader discovery. q searches any metadata field; title-only helps inconsistent credits.
      for(const artist of unique([artists[0],track.artist]))await query('search',{q:base+' '+artist});
      await query('search',{track_name:base});
      // 6. Re-rank all candidates locally; empty records never hide a usable lyric.
      const best=select();if(best)return best.result;
      if(queryError)throw queryError;
      return null;
    }
  };
})();
