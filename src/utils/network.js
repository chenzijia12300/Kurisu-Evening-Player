(() => {
  const N=window.NowPlaying,queues=new Map(),next=new Map();
  const abort=()=>new DOMException('Request cancelled','AbortError');
  const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(abort());
    const cancel=()=>{clearTimeout(timer);reject(abort());};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},Math.max(0,ms));
    signal?.addEventListener('abort',cancel,{once:true});
  });
  async function reserve(service,spacing,signal){
    const before=queues.get(service)||Promise.resolve();
    const task=before.catch(()=>{}).then(async()=>{
      const claim=async()=>{
        let stored=0;try{stored=Number(localStorage.getItem('np-rate-'+service))||0;}catch(_){}
        const at=Math.max(Date.now(),next.get(service)||0,Math.min(stored,Date.now()+60000));
        await sleep(at-Date.now(),signal);
        const future=Date.now()+spacing;next.set(service,future);
        try{localStorage.setItem('np-rate-'+service,String(future));}catch(_){}
      };
      if(navigator.locks)await navigator.locks.request('np-rate-'+service,{signal},claim);else await claim();
    });
    queues.set(service,task);await task;
  }
  N.requestJSON=async(url,signal,service='lyrics')=>{
    if(signal?.aborted)throw abort();
    await reserve(service,service==='musicbrainz'?1200:400,signal);
    const control=new AbortController(),cancel=()=>control.abort();signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)control.abort();
    const timer=setTimeout(cancel,10000);
    try{
      const headers={Accept:'application/json'};if(service==='lyrics')headers['Lrclib-Client']='Kurisu Evening Player';
      const response=await fetch(url,{signal:control.signal,credentials:'omit',referrerPolicy:'no-referrer',headers});
      if(response.status===404)return null;
      if(response.status===429||response.status===503){
        const header=response.headers.get('Retry-After');
        const wait=Number(header)>0?Number(header)*1000:Math.max(10000,Date.parse(header)-Date.now()||0);
        const until=Date.now()+Math.min(60000,Math.max(1000,wait));next.set(service,until);
        try{localStorage.setItem('np-rate-'+service,String(until));}catch(_){}
        const error=Error(service+' HTTP '+response.status);error.retryAfter=until-Date.now();throw error;
      }
      if(!response.ok)throw Error(service+' HTTP '+response.status);
      const raw=await response.text();if(raw.length>2000000)throw Error('Response too large');return JSON.parse(raw);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  };
})();
