// Browser-only asset compiler. It consumes accepted local images and never calls a model.
import { segmentSheet, poseScales } from './sheet-layout.mjs';
const ID = /^[a-z0-9][a-z0-9_-]*$/i;
const KINDS = new Set(['source', 'reference', 'sprites', 'portrait', 'hero', 'cutin', 'ending', 'stage', 'ui', 'effects', 'scene', 'layer']);
// Living-stage layers: cut from a populated scene at their exact place, as fractions of the stage image.
const LAYER_MOTIONS = new Set(['still', 'idle', 'cheer', 'hover', 'sway', 'flicker', 'pulse']);
const FIGHTER_KINDS = ['reference', 'sprites', 'portrait', 'hero', 'cutin', 'ending'];
const STYLES = new Set(['balanced', 'power', 'speed', 'zoner', 'grappler', 'trickster', 'boss']);
// A complete arcade cast (seven fighters, three arenas, PNG/WAV sources) exports at roughly 550 MB.
const MAX_BYTES = 1024 * 1024 * 1024;
const TEMPLATE_FILES = ['index.html', 'game.js', 'engine.js', 'anim.js', 'render/arena.js', 'render/scenery.js', 'render/canvas-renderer.js', 'render/pixi-renderer.js', 'vendor/pixi.min.js', 'fonts/PressStart2P-Regular.ttf', 'fonts/OFL-PressStart2P.txt', 'style.css', 'runtime-config.js', 'session-client.js', 'multiplayer.js', 'controller.js', 'controller.html', 'network.css', 'LICENSE', 'THIRD-PARTY-NOTICES.txt'];
const ARCADE_ART = ['arcade/title-backdrop.webp', 'arcade/title-ensemble.webp', 'arcade/select-backdrop.webp', 'arcade/menu-frame.webp', 'arcade/title-logo.webp'];
const REQUIRED_POSES = ['idle', 'walk', 'punch', 'kick', 'block', 'hit', 'special', 'down', 'win', 'stance2', 'crouch', 'sweep', 'launcher', 'jump', 'airkick', 'hpunch', 'dash', 'tumble', 'walk2', 'lkick', 'cjab', 'airpunch', 'throw', 'taunt', 'getup', 'powerup', 'entrance'];
const encoder = new TextEncoder();
const jsonBlob = value => new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });

export function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\\:\x00-\x1f%?#]/.test(value) || value.startsWith('/')) throw new Error(`Unsafe asset path: ${value}`);
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>"|*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Unsafe asset path: ${value}`);
  return value;
}

