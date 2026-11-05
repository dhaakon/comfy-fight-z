# Pixi port plan

Replace the arena's Canvas 2D draw path with a PixiJS renderer, keeping the simulation, pose choreography, DOM menus and multiplayer untouched. This document is the contract for the `pixi-port` branch.

## Why

- Sprite batching on the GPU, with crisp output at any device pixel ratio.
- Real effects for the Dragon Ball Z direction: additive auras, particle bursts, speed lines, afterimages, impact flashes and screen shake with rotation, none of which the 2D path can do cheaply.
- Per-sprite tint, hue shift and flash through filters instead of `ctx.filter`, which is slow and uneven across browsers.
- One place for all arena drawing, so presentation changes stop touching `game.js`.

## What does not change

- `build/public/engine.js`: deterministic simulation, no `Math.random`, server-authoritative multiplayer. Not modified.
- `build/public/anim.js`: pose selection and visual transforms (`sample()`, `resolvePose()`, the pose fallbacks). The renderer consumes its output.
- The DOM: title, character select, split-screen intro, VS and result screens, HUD, settings, asset lab, network dialogs and the phone controller stay HTML/CSS. The intro's sprite entrances keep their small 2D canvases.
- `assets.json`, `audio.json`, `video.json`, the builder, the exported game layout, `npm start`, QR pairing and the strict export checks.
- The window-level test surface: `window.FighterDebug.snapshot()` and `presentation()`, every element id the browser tests use.

## Architecture

```
game.js  ──frame state──▶  render/arena.js  ──▶  render/pixi-renderer.js   (WebGPU/WebGL via vendored Pixi v8)
                                    └───────▶  render/canvas-renderer.js  (today's 2D code, kept as the fallback)
```

- `build/public/render/arena.js`: picks the Pixi renderer when `PIXI` loaded and `Application.init()` succeeds, otherwise the Canvas renderer. Exposes `draw(frame)`, `resize()`, `pixel(x, y)` (for tests) and `destroy()`.
- `frame`: `{ state, fighters, view, images, manifest, stageIndex, cutin, options, time }`, the values `render()` already reads. The renderer never mutates game state.
- `render/pixi-renderer.js`:
  - `Application` on the existing `#arena` canvas, `resolution = devicePixelRatio`, `autoDensity`, logical size 960×540 (the engine's screen space, `SCREEN_W` 960, `GROUND` 438).
  - Containers: `stage` (background layers with parallax), `world` (camera: zoom, lift, shake, rotation), `fighters`, `effects`, `overlay` (KO/super flash, cut-in).
  - Textures from the already-loaded `HTMLImageElement`s in `images` (`Texture.from(image)`), cached per `src`; only the two fighters in play plus effects are uploaded, and `Assets.unload` runs when a match ends.
  - One `Sprite` per fighter. Each frame: `anim.sample()` → pose → texture swap, anchor from the pose metadata (`ax`, `ay` over `w`, `h`), position/scale/rotation from the sample, `scale.x` sign from `facing`, spin for rolls.
  - Afterimages: pooled sprites fed by the same travel history rule as today (`trail` only on real movement, never on stationary attacks).
  - Hit flash: `ColorMatrixFilter` brightness/saturation, mirror-match palette: `ColorMatrixFilter.hue`. Both cached, one filter instance per fighter.
  - Effects from `manifest.effects` as sprites; sparks and dust as a small pooled particle system (additive blend).
  - Projectiles, super cut-in (hero art slide + burst), KO slow-motion vignette, "FIRST ATTACK"/"COUNTER" callouts stay DOM.
  - Scanline/CRT display modes stay CSS filters on `.canvas-wrap`.
- `render/canvas-renderer.js`: today's `render()` internals moved verbatim, so a browser without WebGL still plays.

## Vendoring

- `build/public/vendor/pixi.min.js` (PixiJS v8, MIT) plus its notice in `THIRD-PARTY-NOTICES.txt`.
- `pack.js` `TEMPLATE_FILES` and the static-site tool include `vendor/pixi.min.js`, so the exported game and `npm start` work offline with no install.
- `index.html` loads it with `<script src="vendor/pixi.min.js" defer>` before `game.js`. If it fails to load, the Canvas renderer is used.

## Steps

1. **Extract** today's drawing from `game.js` into `render/canvas-renderer.js` behind the `arena.js` interface. No visual change; all suites pass. (`game.js` loses roughly a hundred `ctx.` calls.)
2. **Vendor** Pixi v8, wire the loader and the fallback, add the renderer selection to `FighterDebug.presentation()` (`renderer: 'pixi' | 'canvas'`).
3. **Parity**: background, fighters, anchors, trails, hit flash, palette, effects, camera, cut-in and KO treatment on Pixi. Add `FighterDebug.pixel(x, y)` reading from the renderer (the builder test samples the stage colour through it instead of `getContext('2d')`).
4. **Tests**: browser smoke, arcade, builder and multiplayer run on the Pixi path in headless Chromium (SwiftShader WebGL); a forced-fallback run (`?renderer=canvas`) covers the 2D path. Strict export and `npm run example` unchanged.
5. **Motion**: DBZ layer on top of parity: aura particles on power-up and supers, dash speed lines, impact frames (white flash plus the existing hit-stop), shake with slight rotation, projectile trails, super cut-in burst. Reduced-motion disables particles, shake and flashes.
6. **Measure**: 60 fps at 1920×1080 on an integrated GPU with two fighters, particles and a looping backdrop; texture memory under 64 MB for a match; no page errors; phone projection mode unaffected.

## Acceptance

- Same engine and pose choreography; multiplayer snapshots unchanged.
- Every suite green on both renderers; strict `build:bundle` export passes with the vendored library.
- Visibly: no sprite size pulsing, correct facing, crisp sprites at 1080p and 4K, additive auras and impact flashes in play, and the same frame timing as today.

## Risks

- Headless WebGL is software-rendered and slow; keep test timeouts generous and prefer state assertions over frame counts.
- Pixi v8 drops the Canvas renderer; the 2D fallback here is ours, so step 1 must be a faithful extraction.
- Texture upload stalls when a match starts: pre-warm the two fighters' textures during the VS screen.
- Filters allocate render textures per sprite; cache one filter per fighter and avoid filters on trails.
