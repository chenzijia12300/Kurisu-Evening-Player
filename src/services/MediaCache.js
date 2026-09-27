(() => {
  const N=window.NowPlaying;
  N.MediaCache=class {
    constructor(storage){this.key='kurisu-now-playing-v3';this.entries={};try{this.storage=storage===undefined?window.localStorage:storage;const data=JSON.parse(this.storage?.getItem(this.key)||'{}');if(data.version===1&&data.entries&&typeof data.entries==='object')this.entries=data.entries;}catch(_){}this.prune();}
    prune(){const now=Date.now();for(const [key,e] of Object.entries(this.entries))if(!e||!Number.isFinite(e.expires)||e.expires<now)delete this.entries[key];const keys=Object.keys(this.entries).sort((a,b)=>this.entries[b].used-this.entries[a].used);for(const key of keys.slice(100))delete this.entries[key];}
    get(key){const e=this.entries[key];if(!e||e.expires<Date.now())return undefined;e.used=Date.now();return e.value;}
    set(key,value,ttl){this.entries[key]={value,expires:Date.now()+ttl,used:Date.now()};this.prune();let text=JSON.stringify({version:1,entries:this.entries});while(text.length>750000&&Object.keys(this.entries).length){const oldest=Object.keys(this.entries).sort((a,b)=>this.entries[a].used-this.entries[b].used)[0];delete this.entries[oldest];text=JSON.stringify({version:1,entries:this.entries});}try{this.storage?.setItem(this.key,text);}catch(_){N.log('Cache is memory-only');}}
    clear(){this.entries={};try{this.storage?.removeItem(this.key);}catch(_){}}
  };
})();
