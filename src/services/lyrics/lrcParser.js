(() => {
  const N=window.NowPlaying;
  N.parseLRC=text=>{
    if(typeof text!=='string')return [];
    const offset=Number(text.match(/\[offset:\s*(-?\d+)\]/i)?.[1]||0)/1000,rows=[];
    for(const line of text.slice(0,200000).split(/\r?\n/)){
      const stamps=[...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const words=line.replace(/\[[^\]]*\]/g,'').trim();
      for(const m of stamps){if(Number(m[2])>=60)continue;rows.push({time:Math.max(0,Number(m[1])*60+Number(m[2])+Number('0.'+(m[3]||'0'))+offset),text:words});}
    }
    rows.sort((a,b)=>a.time-b.time);const merged=[];
    for(const row of rows){const last=merged[merged.length-1];if(last&&last.time===row.time){if(row.text&&!last.text.split('\n').includes(row.text))last.text=[last.text,row.text].filter(Boolean).join('\n');}else merged.push(row);}
    return merged;
  };
  N.lyricIndex=(rows,seconds)=>{let low=0,high=rows.length-1,index=-1;while(low<=high){const mid=(low+high)>>1;if(rows[mid].time<=seconds){index=mid;low=mid+1;}else high=mid-1;}return index;};
})();
