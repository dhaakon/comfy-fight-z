// Arena renderer chooser: PixiJS (WebGPU/WebGL) on the arena canvas when the vendored library is present and
// initializes, otherwise the Canvas 2D renderer on the overlay canvas. ?renderer=canvas forces the fallback.
(function (root) {
  'use strict';
  function create(options) {
    const forced = new URLSearchParams(root.location?.search || '').get('renderer');
    const canvas2d = root.CFZCanvasRenderer.create({ ...options, canvas: options.hud || options.canvas });
    let active = canvas2d;
    const arena = {
      get kind() { return active.kind; },
      // Draw time is a running average for FighterDebug.rendererStats().
      draw: frame => { const started = performance.now(); active.draw(frame); const spent = performance.now() - started; arena.avgDrawMs = arena.avgDrawMs === undefined ? spent : arena.avgDrawMs * .9 + spent * .1; },
      reset: () => active.reset(),
      // Uploads and compiles what a match will draw; the Canvas path has nothing to warm.
      prepare: frame => { try { active.prepare?.(frame); } catch (error) { console.warn('[CFZ arena] prepare skipped:', error); } },
      pixel: (x, y) => active.pixel(x, y),
      stats: () => ({ ...(active.stats?.() || {}), avgDrawMs: Number((arena.avgDrawMs || 0).toFixed(2)) })
    };
    if (forced !== 'canvas' && root.PIXI && root.CFZPixiRenderer && options.hud) {
      root.CFZPixiRenderer.create({ ...options, screen: canvas2d })
        .then(renderer => { active = renderer; })
        .catch(error => console.warn('[CFZ arena] Pixi renderer unavailable, staying on Canvas 2D:', error));
    }
    return arena;
  }
  root.CFZArena = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
