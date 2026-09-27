(() => {
  const N=window.NowPlaying;
  N.MediaState=class extends window.MediaState.TrackState {
    clear(){super.clear();this.albumArtist='';this.fallbackCover='';this.hdCover='';this.lyrics=null;this.currentLyricIndex=-1;this.contentType='music';this.staleCover='';this.timelinePending=false;}
    resetTimeline(){super.resetTimeline();this.timelinePending=false;}
    setProperties(e){
      const title=typeof e.title==='string'?e.title:'',sameTitle=!!title&&title===this.title;
      const artist=e.artist||(sameTitle?this.artist:''),album=e.albumTitle||(sameTitle?this.album:'');
      const trackChanged=!!(this.title&&(this.title!==title||(this.artist&&artist&&this.artist!==artist)));
      // Album text often arrives after the clock. Only a new song clears the KuGou time.
      if(trackChanged){
        const sameAlbum=!!(this.album&&album&&this.album===album);
        this.resetTimeline();this.hdCover='';this.lyrics=null;this.currentLyricIndex=-1;
        if(!sameAlbum){this.staleCover=this.fallbackCover||this.thumbnail||this.staleCover||'';this.thumbnail='';this.fallbackCover='';}
      }
      this.title=title;this.artist=artist;this.album=album;this.albumArtist=e.albumArtist||(sameTitle?this.albumArtist:'');this.contentType=e.contentType||'music';
    }
    setTimeline(e,now=performance.now(),source='native'){
      const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
      const valid=finite(e.duration)&&Number(e.duration)>0&&finite(e.position);
      // Empty native clocks are common in KuGou. They must not erase a confirmed window sample.
      if(source==='native'&&this.timelineSource==='kugou-window'&&(!valid||Number(e.position)===0))return;
      if(!valid){
        if(this.hasTimeline&&!this.timelinePending){this.position=this.current(now);this.stamp=now;this.timelinePending=true;}
        return;
      }
      super.setTimeline(e,now,source);this.timelineAt=now;this.timelinePending=false;
    }
    isTimelineStale(now){return this.hasTimeline&&(this.timelinePending||(this.timelineSource==='kugou-window'&&now-this.timelineAt>7000));}
    current(now){
      // Keep the last known time during a read gap; never extrapolate a missing window clock forever.
      if(this.timelinePending)return this.hasTimeline?this.position:0;
      return super.current(this.timelineSource==='kugou-window'?Math.min(now,this.timelineAt+7000):now);
    }
    get trackKey(){return N.trackKey(this);}
  };
})();
