(() => {
  /** Provider contract: find(track, AbortSignal) -> {url,source,match}|null. */
  window.NowPlaying.ArtworkProvider=class {async find(){throw Error('ArtworkProvider.find must be implemented');}};
})();
