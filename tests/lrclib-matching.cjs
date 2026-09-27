const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context={console,URL,AbortController,DOMException};context.window=context;
vm.createContext(context);
for(const file of ['utils/track','utils/chinese','services/lyrics/lrcParser','services/lyrics/LyricsProvider','services/lyrics/LrclibProvider']){
  vm.runInContext(fs.readFileSync(path.join(root,'src',file+'.js'),'utf8'),context);
}
const N=context.NowPlaying;
const song={title:'花 (feat. 花譜)',artist:'Guiano',album:'',duration:0};
const row=(id,title='花 - feat. 花譜',artist='Guiano',extras={})=>({id,trackName:title,artistName:artist,albumName:'花鳥風月',duration:208,
  syncedLyrics:'[00:01]first\n[00:02]second',plainLyrics:'first\nsecond',...extras});
async function lookup(track,reply,control=new AbortController()){
  const calls=[];N.requestJSON=async url=>{const u=new URL(url);calls.push(u);return reply(u,calls.length,control);};
  const result=await new N.LrclibProvider().find(track,control.signal);
  assert(calls.length<=18);assert.equal(new Set(calls.map(u=>u.href)).size,calls.length);
  return {result,calls};
}
(async()=>{
  let found=await lookup({...song,title:'花',duration:208},()=>row(1,'花'));
  assert.equal(found.result.id,1);assert.equal(found.calls.length,1);assert(found.calls[0].pathname.endsWith('/get'));
  found=await lookup(song,u=>u.searchParams.get('track_name')===N.normalize(song.title)?[row(2)]:[]);
  assert.equal(found.result.id,2);assert.equal(found.calls.length,2);assert.equal(found.result.kind,'synced');
  found=await lookup({...song,title:'花',artist:'Guiano / 花譜'},u=>u.searchParams.get('artist_name')==='Guiano'?[row(3,'花','Guiano feat. 花譜')]:[]);
  assert.equal(found.result.id,3);assert(found.calls.some(u=>u.searchParams.get('artist_name')==='Guiano'));
  found=await lookup(song,u=>u.searchParams.get('track_name')==='花'&&u.searchParams.get('artist_name')==='Guiano'?[row(4)]:[]);
  assert.equal(found.result.id,4);assert.equal(found.calls.at(-1).searchParams.get('track_name'),'花');
  found=await lookup(song,u=>u.searchParams.get('q')==='花 Guiano'?[row(5)]:[]);
  assert.equal(found.result.id,5);assert(found.calls.some(u=>u.searchParams.has('q')));
  // Artist-only title discovery cannot accept another singer or a longer title containing 花.
  found=await lookup(song,u=>!u.searchParams.has('artist_name')&&!u.searchParams.has('q')?
    [row(6,'花','Other Singer'),row(7,'花火','Guiano'),row(8),row(9,'花 (Live)','Guiano')]:[]);
  assert.equal(found.result.id,8);
  found=await lookup(song,()=>[row(10,'花','Guiano'),row(11,'花 - feat. 花譜','Guiano'),row(12,'花 (feat. Other Guest)','Guiano')]);
  assert.equal(found.result.id,11,'Preserve the requested guest recording');
  found=await lookup({...song,duration:208},()=>[row(13,undefined,undefined,{duration:290}),row(14)]);
  assert.equal(found.result.id,14);
  found=await lookup(song,()=>[row(15,undefined,undefined,{syncedLyrics:'[00:01]\n[00:02]',plainLyrics:'   '}),row(16)]);
  assert.equal(found.result.id,16,'Empty timestamp rows must not hide usable lyrics');
  found=await lookup(song,()=>[row(17,undefined,undefined,{syncedLyrics:'',plainLyrics:'available words'})]);
  assert.equal(found.result.kind,'plain');assert(found.calls.length>2,'Plain lyrics do not end synchronized discovery');
  found=await lookup(song,()=>[row(18,'花 (Live)','Guiano'),row(19,'花 (Remix)','Guiano')]);
  assert.equal(found.result,null);
  found=await lookup({...song,title:'花 (Live)'},u=>u.searchParams.get('track_name')==='花'?[row(20,'花 - Live'),row(21,'花')]:[]);
  assert.equal(found.result.id,20,'Suffix removal must still preserve live versions');
  found=await lookup({...song,title:'花 (2024 Remastered)'},u=>u.searchParams.get('track_name')==='花'?[row(22,'花')]:[]);
  assert.equal(found.result.id,22);
  found=await lookup({...song,title:'ＳＯＮＧ',artist:'Ｓｉｎｇｅｒ'},u=>u.searchParams.get('track_name')==='song'?[row(23,'Song','Singer')]:[]);
  assert.equal(found.result.id,23);
  found=await lookup({...song,title:'夢',artist:'周杰倫'},()=>[row(24,'梦','周杰伦')]);assert.equal(found.result.id,24);
  found=await lookup({...song,title:'Thunderstruck',artist:'AC/DC'},()=>[row(25,'Thunderstruck','AC/DC')]);assert.equal(found.result.id,25);
  found=await lookup({...song,title:'花',artist:'Guiano/花譜'},u=>u.searchParams.get('artist_name')==='Guiano'?[row(26,'花','Guiano, 花譜')]:[]);
  assert.equal(found.result.id,26);
  found=await lookup({...song,title:'Song (Part 2)',artist:'Singer'},()=>[row(27,'Song','Singer')]);assert.equal(found.result,null);
  found=await lookup(song,(_,count)=>{if(count===1)return [row(28,undefined,undefined,{syncedLyrics:'',plainLyrics:'saved words'})];throw Error('network unavailable');});
  assert.equal(found.result.id,28);assert.equal(found.calls.length,2);
  await assert.rejects(lookup(song,()=>{throw Error('HTTP 429');}),/HTTP 429/);
  const aborted=new AbortController();aborted.abort();await assert.rejects(lookup(song,()=>[],aborted),{name:'AbortError'});
  await assert.rejects(lookup(song,(_,__,control)=>{control.abort();return [row(29)];}),{name:'AbortError'});
  const many=Array.from({length:70},(_,i)=>row(100+i,'花','Other Singer'));many.push(row(30));
  found=await lookup(song,()=>many);assert.equal(found.result.id,30,'Do not discard every candidate after the first 40');
  found=await lookup({...song,artist:''},()=>{throw Error('Should not query without artist');});assert.equal(found.result,null);assert.equal(found.calls.length,0);
  console.log('PASS: 23 LRCLIB matching cases (ordered fallbacks, featured artist, short titles, duration, empty lyrics, versions, errors, cancellation, deduplication).');
})().catch(error=>{console.error(error);process.exitCode=1;});