function text(value, label, limit = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${label} must be nonempty text (up to ${limit} characters).`);
  return value.trim();
}

export function validateManifest(input) {
  let manifest;
  try { manifest = typeof input === 'string' ? JSON.parse(input) : JSON.parse(JSON.stringify(input)); }
  catch { throw new Error('The selected manifest is not valid JSON.'); }
  if (manifest?.schema === 'dad-fighter-assets/v1') manifest.schema = 'comfy-fighter-assets/v1';
  if (manifest?.schema !== 'comfy-fighter-assets/v1') throw new Error('Choose the assets.json exported by the Comfy Fighter Z workflow.');
  if (manifest.partial) throw new Error('This is an asset patch. Merge it into a complete asset bundle before building a game.');
  if (manifest.root !== '.') throw new Error('Manifest root must be "."; select the folder containing assets.json and its raw images.');
  const game = manifest.game;
  if (!game || !Array.isArray(game.fighters) || !Array.isArray(game.stages)) throw new Error('Manifest requires game.fighters and game.stages arrays.');
  text(game.title, 'Game title');
  if (game.subtitle !== undefined && game.subtitle !== '') text(game.subtitle, 'Game subtitle', 200);
  if (!game.fighters.length || !game.stages.length) throw new Error('Manifest needs at least one fighter and one stage.');
  if (game.fighters.length > 64 || game.stages.length > 64) throw new Error('Manifest roster is too large (64 fighters/stages maximum).');
  const fighters = new Set(), stages = new Set();
  for (const [items, ids, label] of [[game.fighters, fighters, 'fighter'], [game.stages, stages, 'stage']]) {
    for (const item of items) {
      if (!item || !ID.test(item.id) || ids.has(item.id.toLowerCase())) throw new Error(`Invalid or duplicate ${label} ID: ${item?.id}`);
      ids.add(item.id.toLowerCase()); text(item.name, `${label} name`);
      if (item.color !== undefined && !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error(`Invalid color for ${item.id}; use #RRGGBB.`);
      if (item.description !== undefined && item.description !== '') text(item.description, `${item.id} description`, 4000);
      if (item.introTagline !== undefined && item.introTagline !== '') text(item.introTagline, `${item.id} intro tagline`, 250);
      if (item.sourceImage !== undefined && item.sourceImage !== '') safePath(item.sourceImage);
      if (item.specialMove !== undefined) {
        text(item.specialMove?.name, `${item.id} special move`, 100);
        text(item.specialMove?.description, `${item.id} special description`, 4000);
      }
      // Optional arcade metadata from the factory: gameplay style, super, win quote, ending and boss role.
      if (item.superMove !== undefined) {
        text(item.superMove?.name, `${item.id} super move`, 100);
        text(item.superMove?.description, `${item.id} super description`, 4000);
      }
      if (item.style !== undefined && !STYLES.has(item.style)) throw new Error(`Unknown fighting style for ${item.id}: ${item.style}`);
      if (item.winQuote !== undefined && item.winQuote !== '') text(item.winQuote, `${item.id} win quote`, 200);
      if (item.ending !== undefined && item.ending !== '') text(item.ending, `${item.id} ending`, 800);
      if (item.boss !== undefined && typeof item.boss !== 'boolean') throw new Error(`Invalid boss flag for ${item.id}`);
    }
  }
  if (game.fighters.filter(fighter => fighter.boss === true).length > 1) throw new Error('A game can include at most one final boss.');
  const layouts = { ...(game.sheets || {}), ...(game.extraSheets || {}), ...(game.motionSheets || {}), ...(game.detailSheets || {}) };
  if (!Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 1024) throw new Error('Manifest needs between 1 and 1024 mapped assets.');
  const ids = new Set(), paths = new Set(), outputs = new Set();
  for (const asset of manifest.assets) {
    if (!asset || !ID.test(asset.id) || ids.has(asset.id.toLowerCase())) throw new Error(`Invalid or duplicate asset ID: ${asset?.id}`);
    ids.add(asset.id.toLowerCase());
    if (!KINDS.has(asset.kind)) throw new Error(`Unknown asset kind: ${asset.kind}`);
    safePath(asset.src);
    if (!/\.(png|webp)$/i.test(asset.src)) throw new Error(`${asset.id} must map to a PNG or WebP source image.`);
    if (paths.has(asset.src.toLowerCase())) throw new Error(`Duplicate source image mapping: ${asset.src}`);
    paths.add(asset.src.toLowerCase());
    if (asset.key !== undefined && typeof asset.key !== 'boolean') throw new Error(`Invalid chroma-key flag: ${asset.id}`);
    if (asset.sha256 !== undefined && (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(asset.sha256))) throw new Error(`Invalid SHA-256 digest for ${asset.id}`);
    if (asset.fighter && !game.fighters.some(f => f.id === asset.fighter)) throw new Error(`Unknown fighter on ${asset.id}: ${asset.fighter}`);
    if (asset.stage && !game.stages.some(s => s.id === asset.stage)) throw new Error(`Unknown stage on ${asset.id}: ${asset.stage}`);
    if (FIGHTER_KINDS.includes(asset.kind) && !asset.fighter) throw new Error(`${asset.id} needs a fighter mapping.`);
    if (['stage', 'scene', 'layer'].includes(asset.kind) && !asset.stage) throw new Error(`${asset.id} needs a stage mapping.`);
    if (['ui', 'effects', 'stage'].includes(asset.kind) && asset.fighter) throw new Error(`${asset.id} has an unexpected fighter mapping.`);
    if (!['stage', 'source', 'scene', 'layer'].includes(asset.kind) && asset.stage) throw new Error(`${asset.id} has an unexpected stage mapping.`);
    if (asset.kind === 'source' && Boolean(asset.fighter) === Boolean(asset.stage)) throw new Error(`${asset.id} source needs exactly one fighter or stage mapping.`);
    for (const dimension of ['width', 'height']) if (asset[dimension] !== undefined && (!Number.isInteger(asset[dimension]) || asset[dimension] < 1 || asset[dimension] > 16384)) throw new Error(`Invalid ${dimension} for ${asset.id}`);
    const claims = [];
    if (asset.kind === 'layer') {
      if (!asset.place || ['x', 'y', 'w', 'h'].some(k => !Number.isFinite(asset.place[k]) || asset.place[k] < -1 || asset.place[k] > 2) || asset.place.w <= 0 || asset.place.h <= 0) throw new Error(`${asset.id} needs a place {x, y, w, h} in stage fractions.`);
      if (!LAYER_MOTIONS.has(asset.motion || 'idle')) throw new Error(`${asset.id} has an unknown motion: ${asset.motion}`);
    }
    if (asset.kind === 'sprites' || asset.kind === 'effects') {
      if (!Array.isArray(asset.poses) || asset.poses.length !== 9 || new Set(asset.poses).size !== 9 || asset.poses.some(p => !ID.test(p))) throw new Error(`${asset.id} needs exactly nine unique pose names.`);
      if (asset.kind === 'sprites' && asset.sheet && layouts[asset.sheet] && JSON.stringify(asset.poses) !== JSON.stringify(layouts[asset.sheet])) throw new Error(`${asset.id} pose order disagrees with the ${asset.sheet} layout.`);
      // Reviewed correction: cells drawn facing the wrong way are flipped at build time.
      if (asset.mirror !== undefined && (!Array.isArray(asset.mirror) || asset.mirror.some(p => !asset.poses.includes(p)))) throw new Error(`${asset.id} mirror must list poses from that sheet.`);
      // Reviewed correction: where the model drew an extra figure or shifted a row, `figures` picks each pose's figure.
      if (asset.figures !== undefined && (!asset.figures || typeof asset.figures !== 'object' || Array.isArray(asset.figures) || Object.entries(asset.figures).some(([p, v]) => !asset.poses.includes(p) || !Array.isArray(v) || v.length !== 2 || v.some(n => typeof n !== 'number' || !(n >= 0 && n <= 1))))) throw new Error(`${asset.id} figures must map poses from that sheet to [x, y] fractions.`);
      claims.push(...asset.poses.map(p => asset.kind === 'sprites' ? `assets/fighters/${asset.fighter}_${p}.png` : `assets/effects/${p}.png`));
    } else claims.push(['layer', 'scene'].includes(asset.kind) ? `${asset.kind}/${asset.id}` : `${asset.kind}/${asset.fighter || asset.stage || asset.id}`);
    for (const claim of claims) {
      const normalized = claim.toLowerCase();
      if (outputs.has(normalized)) throw new Error(`Duplicate runtime asset mapping: ${claim}`);
      outputs.add(normalized);
    }
  }
  if (Array.isArray(game.expectedAssets)) {
    const expected = new Set(game.expectedAssets.map(id => String(id).toLowerCase()));
    if (expected.size !== ids.size || [...expected].some(id => !ids.has(id))) throw new Error('Manifest does not include all expected asset records.');
  }
  return manifest;
}

