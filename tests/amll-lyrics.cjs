// Requires Playwright. Optional PLAYWRIGHT_MODULE and PLAYWRIGHT_BROWSER select an existing installation.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER?{executablePath:process.env.PLAYWRIGHT_BROWSER}:{})});
  try{
    const page=await browser.newPage();
    for(const file of ['utils/track','utils/chinese','utils/lyricsMatch','services/lyrics/ttmlParser',
      'services/lyrics/LyricsProvider','services/lyrics/AmllLyricsProvider','media/MediaEnrichment']){
      await page.addScriptTag({content:fs.readFileSync(path.join(root,'src',file+'.js'),'utf8')});
    }
    const count=await page.evaluate(async()=>{
      const N=window.NowPlaying;let checks=0;
      const check=(condition,label)=>{checks++;if(!condition)throw Error(label);};
      const xml=(body,head='',lang='')=>`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:m="http://www.w3.org/ns/ttml#metadata" xmlns:i="http://music.apple.com/lyric-ttml-internal" ${lang?`xml:lang="${lang}"`:''}><head>${head}</head><body><div>${body}</div></body></tt>`;
      const lyric=(translation=true)=>xml(`<p begin="1s" end="2s"><span>オリジナル</span>${translation?'<span m:role="x-translation" xml:lang="zh-CN">原创译文甲</span>':''}</p><p begin="2s">次の行${translation?'<span m:role="x-translation" xml:lang="zh-Hant">原創譯文乙</span>':''}</p>`);
      let lines=N.parseTTML(xml(`<p begin='00:01.500' end='3s'>君<span>と</span>&amp;<br/>私<span m:role='x-bg'><span>背景</span></span><span m:role='x-roman'>kimi</span><span m:role='x-translation' xml:lang='en'>English</span><span m:role='x-translation' xml:lang='zh-Hans-CN'>你<span>和</span>我 &amp; 世界</span></p>`, '', 'ja'));
      check(lines[0].time===1.5&&lines[0].end===3,'Clock timing and single quotes');
      check(lines[0].text==='君と& 私','Nested background/romanization/translation excluded');
      check(lines[0].translation==='你和我 & 世界','Namespace alias, nested translation and entities');
      const header=`<i:iTunesMetadata><i:translations><i:translation type="subtitle" xml:lang="en"><i:text for="L1">English</i:text></i:translation><i:translation type="subtitle" xml:lang="zh-Hans"><i:text for="L1">头部<span>译文</span></i:text><i:text for="L2">第二行译文</i:text></i:translation></i:translations></i:iTunesMetadata>`;
      lines=N.parseTTML(xml('<p begin="1000ms" i:key="L1">日本語</p><p begin="2s" i:key="L2">歌詞<span m:role="x-translation" xml:lang="zh">行内译文</span></p>',header,'ja'));
      check(lines[0].translation==='头部译文'&&lines[0].time===1,'Header translations linked by iTunes key');
      check(lines[1].translation==='行内译文','Inline and header do not duplicate');
      check(N.parseTTML(xml('<p begin="1s">原文<span m:role="x-translation">汉字译文</span></p>'))[0].translation==='汉字译文','Legacy untagged Chinese');
      check(N.parseTTML(xml('<p begin="1s">原文<span m:role="x-translation" xml:lang="ja">世界</span></p>'))[0].translation==='','Tagged Japanese Han is not Chinese');
      check(N.parseTTML(xml('<p begin="2s">二</p><p>missing</p><p begin="bad">bad</p><p begin="00:99">bad</p><p begin="1s">一</p>')).map(x=>x.time).join(',')==='1,2','Invalid times rejected, sorted');
      check(N.parseTTML('<tt><body>').length===0,'Malformed XML');
      check(N.parseTTML('<!DOCTYPE tt [<!ENTITY x "bad">]>'+lyric()).length===0,'DTD rejected');
      check(N.parseTTML('x'.repeat(500001)).length===0,'Size bound');
      check(N.parseTTML(xml('<p begin="1s"><span m:role="x-translation" xml:lang="zh">译文</span></p>')).length===0,'Translation without original rejected');
      check(N.parseTTML(xml('<p begin="1s">原文<span m:role="x-bg">伴唱<span m:role="x-translation" xml:lang="zh">伴唱译文</span></span></p>'))[0].translation==='','Background translation stays separate');
      const track={title:'春泥棒',artist:'Yorushika',album:'',duration:240};
      const item=(id,titles=['春泥棒'],artists=['ヨルシカ','Yorushika'])=>({id,musicNames:titles,artistNames:artists,albumNames:[]});
      const search=(items,hasMore=false)=>({data:{items,pagination:{hasMore}}});
      async function lookup(song,reply,control=new AbortController()){
        const calls=[];N.requestJSON=async(url,signal)=>{const u=new URL(url);calls.push(u);return reply(u,calls.length,control,signal);};
        const result=await new N.AmllLyricsProvider().find(song,control.signal);
        check(calls.filter(x=>x.pathname.endsWith('/search')).length<=12&&calls.filter(x=>x.pathname.endsWith('/get')).length<=4,'Request bounds');
        check(new Set(calls.map(x=>x.href)).size===calls.length,'No duplicate request');
        return {result,calls};
      }
      const detail=(u,text=lyric())=>({data:{id:Number(u.searchParams.get('id')),lyrics:text}});
      let found=await lookup(track,u=>u.pathname.endsWith('/get')?detail(u):search([item(1,['wrong title','春泥棒'])]));
      check(found.result?.id==='1'&&found.result.lines[0].translation==='原创译文甲','All title and artist aliases');
      found=await lookup({...track,title:'アイドル (偶像)',artist:'YOASOBI'},u=>u.pathname.endsWith('/get')?detail(u):search(u.searchParams.get('musicName')==='アイドル'?[item(18,['アイドル'],['YOASOBI'])]:[]));
      check(found.result?.id==='18','Translated title annotation discovery');
      found=await lookup(track,u=>u.pathname.endsWith('/get')?detail(u):search(!u.searchParams.has('artistName')?[item(2)]:[]));
      check(found.result?.id==='2'&&found.calls.some(u=>!u.searchParams.has('artistName')),'Title-only discovery retains artist gate');
      found=await lookup({...track,title:'盗春者'},u=>u.pathname.endsWith('/get')?detail(u):search(!u.searchParams.has('musicName')?[item(3,['春泥棒','盗春者'])]:[]));
      check(found.result?.id==='3','Artist-only discovers translated title alias');
      found=await lookup({...track,title:'たぶん',artist:'YOASOBI'},u=>u.pathname.endsWith('/get')?detail(u):search(u.searchParams.get('musicName')==='たぶん'?[item(4,['たぶん'],['YOASOBI'])]:[]));
      check(found.result?.id==='4','NFKC discovery and scoring');
      found=await lookup({title:'花 (feat. 花譜)',artist:'Guiano / 花譜',duration:0},u=>u.pathname.endsWith('/get')?detail(u):search(u.searchParams.get('artistName')==='Guiano'?[item(5,['花'],['Guiano','花譜'])]:[]));
      check(found.result?.id==='5','Split artists and preserve featured artist');
      found=await lookup({title:'花',artist:'Guiano',duration:0},()=>search([item(6,['花火'],['Guiano']),item(7,['花'],['Other Singer']),item(8,['花 (Live)'],['Guiano'])]));
      check(found.result===null&&!found.calls.some(u=>u.pathname.endsWith('/get')),'Short title, artist and recording guards');
      found=await lookup(track,u=>u.pathname.endsWith('/get')?detail(u,u.searchParams.get('id')==='10'?'<tt/>':lyric()):search([item(10),item(11)]));
      check(found.result?.id==='11','Empty detail does not hide next candidate');
      found=await lookup(track,u=>u.pathname.endsWith('/get')?detail(u,lyric(u.searchParams.get('id')==='13')):search([item(12),item(13)]));
      check(found.result?.id==='13','Prefer candidate with human translation over original only');
      found=await lookup(track,u=>u.pathname.endsWith('/get')?detail(u):search(u.searchParams.get('page')==='2'?[item(14)]:[item(15,['Wrong'])],u.searchParams.get('page')==='1'));
      check(found.result?.id==='14','Pagination');
      found=await lookup(track,u=>u.pathname.endsWith('/get')?detail(u,xml('<p begin="1s">一</p><p begin="400s">二</p>')):search([item(16)]));
      check(found.result===null,'Timeline grossly exceeds recording');
      found=await lookup(track,u=>{if(u.pathname.endsWith('/get'))return detail(u,lyric(false));if(u.searchParams.get('musicName')===track.title)return search([item(17)]);throw Error('HTTP 429');});
      check(found.result?.id==='17'&&found.result.retryTranslation===true,'Partial original survives failure but translation remains retryable');
      let calls=0;N.requestJSON=async()=>{calls++;throw Error('offline');};
      try{await new N.AmllLyricsProvider().find(track,new AbortController().signal);throw Error('did not reject');}catch(e){check(e.message==='offline'&&calls===1,'Network failure stops expansion');}
      const cancelled=new AbortController();cancelled.abort();calls=0;
      try{await new N.AmllLyricsProvider().find(track,cancelled.signal);throw Error('did not abort');}catch(e){check(e.name==='AbortError'&&calls===0,'Cancellation');}
      const original={kind:'synced',lines:[{time:1,text:'original'}],plain:'original',source:'fallback'};
      const human={...original,lines:[{time:1,text:'original',translation:'人工译文'}],source:'AMLL'};
      const state={enabled:true,title:'Song',artist:'Singer',contentType:'music',lyrics:null},provider={state,subscribe(){return()=>{};}};
      const written=[],cache={get(){return undefined;},set(...args){written.push(args);}};
      const engine=new N.MediaEnrichment(provider,()=>{},{cache,lyricsProviders:[{find:async()=>{throw Error('offline');}},{find:async()=>original}],artworkProviders:[],retryDelays:[]});
      let job=engine.jobs.lyrics={key:'test',control:new AbortController(),attempt:0};await engine.run('lyrics',track,job);
      check(state.lyrics===original&&job.failed&&written.length===0,'Fallback is visible; failed translation is retried without long cache');
      engine.lyricsProviders=[{find:async()=>human},{find:async()=>{throw Error('should not call');}}];
      job=engine.jobs.lyrics={key:'test2',control:new AbortController(),attempt:0};await engine.run('lyrics',track,job);
      check(state.lyrics===human&&!job.failed&&written[0][2]===30*86400000,'Human translation wins and caches');
      engine.lyricsProviders=[{find:async()=>original}];
      job=engine.jobs.lyrics={key:'test3',control:new AbortController(),attempt:0};await engine.run('lyrics',track,job);
      check(state.lyrics===human&&written[1][2]===86400000,'Original-only refinement preserves translation; original cache expires sooner');
      engine.dispose();
      N.KugouLyricsProvider=class {};N.LrclibProvider=class {};
      const defaults=new N.MediaEnrichment(provider,()=>{},{cache,artworkProviders:[]});
      check(defaults.lyricsProviders[0] instanceof N.AmllLyricsProvider,'AMLL is first source');
      defaults.dispose();return checks;
    });
    console.log(`PASS ${count} AMLL / TTML / translation fallback checks`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
