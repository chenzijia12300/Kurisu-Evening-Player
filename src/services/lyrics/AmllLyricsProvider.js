(() => {
  const N=window.NowPlaying;
  N.AmllLyricsProvider=class extends N.LyricsProvider {
    async find(track,signal){
      if(!track.title||!track.artist)return null;
      const search=new URL('https://api.amll.dev/v1/lyrics/search');
      search.searchParams.set('musicName',track.title);search.searchParams.set('artistName',track.artist);
      const found=await N.requestJSON(search.href,signal,'amll');
      const items=found?.data?.items;if(!Array.isArray(items))return null;
      const ranked=items.slice(0,12).map(item=>{
        const row={item,title:(item.musicNames||[])[0]||'',artist:(item.artistNames||[]).join(' '),album:(item.albumNames||[])[0]||'',duration:0};
        return {row,score:N.similarity(track.title,row.title)>=.92?N.matchScore({...track,duration:0},row):0};
      }).filter(x=>x.score>=.9).sort((a,b)=>b.score-a.score);
      if(!ranked.length)return null;
      const best=ranked[0],full=await N.requestJSON('https://api.amll.dev/v1/lyrics/get?id='+encodeURIComponent(best.row.item.id),signal,'amll');
      const lines=N.parseTTML(full?.data?.lyrics);
      if(lines.length<2||!lines.some(x=>x.text.trim()))return null;
      return {kind:'synced',lines,plain:lines.map(x=>x.translation?x.text+'\n'+x.translation:x.text).join('\n'),source:'AMLL',id:String(best.row.item.id),match:{score:best.score,title:best.row.title,artist:best.row.artist,album:best.row.album,duration:track.duration}};
    }
  };
})();
