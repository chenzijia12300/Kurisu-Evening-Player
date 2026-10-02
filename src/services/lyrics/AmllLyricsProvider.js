(() => {
  'use strict';
  const N=window.NowPlaying,{unique,splitArtists,titleInfo}=N.lyricsMatch;
  const abort=signal=>{if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');};
  const strings=(values,limit)=>unique((Array.isArray(values)?values:[]).filter(x=>typeof x==='string')).slice(0,limit);
  N.AmllLyricsProvider=class extends N.LyricsProvider {
    score(track,item){
      const titles=strings(item.musicNames,12),names=strings(item.artistNames,12),albums=strings(item.albumNames,6);
      // artistNames contains both aliases and collaborating artists. Check individual names and full credits.
      const artists=unique([names.join(' / '),...names]);let best=null;
      for(const title of titles)for(const artist of artists)for(const album of albums.length?albums:['']){
        const scored=N.lyricsMatch.score({...track,duration:0},{title,artist,album,duration:0});
        if(scored&&(!best||scored.score>best.score))best={...scored,item};
      }
      return best;
    }
    async find(track,signal){
      if(!track.title||!track.artist)return null;
      const candidates=new Map(),requested=new Set(),fetched=new Set();
      let searchCount=0,detailCount=0,error=null,best=null;
      const translated=result=>!!result?.lines.some(line=>line.translation?.trim());
      const inspect=async()=>{
        const ranked=[...candidates.values()].map(item=>this.score(track,item)).filter(x=>x&&x.score>=.90)
          .sort((a,b)=>b.score-a.score||String(a.item.id).localeCompare(String(b.item.id)));
        for(const candidate of ranked){
          abort(signal);
          const id=String(candidate.item.id);if(fetched.has(id)||detailCount>=4||error)continue;
          fetched.add(id);detailCount++;
          try{
            const full=await N.requestJSON('https://api.amll.dev/v1/lyrics/get?id='+encodeURIComponent(id),signal,'amll');
            abort(signal);
            if(full&&(!full.data||String(full.data.id)!==id))throw Error('AMLL invalid lyric response');
            const lines=N.parseTTML(full?.data?.lyrics);
            if(lines.length<2||!lines.some(x=>x.text.trim()))continue;
            // The API has no track duration. Reject lyrics extending well beyond the actual recording.
            const last=Math.max(...lines.map(x=>x.end??x.time));
            if(track.duration>0&&last>track.duration+Math.max(30,track.duration*.12))continue;
            const result={kind:'synced',lines,plain:lines.map(x=>x.translation?x.text+'\n'+x.translation:x.text).join('\n'),
              source:'AMLL',id,match:{score:candidate.score,...candidate.row}};
            if(!best||translated(result)&&!translated(best)||translated(result)===translated(best)&&candidate.score>best.match.score)best=result;
            if(translated(best))return best;
          }catch(e){if(signal?.aborted||e.name==='AbortError')throw e;error=e;}
        }
        return null;
      };
      const query=async params=>{
        for(let page=1;page<=2;page++){
          abort(signal);if(error||searchCount>=12||candidates.size>=500)return null;
          const url=new URL('https://api.amll.dev/v1/lyrics/search');
          for(const [key,value] of Object.entries(params))if(value)url.searchParams.set(key,value);
          url.searchParams.set('pageSize','100');url.searchParams.set('page',String(page));
          if(requested.has(url.href))return null;
          requested.add(url.href);searchCount++;
          try{
            const response=await N.requestJSON(url.href,signal,'amll');abort(signal);
            if(response&&!Array.isArray(response.data?.items))throw Error('AMLL invalid search response');
            for(const item of (response?.data?.items||[]).slice(0,100)){
              if(item&&/^\d+$/.test(String(item.id))&&candidates.size<500)candidates.set(String(item.id),item);
            }
            const result=await inspect();if(result)return result;
            if(!response?.data?.pagination?.hasMore)return null;
          }catch(e){if(signal?.aborted||e.name==='AbortError')throw e;error=e;return null;}
        }
        return null;
      };
      const artists=splitArtists(track.artist),base=titleInfo(track.title).base;
      const queries=[
        {musicName:track.title,artistName:track.artist},
        {musicName:track.title.normalize('NFKC'),artistName:track.artist.normalize('NFKC')},
        {musicName:N.normalize(track.title),artistName:N.normalize(track.artist)},
        ...artists.map(artist=>({musicName:track.title,artistName:artist})),
        ...unique([track.artist,...artists]).map(artist=>({musicName:base,artistName:artist})),
        {musicName:base},
        ...unique([artists[0],track.artist]).map(artist=>({artistName:artist}))
      ];
      // Search variants discover records; every title/artist alias is scored against the original track.
      for(const params of queries){const result=await query(params);if(result)return result;if(error)break;}
      abort(signal);
      if(best)return error?{...best,retryTranslation:true}:best;
      if(error)throw error;
      return null;
    }
  };
})();