(() => {
  'use strict';
  const $=id=>document.getElementById(id),M=window.MediaState,provider=new NowPlaying.WallpaperMediaProvider(),state=provider.state,fallback='assets/kurisu-resting.png';
  const demo=new URLSearchParams(location.search).get('demo')==='1';
  const host=typeof window.wallpaperRegisterMediaPropertiesListener==='function';
  const buttons=['previous','toggle','next','volume-down','volume-up'];
  let bridgeToken='',bridgeReady=false,connecting=false,hostPaused=false,fps=30,lastFrame=0,raf=0,audioAt=0,showSpectrum=true;
  let values=new Float32Array(32),smooth=new Float32Array(32),toastTimer=0;
  let timelinePending=false,bridgeVersion=0;
  const canvas=$('spectrum'),ctx=canvas.getContext('2d');
  if(!host&&!demo){try{bridgeToken=localStorage.getItem('kurisu-controller-token')||'';}catch(_){}}
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
  const nowPlaying=new NowPlaying.NowPlaying(document.querySelector('.player'),state,{demo});
  const enrichment=new NowPlaying.MediaEnrichment(provider,()=>render(),{online:host&&!demo});
  function render(){
    nowPlaying.render(bridgeReady);
    buttons.forEach(id=>{$(id).disabled=!bridgeReady&&!demo;$(id).title=bridgeReady||demo?$(id).getAttribute('aria-label'):'连接本机控制器后启用';});
    $('connection').textContent=demo?'演示模式 · 歌曲信息为示例':bridgeReady?'播放控制已连接 · 设置 ↗':nowPlaying.connectionIssue?nowPlaying.connectionIssue+' · 设置 ↗':'连接播放控制（可选）↗';
  }
  function updateTimeline(){nowPlaying.tick(performance.now(),bridgeReady);}
  function nativeClockIsReal(){return state.hasTimeline&&!state.timelinePending&&state.timelineSource==='native'&&state.duration>0&&state.position>0;}
  async function pollKugouTimeline(){
    // KuGou's Windows session reports 0:00 / 0:00. The on-screen "01:23 / 04:05" label is the clock.
    if(demo||!state.enabled||hostPaused||document.hidden||!bridgeReady||bridgeVersion<3||!state.title||timelinePending||nativeClockIsReal())return;
    timelinePending=true;const title=state.title,artist=state.artist,token=bridgeToken;
    try{
      const sample=await request('/timeline');
      if(title!==state.title||artist!==state.artist||token!==bridgeToken||!bridgeReady||!state.enabled)return;
      if(nativeClockIsReal())return;
      if(M.matchesKugouTimeline(sample,title,artist)&&Number(sample.ageMs||0)<8000){provider.setTimeline(sample,performance.now()-Math.max(0,Number(sample.ageMs)||0),'kugou-window');updateTimeline();}
    }catch(_){/* An old controller or hidden KuGou window must not invent a timeline. */}
    finally{timelinePending=false;}
  }
  function clock(){const d=new Date(),pad=n=>String(n).padStart(2,'0');$('clock').textContent=pad(d.getHours())+':'+pad(d.getMinutes());$('clock').dateTime=d.toISOString();$('seconds').textContent=pad(d.getSeconds());$('date').textContent=d.getFullYear()+'.'+pad(d.getMonth()+1)+'.'+pad(d.getDate())+'  '+['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];}
  function resize(){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d));}
  function draw(t){raf=0;if(hostPaused||document.hidden)return;if(t-lastFrame>=1000/fps){lastFrame=t;nowPlaying.tick(t,bridgeReady);const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);const stale=t-audioAt>450;
      for(let i=0;i<32;i++){let target=showSpectrum?(demo&&state.playback==='playing'?(Math.sin(t/370+i*.7)+1)*.17+Math.abs(Math.sin(t/630+i))*.28:stale?0:values[i]):0;smooth[i]+=(target-smooth[i])*.24;const height=Math.max(1.5,smooth[i]*h);ctx.fillStyle='rgba(238,194,178,'+(.18+smooth[i]*.65)+')';ctx.fillRect(i*w/32+(w/32)*.23,(h-height)/2,w/32*.54,height);}
    }raf=requestAnimationFrame(draw);}
  function wake(){if(!raf&&!hostPaused&&!document.hidden)raf=requestAnimationFrame(draw);}
  function audio(data){if(hostPaused)return;audioAt=performance.now();for(let i=0;i<32;i++){const a=Number(data[i*2])||0,b=Number(data[64+i*2])||0;values[i]=M.clamp(Math.sqrt(Math.max(0,(a+b)/2))*.85,0,1);}}
  async function request(path,body){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1800);try{const r=await fetch('http://127.0.0.1:18743'+path,{method:body?'POST':'GET',headers:{'X-Kurisu-Token':bridgeToken,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store'});if(!r.ok){const error=new Error('连接失败 ('+r.status+')');error.status=r.status;throw error;}return await r.json();}finally{clearTimeout(timer);}}
  NowPlaying.bridgeReady=()=>bridgeReady&&bridgeVersion>=5;
  NowPlaying.bridgeLyrics=async(track,signal)=>{
    if(!bridgeReady||bridgeVersion<5)return null;
    const query=new URLSearchParams({title:track.title,artist:track.artist,album:track.album||'',duration:String(Math.round(track.duration||0))});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000),stop=()=>controller.abort();
    signal.addEventListener('abort',stop,{once:true});
    try{const response=await fetch('http://127.0.0.1:18743/lyrics?'+query,{headers:{'X-Kurisu-Token':bridgeToken},signal:controller.signal,cache:'no-store'});if(!response.ok)return null;return await response.json();}finally{clearTimeout(timer);signal.removeEventListener('abort',stop);}
  };
  async function connect(manual=false){if(demo)return;if(connecting)return;connecting=true;const requestedToken=bridgeToken;try{if(!bridgeToken){bridgeReady=false;nowPlaying.connectionIssue='';$('connect-result').textContent=host?'请先在 Wallpaper Engine 右侧壁纸属性中填写连接码。':'请填写连接码。';return;}const result=await request('/health');if(requestedToken!==bridgeToken)return;nowPlaying.connectionIssue='';bridgeReady=result.ok===true&&!result.dryRun;bridgeVersion=Number(result.version)||1;$('connect-result').textContent=bridgeReady?(bridgeVersion>=5?'本机控制器已连接。歌词优先使用酷狗曲库。':bridgeVersion>=4?'控制器已连接。重启一次控制器后，歌词会优先走酷狗曲库。':'播放控制已连接；酷狗时间和歌词需要重启新版控制器。'):'控制器处于测试模式，不会发送媒体键。';if(bridgeReady){pollKugouTimeline();enrichment.update();}}catch(error){if(requestedToken!==bridgeToken)return;bridgeReady=false;nowPlaying.connectionIssue=error.status===401?'连接码不匹配':error.status===403?'连接来源被拒绝':'';$('connect-result').textContent=error.status===401?'连接码不匹配，请复制当前运行的控制器所显示的完整连接码。':error.status===403?'请求来源被拒绝，请从本地文件或 Wallpaper Engine 打开。':'未能访问本机控制器，请确认 tools/start-controller.cmd 正在运行。';}finally{connecting=false;render();if(requestedToken!==bridgeToken)connect(manual);}}
  async function command(action){if(demo){if(action==='toggle'){state.setPlayback(state.playback==='playing'?'paused':'playing',performance.now());render();}else toast('当前为演示预览，不控制系统播放器');return;}if(!bridgeReady){openSettings();return;}try{await request('/command',{action});}catch(_){bridgeReady=false;render();toast('播放控制已断开，请重新连接本机控制器');}}
  buttons.forEach(id=>$(id).addEventListener('click',()=>command(id)));
  function openSettings(){$('token').value=host?'':bridgeToken;if(!$('settings-dialog').open)$('settings-dialog').showModal();if(host&&!bridgeToken)$('connect-result').textContent='请在 Wallpaper Engine 右侧壁纸属性中填写连接码。';}
  $('settings').addEventListener('click',openSettings);$('connection').addEventListener('click',openSettings);$('close-settings').addEventListener('click',()=>$('settings-dialog').close());
  $('settings-form').addEventListener('submit',async e=>{e.preventDefault();if(host||demo)return;bridgeToken=$('token').value.trim();try{localStorage.setItem('kurisu-controller-token',bridgeToken);}catch(_){}await connect(true);});
  $('retry-connect').addEventListener('click',()=>connect(true));
  $('disconnect').addEventListener('click',()=>{bridgeToken='';bridgeReady=false;nowPlaying.connectionIssue='';try{localStorage.removeItem('kurisu-controller-token');}catch(_){}$('token').value='';$('connect-result').textContent='已断开播放控制。';render();});
  window.wallpaperPropertyListener={
    applyUserProperties(p){if(p.mediadebug)NowPlaying.debug=!!p.mediadebug.value;nowPlaying.configure(p);if(!demo)enrichment.configure(p);if(window.HairMotion)window.HairMotion.setOptions(p);if(p.showclock)$('clock').closest('section').hidden=!p.showclock.value;if(p.spectrum){showSpectrum=!!p.spectrum.value;canvas.hidden=!showSpectrum;resize();}if(p.brightness)document.documentElement.style.setProperty('--scene-brightness',M.clamp(Number(p.brightness.value)/100,.6,1.2));if(p.widgets){document.querySelector('.widgets').hidden=!p.widgets.value;resize();}if(p.bridgetoken){bridgeToken=String(p.bridgetoken.value||'').trim();bridgeReady=false;connect();}},
    applyGeneralProperties(p){if(p.fps)fps=M.clamp(Number(p.fps),1,60);if(window.HairMotion)window.HairMotion.setOptions(p);},
    setPaused(paused){hostPaused=!!paused;if(window.HairMotion)window.HairMotion.setPaused(paused);if(hostPaused){cancelAnimationFrame(raf);raf=0;values.fill(0);smooth.fill(0);}else{clock();wake();}}
  };
  // Register synchronously at the end of body: Wallpaper Engine may emit initial data immediately.
  function register(name,fn){if(typeof window[name]==='function')window[name](fn);}
  provider.subscribe((_state,kind)=>{render();if(kind==='properties'||kind==='playback')pollKugouTimeline();});provider.start();
  register('wallpaperRegisterAudioListener',audio);
  if(demo){state.setProperties({title:'黄昏与你 · Evening With You',artist:'音乐组件演示 · 非真实播放'});state.setPlayback('playing',performance.now());state.setTimeline({position:86,duration:243},performance.now());state.lyrics={kind:'synced',id:'demo',source:'演示原创文字',plain:'让余晖慢慢落在窗前\n把此刻留给一首歌\n晚风轻轻经过',lines:[{time:0,text:'让余晖慢慢落在窗前'},{time:90,text:'把此刻留给一首歌'},{time:120,text:'晚风轻轻经过'}]};}
  $('host-instructions').hidden=!host||demo;$('browser-connection').hidden=host||demo;$('submit-connect').hidden=host||demo;$('retry-connect').hidden=!host||demo;$('disconnect').hidden=demo;
  if(demo){$('connection-description').textContent='这是外观演示，使用示例歌名和进度，不读取也不控制本机音乐。';$('controller-hint').textContent='请将 index.html 导入 Wallpaper Engine，在右侧壁纸属性中填写连接码。';}
  if(!host&&!demo){$('status').title='浏览器预览：歌曲同步需要在 Wallpaper Engine 中运行';$('connection-description').textContent='这是普通浏览器预览。可测试本机控制器连接，但不会获得 Wallpaper Engine 的歌曲信息；浏览器中填写的连接码不会自动同步到桌面壁纸。';}
  addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else{clock();wake();}});
  setInterval(()=>{if(!hostPaused&&!document.hidden){clock();updateTimeline();}},250);
  setInterval(()=>{if(bridgeToken&&!hostPaused&&!document.hidden)connect();},15000);
  setInterval(pollKugouTimeline,2000);
  resize();clock();render();wake();if(bridgeToken)connect();
})();
