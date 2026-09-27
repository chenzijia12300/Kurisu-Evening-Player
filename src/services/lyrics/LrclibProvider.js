(() => {
  'use strict';
  const N=window.NowPlaying;
  const unique=values=>[...new Set(values.filter(Boolean))];
  const compact=value=>N.normalize(value).replace(/ /g,'');
  const splitArtists=value=>unique(String(value||'').normalize('NFKC').replace(/\bAC\/DC\b/gi,'AC\u0000DC')
    .split(/\s*(?:\b(?:featuring|feat\.?|ft\.?)\s+|[,，、;；&＆/]|\s+[x×]\s+)\s*/i)
    .map(part=>part.replace(/\u0000/g,'/').trim()).filter(Boolean)).slice(0,4);
  const versionTags=value=>{
    const text=N.normalize(value);
    return unique([
      /\blive\b|现场|現場/.test(text)?'live':'',
      /\bremix\b|混音/.test(text)?'remix':'',
      /\bacoustic\b|不插电|不插電/.test(text)?'acoustic':'',
      /\binstrumental\b|\bkaraoke\b|伴奏/.test(text)?'instrumental':'',
      /\bcover\b|翻唱/.test(text)?'cover':'',
      /\bradio edit\b|\bedit\b|剪辑版|剪輯版/.test(text)?'edit':''
    ]).sort();
  };
  const isTranslatedTitle=(main,annotation)=>{
    // Different scripts identify a possible display translation, not an arbitrary subtitle.
    const text=annotation.trim();
    if(!text||/\d|\b(?:part|pt|vol|volume|chapter|version|ver|live|remix|edit|feat|ft)\b|第|章|篇|部|版|现场|現場|伴奏|翻唱/i.test(text))return false;
    const script=value=>/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)?'kana':/\p{Script=Han}/u.test(value)?'han':/\p{Script=Latin}/u.test(value)?'latin':'';
    const a=script(main),b=script(text);
    return !!a&&!!b&&a!==b;
  };
  const titleInfo=value=>{
    let base=String(value||'').normalize('NFKC').trim();
    const features=[];
    // Credits may be in parentheses, after a dash, or part of the artist field.
    base=base.replace(/[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^\])]+)[\])]/gi,(_,names)=>{features.push(...splitArtists(names));return '';});
    base=base.replace(/\s*(?:[-–—]\s*)?\b(?:feat\.?|ft\.?|featuring)\s+(.+)$/i,(_,names)=>{features.push(...splitArtists(names));return '';});
    // Remove only recognizable metadata; meaningful titles such as "Song (Part 2)" survive.
    const metadata=/\blive\b|\bremix\b|\bacoustic\b|\binstrumental\b|\bkaraoke\b|\bcover\b|\b(?:re)?master(?:ed)?\b|\bradio edit\b|\bversion\b|现场|現場|伴奏|翻唱|不插电|不插電|重制|重製|修复|修復|版本|音质|音質/i;
    base=base.replace(/[([]([^\])]+)[\])]/g,(all,inside)=>metadata.test(inside)?'':all);
    base=base.replace(/\s+[-–—]\s+(.+)$/, (all,suffix)=>metadata.test(suffix)?'':all).trim();
    // Music clients append translations such as ヒッチコック (希区柯克).
    // Apply symmetrically to the local title and LRCLIB candidates.
    base=base.replace(/\s*[([]([^\])]+)[\])]\s*$/, (all,inside,offset)=>isTranslatedTitle(base.slice(0,offset),inside)?'':all).trim();
    return {base:base||String(value||''),features:unique(features),versions:versionTags(value)};
  };
  const artistScore=(wanted,actual)=>{
    if(!wanted||!actual)return 0;
    const a=splitArtists(wanted),b=splitArtists(actual);
    // Require the main credited artist, rather than accepting any shared guest.
    const primary=a[0];
    return Math.max(compact(wanted)===compact(actual)?1:0,...b.map(name=>compact(primary)===compact(name)?1:N.nameScore(primary,name)));
  };
  const credits=track=>unique([...titleInfo(track.title).features,...splitArtists(track.artist).slice(1)]);

  N.LrclibProvider=class extends N.LyricsProvider {
    constructor(){super();this.fallback=true;}
    score(track,row){
      const wanted=titleInfo(track.title),actual=titleInfo(row.title);
      const sameTitle=compact(track.title)===compact(row.title);
      const short=Math.min(compact(wanted.base).length,compact(actual.base).length)<=3;
      const baseScore=compact(wanted.base)===compact(actual.base)?1:short?0:N.similarity(wanted.base,actual.base);
      const title=sameTitle?1:baseScore*.97,artist=artistScore(track.artist,row.artist);
      if(title<.8||artist<.8)return null;
      // Removing a suffix expands discovery, but does not erase recording differences.
      if(wanted.versions.join('|')!==actual.versions.join('|'))return null;
      const expected=credits(track),found=credits(row);
      const shared=expected.some(a=>found.some(b=>compact(a)===compact(b)));
      if(expected.length&&found.length&&!shared)return null;
      const hasDuration=track.duration>0&&row.duration>0;
      const gap=hasDuration?Math.abs(track.duration-row.duration):0;
      if(hasDuration&&gap>Math.max(30,track.duration*.12))return null;
      // Album is evidence rather than a veto: singles and compilation releases differ.
      let score=title*.62+artist*.33+.05;
      if(track.album&&row.album)score-=.04*(1-N.similarity(track.album,row.album));
      if(expected.length&&!shared)score-=.09;
      if(hasDuration)score-=Math.min(.14,gap/200);
      else if(track.duration>0)score-=.04;
      return {row,score,gap,sharedCredits:shared};
    }
    async find(track,signal){
      if(!track.title||!track.artist)return null;
      const candidates=new Map(),requested=new Set();let queryError=null,requests=0;
      const collect=data=>{
        for(const r of (Array.isArray(data)?data:data?[data]:[]).slice(0,200)){
          if(!r||typeof r.trackName!=='string'||typeof r.artistName!=='string')continue;
          const row={...r,title:r.trackName,artist:r.artistName,album:r.albumName||'',duration:Number(r.duration)||0};
          const key=r.id??JSON.stringify([row.title,row.artist,row.album,row.duration]);
          if(candidates.size<1000||candidates.has(key))candidates.set(key,row);
        }
      };
      const select=()=>{
        const ranked=[...candidates.values()].map(row=>this.score(track,row)).filter(x=>x&&x.score>=.86)
          .sort((a,b)=>b.score-a.score||a.gap-b.gap||String(a.row.id).localeCompare(String(b.row.id)));
        const usable=[];
        for(const item of ranked){
          const r=item.row,lines=N.parseLRC(r.syncedLyrics),plain=String(r.plainLyrics||'').slice(0,200000);
          const words=lines.filter(line=>line.text.trim());
          if(!r.instrumental&&!plain.trim()&&!words.length)continue;
          usable.push({...item,result:{kind:r.instrumental?'instrumental':words.length>1?'synced':'plain',lines,
            plain:plain||lines.map(line=>line.text).join('\n'),source:'LRCLIB',id:r.id,
            match:{score:item.score,title:r.title,artist:r.artist,album:r.album,duration:r.duration}}});
        }
        if(!usable.length)return null;
        // Timing preference is limited to recordings with nearly the same confidence.
        return usable.find(item=>item.score>=usable[0].score-.02&&item.gap<=usable[0].gap+2&&item.result.kind==='synced')||usable[0];
      };
      const query=async(path,params)=>{
        if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
        if(queryError||requests>=18)return;
        const url=new URL('https://lrclib.net/api/'+path);
        for(const [key,value] of Object.entries(params))if(value!==''&&value!==undefined)url.searchParams.set(key,value);
        if(requested.has(url.href))return;
        requested.add(url.href);requests++;
        try{
          const data=await N.requestJSON(url.href,signal,'lyrics');
          if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
          collect(data);
        }
        catch(error){if(signal?.aborted||error.name==='AbortError')throw error;queryError=error;}
      };
      const ready=()=>{const best=select();return best&&best.score>=.94&&(best.result.kind==='synced'||best.result.kind==='instrumental')?best.result:null;};
      const full={track_name:track.title,artist_name:track.artist};
      // 1. Exact metadata lookup, then exact structured search (also without a timeline).
      if(track.duration>0){
        await query('get',{...full,album_name:track.album,duration:Math.round(track.duration)});
        let result=ready();if(result)return result;
        if(track.album){await query('get',{...full,duration:Math.round(track.duration)});result=ready();if(result)return result;}
      }
      await query('search',full);let result=ready();if(result)return result;
      // 2. NFKC, case, punctuation, whitespace, and Chinese character normalization.
      await query('search',{track_name:N.normalize(track.title),artist_name:N.normalize(track.artist)});
      result=ready();if(result)return result;
      // 3. Query each artist separately; always score against the original main artist.
      const artists=splitArtists(track.artist);
      if(artists.length>1)for(const artist of artists){await query('search',{track_name:track.title,artist_name:artist});result=ready();if(result)return result;}
      // 4. Strip recognized suffixes/feat credits for discovery, preserve them in scoring.
      const base=titleInfo(track.title).base;
      if(base!==track.title)for(const artist of unique([track.artist,...artists])){
        await query('search',{track_name:base,artist_name:artist});result=ready();if(result)return result;
      }
      // 5. Broader discovery. q searches any metadata field; title-only helps inconsistent credits.
      for(const artist of unique([artists[0],track.artist]))await query('search',{q:base+' '+artist});
      await query('search',{track_name:base});
      // 6. Re-rank all candidates locally; empty records never hide a usable lyric.
      const best=select();if(best)return best.result;
      if(queryError)throw queryError;
      return null;
    }
  };
})();