export function validateAudioManifest(input, game) {
  let manifest;
  try { manifest = typeof input === 'string' ? JSON.parse(input) : JSON.parse(JSON.stringify(input)); }
  catch { throw new Error('The audio manifest is not valid JSON.'); }
  if (manifest?.schema === 'dad-fighter-audio/v1') manifest.schema = 'comfy-fighter-audio/v1';
  if (manifest?.schema !== 'comfy-fighter-audio/v1' || manifest.root !== '.') throw new Error('Choose a Comfy Fighter Z audio.json with root ".".');
  if (!Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 256) throw new Error('Audio manifest requires 1–256 audio assets.');
  const ids = new Set(), paths = new Set();
  for (const asset of manifest.assets) {
    if (!asset || !ID.test(asset.id) || ids.has(asset.id.toLowerCase())) throw new Error(`Invalid or duplicate audio ID: ${asset?.id}`);
    ids.add(asset.id.toLowerCase()); safePath(asset.src);
    if (!/\.(wav|mp3|ogg|flac)$/i.test(asset.src) || paths.has(asset.src.toLowerCase())) throw new Error(`Invalid or duplicate audio path: ${asset.src}`);
    paths.add(asset.src.toLowerCase());
    if (asset.kind !== 'audio' || !['music', 'sfx', 'voice'].includes(asset.category)) throw new Error(`Invalid audio category: ${asset.id}`);
    if (asset.fighter && game && !game.fighters.some(f => f.id === asset.fighter)) throw new Error(`Unknown audio fighter: ${asset.fighter}`);
    if (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(asset.sha256)) throw new Error(`Invalid audio SHA-256: ${asset.id}`);
    if (asset.loop !== undefined && typeof asset.loop !== 'boolean') throw new Error(`Invalid audio loop flag: ${asset.id}`);
  }
  return manifest;
}

export function validateVideoManifest(input, game = null) {
  let manifest;
  try { manifest = typeof input === 'string' ? JSON.parse(input) : structuredClone(input); }
  catch { throw new Error('The video manifest is not valid JSON.'); }
  if (manifest?.schema !== 'comfy-fighter-video/v1' || manifest.root !== '.') throw new Error('Expected a comfy-fighter-video/v1 video.json with root ".".');
  const intros = manifest.fighterIntros ?? [];
  if (!Array.isArray(intros) || intros.length > 64 || (!manifest.openingVideo && !manifest.titleVideo && !manifest.selectVideo && !intros.length)) throw new Error('Video manifest needs an opening, animated title, select-screen or fighter introduction videos.');
  const paths = new Set(), fighters = new Set();
  const check = (video, label, limit) => {
    if (!video || typeof video !== 'object') throw new Error(`Invalid ${label}.`);
    safePath(video.src);
    if (!/\.mp4$/i.test(video.src) || paths.has(video.src.toLowerCase())) throw new Error(`${label} must use a unique MP4 path.`);
    paths.add(video.src.toLowerCase());
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > limit) throw new Error(`Invalid ${label} duration.`);
    if (typeof video.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(video.sha256)) throw new Error(`${label} requires a SHA-256 digest.`);
    if (video.hasAudio !== undefined && typeof video.hasAudio !== 'boolean') throw new Error(`${label} has an invalid audio flag.`);
  };
  if (manifest.openingVideo) { if (manifest.openingVideo.id !== 'opening') throw new Error('Invalid opening video ID.'); check(manifest.openingVideo, 'Opening video', 300); }
  if (manifest.titleVideo) { if (manifest.titleVideo.id !== 'title') throw new Error('Invalid title video ID.'); check(manifest.titleVideo, 'Title video', 300); }
  if (manifest.selectVideo) { if (manifest.selectVideo.id !== 'select') throw new Error('Invalid select video ID.'); check(manifest.selectVideo, 'Select video', 300); }
  for (const video of intros) {
    if (!ID.test(video?.fighter || '') || video.id !== `intro-${video.fighter}` || fighters.has(video.fighter.toLowerCase())) throw new Error('Invalid or duplicate fighter intro.');
    if (game && !game.fighters.some(f => f.id === video.fighter)) throw new Error(`Unknown intro fighter: ${video.fighter}`);
    fighters.add(video.fighter.toLowerCase()); check(video, 'Fighter introduction', 30);
  }
  // Select-screen idle loops: one portrait clip per fighter, id idle-<fighter>.
  const idles = manifest.selectIdles ?? [], idleFighters = new Set();
  if (!Array.isArray(idles) || idles.length > 64) throw new Error('Invalid select idle list.');
  for (const video of idles) {
    if (!ID.test(video?.fighter || '') || video.id !== `idle-${video.fighter}` || idleFighters.has(video.fighter.toLowerCase())) throw new Error('Invalid or duplicate select idle.');
    if (game && !game.fighters.some(f => f.id === video.fighter)) throw new Error(`Unknown idle fighter: ${video.fighter}`);
    idleFighters.add(video.fighter.toLowerCase()); check(video, 'Select idle', 30);
  }
  return manifest;
}

