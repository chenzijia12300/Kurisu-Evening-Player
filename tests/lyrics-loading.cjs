const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER?{executablePath:process.env.PLAYWRIGHT_BROWSER}:{})});
  try{
    const page=await browser.newPage();
    for(const file of ['media-state.js','src/utils/track.js','src/utils/chinese.js','src/utils/lyricsMatch.js',
      'src/media/MediaState.js','src/media/WallpaperMediaProvider.js','src/services/MediaCache.js',
      'src/services/lyrics/lrcParser.js','src/services/lyrics/ttmlParser.js','src/services/lyrics/LyricsProvider.js',
      'src/services/lyrics/AmllLyricsProvider.js','src/services/lyrics/KugouLyricsProvider.js','src/media/MediaEnrichment.js']){
      await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    }
    const count=await page.evaluate(async()=>{
      const N=NowPlaying;let checks=0;
      const check=(ok,label)=>{checks++;if(!ok)throw Error(label);};
      const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
      const sample={available:true,ageMs:0,trackLabels:['NIGHT DANCER (夜中舞者) - imase','NIGHT DANCER (夜中舞者)','imase']};
      check(N.artistFromLabels(sample,'NIGHT DANCER (夜中舞者)')==='imase','Read artist from current exact-title label');
      check(N.artistFromLabels({...sample,trackLabels:['imase - NIGHT DANCER (夜中舞者)']},'NIGHT DANCER (夜中舞者)')==='imase','Reverse label');
      check(N.artistFromLabels({...sample,trackLabels:['Other Song - imase']},'NIGHT DANCER (夜中舞者)')==='','Do not borrow another song artist');
      check(N.artistFromLabels({...sample,ageMs:8000},'NIGHT DANCER (夜中舞者)')==='','Reject stale labels');
      check(N.artistFromLabels({...sample,trackLabels:['Song - Singer A','Song - Singer B']},'Song')==='','Reject ambiguous labels');
      check(N.artistFromLabels({...sample,trackLabels:['Song - 酷狗音乐']},'Song')==='','Reject player name');
      const media=new N.WallpaperMediaProvider();media.state.setProperties({title:'Song'});media.setTimeline({position:10,duration:200});
      check(media.refineArtist('Song','Singer')&&media.state.artist==='Singer'&&media.state.duration===200,'Artist refinement preserves timeline');
      check(!media.refineArtist('Song','Other')&&!media.refineArtist('Old song','Singer'),'Do not overwrite native artist or new song');
      const xml='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:m="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s">原文一<span m:role="x-translation" xml:lang="zh">译文一</span></p><p begin="2s">原文二</p></div></body></tt>';
      const item=(id,artist)=>({id,musicNames:['アイドル'],artistNames:[artist],albumNames:[]});
      let calls=0,items=[item(1,'YOASOBI')];
      N.requestJSON=async url=>{calls++;return url.includes('/get?')?{data:{id:1,lyrics:xml}}:{data:{items,pagination:{hasMore:false}}};};
      let found=await new N.AmllLyricsProvider().find({title:'アイドル (Idol)',artist:'',duration:0},new AbortController().signal);
      check(found?.match.inferredArtist&&found.match.artist==='YOASOBI'&&found.lines[0].translation==='译文一','Missing artist: one exact-title performer can resolve lyrics');
      check(calls<=12,'Missing-artist search budget');
      items=[item(1,'YOASOBI'),item(2,'Other Singer')];calls=0;
      found=await new N.AmllLyricsProvider().find({title:'アイドル',artist:''},new AbortController().signal);
      check(found===null&&calls===1,'Missing artist with multiple singers stays ambiguous');
      calls=0;found=await new N.AmllLyricsProvider().find({title:'花',artist:''},new AbortController().signal);
      check(found===null&&calls===0,'Short title without artist must not guess');
      N.requestJSON=async()=>({data:{items:[item(1,'YOASOBI')],pagination:{hasMore:true}}});
      found=await new N.AmllLyricsProvider().find({title:'アイドル',artist:''},new AbortController().signal);
      check(found===null,'Incomplete pagination cannot prove unique singer');
      N.requestJSON=async()=>{throw Error('temporary outage');};
      try{await new N.KugouLyricsProvider().find({title:'Song',artist:'Singer'},new AbortController().signal);throw Error('did not reject');}
      catch(e){check(e.message==='temporary outage','Kugou errors stay retryable instead of becoming no match');}
      N.requestJSON=async url=>url.includes('/api/v3/search/song')?{data:{info:[{songname:'NIGHT DANCER',singername:'imase',duration:210,hash:'fixture'}]}}:
        url.includes('/search?')?{candidates:[{id:'fixture',accesskey:'fixture'}]}:{content:'[00:01]Original fixture\n[00:02]Second fixture'};
      found=await new N.KugouLyricsProvider().find({title:'NIGHT DANCER (夜中舞者)',artist:'imase',duration:210},new AbortController().signal);
      check(found?.lines.length===2&&found.match.title==='NIGHT DANCER','Kugou shares translated-title matching instead of rejecting a valid song');
      found=await new N.KugouLyricsProvider().find({title:'NIGHT DANCER (Live)',artist:'imase',duration:210},new AbortController().signal);
      check(found===null,'Kugou still rejects a different recording version');
      calls=0;N.requestJSON=async()=>{calls++;throw Error('browser endpoint blocked');};N.bridgeReady=()=>true;
      N.bridgeLyrics=async()=>({title:'NIGHT DANCER',artist:'imase',duration:210,lyric:'[00:01]Original fixture\n[00:02]Second fixture'});
      found=await new N.KugouLyricsProvider().find({title:'NIGHT DANCER (夜中舞者)',artist:'imase',duration:210},new AbortController().signal);
      check(found?.lines.length===2&&calls===0,'Connected local lyrics bridge takes priority over blocked browser endpoint');
      delete N.bridgeReady;delete N.bridgeLyrics;
      const track={title:'Song',artist:'Singer',album:'',duration:0};
      const lyric=(source,translation='')=>({kind:'synced',source,id:source,lines:[{time:1,text:'original',translation}],plain:'original'});
      const make=(providers,timeout=1000)=>{
        const state={...track,enabled:true,contentType:'music',lyrics:null},written=[];
        const cache={get(){return undefined;},set(...args){written.push(args);}};
        const engine=new N.MediaEnrichment({state,subscribe(){return()=>{};}},()=>{},
          {lyricsProviders:providers,artworkProviders:[],cache,retryDelays:[],lyricsTimeout:timeout});
        const job=engine.jobs.lyrics={key:'test',control:new AbortController(),attempt:0};
        return {engine,state,job,written};
      };
      let resolvePrimary,slowSignal;
      let test=make([{find:()=>new Promise(resolve=>resolvePrimary=resolve)},
        {find:async()=>lyric('fast original')},{find:(t,signal)=>{slowSignal=signal;return new Promise(()=>{});}}]);
      let running=test.engine.run('lyrics',track,test.job);await tick();
      check(test.state.lyrics?.source==='fast original','Slow AMLL cannot block a fast original');
      resolvePrimary(lyric('AMLL','human translation'));await running;
      check(test.state.lyrics.source==='AMLL'&&slowSignal.aborted&&!test.job.failed,'Preferred translation upgrades and cancels stalled source');
      check(test.written.length===1&&test.written[0][2]===30*86400000,'Final translated result is cached');test.engine.dispose();
      test=make([{find:()=>new Promise(resolve=>resolvePrimary=resolve)},{find:async()=>lyric('other translation','human')}]);
      running=test.engine.run('lyrics',track,test.job);await tick();
      check(test.state.lyrics?.source==='other translation','Secondary translation appears while AMLL is pending');
      resolvePrimary(lyric('AMLL','preferred human'));await running;
      check(test.state.lyrics.source==='AMLL','AMLL wins equal-quality translation priority');test.engine.dispose();
      const bilingual=lyric('bilingual LRC');bilingual.lines[0].text='日本のうた\n中文译文';
      check(N.lyricsHaveTranslation(bilingual)&&!N.lyricsHaveTranslation({lines:[{text:'日本のうた\nnihon no uta'}]}),'Chinese at duplicate LRC timestamp counts as translation; romanization does not');
      let resolveOriginal;
      test=make([{find:async()=>null},{find:()=>new Promise(resolve=>resolveOriginal=resolve)},{find:async()=>bilingual}]);
      running=test.engine.run('lyrics',track,test.job);await tick();resolveOriginal(lyric('untranslated'));await running;
      check(test.state.lyrics===bilingual&&test.written[0][2]===30*86400000,'Slower original cannot replace bilingual LRC');test.engine.dispose();
      let primaryCalls=0,fallbackCalls=0;
      test=make([{find:async()=>{if(++primaryCalls===1)throw Error('offline');return lyric('recovered','human');}},
        {find:async()=>{fallbackCalls++;return lyric('fallback');}}]);
      await test.engine.run('lyrics',track,test.job);
      check(test.state.lyrics?.source==='fallback'&&test.job.failed&&test.written.length===0,'Transient source failure preserves original without negative cache');
      await test.engine.run('lyrics',track,test.job);
      check(primaryCalls===2&&fallbackCalls===1&&test.state.lyrics.source==='recovered','Retry only failed source, reuse successful original');test.engine.dispose();
      test=make([{find:()=>new Promise(()=>{})},{find:async()=>lyric('fast')}],40);
      const start=performance.now();await test.engine.run('lyrics',track,test.job);
      check(performance.now()-start<1000&&test.state.lyrics.source==='fast'&&test.job.failed,'Whole-source timeout bounds a hung provider');test.engine.dispose();
      test=make([{find:()=>new Promise(resolve=>resolvePrimary=resolve)},{find:async()=>null}]);
      running=test.engine.run('lyrics',track,test.job);await tick();test.engine.cancel('lyrics');resolvePrimary(lyric('stale','human'));await running;
      check(test.state.lyrics===null&&test.written.length===0,'Late cancelled song cannot publish or cache');test.engine.dispose();
      test=make([{find:async()=>null},{find:async()=>null}]);await test.engine.run('lyrics',track,test.job);
      check(test.state.lyricsStatus==='not-found'&&test.written[0][1]===null,'Completed empty search has a distinct status');test.engine.dispose();
      test=make([{find:async()=>{throw Error('offline');}}]);await test.engine.run('lyrics',track,test.job);
      check(test.state.lyricsStatus==='unavailable'&&test.written.length===0,'Network failure has a distinct status');test.engine.dispose();
      test=make([{find:async()=>null}]);test.state.artist='';await test.engine.run('lyrics',{...track,artist:''},test.job);
      check(test.state.lyricsStatus==='missing-artist','Missing artist has a distinct status');test.engine.dispose();
      const warm=lyric('cached'),warmCache={get(key){return key.startsWith('lyrics-v6:')?warm:undefined;},set(){}};
      test=make([{find:async()=>{throw Error('cache should avoid network');}}]);test.engine.cache=warmCache;test.engine.debounce=10000;test.engine.update();
      check(test.state.lyrics===warm,'Warm cache renders immediately without debounce');test.engine.dispose();
      return checks;
    });
    console.log(`PASS ${count} lyric loading, parallel sources, missing metadata and cancellation checks`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
