(() => {
  const N=window.NowPlaying;
  const textOf=value=>{if(typeof value==='string'&&value.trim().startsWith('['))return value;try{const bytes=Uint8Array.from(atob(String(value||'')),c=>c.charCodeAt(0));return new TextDecoder('utf-8').decode(bytes);}catch(_){return '';}};
  N.packLyrics=(packet,source)=>{
    const lines=N.parseLRC(packet.lyric);
    if(packet.translation){
      for(const line of lines){
        let best=null,gap=.8;
        for(const item of N.parseLRC(packet.translation)){const distance=Math.abs(item.time-line.time);if(item.text&&distance<gap&&/[\u4e00-\u9fff]/.test(item.text)&&!/[\u3040-\u30ff]/.test(item.text)){best=item;gap=distance;}}
        if(best&&best.text!==line.text)line.translation=best.text;
      }
    }
    if(lines.length<2||!lines.some(line=>line.text.trim()))return null;
    return {kind:'synced',lines,plain:lines.map(line=>line.translation?line.text+'\n'+line.translation:line.text).join('\n'),source,id:packet.id||source,match:{score:packet.score||1,title:packet.title,artist:packet.artist,album:packet.album||'',duration:packet.duration||0}};
  };
  N.KugouLyricsProvider=class extends N.LyricsProvider {
    async find(track,signal){
      if(!track.title||!track.artist)return null;
      let packet=null,failure=null,bridged=false;
      if(typeof N.bridgeLyrics==='function'&&N.bridgeReady?.()){
        bridged=true;try{packet=await N.bridgeLyrics(track,signal);}catch(error){if(signal.aborted)throw error;failure=error;}
      }
      if(!packet?.lyric){try{packet=await this.direct(track,signal);}catch(error){if(signal.aborted)throw error;failure=error;}}
      if(!packet?.lyric&&!bridged&&typeof N.bridgeLyrics==='function'){
        try{packet=await N.bridgeLyrics(track,signal);}catch(error){if(signal.aborted)throw error;failure=error;}
      }
      if(!packet?.lyric){if(failure)throw failure;return null;}
      const row={title:packet.title||track.title,artist:packet.artist||track.artist,album:packet.album||'',duration:Number(packet.duration)||0};
      const score=N.lyricsMatch.score(track,row)?.score||0;
      if(score<.86)return null;
      packet.score=score;
      return N.packLyrics(packet,'酷狗音乐');
    }
    async direct(track,signal){
      const search=new URL('https://mobileservice.kugou.com/api/v3/search/song');
      search.searchParams.set('format','json');search.searchParams.set('keyword',track.title+' '+track.artist);search.searchParams.set('page','1');search.searchParams.set('pagesize','20');
      const data=await N.requestJSON(search.href,signal,'kugou');
      const rows=(data?.data?.info||[]).map(row=>({raw:row,title:row.songname||'',artist:row.singername||'',album:row.album_name||'',duration:Number(row.duration)||0}));
      const ranked=rows.map(row=>({row,score:N.lyricsMatch.score(track,row)?.score||0})).filter(x=>x.score>=.86).sort((a,b)=>b.score-a.score);
      const best=ranked[0];if(!best?.row.raw.hash)return null;
      const lyricSearch=new URL('https://lyrics.kugou.com/search');
      lyricSearch.searchParams.set('ver','1');lyricSearch.searchParams.set('man','yes');lyricSearch.searchParams.set('client','pc');
      lyricSearch.searchParams.set('keyword',best.row.title+'-'+best.row.artist);lyricSearch.searchParams.set('duration',String(Math.round((best.row.duration||track.duration||0)*1000)));lyricSearch.searchParams.set('hash',best.row.raw.hash);
      const found=await N.requestJSON(lyricSearch.href,signal,'kugou');
      const candidate=(found?.candidates||[]).find(item=>item?.id&&item?.accesskey);if(!candidate)return null;
      const download=new URL('https://lyrics.kugou.com/download');
      download.searchParams.set('ver','1');download.searchParams.set('client','pc');download.searchParams.set('id',candidate.id);download.searchParams.set('accesskey',candidate.accesskey);download.searchParams.set('fmt','lrc');download.searchParams.set('charset','utf8');
      const file=await N.requestJSON(download.href,signal,'kugou');
      const lyric=textOf(file?.content);
      return lyric.trim()?{lyric,title:best.row.title,artist:best.row.artist,album:best.row.album,duration:best.row.duration,id:candidate.id}:null;
    }
  };
})();