function canvas(width, height) {
  width = Math.round(width); height = Math.round(height);
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64e6) throw new Error(`Unsupported image dimensions: ${width} x ${height}`);
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
}
function png(image) { return new Promise((resolve, reject) => image.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png')); }
async function decode(blob, label) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error(`Missing image data: ${label}`);
  if (blob.size > 64 * 1024 * 1024) throw new Error(`${label} exceeds the 64 MB source image limit.`);
  try {
    const image = await createImageBitmap(blob);
    if (!image.width || !image.height || image.width > 16384 || image.height > 16384 || image.width * image.height > 64e6) { image.close(); throw new Error('Image dimensions exceed the supported limits.'); }
    return image;
  } catch (error) { throw new Error(`Cannot decode ${label}: ${error.message}`); }
}
function keyGreen(image) {
  const context = image.getContext('2d', { willReadFrequently: true }), pixels = context.getImageData(0, 0, image.width, image.height), d = pixels.data;
  const { width, height } = image;
  for (let i = 0; i < d.length; i += 4) {
    const limit = Math.max(d[i], d[i + 2]), spill = d[i + 1] - limit;
    if (spill > 80) { d[i + 3] = 0; continue; }
    if (spill > 22) d[i + 3] = Math.round(d[i + 3] * (1 - (spill - 22) / 58));
    if (spill > 8) d[i + 1] = limit + 8;
  }
  // Edge pass: a translucent pixel beside two or more transparent neighbours is fringe, not ink.
  const alpha = new Uint8ClampedArray(width * height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = d[p * 4 + 3];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, a = alpha[p];
    if (a === 0 || a === 255) continue;
    const clear = (x > 0 && alpha[p - 1] === 0) + (x < width - 1 && alpha[p + 1] === 0) + (y > 0 && alpha[p - width] === 0) + (y < height - 1 && alpha[p + width] === 0);
    if (clear >= 2) d[p * 4 + 3] = a < 110 ? 0 : Math.round(a * .6);
  }
  context.putImageData(pixels, 0, 0);
}
function bounds(image) {
  const { width: w, height: h } = image, d = image.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let left = w, right = -1, top = h, bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 30) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < 0) throw new Error('Empty artwork after chroma-key removal.');
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}
function mirrored(cell) {
  const flipped = canvas(cell.canvas.width, cell.canvas.height), context = flipped.getContext('2d', { willReadFrequently: true });
  context.translate(flipped.width, 0); context.scale(-1, 1); context.drawImage(cell.canvas, 0, 0);
  return { canvas: flipped, bounds: bounds(flipped) };
}
// Fighter sheets keep their native resolution (up to 2100 px) so cels are downsampled, never upscaled; effects stay at 1260.
function sheetCells(image, job, native = false) {
  if (image.width < 90 || image.height < 90 || Math.abs(image.width - image.height) / Math.max(image.width, image.height) > .02) throw new Error(`${job.id}: expected a square 3x3 sheet, at least 90 x 90 pixels.`);
  const cw = image.width / 3, ch = image.height / 3, result = new Map();
  const mirror = cells => { for (const pose of job.mirror || []) if (cells.has(pose)) cells.set(pose, mirrored(cells.get(pose))); return cells; };
  if (job.key !== false) {
    // Small sheets are still upsampled to 1260 so their bounds are measured as before.
    const width = native ? Math.min(Math.max(image.width, 1260), 2100) : 1260;
    const sheet = canvas(width, width * image.height / image.width);
    const context = sheet.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, sheet.width, sheet.height); keyGreen(sheet);
    const cells = segmentSheet(context.getImageData(0, 0, sheet.width, sheet.height).data, sheet.width, sheet.height, { picks: job.poses.map(pose => job.figures?.[pose] || null) });
    cells.forEach((pixels, i) => {
      const cell = canvas(pixels.width, pixels.height), ctx = cell.getContext('2d', { willReadFrequently: true });
      const data = ctx.createImageData(pixels.width, pixels.height); data.data.set(pixels.data); ctx.putImageData(data, 0, 0);
      result.set(job.poses[i], { canvas: cell, bounds: bounds(cell) });
    });
    return mirror(result);
  }
  const size = native ? Math.min(Math.max(cw, 420), 700) : 420;
  for (let i = 0; i < 9; i++) {
    const cell = canvas(size, size * ch / cw);
    cell.getContext('2d').drawImage(image, i % 3 * cw, Math.floor(i / 3) * ch, cw, ch, 0, 0, cell.width, cell.height);
    try { result.set(job.poses[i], { canvas: cell, bounds: bounds(cell) }); }
    catch (error) { throw new Error(`${job.id}/${job.poses[i]}: ${error.message}`); }
  }
  return mirror(result);
}
async function exportCell(cell, scale) {
  const b = cell.bounds, x = Math.max(0, b.left - 4), y = Math.max(0, b.top - 4);
  const sw = Math.min(cell.canvas.width, b.right + 5) - x, sh = Math.min(cell.canvas.height, b.bottom + 5) - y;
  const result = canvas(sw * scale, sh * scale), context = result.getContext('2d', { willReadFrequently: true });
  context.drawImage(cell.canvas, x, y, sw, sh, 0, 0, result.width, result.height);
  const actual = bounds(result), data = context.getImageData(0, 0, result.width, result.height).data;
  const band = actual.bottom - Math.max(1, Math.round(actual.height * .18));
  let sum = 0, count = 0;
  for (let yy = Math.max(0, band); yy <= actual.bottom; yy++) for (let xx = 0; xx < result.width; xx++) if (data[(yy * result.width + xx) * 4 + 3] > 30) { sum += xx; count++; }
  return { blob: await png(result), meta: { w: result.width, h: result.height, ax: Math.round(count ? sum / count : result.width / 2), ay: actual.bottom, top: actual.top, bh: actual.bottom - actual.top } };
}
async function exportImage(image, job) {
  let sx = 0, sy = 0, sw = image.width, sh = image.height, width, height;
  if (job.kind === 'portrait') { sw = sh = Math.min(sw, sh); sx = (image.width - sw) / 2; sy = (image.height - sh) * .3; width = 320; }
  if (job.kind === 'hero') height = 760;
  if (job.kind === 'cutin' || job.kind === 'ending') width = 960;
  if (job.kind === 'stage') width = 1600;
  const result = canvas(width || sw * (height || sh) / sh, height || sh * (width || sw) / sw);
  result.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, result.width, result.height);
  if (job.key) { keyGreen(result); bounds(result); }
  return png(result);
}

