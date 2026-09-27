(() => {
  'use strict';
  const canvas = document.getElementById('hair-scene');
  const scene = document.querySelector('.scene-depth');
  const gl = canvas.getContext('webgl', {alpha:false, antialias:false, depth:false, powerPreference:'low-power'});
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const options = {hairmotion:true, breathing:true, blinking:true, eyemotion:true, citylights:true, reflections:true, parallax:true, windowclouds:true};
  let ready=false, closedReady=false, cloudsReady=false, cloudsReadyAt=0, paused=false, strength=.55, fps=30;
  let raf=0, last=0, previous=0, time=0, blink=0, blinkStart=6+Math.random()*4;
  let nextGaze=3, gazeX=0, gazeY=0, gazeTargetX=0, gazeTargetY=0;
  const pointer={x:0,y:0,targetX:0,targetY:0};
  function fallback(){canvas.hidden=true;cancelAnimationFrame(raf);raf=0;ready=false;scene.style.transform='';}
  if(!gl){fallback();window.HairMotion={setOptions(){},setPaused(){}};return;}
  const vertex=`attribute vec2 a_position;
    varying vec2 v_uv;
    void main(){v_uv=vec2((a_position.x+1.0)*.5,(1.0-a_position.y)*.5);gl_Position=vec4(a_position,0.,1.);}`;
  const fragment=`precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image, u_closed, u_cloudA, u_cloudB, u_cloudC;
    uniform vec2 u_screen, u_imageSize, u_gaze, u_pointer;
    uniform float u_time, u_strength, u_breath, u_blink, u_lights, u_reflections, u_pan, u_clouds;
    float band(vec2 p,vec2 a,vec2 b,float width){vec2 ab=b-a;float h=clamp(dot(p-a,ab)/dot(ab,ab),0.,1.);float d=length(p-a-ab*h);return 1.-smoothstep(width*.35,width,d);}
    float ellipse(vec2 p,vec2 center,vec2 radius){return 1.-smoothstep(.7,1.,length((p-center)/radius));}
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float lamp(vec2 cell){float t=u_time/(5.+hash(cell+1.)*7.)+hash(cell+3.)*15.;float f=fract(t);f=f*f*(3.-2.*f);return mix(hash(cell+floor(t)),hash(cell+floor(t)+1.),f);}
    float eyeMask(vec2 pixel,vec2 center,vec2 radius,float angle){vec2 p=pixel-center;float c=cos(angle),s=sin(angle);p=vec2(c*p.x+s*p.y,-s*p.x+c*p.y);return 1.-smoothstep(.80,1.,length(p/radius));}
    vec3 cloudPlate(float index,vec2 uv){
      if(index<.5)return texture2D(u_cloudA,uv).rgb;
      if(index<1.5)return texture2D(u_cloudB,uv).rgb;
      return texture2D(u_cloudC,uv).rgb;
    }
    vec3 softCloudPlate(float index,vec2 uv){
      // Match the defocused city beyond the glass (~3 source-image pixels).
      // Blur only the sky texture, before compositing the sharp foreground hair.
      vec2 radius=vec2(14./1536.,14./1024.);
      vec3 color=cloudPlate(index,uv)*.20;
      color+=(cloudPlate(index,uv+vec2(radius.x,0.))+cloudPlate(index,uv-vec2(radius.x,0.))
             +cloudPlate(index,uv+vec2(0.,radius.y))+cloudPlate(index,uv-vec2(0.,radius.y)))*.12;
      color+=(cloudPlate(index,uv+radius)+cloudPlate(index,uv-radius)
             +cloudPlate(index,uv+vec2(radius.x,-radius.y))+cloudPlate(index,uv+vec2(-radius.x,radius.y)))*.08;
      return color;
    }
    void main(){
      // Pan a slightly closer crop of the original image. At each edge the reserved
      // margin becomes visible; there is no tilt, perspective or rubber-sheet warp.
      float fit=max(u_screen.x/u_imageSize.x,u_screen.y/u_imageSize.y)*mix(1.,1.10,u_pan);
      vec2 align=vec2(u_screen.x/u_screen.y<1.3333?.7:.5,.5);
      align=mix(align,mix(align,step(vec2(0.),u_pointer),abs(u_pointer)),u_pan);
      vec2 uv=(v_uv*u_screen-(u_screen-u_imageSize*fit)*align)/(u_imageSize*fit);
      float bodyEdge=.535-.30*uv.y;
      float person=smoothstep(bodyEdge-.025,bodyEdge+.025,uv.x)*(1.-smoothstep(.83,.89,uv.y));
      // Breathing: shoulders rise slightly while the forearms stay anchored on the desk.
      float cycle=sin(u_time*6.2831853/5.2)*u_breath;
      float head=ellipse(uv,vec2(.758,.343),vec2(.315,.47))*person;
      float coat=smoothstep(.32,.43,uv.x)*smoothstep(.43,.57,uv.y)*(1.-smoothstep(.77,.86,uv.y));
      vec2 breath=vec2((uv.x-.71)*.65*coat,-.42*head-1.4*coat)*cycle;
      uv-=breath/u_imageSize;
      vec3 base=texture2D(u_image,uv).rgb;
      float left=max(band(uv,vec2(.53,.22),vec2(.40,.49),.07),band(uv,vec2(.40,.49),vec2(.245,.845),.055));
      float right=band(uv,vec2(.975,.15),vec2(.979,.55),.045);
      float middle=ellipse(uv,vec2(.735,.245),vec2(.258,.375))*smoothstep(.015,.17,uv.y);
      float face=ellipse(uv,vec2(.805,.475),vec2(.173,.23));
      float sleeve=smoothstep(.55,.64,uv.y)*smoothstep(.48,.62,uv.x);
      float hairColor=smoothstep(.035,.12,base.r-base.b)*smoothstep(.025,.085,base.r-base.g);
      float roots=smoothstep(.12,.59,uv.y);
      float mask=max(left*roots,right*roots)*hairColor*(1.-face)*(1.-sleeve);
      float wind=sin(u_time*.58-uv.y*5.5)+.28*sin(u_time*.91-uv.y*9.+uv.x*4.);
      vec2 hairOffset=vec2(wind*6.2,sin(u_time*.48-uv.y*4.)*1.2)*mask*u_strength/u_imageSize;
      // Broad middle locks have their own stronger wave, anchored at the crown.
      // Keep iris/eyelids fixed even where the fringe approaches the eyes.
      vec2 referencePixel=uv*vec2(1672.,941.);
      float eyesGuard=max(eyeMask(referencePixel,vec2(1180.,425.),vec2(117.,61.),-.17),eyeMask(referencePixel,vec2(1438.,349.),vec2(113.,60.),-.53));
      float redHair=smoothstep(1.32,1.62,base.r/max(.03,base.g))*smoothstep(1.65,2.1,base.r/max(.03,base.b));
      float middleMask=middle*hairColor*redHair*(1.-sleeve)*(1.-eyesGuard);
      float middleWave=sin(u_time*.66-uv.y*3.7)+.22*sin(u_time*1.03-uv.x*7.);
      hairOffset+=vec2(middleWave*13.,sin(u_time*.56-uv.y*5.)*2.5)*middleMask*u_strength/u_imageSize;
      vec2 source=uv-hairOffset;
      vec2 pixel=source*vec2(1672.,941.);
      // Iris movement is confined to the two eyes and stays below two source pixels.
      float iris=max(ellipse(pixel,vec2(1184.,423.),vec2(44.,35.)),ellipse(pixel,vec2(1438.,351.),vec2(36.,38.)));
      vec2 eyeOffset=u_gaze*iris*(1.-u_blink)/u_imageSize;
      vec3 color=texture2D(u_image,clamp(source-eyeOffset,vec2(.001),vec2(.999))).rgb;
      if(u_clouds>0.){
        // Only the user-selected strip between the window mullion and the hair.
        // Three independently generated skies: A -> B -> C. Each incoming plate
        // is already moving right during the soft handover, with continuous UVs.
        // Extend behind the hair silhouette instead of leaving a diagonal strip
        // of the original blurred clouds. Use the displaced hair coordinates so
        // the foreground matte follows the moving strands, including thin tips.
        float boundary=.574-.216*source.y;
        float sky=smoothstep(.372,.378,source.x)*(1.-smoothstep(boundary-.004,boundary,source.x))*(1.-smoothstep(.258,.284,source.y));
        float nearHair=smoothstep(.492-.18*source.y,.515-.18*source.y,source.x);
        vec3 foreground=texture2D(u_image,source).rgb;
        // The upper strands reflect violet skylight; a fixed red/blue test would
        // cut holes in them. Follow the sky's warmer chroma toward the horizon.
        float hairStrand=smoothstep(1.22+1.8*source.y,1.43+1.8*source.y,foreground.r/max(.025,foreground.g));
        sky*=1.-hairStrand*nearHair;
        if(sky>0.){
        float cycle=u_time/24.;
        float stage=mod(floor(cycle),3.),phase=fract(cycle);
        vec2 local=vec2(clamp((uv.x-.374)/.15,0.,1.),clamp(uv.y/.285,0.,1.));
        vec2 currentUV=vec2(.20+local.x*.55-phase*.16,local.y);
        vec2 nextUV=vec2(.20+local.x*.55+(1.-phase)*.16,local.y);
        // A short three-second handover avoids spending most of the cycle with
        // two translucent cloud banks superimposed on one another.
        float handover=smoothstep(.875,1.,phase);
        vec3 drifting=softCloudPlate(stage,currentUV);
        if(handover>0.)drifting=mix(drifting,softCloudPlate(mod(stage+1.,3.),nextUV),handover);
        color=mix(color,drifting,sky*u_clouds);
        }
      }
      if(u_blink>0.){
        float eyes=max(eyeMask(pixel,vec2(1180.,425.),vec2(110.,55.),-.17),eyeMask(pixel,vec2(1438.,349.),vec2(105.,52.),-.53));
        // The eyelid texture is an aligned auxiliary frame; only the eyes are blended.
        vec3 closed=texture2D(u_closed,source).rgb;
        color=mix(color,closed,eyes*u_blink);
      }
      if(u_lights>0.){
        float leftCity=(1.-smoothstep(.317,.334,uv.x))*smoothstep(.285,.335,uv.y)*(1.-smoothstep(.65,.70,uv.y));
        float rightCity=smoothstep(.375,.385,uv.x)*(1.-smoothstep(bodyEdge-.045,bodyEdge-.025,uv.x))*smoothstep(.335,.365,uv.y)*(1.-smoothstep(.445,.49,uv.y));
        float warmWindow=smoothstep(.027,.105,base.r-base.b)*smoothstep(.11,.26,dot(base,vec3(.3,.5,.2)));
        vec2 cell=floor(uv*u_imageSize/vec2(14.,22.));
        float variation=(lamp(cell)-.5)*.40;
        color*=1.+max(leftCity,rightCity)*warmWindow*variation*u_lights;
      }
      if(u_reflections>0.){
        float table=smoothstep(.865,.905,uv.y)*smoothstep(.195,.24,uv.x)*(1.-smoothstep(.66,.78,uv.x));
        float pools=exp(-pow((uv.x-.253)/.022,2.))*(lamp(vec2(30.,16.))-.5)
                   +exp(-pow((uv.x-.307)/.019,2.))*(lamp(vec2(36.,18.))-.5)
                   +exp(-pow((uv.x-.402)/.031,2.))*(lamp(vec2(48.,17.))-.5)
                   +exp(-pow((uv.x-.447)/.024,2.))*(lamp(vec2(53.,16.))-.5);
        float gloss=.65+.35*sin(uv.y*215.+sin(uv.x*53.)*.4);
        color+=vec3(.9,.47,.24)*pools*table*gloss*.045*u_reflections;
      }
      gl_FragColor=vec4(color,1.);
    }`;
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  let program;
  const uniforms={};
  try{
    program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    for(const name of ['screen','imageSize','time','strength','breath','blink','lights','reflections','gaze','pointer','image','closed','pan','clouds','cloudA','cloudB','cloudC'])uniforms[name]=gl.getUniformLocation(program,'u_'+name);
    gl.uniform1i(uniforms.image,0);gl.uniform1i(uniforms.closed,1);
    gl.uniform1i(uniforms.cloudA,2);gl.uniform1i(uniforms.cloudB,3);gl.uniform1i(uniforms.cloudC,4);
  }catch(error){console.warn('Scene animation unavailable; using still artwork.',error);fallback();window.HairMotion={setOptions(){},setPaused(){}};return;}
  function active(){return Object.values(options).some(Boolean);}
  function resize(){
    const ratio=Math.min(devicePixelRatio||1,1.5),limit=Math.min(1,2560/(innerWidth*ratio));
    canvas.width=Math.round(innerWidth*ratio*limit);canvas.height=Math.round(innerHeight*ratio*limit);
    gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(uniforms.screen,innerWidth,innerHeight);if(ready)render();
  }
  function render(){
    gl.uniform1f(uniforms.time,time);gl.uniform1f(uniforms.strength,options.hairmotion?strength:0);
    gl.uniform1f(uniforms.breath,options.breathing?1:0);gl.uniform1f(uniforms.blink,options.blinking&&closedReady?blink:0);
    gl.uniform1f(uniforms.lights,options.citylights?1:0);gl.uniform1f(uniforms.reflections,options.citylights&&options.reflections?1:0);
    gl.uniform2f(uniforms.gaze,options.eyemotion?gazeX:0,options.eyemotion?gazeY:0);
    gl.uniform2f(uniforms.pointer,options.parallax?pointer.x:0,options.parallax?pointer.y:0);
    gl.uniform1f(uniforms.pan,options.parallax?1:0);gl.uniform1f(uniforms.clouds,options.windowclouds&&cloudsReady?ease((time-cloudsReadyAt)/1.5):0);
    gl.drawArrays(gl.TRIANGLES,0,6);
    scene.style.transform='';
  }
  const ease=n=>{n=Math.max(0,Math.min(1,n));return n*n*(3-2*n);};
  function animate(dt){
    time+=dt;
    const b=time-blinkStart;
    if(b<0)blink=0;
    else if(b<.10)blink=ease(b/.10);
    else if(b<.145)blink=1;
    else if(b<.32)blink=1-ease((b-.145)/.175);
    else{blink=0;blinkStart=time+5.5+Math.random()*6;}
    if(time>=nextGaze){gazeTargetX=(Math.random()-.5)*2.4;gazeTargetY=(Math.random()-.5)*1.2;nextGaze=time+3.5+Math.random()*4;}
    const gazeEase=1-Math.exp(-dt*1.8),pointerEase=1-Math.exp(-dt*4.5);
    gazeX+=(gazeTargetX-gazeX)*gazeEase;gazeY+=(gazeTargetY-gazeY)*gazeEase;
    pointer.x+=(pointer.targetX-pointer.x)*pointerEase;pointer.y+=(pointer.targetY-pointer.y)*pointerEase;
  }
  function run(t){
    raf=0;if(!ready||!active()||paused||document.hidden||reduced.matches)return;
    if(t-last>=1000/fps){if(previous)animate(Math.min(1.2,(t-previous)/1000));previous=t;last=t;render();}
    raf=requestAnimationFrame(run);
  }
  function sync(){
    cancelAnimationFrame(raf);raf=0;previous=0;canvas.hidden=!ready||!active()||reduced.matches;
    if(ready)render();if(canvas.hidden)scene.style.transform='';
    if(!canvas.hidden&&!paused&&!document.hidden)raf=requestAnimationFrame(run);
  }
  window.HairMotion={
    setOptions(p){
      for(const name of Object.keys(options))if(p[name])options[name]=!!p[name].value;
      if(p.windstrength){const value=Number(p.windstrength.value);if(Number.isFinite(value))strength=Math.max(0,Math.min(1,value/100));}
      if(p.fps&&Number.isFinite(Number(p.fps)))fps=Math.max(1,Math.min(30,Number(p.fps)));
      sync();
    },
    setPaused(value){paused=!!value;sync();}
  };
  function texture(image,unit){
    const tex=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
  }
  const artwork=new Image();
  artwork.onload=()=>{
    try{
      texture(artwork,0);texture(artwork,1);
      // Complete placeholder textures keep WebGL valid while the independent assets load.
      for(let unit=2;unit<=4;unit++)texture(artwork,unit);
      gl.uniform2f(uniforms.imageSize,artwork.naturalWidth,artwork.naturalHeight);ready=true;resize();sync();
      const closed=new Image();closed.onload=()=>{try{texture(closed,1);closedReady=true;}catch(error){console.warn('Blink texture unavailable',error);}};closed.src='assets/kurisu-eyes-closed.png';
      canvas.dataset.cloudAssets='loading';
      Promise.all(['a','b','c'].map((name,index)=>new Promise((resolve,reject)=>{
        const plate=new Image();plate.onload=()=>{try{texture(plate,index+2);resolve();}catch(error){reject(error);}};
        plate.onerror=()=>reject(Error('Cloud plate '+name+' failed to load'));plate.src='assets/clouds-'+name+'.png';
      }))).then(()=>{cloudsReady=true;cloudsReadyAt=time;canvas.dataset.cloudAssets='ready';}).catch(error=>{canvas.dataset.cloudAssets='unavailable';console.warn('Cloud assets unavailable; retaining original sky.',error);});
    }catch(error){console.warn('Artwork unavailable',error);fallback();}
  };
  artwork.onerror=fallback;artwork.src='assets/kurisu-resting.png';
  addEventListener('pointermove',event=>{pointer.targetX=Math.max(-1,Math.min(1,event.clientX/innerWidth*2-1));pointer.targetY=Math.max(-1,Math.min(1,event.clientY/innerHeight*2-1));},{passive:true});
  document.addEventListener('pointerleave',()=>{pointer.targetX=0;pointer.targetY=0;});
  addEventListener('blur',()=>{pointer.targetX=0;pointer.targetY=0;});
  addEventListener('resize',resize);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fallback();});
})();
