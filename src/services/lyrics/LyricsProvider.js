(() => {
  /** Provider contract: find(track, AbortSignal) -> {kind,lines,plain,source,id,match}|null. */
  window.NowPlaying.LyricsProvider=class {async find(){throw Error('LyricsProvider.find must be implemented');}};
})();
