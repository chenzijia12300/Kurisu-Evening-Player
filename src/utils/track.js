(() => {
  'use strict';
  const N=window.NowPlaying=window.NowPlaying||{};
  N.normalize=s=>{s=String(s||'').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();return N.foldChinese?N.foldChinese(s):s;};
  // "周杰伦 / 温岚" should still match "周杰伦". A short English token like "the" must not.
  N.nameScore=(a,b)=>{const sim=N.similarity(a,b);if(sim>=.65||!a||!b)return sim;const x=N.normalize(a),y=N.normalize(b),shorter=x.length<=y.length?x:y,longer=x.length<=y.length?y:x,parts=shorter.split(' ').filter(Boolean),have=new Set(longer.split(' ').filter(Boolean));if(!parts.length||!parts.every(t=>have.has(t)))return sim;const compact=parts.join(''),cjk=/[^\u0000-\u007f]/.test(compact);return (cjk?compact.length>=2:compact.length>=6)?Math.max(sim,.9):sim;};
  const PLAYER=/^(?:酷狗音乐|酷狗|网易云音乐|网易云|qq音乐|qqmusic|汽水音乐|咪咕音乐|spotify|itunes|apple music|foobar2000|vlc|potplayer)$/i;
  N.mediaQuery=s=>{let title=String(s.title||'').trim(),artist=String(s.artist||'').trim();const plain=N.normalize(artist).replace(/ /g,'');if(!artist||PLAYER.test(artist)||PLAYER.test(plain))artist='';if(!artist){const parts=title.split(/\s+[-–—]\s+/);if(parts.length>=2&&parts[0].trim()&&parts.slice(1).join(' - ').trim()){artist=parts[0].trim();title=parts.slice(1).join(' - ').trim();}}return {title,artist,album:s.album||'',albumArtist:s.albumArtist||'',duration:Number(s.duration)||0};};
  N.artistFromLabels=(sample,title)=>{
    if(!sample?.available||!Number.isFinite(Number(sample.ageMs))||Number(sample.ageMs)<0||Number(sample.ageMs)>=8000||!title)return '';
    const key=N.normalize(title),artists=new Set();
    for(const label of (Array.isArray(sample.trackLabels)?sample.trackLabels:[]).slice(0,50)){
      if(typeof label!=='string'||label.length>2000)continue;
      const parts=label.split(/\s+[-–—]\s+/);
      for(let i=1;i<parts.length;i++){
        const left=parts.slice(0,i).join(' - ').trim(),right=parts.slice(i).join(' - ').trim();
        const artist=N.normalize(left)===key?right:N.normalize(right)===key?left:'';
        if(artist&&N.normalize(artist)!==key&&!PLAYER.test(artist)&&!PLAYER.test(N.normalize(artist).replace(/ /g,'')))artists.add(artist);
      }
    }
    return artists.size===1?[...artists][0]:'';
  };
  N.trackKey=t=>JSON.stringify([t.title,t.artist,t.album].map(N.normalize));
  N.similarity=(a,b)=>{
    a=N.normalize(a);b=N.normalize(b);if(!a||!b)return 0;if(a===b)return 1;
    const grams=s=>{const out=new Map();for(let i=0;i<s.length-1;i++){const k=s.slice(i,i+2);out.set(k,(out.get(k)||0)+1);}return out;};
    if(a.length<2||b.length<2)return 0;
    const x=grams(a),y=grams(b);let same=0;for(const [g,n] of x)same+=Math.min(n,y.get(g)||0);
    return 2*same/(a.length+b.length-2);
  };
  const versions=s=>N.normalize(s).match(/\b(live|remix|instrumental|acoustic|karaoke)\b|现场|伴奏|翻唱/g)||[];
  N.matchScore=(track,candidate)=>{
    const title=N.similarity(track.title,candidate.title),artist=N.nameScore(track.artist,candidate.artist);
    if(title<.72||(track.artist&&artist<.65))return 0;
    if(versions(track.title).sort().join('|')!==versions(candidate.title).sort().join('|'))return 0;
    let sum=title*.55+artist*.35,weight=.55+(track.artist?.35:0);
    if(track.album&&candidate.album){sum+=N.similarity(track.album,candidate.album)*.10;weight+=.10;}
    let score=sum/weight;
    if(track.duration>0&&candidate.duration>0){const d=Math.abs(track.duration-candidate.duration);if(d>Math.max(12,track.duration*.06))return 0;score-=Math.min(.25,d/40);}
    else if(track.duration>0)score-=.05;
    return score;
  };
  N.chooseMatch=(track,rows)=>{
    const ranked=rows.map(row=>({row,score:N.matchScore(track,row)})).filter(x=>x.score>=.82).sort((a,b)=>b.score-a.score);
    if(!ranked.length||!track.artist)return null;
    return ranked[0];
  };
  N.log=(...args)=>{if(N.debug)console.debug('[NowPlaying]',...args);};
})();
