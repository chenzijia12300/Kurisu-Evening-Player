(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MediaState=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const finite=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n));
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function formatTime(seconds){if(!finite(seconds)||seconds<0)return '--:--';const n=Math.floor(seconds);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');}
  function playbackKind(event,integration){const x=integration||{},p=x.playback||{},s=event.state;if(s==='playing'||(x.PLAYBACK_PLAYING!==undefined&&s===x.PLAYBACK_PLAYING)||(p.PLAYING!==undefined&&s===p.PLAYING))return 'playing';if(s==='paused'||(x.PLAYBACK_PAUSED!==undefined&&s===x.PLAYBACK_PAUSED)||(p.PAUSED!==undefined&&s===p.PAUSED))return 'paused';return 'stopped';}
  class TrackState{
    constructor(){this.enabled=true;this.clear();}
    clear(){this.title='';this.artist='';this.album='';this.thumbnail='';this.playback='stopped';this.position=0;this.duration=0;this.stamp=0;this.hasTimeline=false;this.timelineSource='';this.timelineAt=0;}
    resetTimeline(){this.hasTimeline=false;this.duration=0;this.position=0;this.timelineSource='';this.timelineAt=0;}
    setProperties(e){const title=typeof e.title==='string'?e.title:'';const artist=typeof e.artist==='string'?e.artist:'';if(this.title&&(title!==this.title||artist!==this.artist))this.resetTimeline();this.title=title;this.artist=artist;this.album=e.albumTitle||'';}
    setTimeline(e,now,source='native'){const valid=finite(e.duration)&&Number(e.duration)>0&&finite(e.position);if(!valid){if(source==='native'&&this.timelineSource==='kugou-window')return;this.resetTimeline();return;}this.hasTimeline=true;this.duration=Number(e.duration);this.position=clamp(Number(e.position),0,this.duration);this.stamp=now;this.timelineAt=typeof performance!=='undefined'?performance.now():now;this.timelineSource=source;}
    current(now){return this.hasTimeline?clamp(this.position+(this.playback==='playing'?Math.max(0,now-this.stamp)/1000:0),0,this.duration):0;}
    setPlayback(kind,now){this.position=this.current(now);this.stamp=now;this.playback=kind;if(kind==='stopped')this.clear();}
  }
  function foldName(s){let n=String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();const fold=typeof globalThis!=='undefined'&&globalThis.NowPlaying&&globalThis.NowPlaying.foldChinese;return fold?fold(n):n;}
  function matchesKugouTimeline(e,title,artist){
    if(!e||!e.available||!title||!Array.isArray(e.trackLabels)||!e.trackLabels.length)return false;
    let t=foldName(title),a=foldName(artist);
    if(/酷狗|kugou|网易云|qq音乐|qqmusic/.test(a))a='';
    const pieces=new Set();
    for(const label of e.trackLabels){const name=foldName(label);if(!name)continue;pieces.add(name);for(const part of name.split(' - '))if(part)pieces.add(part);}
    if(a&&pieces.has(t)&&pieces.has(a))return true;
    if(a&&(pieces.has(t+' - '+a)||pieces.has(a+' - '+t)))return true;
    return !a&&pieces.has(t);
  }
  return {TrackState,formatTime,playbackKind,clamp,matchesKugouTimeline};
});
