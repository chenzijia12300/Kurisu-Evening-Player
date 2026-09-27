(() => {
  const N=window.NowPlaying;
  N.LrclibProvider=class extends N.LyricsProvider {
    constructor(){super();this.fallback=true;}
    async find(track,signal){
      const candidates=new Map();let queryError=null;
      const collect=data=>{for(const r of (Array.isArray(data)?data:data?[data]:[]).slice(0,40))if(r&&typeof r.trackName==='string')candidates.set(r.id,{...r,title:r.trackName,artist:r.artistName,album:r.albumName});};
      const select=()=>{
        const pool=[...candidates.values()].filter(row=>row.syncedLyrics||row.plainLyrics||row.instrumental);
        let ranked=pool.map(row=>({row,score:N.matchScore(track,row)})).filter(x=>x.score>=.82).sort((a,b)=>b.score-a.score);
        // A live cut a few dozen seconds off still has the right words. A much longer gap stays rejected.
        if(!ranked.length&&track.artist){const span=track.duration>0?Math.max(30,track.duration*.12):0;ranked=pool.map(row=>({row,score:N.matchScore({...track,duration:0},{...row,duration:0}),gap:track.duration>0&&row.duration>0?Math.abs(track.duration-row.duration):0})).filter(x=>x.score>=.9&&(!span||x.gap<=span)).sort((a,b)=>a.gap-b.gap||b.score-a.score);}
        if(!ranked.length||!track.artist)return null;
        // Synced lyrics win only among equally plausible recordings.
        const best=ranked.find(x=>(ranked[0].gap===undefined||x.gap<=ranked[0].gap+2)&&x.score>=ranked[0].score-.025&&N.parseLRC(x.row.syncedLyrics).length>1)||ranked[0];
        const r=best.row,lines=N.parseLRC(r.syncedLyrics),plain=String(r.plainLyrics||'').slice(0,200000);
        if(!r.instrumental&&!plain.trim()&&!lines.some(x=>x.text.trim()))return null;
        return {kind:r.instrumental?'instrumental':lines.length>1?'synced':'plain',lines,plain:plain||lines.map(x=>x.text).join('\n'),source:'LRCLIB',id:r.id,match:{score:best.score,title:r.title,artist:r.artist,album:r.album,duration:r.duration}};
      };
      const query=async(path,params)=>{
        if(queryError)return;
        const u=new URL('https://lrclib.net/api/'+path);for(const [k,v] of Object.entries(params))if(v!==''&&v!==undefined)u.searchParams.set(k,v);
        try{collect(await N.requestJSON(u.href,signal,'lyrics'));}
        catch(error){if(signal.aborted||!candidates.size)throw error;queryError=error;}
      };
      const full={track_name:track.title,artist_name:track.artist};
      if(track.duration>0){
        await query('get',{...full,album_name:track.album,duration:Math.round(track.duration)});let result=select();if(result?.kind==='synced'||result?.kind==='instrumental')return result;
        if(track.album){await query('get',{...full,duration:Math.round(track.duration)});result=select();if(result?.kind==='synced'||result?.kind==='instrumental')return result;}
      }
      await query('search',{track_name:N.normalize(track.title),artist_name:track.artist});let result=select();if(result)return result;
      // Title-only discovery still has the same artist/version confidence gate.
      await query('search',{track_name:track.title});result=select();if(!result&&queryError)throw queryError;return result;
    }
  };
})();
