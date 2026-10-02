(() => {
  'use strict';
  const N=window.NowPlaying,XML='http://www.w3.org/XML/1998/namespace',
    TTM='http://www.w3.org/ns/ttml#metadata',ITUNES='http://music.apple.com/lyric-ttml-internal';
  const clock=value=>{
    const s=String(value||'').trim();let n;
    if(/^\d+(?:\.\d+)?ms$/.test(s))n=Number(s.slice(0,-2))/1000;
    else if(/^\d+(?:\.\d+)?s?$/.test(s))n=Number(s.replace(/s$/,''));
    else if(/^(?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?$/.test(s)){
      const p=s.split(':').map(Number);n=p.reduce((sum,x)=>sum*60+x,0);
      if(p.slice(1).some(x=>x>=60))return NaN;
    }
    return Number.isFinite(n)&&n>=0?n:NaN;
  };
  const language=node=>{
    for(let p=node;p?.nodeType===1;p=p.parentElement){const lang=p.getAttributeNS(XML,'lang');if(lang)return lang.toLowerCase();}
    return '';
  };
  const role=node=>node.getAttributeNS(TTM,'role')||'';
  const background=node=>{for(let p=node.parentElement;p;p=p.parentElement)if(role(p)==='x-bg')return true;return false;};
  const clean=s=>s.replace(/[\t\r\n ]+/g,' ').trim();
  // Read the tree rather than stripping tags: nested background vocals and romanization stay separate.
  const words=(node,main=false)=>{
    if(node.nodeType===3||node.nodeType===4)return node.nodeValue;
    if(node.nodeType!==1)return '';
    if(main&&/^(?:x-translation|x-roman|x-bg)$/.test(role(node)))return '';
    if(node.localName==='br')return ' ';
    return Array.from(node.childNodes).map(child=>words(child,main)).join('');
  };
  const chinese=(node,text)=>{
    const lang=language(node);
    if(lang)return /^zh(?:-|$)/.test(lang);
    return /[\u3400-\u9fff]/.test(text)&&!/[\u3040-\u30ff]/.test(text);
  };
  N.parseTTML=text=>{
    if(typeof text!=='string'||text.length>500000||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text))return [];
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.getElementsByTagNameNS('*','parsererror').length||doc.documentElement?.localName!=='tt')return [];
    const body=doc.getElementsByTagNameNS('*','body')[0];if(!body)return [];
    const header=new Map(),head=doc.getElementsByTagNameNS('*','head')[0];
    for(const block of Array.from(head?.getElementsByTagNameNS(ITUNES,'translation')||[])){
      if(block.getAttribute('type')!=='subtitle')continue;
      for(const node of Array.from(block.getElementsByTagNameNS(ITUNES,'text'))){
        const key=node.getAttribute('for'),value=clean(words(node));
        if(key&&value&&chinese(node,value)&&!header.has(key))header.set(key,value);
      }
    }
    const lines=[];
    for(const p of Array.from(body.getElementsByTagNameNS('*','p')).slice(0,9999)){
      const time=clock(p.getAttribute('begin'));if(!Number.isFinite(time))continue;
      const main=clean(words(p,true));if(!main)continue;
      // Prefer a tagged Chinese translation; untagged Han text is only a legacy fallback.
      const inline=Array.from(p.getElementsByTagNameNS('*','span')).filter(node=>role(node)==='x-translation'&&!background(node))
        .map(node=>({node,value:clean(words(node))})).filter(x=>x.value&&chinese(x.node,x.value));
      const translation=(inline.find(x=>/^zh(?:-|$)/.test(language(x.node)))||inline[0])?.value
        ||header.get(p.getAttributeNS(ITUNES,'key'))||'';
      const end=clock(p.getAttribute('end'));
      lines.push({time,text:main,translation:translation!==main?translation:'',...(Number.isFinite(end)&&end>=time?{end}:{})});
    }
    return lines.sort((a,b)=>a.time-b.time);
  };
})();
