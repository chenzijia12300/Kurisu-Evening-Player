(() => {
  const N=window.NowPlaying,DAY=86400000;
  N.MediaEnrichment=class {
    constructor(provider,onChange,{online=true,lyricsProviders,artworkProviders,cache,retryDelays=[3000,10000,30000],debounce=400}={}){
      this.provider=provider;this.onChange=onChange;this.online=online;this.lyricsEnabled=true;this.artworkEnabled=true;
      this.lyricsProviders=lyricsProviders||[new N.KugouLyricsProvider(),new N.AmllLyricsProvider(),new N.LrclibProvider()];this.artworkProviders=artworkProviders||[new N.MusicBrainzArtworkProvider()];this.cache=cache||new N.MediaCache();
      this.jobs={};this.retryDelays=retryDelays;this.debounce=debounce;this.previous=null;
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
      const active=s.enabled&&track.title&&track.artist&&s.contentType==='music'&&this.online;
      for(const kind of ['lyrics','artwork']){
        if(!active||!(kind==='lyrics'?this.lyricsEnabled:this.artworkEnabled)){
          this.cancel(kind);
          if(kind==='lyrics'){s.lyrics=null;s.currentLyricIndex=-1;}else s.hdCover='';
          continue;
        }
        // Album/duration refinement is a new query, not a new song. Keep usable results visible.
        const bridge=kind==='lyrics'&&typeof N.bridgeReady==='function'&&N.bridgeReady()?1:0;
        const key='stable-v2:'+kind+':'+N.trackKey(track)+':'+Math.round(track.duration||0)+':'+bridge;
        if(this.jobs[kind]?.key===key)continue;
        this.cancel(kind);
        const job=this.jobs[kind]={key,control:new AbortController(),attempt:0,failed:false};
        job.timer=setTimeout(()=>this.run(kind,track,job),this.debounce);
      }
      this.onChange();
    }
    async run(kind,track,job){
      const s=this.provider.state,signal=job.control.signal,current=()=>!signal.aborted&&this.jobs[kind]===job;
      if(!current())return;
      try{
        let result=this.cache.get(job.key),failed=false;
        if(result!==undefined&&result!==null&&!this.valid(kind,result))result=undefined;
        if(result===undefined){
          result=null;let best=null;
          for(const provider of kind==='lyrics'?this.lyricsProviders:this.artworkProviders){
            if(provider.fallback&&best)break;
            try{
              const found=await provider.find(track,signal);
              if(!current())return;
              if(!this.valid(kind,found))continue;
              const rank=kind==='lyrics'&&found.lines.some(line=>String(line.translation||'').trim())?2:1;
              if(!best||rank>best.rank)best={result:found,rank};
              if(rank===2||kind!=='lyrics')break;
            }catch(error){if(!current())return;failed=true;N.log(kind,'unavailable',error.message);}
          }
          result=best?best.result:null;
          if(!current())return;
          // One failed source + another source's empty result is not proof that no lyrics exist.
          if(result||!failed)this.cache.set(job.key,result,result?(kind==='lyrics'?30:7)*DAY:5*60000);
        }
        if(!current())return;
        job.failed=failed&&!result;
        if(result){if(kind==='lyrics')s.lyrics=result;else s.hdCover=result.url;this.onChange();}
        // Failed/empty refinements keep the result already shown for this song.
        if(job.failed&&job.attempt<this.retryDelays.length){job.timer=setTimeout(()=>this.run(kind,track,job),this.retryDelays[job.attempt++]);}
      }catch(error){if(current())N.log(kind,'cache/provider error',error.message);}
    }
    dispose(){for(const kind of Object.keys(this.jobs))this.cancel(kind);this.unsubscribe();window.removeEventListener?.('online',this.reconnect);}
  };
})();