function customize(items, edits, label) {
  const updates = new Map();
  for (const edit of edits || []) {
    if (!items.some(item => item.id === edit.id) || updates.has(edit.id)) throw new Error(`Unknown or duplicate ${label} customization: ${edit.id}`);
    updates.set(edit.id, edit);
  }
  return items.filter(item => updates.get(item.id)?.enabled !== false).map(item => {
    const update = updates.get(item.id) || {};
    const value = { id: item.id, name: text(update.name ?? item.name, `${label} name`) };
    if (item.introTagline) value.introTagline = text(item.introTagline, `${label} intro tagline`, 250);
    if (item.description) value.description = text(update.description ?? item.description, `${label} description`, 4000);
    if (item.specialMove) value.specialMove = {
      name: text(update.specialMove?.name ?? item.specialMove.name, 'Special move name', 100),
      description: text(update.specialMove?.description ?? item.specialMove.description, 'Special move description', 4000)
    };
    if (item.superMove) value.superMove = { name: text(item.superMove.name, 'Super move name', 100), description: text(item.superMove.description, 'Super move description', 4000) };
    for (const field of ['style', 'winQuote', 'ending']) if (item[field]) value[field] = item[field];
    if (item.boss === true) value.boss = true;
    if (label === 'fighter') {
      value.color = update.color ?? item.color ?? '#ff824f';
      if (!/^#[0-9a-f]{6}$/i.test(value.color)) throw new Error(`Invalid color for ${item.id}`);
      value.poses = {};
    }
    return value;
  });
}

export async function buildGame({ manifest: input, audioManifest: audioInput = null, videoManifest: videoInput = null, files, customization = {}, onProgress = () => {} }) {
  const source = validateManifest(input);
  const audioSource = audioInput ? validateAudioManifest(audioInput, source.game) : null;
  const videoSource = videoInput ? validateVideoManifest(videoInput, source.game) : null;
  if (!(files instanceof Map)) throw new Error('Choose the source image folder before building.');
  const runtime = { version: 1, title: text(customization.title ?? source.game.title, 'Game title'),
    subtitle: source.game.subtitle || '',
    fighters: customize(source.game.fighters, customization.fighters, 'fighter'), stages: customize(source.game.stages, customization.stages, 'stage'), ui: {}, effects: {}, audio: {} };
  if (runtime.fighters.length < 2 || !runtime.stages.length) throw new Error('Choose at least two fighters and one stage.');
  const selectedFighters = new Map(runtime.fighters.map(f => [f.id, f])), selectedStages = new Map(runtime.stages.map(s => [s.id, s]));
  const jobs = source.assets.filter(a => (!a.fighter || selectedFighters.has(a.fighter)) && (!a.stage || selectedStages.has(a.stage)));
  const audioJobs = (audioSource?.assets || []).filter(a => !a.fighter || selectedFighters.has(a.fighter));
  const allow = customization.allowPlaceholders === true, missing = jobs.filter(job => !files.has(job.src)), warnings = [], output = new Map(), built = [];
  if (missing.length && !allow) throw new Error(`Missing ${missing.length} source image(s): ${missing.map(j => j.src).join(', ')}. Select the full asset root or explicitly allow placeholders.`);
  if (missing.length) warnings.push(`Missing artwork: ${missing.map(j => j.id).join(', ')}. The game uses labeled placeholders.`);
  const videoJobs = [...(videoSource?.openingVideo ? [videoSource.openingVideo] : []), ...(videoSource?.titleVideo ? [videoSource.titleVideo] : []), ...(videoSource?.selectVideo ? [videoSource.selectVideo] : []), ...(videoSource?.fighterIntros || []).filter(video => selectedFighters.has(video.fighter)), ...(videoSource?.selectIdles || []).filter(video => selectedFighters.has(video.fighter))];
  for (const video of videoJobs) if (!files.has(video.src)) throw new Error(`Missing video file: ${video.src}. Select the complete asset root.`);
  const unmapped = [];
  for (const fighter of runtime.fighters) {
    const characterJobs = jobs.filter(job => job.fighter === fighter.id);
    const mappedPoses = new Set(characterJobs.filter(job => job.kind === 'sprites').flatMap(job => job.poses));
    for (const pose of REQUIRED_POSES) if (!mappedPoses.has(pose)) unmapped.push(`${fighter.id}/${pose}`);
    for (const kind of ['reference', 'portrait', 'hero', 'cutin']) if (!characterJobs.some(job => job.kind === kind)) unmapped.push(`${fighter.id}/${kind}`);
  }
  for (const stage of runtime.stages) if (!jobs.some(job => job.kind === 'stage' && job.stage === stage.id)) unmapped.push(`stage/${stage.id}`);
  for (const id of ['title', 'select', 'logo', 'hud', 'icons']) if (!jobs.some(job => job.kind === 'ui' && job.id === id)) unmapped.push(`ui/${id}`);
  const mappedEffects = new Set(jobs.filter(job => job.kind === 'effects').flatMap(job => job.poses));
  for (const effect of ['hit', 'block', 'projectile', 'dust', 'ko', 'powerup', 'dash', 'launch', 'spark']) if (!mappedEffects.has(effect)) unmapped.push(`effects/${effect}`);
  if (unmapped.length && !allow) throw new Error(`Incomplete asset mappings: ${unmapped.join(', ')}. Load the complete bundle or explicitly allow placeholders.`);
  if (unmapped.length) warnings.push(`Unmapped artwork: ${unmapped.join(', ')}. Placeholder mode is enabled.`);
  let sourceBytes = 0;
  for (const job of [...jobs, ...audioJobs, ...videoJobs]) { const file = files.get(job.src); if (file) sourceBytes += file.size; }
  if (sourceBytes > MAX_BYTES) throw new Error('Selected source images exceed the 1 GB browser build limit.');
  const allCells = new Map(), accepted = [], total = jobs.length + audioJobs.length + TEMPLATE_FILES.length + videoJobs.length; let done = 0;
  for (const video of videoJobs) {
    const blob = files.get(video.src);
    if (!(blob instanceof Blob) || !blob.size) throw new Error(`Video file is empty: ${video.src}`);
    if (!globalThis.crypto?.subtle) throw new Error('Video integrity verification requires localhost or HTTPS.');
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== video.sha256.toLowerCase()) throw new Error(`Video SHA-256 mismatch: ${video.id}`);
    const src = `assets/video/${video.id}.mp4`;
    if (video.fighter) selectedFighters.get(video.fighter)[video.id.startsWith('idle-') ? 'selectVideo' : 'introVideo'] = { ...video, src };
    else if (video.id === 'title') runtime.titleVideo = { ...video, src };
    else if (video.id === 'select') runtime.selectVideo = { ...video, src };
    else runtime.openingVideo = { ...video, src };
    output.set(src, blob); output.set(`sources/${video.src}`, blob);
    done++;
  }
  if (videoSource && videoJobs.length) output.set('sources/video.json', jsonBlob({ ...videoSource, ...(videoSource.fighterIntros ? { fighterIntros: videoJobs.filter(video => video.fighter && !video.id.startsWith('idle-')) } : {}), ...(videoSource.selectIdles ? { selectIdles: videoJobs.filter(video => video.id.startsWith('idle-')) } : {}) }));
  for (const job of jobs) {
    onProgress({ done, total, message: `Processing ${job.id}` });
    const blob = files.get(job.src); let image;
    if (!blob) { done++; continue; }
    try {
      if (job.sha256) {
        if (!globalThis.crypto?.subtle) throw new Error('Image integrity verification requires localhost or HTTPS.');
        const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const actual = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== job.sha256.toLowerCase()) throw new Error('SHA-256 mismatch: this image does not match the exported manifest. Select the matching asset root.');
      }
      image = await decode(blob, job.src);
      if ((job.width && job.width !== image.width) || (job.height && job.height !== image.height)) throw new Error(`Image dimensions differ from manifest (${image.width} x ${image.height}).`);
      if (job.kind === 'source') {
        const src = `assets/references/${job.id}.${job.src.split('.').pop().toLowerCase()}`; output.set(src, blob);
        (job.fighter ? selectedFighters.get(job.fighter) : selectedStages.get(job.stage)).sourceImage = src;
      } else if (job.kind === 'sprites') {
        const collection = allCells.get(job.fighter) || new Map();
        for (const [pose, cell] of sheetCells(image, job, true)) collection.set(pose, { ...cell, sheet: job.sheet || job.id });
        allCells.set(job.fighter, collection);
      } else if (job.kind === 'effects') {
        const pending = [];
        for (const [pose, cell] of sheetCells(image, job)) {
          const result = await exportCell(cell, 1), src = `assets/effects/${pose}.png`;
          pending.push({ pose, src, ...result });
        }
        for (const result of pending) { output.set(result.src, result.blob); runtime.effects[result.pose] = { src: result.src, ...result.meta }; }
      } else if (job.kind === 'layer') {
        // A cut-out stage element keeps its alpha and its native pixels; place says where it sits on the stage painting.
        const src = `assets/scenery/${job.id}.png`; output.set(src, blob);
        const stage = selectedStages.get(job.stage); stage.scenery = stage.scenery || { layers: [] };
        stage.scenery.layers.push({ id: job.id, src, place: job.place, motion: job.motion || 'idle', ...(job.depth ? { depth: job.depth } : {}), ...(job.order !== undefined ? { order: job.order } : {}) });
        stage.scenery.layers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      } else if (job.kind === 'scene') {
        // The populated composition the layers were cut from: kept as a source for review, not shipped to the runtime.
      } else if (job.kind !== 'reference') {
        const dirs = { portrait: 'portraits', hero: 'heroes', cutin: 'cutins', ending: 'endings', stage: 'stages', ui: 'ui' }, src = `assets/${dirs[job.kind]}/${job.id}.png`;
        output.set(src, await exportImage(image, job));
        // The ending text keeps its name; the illustration is exposed as endingArt.
        if (job.fighter) selectedFighters.get(job.fighter)[job.kind === 'ending' ? 'endingArt' : job.kind] = src;
        else if (job.kind === 'stage') selectedStages.get(job.stage).src = src;
        else runtime.ui[job.id] = src;
      }
      const rawSrc = `sources/${job.src}`; output.set(rawSrc, blob); accepted.push({ ...job, src: rawSrc }); built.push(job.id);
    } catch (error) {
      if (!allow) throw new Error(`${job.id}: ${error.message}`);
      warnings.push(`${job.id}: ${error.message} Omitted; placeholder mode is enabled.`);
    } finally { image?.close(); done++; }
    // Allow status updates and user interaction between large images.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const acceptedAudio = [];
  for (const job of audioJobs) {
    onProgress({ done, total, message: `Packaging audio ${job.id}` });
    const blob = files.get(job.src);
    try {
      if (!(blob instanceof Blob) || !blob.size) throw new Error('Missing audio file. Choose the folder containing audio.json and its raw files.');
      if (blob.size > 64 * 1024 * 1024) throw new Error('Audio exceeds the 64 MB per-file limit.');
      if (job.sha256) {
        const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const actual = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== job.sha256.toLowerCase()) throw new Error('Audio SHA-256 mismatch.');
      }
      const src = `assets/audio/${job.id}.${job.src.split('.').pop().toLowerCase()}`;
      if (output.has(`sources/${job.src}`)) throw new Error('Audio path collides with an image source.');
      output.set(src, blob); output.set(`sources/${job.src}`, blob);
      runtime.audio[job.id] = { ...job, src }; acceptedAudio.push(job);
    } catch (error) {
      if (!allow) throw new Error(`${job.id}: ${error.message}`);
      warnings.push(`${job.id}: ${error.message} Audio omitted in placeholder mode.`);
    }
    done++;
  }
  for (const [fighterId, cells] of allCells) {
    const base = cells.get('idle') || cells.values().next().value;
    if (!cells.has('idle')) warnings.push(`${fighterId}: idle pose missing; scale uses the first available pose.`);
    const scale = 400 / Math.max(1, base.bounds.height - 1), corrections = poseScales(cells);
    try {
      const pending = [];
      for (const [pose, cell] of cells) {
        const result = await exportCell(cell, scale * (corrections.get(pose) || 1)), src = `assets/fighters/${fighterId}_${pose}.png`;
        pending.push({ pose, src, ...result });
      }
      for (const result of pending) { output.set(result.src, result.blob); selectedFighters.get(fighterId).poses[result.pose] = { src: result.src, ...result.meta }; }
    } catch (error) {
      if (!allow) throw new Error(`${fighterId}: ${error.message}`);
      warnings.push(`${fighterId}: ${error.message} Sprite export omitted; placeholder mode is enabled.`);
    }
  }
  for (const file of TEMPLATE_FILES) {
    onProgress({ done, total, message: `Packaging ${file}` });
    const response = await fetch(new URL(`../${file}`, import.meta.url));
    if (!response.ok) throw new Error(`Game template unavailable: ${file} (${response.status}). Run the builder through its local server.`);
    // Binary template files (the arcade typeface) are copied byte for byte; text would re-encode them.
    if (/\.(ttf|otf|woff2?)$/i.test(file)) { output.set(file, new Blob([await response.arrayBuffer()], { type: file.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream' })); done++; continue; }
    let content = await response.text();
    // A runtime template may link back to the builder; exported games must not.
    if (file === 'index.html') content = content.replace(/<a\b[^>]*href=["'][^"']*builder[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, '');
    output.set(file, new Blob([content], { type: file === 'LICENSE' ? 'text/plain' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript' })); done++;
  }
  for (const file of ARCADE_ART) { const response = await fetch(new URL(`../${file}`, import.meta.url)); if (!response.ok) throw new Error(`Arcade artwork unavailable: ${file}`); output.set(file, await response.blob()); }
  output.set('assets/manifest.json', jsonBlob(runtime));
  const sourceGame = { ...source.game, title: runtime.title,
    fighters: runtime.fighters.map(({ poses, portrait, hero, cutin, endingArt, introVideo, selectVideo, ...f }) => ({ ...source.game.fighters.find(item => item.id === f.id), ...f })),
    stages: runtime.stages.map(({ src, ...s }) => ({ ...source.game.stages.find(item => item.id === s.id), ...s })) };
  if (sourceGame.expectedAssets) sourceGame.expectedAssets = jobs.map(job => job.id);
  output.set('sources/assets.json', jsonBlob({ ...source, root: '.', game: sourceGame, assets: jobs }));
  if (audioSource) output.set('sources/audio.json', jsonBlob({ ...audioSource, assets: audioJobs }));
  output.set('assets/source-manifest.json', jsonBlob({ schema: 'comfy-fighter-source-map/v1', root: '.', pathBase: 'game-package-root', sourceManifest: 'sources/assets.json', assets: accepted }));
  output.set('build-report.json', jsonBlob({ strict: !allow, sourceAssets: jobs.length, audioAssets: acceptedAudio.length, audioStatus: audioSource ? 'included' : 'not-supplied', openingVideo: runtime.openingVideo || null, built, missing: missing.map(j => j.id), warnings, requiresVisualReview: true }));
  output.set('package.json', jsonBlob({ name: 'custom-comfy-fighter', version: '1.0.0', license: 'MIT', private: true, scripts: { start: 'node start-server.cjs' }, engines: { node: '>=22' } }));
  const serverResponse = await fetch(new URL('./runtime-server.cjs', import.meta.url));
  if (!serverResponse.ok) throw new Error('Bundled multiplayer server is missing. Run npm run bundle:server in the repository.');
  output.set('start-server.cjs', await serverResponse.blob());
  output.set('README.txt', new Blob([`${runtime.title}\n\nRun with Node.js 22 or later:\n  npm start\nThen open http://127.0.0.1:8080\nNo npm install is required. The server prints a LAN address for phones on the same Wi-Fi.\nOnline Versus: create a room, share the invite, choose fighters and ready up.\nPhone Controllers: open the game at its LAN address on the shared display; scan one or two QR codes.\nA static HTTP host supports local play; online matches and phone pairing require this Node server.\nOpening index.html directly as file:// will not load the asset manifest.\n\nControls: Single-player versus CPU, online 1v1, or phone-controlled shared display. Arrow keys move, jump and crouch.\nA punch, S kick, D heavy strike, F special. Hold back to block. Escape pauses.\nSpace skips the opening film and fighter introductions. Use the fullscreen button to fill the display.\n\nassets/manifest.json maps all runtime art and sprite anchors.\nassets/source-manifest.json is a provenance report with paths relative to the game package root.\nsources/assets.json is the re-importable asset manifest; select the sources/ directory in the builder to use it again.\nsources/ contains original accepted artwork, including sprite sheets.\nbuild-report.json records missing/omitted images. Review generated poses and anchors before release.\n${warnings.length ? '\nPLACEHOLDER BUILD: ' + warnings.join('\n') : '\nAll selected source images were processed. Visual review is still required.'}\n`], { type: 'text/plain' }));
  onProgress({ done: total, total, message: `Ready: ${output.size} files` });
  return output;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
function validateOutput(files) {
  if (!(files instanceof Map) || !files.size || files.size > 65534) throw new Error('Export requires between 1 and 65534 files.');
  let size = 0; const used = new Set();
  for (const [path, blob] of files) {
    safePath(path);
    if (used.has(path.toLowerCase())) throw new Error(`Duplicate export path: ${path}`);
    used.add(path.toLowerCase());
    if (!(blob instanceof Blob)) throw new Error(`Invalid export data: ${path}`);
    size += blob.size;
  }
  if (size > MAX_BYTES) throw new Error('Export exceeds the 1 GB browser package limit.');
}
export async function zipFiles(files) {
  validateOutput(files);
  const local = [], central = []; let offset = 0, centralSize = 0;
  for (const [path, blob] of files) {
    // Read each file once for its checksum, then reference the original blob so the archive is not a second in-memory copy.
    const name = encoder.encode(path), crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    if (name.length > 65535) throw new Error('ZIP filename is too long.');
    const head = new Uint8Array(30 + name.length), view = new DataView(head.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(12, 0x21, true); // Fixed DOS date 1980-01-01 for reproducible archives.
    view.setUint32(14, crc, true); view.setUint32(18, blob.size, true); view.setUint32(22, blob.size, true); view.setUint16(26, name.length, true); head.set(name, 30);
    local.push(head, blob);
    const entry = new Uint8Array(46 + name.length), cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, blob.size, true); cv.setUint32(24, blob.size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); entry.set(name, 46);
    central.push(entry); centralSize += entry.length; offset += head.length + blob.size;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.size, true); ev.setUint16(10, files.size, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
export async function writeDirectory(handle, files) {
  validateOutput(files);
  if (!handle || handle.kind !== 'directory' || typeof handle.entries !== 'function') throw new Error('Choose an empty destination directory.');
  for await (const entry of handle.entries()) throw new Error('Choose an empty destination directory; existing files will not be overwritten.');
  let written = 0;
  try {
    for (const [path, blob] of files) {
      const parts = path.split('/'), name = parts.pop(); let directory = handle;
      for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
      const file = await directory.getFileHandle(name, { create: true }), writable = await file.createWritable();
      try { await writable.write(blob); await writable.close(); } catch (error) { await writable.abort().catch(() => {}); throw error; }
      written++;
    }
  } catch (error) { throw new Error(`Directory export stopped after ${written}/${files.size} files: ${error.message}. The selected directory contains a partial build; choose a new empty folder to retry.`); }
  return { files: written };
}
