(() => {
  const N=window.NowPlaying;
  const decode=s=>String(s||'').replace(/&(#x?[0-9a-f]+|\d+|[a-z]+);/gi,(m,e)=>{
    if(e[0]==='#'){const n=e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return Number.isFinite(n)?String.fromCodePoint(n):m;}
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()]||m;
  });
  const clock=v=>{const s=String(v||'').trim();if(s.endsWith('s'))return parseFloat(s)||0;const p=s.split(':').map(Number);if(p.some(n=>!Number.isFinite(n)))return 0;if(p.length===3)return p[0]*3600+p[1]*60+p[2];if(p.length===2)return p[0]*60+p[1];return p[0]||0;};
  const chinese=s=>/[\u4e00-\u9fff]/.test(s)&&!/[\u3040-\u30ff]/.test(s);
  N.parseTTML=text=>{
    if(typeof text!=='string')return [];
    const lines=[];
    for(const m of text.slice(0,500000).matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)){
      const time=clock(m[1].match(/\bbegin="([^"]+)"/i)?.[1]);
      const body=m[2];
      const translation=[...body.matchAll(/<span\b[^>]*\bttm:role="x-translation"[^>]*>([\s\S]*?)<\/span>/gi)].map(x=>decode(x[1].replace(/<[^>]+>/g,'')).replace(/\s+/g,' ').trim()).filter(chinese).join('');
      const main=decode(body.replace(/<span\b[^>]*\bttm:role="x-(?:translation|roman|bg)"[^>]*>[\s\S]*?<\/span>/gi,'').replace(/<[^>]+>/g,'')).replace(/\s+/g,' ').trim();
      if(!main&&!translation)continue;
      lines.push({time,text:main||translation,translation:main&&translation&&translation!==main?translation:''});
    }
    lines.sort((a,b)=>a.time-b.time);
    return lines;
  };
})();
