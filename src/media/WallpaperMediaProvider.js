(() => {
  const N=window.NowPlaying;
  N.WallpaperMediaProvider=class {
    constructor(){this.state=new N.MediaState();this.listeners=new Set();this.started=false;}
    subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
    notify(kind='change'){N.log(kind,{title:this.state.title,playback:this.state.playback,position:this.state.position,duration:this.state.duration});for(const fn of this.listeners)fn(this.state,kind);}
    setTimeline(e,now=performance.now(),source='native'){const before=this.state.hasTimeline;this.state.setTimeline(e,now,source);if(this.state.hasTimeline||before)this.notify('timeline');}
    start(){
      if(this.started)return;this.started=true;
      const s=this.state,register=(name,fn)=>{if(typeof window[name]==='function')window[name](fn);};
      register('wallpaperRegisterMediaStatusListener',e=>{s.enabled=!!e.enabled;if(!s.enabled)s.clear();this.notify('status');});
      register('wallpaperRegisterMediaPropertiesListener',e=>{if(s.enabled){s.setProperties(e);this.notify('properties');}});
      register('wallpaperRegisterMediaThumbnailListener',e=>{
        if(!s.enabled)return;
        const next=typeof e.thumbnail==='string'&&e.thumbnail.startsWith('data:image/')?e.thumbnail:'';
        if(!next){s.thumbnail=s.fallbackCover='';this.notify('thumbnail');return;}
        // Wallpaper Engine does not name the track on a thumbnail. The previous song's picture often arrives again after the title already changed.
        if(s.staleCover&&next===s.staleCover)return;
        s.staleCover='';s.thumbnail=s.fallbackCover=next;this.notify('thumbnail');
      });
      register('wallpaperRegisterMediaPlaybackListener',e=>{if(s.enabled){s.setPlayback(window.MediaState.playbackKind(e,window.wallpaperMediaIntegration),performance.now());this.notify('playback');}});
      register('wallpaperRegisterMediaTimelineListener',e=>{if(s.enabled)this.setTimeline(e);});
    }
  };
})();
