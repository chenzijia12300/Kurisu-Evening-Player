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

  const score=(track,row)=>{
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
  };
  N.lyricsMatch={unique,compact,splitArtists,titleInfo,score};
})();
