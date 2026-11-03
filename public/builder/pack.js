// Browser-only asset compiler. It consumes accepted local images and never calls a model.
import { segmentSheet } from './sheet-layout.mjs';
const ID = /^[a-z0-9][a-z0-9_-]*$/i;
const KINDS = new Set(['source', 'reference', 'sprites', 'portrait', 'hero', 'cutin', 'stage', 'ui', 'effects']);
const MAX_BYTES = 512 * 1024 * 1024;
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
  if (manifest?.schema !== 'dad-fighter-assets/v1') throw new Error('Expected a dad-fighter-assets/v1 manifest exported by the ComfyUI bundle workflow.');
  if (manifest.root !== '.') throw new Error('Manifest root must be "."; select the folder containing assets.json and its raw images.');
  const game = manifest.game;
  if (!game || !Array.isArray(game.fighters) || !Array.isArray(game.stages)) throw new Error('Manifest requires game.fighters and game.stages arrays.');
  text(game.title, 'Game title');
  if (game.subtitle !== undefined) text(game.subtitle, 'Game subtitle', 200);
  if (!game.fighters.length || !game.stages.length) throw new Error('Manifest needs at least one fighter and one stage.');
  if (game.fighters.length > 64 || game.stages.length > 64) throw new Error('Manifest roster is too large (64 fighters/stages maximum).');
  const fighters = new Set(), stages = new Set();
  for (const [items, ids, label] of [[game.fighters, fighters, 'fighter'], [game.stages, stages, 'stage']]) {
    for (const item of items) {
      if (!item || !ID.test(item.id) || ids.has(item.id.toLowerCase())) throw new Error(`Invalid or duplicate ${label} ID: ${item?.id}`);
      ids.add(item.id.toLowerCase()); text(item.name, `${label} name`);
      if (item.color !== undefined && !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error(`Invalid color for ${item.id}; use #RRGGBB.`);
      if (item.description !== undefined) text(item.description, `${item.id} description`, 4000);
      if (item.introTagline !== undefined) text(item.introTagline, `${item.id} intro tagline`, 250);
      if (item.sourceImage !== undefined) safePath(item.sourceImage);
      if (item.specialMove !== undefined) {
        text(item.specialMove?.name, `${item.id} special move`, 100);
        text(item.specialMove?.description, `${item.id} special description`, 4000);
      }
    }
  }
  if (!Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 1024) throw new Error('Manifest needs between 1 and 1024 mapped assets.');
  const ids = new Set(), paths = new Set(), outputs = new Set();
  for (const asset of manifest.assets) {
    if (!asset || !ID.test(asset.id) || ids.has(asset.id.toLowerCase())) throw new Error(`Invalid or duplicate asset ID: ${asset?.id}`);
    ids.add(asset.id.toLowerCase());
    if (!KINDS.has(asset.kind)) throw new Error(`Unknown asset kind: ${asset.kind}`);
    safePath(asset.src);
    if (!/\.png$/i.test(asset.src)) throw new Error(`${asset.id} must map to a PNG source image.`);
    if (paths.has(asset.src.toLowerCase())) throw new Error(`Duplicate source image mapping: ${asset.src}`);
    paths.add(asset.src.toLowerCase());
    if (asset.key !== undefined && typeof asset.key !== 'boolean') throw new Error(`Invalid chroma-key flag: ${asset.id}`);
    if (asset.sha256 !== undefined && (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(asset.sha256))) throw new Error(`Invalid SHA-256 digest for ${asset.id}`);
    if (asset.fighter && !game.fighters.some(f => f.id === asset.fighter)) throw new Error(`Unknown fighter on ${asset.id}: ${asset.fighter}`);
    if (asset.stage && !game.stages.some(s => s.id === asset.stage)) throw new Error(`Unknown stage on ${asset.id}: ${asset.stage}`);
    if (['reference', 'sprites', 'portrait', 'hero', 'cutin'].includes(asset.kind) && !asset.fighter) throw new Error(`${asset.id} needs a fighter mapping.`);
    if (asset.kind === 'stage' && !asset.stage) throw new Error(`${asset.id} needs a stage mapping.`);
    if (['ui', 'effects', 'stage'].includes(asset.kind) && asset.fighter) throw new Error(`${asset.id} has an unexpected fighter mapping.`);
    if (!['stage', 'source'].includes(asset.kind) && asset.stage) throw new Error(`${asset.id} has an unexpected stage mapping.`);
    if (asset.kind === 'source' && Boolean(asset.fighter) === Boolean(asset.stage)) throw new Error(`${asset.id} source needs exactly one fighter or stage mapping.`);
    for (const dimension of ['width', 'height']) if (asset[dimension] !== undefined && (!Number.isInteger(asset[dimension]) || asset[dimension] < 1 || asset[dimension] > 16384)) throw new Error(`Invalid ${dimension} for ${asset.id}`);
    const claims = [];
    if (asset.kind === 'sprites' || asset.kind === 'effects') {
      if (!Array.isArray(asset.poses) || asset.poses.length !== 9 || new Set(asset.poses).size !== 9 || asset.poses.some(p => !ID.test(p))) throw new Error(`${asset.id} needs exactly nine unique pose names.`);
      if (asset.kind === 'sprites' && asset.sheet && game.sheets?.[asset.sheet] && JSON.stringify(asset.poses) !== JSON.stringify(game.sheets[asset.sheet])) throw new Error(`${asset.id} pose order disagrees with game.sheets.${asset.sheet}.`);
      claims.push(...asset.poses.map(p => asset.kind === 'sprites' ? `assets/fighters/${asset.fighter}_${p}.png` : `assets/effects/${p}.png`));
    } else claims.push(`${asset.kind}/${asset.fighter || asset.stage || asset.id}`);
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
  if (manifest?.schema !== 'dad-fighter-audio/v1' || manifest.root !== '.') throw new Error('Expected a dad-fighter-audio/v1 audio.json with root ".".');
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

export function validateVideoManifest(input) {
  let manifest;
  try { manifest = typeof input === 'string' ? JSON.parse(input) : structuredClone(input); }
  catch { throw new Error('The video manifest is not valid JSON.'); }
  if (manifest?.schema !== 'comfy-fighter-video/v1' || manifest.root !== '.') throw new Error('Expected a comfy-fighter-video/v1 video.json with root ".".');
  const video = manifest.openingVideo;
  if (!video || video.id !== 'opening') throw new Error('Video manifest requires an opening video.');
  safePath(video.src);
  if (!/\.mp4$/i.test(video.src)) throw new Error('Opening video must be an MP4.');
  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 300) throw new Error('Opening video duration must be between 0 and 300 seconds.');
  if (typeof video.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(video.sha256)) throw new Error('Opening video requires a SHA-256 digest.');
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
  for (let i = 0; i < d.length; i += 4) {
    const spill = d[i + 1] - Math.max(d[i], d[i + 2]);
    if (spill > 95) d[i + 3] = 0;
    else if (spill > 28) { d[i + 3] = Math.round(d[i + 3] * (1 - (spill - 28) / 67)); d[i + 1] = Math.max(d[i], d[i + 2]); }
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
function sheetCells(image, job) {
  if (image.width < 90 || image.height < 90 || Math.abs(image.width - image.height) / Math.max(image.width, image.height) > .02) throw new Error(`${job.id}: expected a square 3x3 sheet, at least 90 x 90 pixels.`);
  const cw = image.width / 3, ch = image.height / 3, result = new Map();
  if (job.key !== false) {
    const sheet = canvas(1260, 1260 * image.height / image.width);
    const context = sheet.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, sheet.width, sheet.height); keyGreen(sheet);
    const cells = segmentSheet(context.getImageData(0, 0, sheet.width, sheet.height).data, sheet.width, sheet.height);
    cells.forEach((pixels, i) => {
      const cell = canvas(pixels.width, pixels.height), ctx = cell.getContext('2d', { willReadFrequently: true });
      const data = ctx.createImageData(pixels.width, pixels.height); data.data.set(pixels.data); ctx.putImageData(data, 0, 0);
      result.set(job.poses[i], { canvas: cell, bounds: bounds(cell) });
    });
    return result;
  }
  for (let i = 0; i < 9; i++) {
    const cell = canvas(420, 420 * ch / cw);
    cell.getContext('2d').drawImage(image, i % 3 * cw, Math.floor(i / 3) * ch, cw, ch, 0, 0, cell.width, cell.height);
    try { result.set(job.poses[i], { canvas: cell, bounds: bounds(cell) }); }
    catch (error) { throw new Error(`${job.id}/${job.poses[i]}: ${error.message}`); }
  }
  return result;
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
  if (job.kind === 'cutin') width = 960;
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
    if (label === 'fighter') {
      value.color = update.color ?? item.color ?? '#ff824f';
      if (!/^#[0-9a-f]{6}$/i.test(value.color)) throw new Error(`Invalid color for ${item.id}`);
      value.poses = {};
    }
    return value;
  });
}

const SERVER = `const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname,types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4'};
const server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  let p;try{p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
  const file=path.resolve(root,'.'+(p==='/'?'/index.html':p));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.stat(file,(err,st)=>{
    if(err||!st.isFile()){res.writeHead(404);return res.end('Not found');}
    const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':st.size,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
    let start=0,end=st.size-1,status=200;
    if(req.headers.range){
      const range=/^bytes=([0-9]*)-([0-9]*)$/.exec(req.headers.range);
      let valid=!!range&&!!(range[1]||range[2])&&st.size>0;
      if(valid){
        if(range[1]){start=Number(range[1]);end=range[2]?Number(range[2]):end;valid=Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<st.size&&end>=start;end=Math.min(end,st.size-1);}
        else{const suffix=Number(range[2]);valid=Number.isSafeInteger(suffix)&&suffix>0;start=Math.max(0,st.size-suffix);}
      }
      if(!valid){res.writeHead(416,{...headers,'Content-Length':0,'Content-Range':'bytes */'+st.size});return res.end();}
      status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+st.size;headers['Content-Length']=end-start+1;
    }
    res.writeHead(status,headers);
    if(req.method==='HEAD'||st.size===0)return res.end();
    fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
  });
});
const port=Number(process.env.PORT||8080);server.listen(port,'127.0.0.1',()=>console.log('Game: http://127.0.0.1:'+port));
`;

export async function buildGame({ manifest: input, audioManifest: audioInput = null, videoManifest: videoInput = null, files, customization = {}, onProgress = () => {} }) {
  const source = validateManifest(input);
  const audioSource = audioInput ? validateAudioManifest(audioInput, source.game) : null;
  const videoSource = videoInput ? validateVideoManifest(videoInput) : null;
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
  if (videoSource && !files.has(videoSource.openingVideo.src)) throw new Error('Missing opening video file. Select the complete asset root.');
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
  for (const job of [...jobs, ...audioJobs, ...(videoSource ? [videoSource.openingVideo] : [])]) { const file = files.get(job.src); if (file) sourceBytes += file.size; }
  if (sourceBytes > MAX_BYTES) throw new Error('Selected source images exceed the 512 MB browser build limit.');
  const allCells = new Map(), accepted = [], total = jobs.length + audioJobs.length + 5 + Number(!!videoSource); let done = 0;
  if (videoSource) {
    const video = videoSource.openingVideo, blob = files.get(video.src);
    if (!(blob instanceof Blob) || !blob.size) throw new Error('Opening video file is empty.');
    if (!globalThis.crypto?.subtle) throw new Error('Video integrity verification requires localhost or HTTPS.');
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== video.sha256.toLowerCase()) throw new Error('Opening video SHA-256 mismatch.');
    const src = 'assets/video/opening.mp4';
    runtime.openingVideo = { ...video, src };
    output.set(src, blob); output.set(`sources/${video.src}`, blob);
    output.set('sources/video.json', jsonBlob(videoSource)); done++;
  }
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
        const src = `assets/references/${job.id}.png`; output.set(src, blob);
        (job.fighter ? selectedFighters.get(job.fighter) : selectedStages.get(job.stage)).sourceImage = src;
      } else if (job.kind === 'sprites') {
        const collection = allCells.get(job.fighter) || new Map();
        for (const [pose, cell] of sheetCells(image, job)) collection.set(pose, cell);
        allCells.set(job.fighter, collection);
      } else if (job.kind === 'effects') {
        const pending = [];
        for (const [pose, cell] of sheetCells(image, job)) {
          const result = await exportCell(cell, 1), src = `assets/effects/${pose}.png`;
          pending.push({ pose, src, ...result });
        }
        for (const result of pending) { output.set(result.src, result.blob); runtime.effects[result.pose] = { src: result.src, ...result.meta }; }
      } else if (job.kind !== 'reference') {
        const dirs = { portrait: 'portraits', hero: 'heroes', cutin: 'cutins', stage: 'stages', ui: 'ui' }, src = `assets/${dirs[job.kind]}/${job.id}.png`;
        output.set(src, await exportImage(image, job));
        if (job.fighter) selectedFighters.get(job.fighter)[job.kind] = src;
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
    const scale = 400 / Math.max(1, base.bounds.height - 1);
    try {
      const pending = [];
      for (const [pose, cell] of cells) {
        const result = await exportCell(cell, scale), src = `assets/fighters/${fighterId}_${pose}.png`;
        pending.push({ pose, src, ...result });
      }
      for (const result of pending) { output.set(result.src, result.blob); selectedFighters.get(fighterId).poses[result.pose] = { src: result.src, ...result.meta }; }
    } catch (error) {
      if (!allow) throw new Error(`${fighterId}: ${error.message}`);
      warnings.push(`${fighterId}: ${error.message} Sprite export omitted; placeholder mode is enabled.`);
    }
  }
  for (const file of ['index.html', 'game.js', 'engine.js', 'anim.js', 'style.css']) {
    onProgress({ done, total, message: `Packaging ${file}` });
    const response = await fetch(new URL(`../${file}`, import.meta.url));
    if (!response.ok) throw new Error(`Game template unavailable: ${file} (${response.status}). Run the builder through its local server.`);
    let content = await response.text();
    // A runtime template may link back to the builder; exported games must not.
    if (file === 'index.html') content = content.replace(/<a\b[^>]*href=["'][^"']*builder[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, '');
    output.set(file, new Blob([content], { type: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript' })); done++;
  }
  output.set('assets/manifest.json', jsonBlob(runtime));
  const sourceGame = { ...source.game, title: runtime.title,
    fighters: runtime.fighters.map(({ poses, portrait, hero, cutin, ...f }) => ({ ...source.game.fighters.find(item => item.id === f.id), ...f })),
    stages: runtime.stages.map(({ src, ...s }) => ({ ...source.game.stages.find(item => item.id === s.id), ...s })) };
  if (sourceGame.expectedAssets) sourceGame.expectedAssets = jobs.map(job => job.id);
  output.set('sources/assets.json', jsonBlob({ ...source, root: '.', game: sourceGame, assets: jobs }));
  if (audioSource) output.set('sources/audio.json', jsonBlob({ ...audioSource, assets: audioJobs }));
  output.set('assets/source-manifest.json', jsonBlob({ schema: 'dad-fighter-source-map/v1', root: '.', pathBase: 'game-package-root', sourceManifest: 'sources/assets.json', assets: accepted }));
  output.set('build-report.json', jsonBlob({ strict: !allow, sourceAssets: jobs.length, audioAssets: acceptedAudio.length, audioStatus: audioSource ? 'included' : 'not-supplied', openingVideo: runtime.openingVideo || null, built, missing: missing.map(j => j.id), warnings, requiresVisualReview: true }));
  output.set('package.json', jsonBlob({ name: 'custom-comfy-fighter', version: '1.0.0', private: true, scripts: { start: 'node start-server.cjs' }, engines: { node: '>=22' } }));
  output.set('start-server.cjs', new Blob([SERVER], { type: 'text/javascript' }));
  output.set('README.txt', new Blob([`${runtime.title}\n\nRun with Node.js 22 or later:\n  npm start\nThen open http://127.0.0.1:8080\nNo npm install is required. Or serve this folder with any static HTTP server.\nOpening index.html directly as file:// will not load the asset manifest.\n\nControls: One human fighter versus CPU. Arrow keys move, jump and crouch.\nA punch, S kick, D heavy strike, F special. Hold back to block. Escape pauses.\nSpace skips the opening film and fighter introductions. Use the fullscreen button to fill the display.\n\nassets/manifest.json maps all runtime art and sprite anchors.\nassets/source-manifest.json is a provenance report with paths relative to the game package root.\nsources/assets.json is the re-importable asset manifest; select the sources/ directory in the builder to use it again.\nsources/ contains original accepted artwork, including sprite sheets.\nbuild-report.json records missing/omitted images. Review generated poses and anchors before release.\n${warnings.length ? '\nPLACEHOLDER BUILD: ' + warnings.join('\n') : '\nAll selected source images were processed. Visual review is still required.'}\n`], { type: 'text/plain' }));
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
  if (size > MAX_BYTES) throw new Error('Export exceeds the 512 MB browser package limit.');
}
export async function zipFiles(files) {
  validateOutput(files);
  const local = [], central = []; let offset = 0, centralSize = 0;
  for (const [path, blob] of files) {
    const name = encoder.encode(path), data = new Uint8Array(await blob.arrayBuffer()), crc = crc32(data);
    if (name.length > 65535) throw new Error('ZIP filename is too long.');
    const head = new Uint8Array(30 + name.length), view = new DataView(head.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(12, 0x21, true); // Fixed DOS date 1980-01-01 for reproducible archives.
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true); head.set(name, 30);
    local.push(head, data);
    const entry = new Uint8Array(46 + name.length), cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); entry.set(name, 46);
    central.push(entry); centralSize += entry.length; offset += head.length + data.length;
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
