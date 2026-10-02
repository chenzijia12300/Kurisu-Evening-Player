(() => {
  const N=window.NowPlaying,DAY=86400000;
  N.MediaEnrichment=class {
    constructor(provider,onChange,{online=true,lyricsProviders,artworkProviders,cache,retryDelays=[3000,10000,30000],debounce=400,lyricsTimeout=20000}={}){
      this.provider=provider;this.onChange=onChange;this.online=online;this.lyricsEnabled=true;this.artworkEnabled=true;
      this.lyricsProviders=lyricsProviders||[new N.AmllLyricsProvider(),new N.KugouLyricsProvider(),new N.LrclibProvider()];this.artworkProviders=artworkProviders||[new N.MusicBrainzArtworkProvider()];this.cache=cache||new N.MediaCache();
      this.jobs={};this.retryDelays=retryDelays;this.debounce=debounce;this.lyricsTimeout=lyricsTimeout;this.previous=null;
      this.unsubscribe=provider.subscribe(()=>this.update());
      this.reconnect=()=>{for(const [kind,job] of Object.entries(this.jobs))if(job.failed)this.cancel(kind);this.update();};
      window.addEventListener?.('online',this.reconnect);
    }
    configure(p){if(p.onlinemetadata)this.online=!!p.onlinemetadata.value;if(p.showlyrics)this.lyricsEnabled=!!p.showlyrics.value;if(p.hdcover)this.artworkEnabled=!!p.hdcover.value;this.update();}
    cancel(kind){const job=this.jobs[kind];if(job){job.control.abort();clearTimeout(job.timer);delete this.jobs[kind];}}
    valid(kind,result){return kind==='lyrics'?!!(result&&Array.isArray(result.lines)&&result.lines.length<10000&&result.lines.every(x=>x&&Number.isFinite(x.time)&&typeof x.text==='string')&&typeof result.plain==='string'):!!(result&&N.safeCoverURL(result.url));}
    update(){
      const s=this.provider.state,track=N.mediaQuery(s),previous=this.previous;
      const changed=!!previous&&(previous.title!==s.title||(previous.artist&&s.artist&&previous.artist!==s.artist));
      this.previous={title:s.title,artist:s.artist};
      if(changed){for(const kind of Object.keys(this.jobs))this.cancel(kind);s.lyrics=null;s.currentLyricIndex=-1;s.hdCover='';this.onChange();}
      const active=s.enabled&&track.title&&s.contentType==='music'&&this.online;
      for(const kind of ['lyrics','artwork']){
        if(!active||!(kind==='lyrics'?this.lyricsEnabled:this.artworkEnabled&&track.artist)){
          this.cancel(kind);
          if(kind==='lyrics'){s.lyrics=null;s.currentLyricIndex=-1;s.lyricsStatus='';}else s.hdCover='';
          continue;
        }
        // Album/duration refinement is a new query, not a new song. Keep usable results visible.
        const bridge=kind==='lyrics'&&typeof N.bridgeReady==='function'&&N.bridgeReady()?1:0;
        const key=(kind==='lyrics'?'lyrics-v6:':'stable-v2:')+kind+':'+N.trackKey(track)+':'+Math.round(track.duration||0)+':'+bridge;
        if(this.jobs[kind]?.key===key)continue;
        this.cancel(kind);
        const job=this.jobs[kind]={key,control:new AbortController(),attempt:0,failed:false};
        if(kind==='lyrics')s.lyricsStatus='loading';
        let cached;try{cached=this.cache.get(key);}catch(error){N.log(kind,'cache read error',error.message);}
        if(cached===null||this.valid(kind,cached))this.run(kind,track,job);
        else job.timer=setTimeout(()=>this.run(kind,track,job),this.debounce);
      }
      this.onChange();
    }
    async findLyrics(track,job,current){
      const signal=job.control.signal,s=this.provider.state;
      const rank=result=>N.lyricsHaveTranslation(result)?2:1;
      const publish=result=>{
        if(!current())return;
        if(!N.lyricsHaveTranslation(s.lyrics)||rank(result)===2){s.lyrics=result;this.onChange();}
      };
      job.sources=job.sources||[];
      let best=job.best||null;
      const controls=this.lyricsProviders.map(()=>new AbortController()),winners=new Set();
      await Promise.all(this.lyricsProviders.map(async(provider,index)=>{
        if(job.sources[index]&&!job.sources[index].failed)return;
        const control=controls[index],cancel=()=>control.abort();let timedOut=false,timer,rejectAbort;
        signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
        const stopped=new Promise((_,reject)=>{
          rejectAbort=()=>reject(new DOMException(timedOut?'Lyrics source timed out':'Request cancelled','AbortError'));
          control.signal.addEventListener('abort',rejectAbort,{once:true});
          if(control.signal.aborted)rejectAbort();
          timer=setTimeout(()=>{timedOut=true;control.abort();},this.lyricsTimeout);
        });
        try{
          const found=await Promise.race([Promise.resolve().then(()=>provider.find(track,control.signal)),stopped]);
          if(!current())return;
          const valid=this.valid('lyrics',found),failed=!!(valid&&found.retryTranslation);
          job.sources[index]={failed,result:valid?found:null};
          if(valid&&(!best||rank(found)>best.rank||rank(found)===best.rank&&index<best.index)){
            best=job.best={result:found,rank:rank(found),index};publish(found);
          }
          // Once the preferred source has a translation, slower sources cannot improve it.
          if(best?.rank===2&&best.index===0)controls.forEach((other,i)=>{if(i!==index){winners.add(i);other.abort();}});
        }catch(error){
          if(!current()||winners.has(index))return;
          job.sources[index]={failed:true,result:job.sources[index]?.result||null};
          N.log('lyrics','unavailable',error.message);
        }finally{
          clearTimeout(timer);signal.removeEventListener('abort',cancel);control.signal.removeEventListener('abort',rejectAbort);
        }
      }));
      return {result:best?.result||null,failed:job.sources.some(source=>source?.failed)};
    }
    async run(kind,track,job){
      const s=this.provider.state,signal=job.control.signal,current=()=>!signal.aborted&&this.jobs[kind]===job;
      if(!current())return;
      try{
        let result=this.cache.get(job.key),failed=false;
        if(result!==undefined&&result!==null&&!this.valid(kind,result))result=undefined;
        if(result===undefined){
          result=null;
          if(kind==='lyrics')({result,failed}=await this.findLyrics(track,job,current));
          else for(const provider of this.artworkProviders){
            try{
              const found=await provider.find(track,signal);
              if(!current())return;
              if(!this.valid(kind,found))continue;
              result=found;break;
            }catch(error){if(!current())return;failed=true;N.log(kind,'unavailable',error.message);}
          }
          if(!current())return;
          // One failed source + another source's empty result is not proof that no lyrics exist.
          const hasTranslation=kind==='lyrics'&&N.lyricsHaveTranslation(result);
          if(!failed||hasTranslation||kind!=='lyrics'&&result)this.cache.set(job.key,result,result?(kind==='lyrics'?(hasTranslation?30:1):7)*DAY:5*60000);
        }
        if(!current())return;
        job.failed=failed&&(!result||kind==='lyrics'&&!N.lyricsHaveTranslation(result));
        if(kind==='lyrics')s.lyricsStatus=result?'':job.failed?'unavailable':!track.artist?'missing-artist':'not-found';
        if(result){
          if(kind==='lyrics'){
            if(!N.lyricsHaveTranslation(s.lyrics)||N.lyricsHaveTranslation(result))s.lyrics=result;
          }else s.hdCover=result.url;
          this.onChange();
        }
        // Failed/empty refinements keep the result already shown for this song.
        if(job.failed&&job.attempt<this.retryDelays.length){job.timer=setTimeout(()=>this.run(kind,track,job),this.retryDelays[job.attempt++]);}
      }catch(error){if(current())N.log(kind,'cache/provider error',error.message);}
    }
    dispose(){for(const kind of Object.keys(this.jobs))this.cancel(kind);this.unsubscribe();window.removeEventListener?.('online',this.reconnect);}
  };
})();
