(() => {
  const N=window.NowPlaying,quote=s=>'"'+String(s).replace(/[\\"]/g,'\\$&')+'"';
  N.safeCoverURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='coverartarchive.org'||u.hostname==='archive.org'||u.hostname.endsWith('.archive.org'));}catch(_){return false;}};
  N.MusicBrainzArtworkProvider=class extends N.ArtworkProvider {
    async find(track,signal){
      if(!track.artist)return null;
      const mb=async(path,params={})=>{const url=new URL('https://musicbrainz.org/ws/2/'+path);url.searchParams.set('fmt','json');for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);return N.requestJSON(url.href,signal,'musicbrainz');};
      const query='recording:'+quote(track.title)+' AND artist:'+quote(track.artist);
      let data=await mb('recording',{query:query+(track.album?' AND release:'+quote(track.album):''),limit:'12'});
      if(!data?.recordings?.length&&track.album)data=await mb('recording',{query,limit:'12'});
      const rows=(data?.recordings||[]).map(r=>({raw:r,title:r.title,artist:(r['artist-credit']||[]).map(a=>a.name||a.artist?.name||'').join(' '),album:track.album?(r.releases||[]).map(x=>x.title).sort((a,b)=>N.similarity(track.album,b)-N.similarity(track.album,a))[0]:'',duration:Number(r.length)/1000}));
      const matched=N.chooseMatch(track,rows);if(!matched)return null;
      const recording=matched.row.raw;
      let releases=recording.releases||[];
      if(!releases.length)releases=(await mb('recording/'+recording.id,{inc:'releases'}))?.releases||[];
      releases=releases.map(r=>({r,score:track.album?N.similarity(track.album,r.title):(r.status==='Official'?.8:.5)})).filter(x=>!track.album||x.score>=.72).sort((a,b)=>b.score-a.score).slice(0,2).map(x=>x.r);
      const groups=new Set();
      const cover=async(type,id)=>{
        if(!/^[0-9a-f-]{36}$/i.test(id||''))return null;
        const data=await N.requestJSON('https://coverartarchive.org/'+type+'/'+id,signal,'artwork');
        const image=data?.images?.find(x=>x.front===true);if(!image)return null;
        // CAA still returns historical http:// archive links in some JSON.
        // Upgrade only to HTTPS; the hostname allowlist below remains mandatory.
        const url=String(image.thumbnails?.['1200']||image.thumbnails?.['500']||image.image||'').replace(/^http:/,'https:');
        if(!N.safeCoverURL(url))return null;
        return {url,source:'MusicBrainz / Cover Art Archive',match:{recording:recording.id,[type]:id,score:matched.score}};
      };
      for(const r of releases){
        const result=await cover('release',r.id);if(result)return result;
        const group=r['release-group']||(await mb('release/'+r.id,{inc:'release-groups'}))?.['release-group'];if(group?.id)groups.add(group.id);
      }
      for(const id of groups){const result=await cover('release-group',id);if(result)return result;}
      return null;
    }
  };
})();
