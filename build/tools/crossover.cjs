// Compose a crossover game from installed, verified games: every fighter and arena in one roster, one interface, one
// shared announcer and effects set, and a title loop cut from each game's own title art. No model calls, no spending.
//
//   node build/tools/crossover.cjs [build/crossovers/ultra.json] [--out <directory>] [--no-install]
//
// A definition (schema comfy-fighter-crossover/v1) names the source games in roster order, the series whose
// announcer, menu music, sound effects and hit effects serve every fight, the interface art, the single final boss and
// its arena, and how many rivals of each series the Arcade ladder draws. Fighters keep their own poses, art, clips,
// voice lines and moveset; arenas keep their scenery and their music. The source games are never modified.
//
// Media under output/ is hard-linked when the volume allows it (else copied). Tracked media under build/public is always
// copied, so nothing written into the slot can reach the repository. The game is built beside output/games/<slot> and
// swapped in only after every mapped file and clip digest checks out; npm start serves it at /<slot>/ after a restart.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { safePath, sourceFile, isInside, directoryTarget, runtimeSources } = require('./lib/runtime-validation.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SCHEMA = 'comfy-fighter-crossover/v1';
const SLOT = /^[a-z0-9][a-z0-9-]{1,31}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const DEFAULT_DEFINITION = 'build/crossovers/ultra.json';
// The browser runtime a game slot serves (the server's public file list), copied from build/public.
const RUNTIME_FILES = ['index.html', 'game.js', 'engine.js', 'anim.js', 'render/arena.js', 'render/scenery.js', 'render/canvas-renderer.js',
  'render/pixi-renderer.js', 'vendor/pixi.min.js', 'style.css', 'session-client.js', 'multiplayer.js', 'network.css', 'controller.html',
  'controller.js', 'runtime-config.js', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'fonts/PressStart2P-Regular.ttf', 'fonts/OFL-PressStart2P.txt',
  // The original cast's static title art ships with every export and the static-site packer expects it, so a slot has it too.
  'arcade/title-backdrop.webp', 'arcade/title-ensemble.webp', 'arcade/select-backdrop.webp', 'arcade/menu-frame.webp', 'arcade/title-logo.webp'];
const OPTIONAL_RUNTIME = new Set(['LICENSE', 'THIRD-PARTY-NOTICES.txt']);
const FIGHTER_ART = ['portrait', 'hero', 'cutin', 'endingArt', 'sourceImage'];
const FIGHTER_CLIPS = ['introVideo', 'selectVideo'];
const VOICE_LINES = ['intro', 'special', 'super', 'attack', 'hurt', 'ko', 'win'];
const MONTAGE = { width: 1920, height: 1080, fps: 24, transition: 0.4, seam: 0.3 };
const ENSEMBLE = { width: 2752, height: 1536, divider: 8 };

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const srcOf = value => typeof value === 'string' ? value : value?.src;
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function repoFile(relative, what) {
  if (typeof relative !== 'string' || !relative) throw new Error(`${what} needs a repository-relative file path.`);
  safePath(relative);
  const file = path.resolve(ROOT, relative);
  if (!isInside(ROOT, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${what} is missing: ${relative}`);
  return file;
}

function loadDefinition(file) {
  const definition = read(file);
  const fail = message => { throw new Error(`${path.relative(ROOT, file)}: ${message}`); };
  if (definition.schema !== SCHEMA) fail(`schema must be ${SCHEMA}.`);
  if (!SLOT.test(definition.slot || '')) fail('slot uses 2-32 lowercase letters, digits or dashes.');
  if (typeof definition.title !== 'string' || !definition.title.trim()) fail('title is required.');
  if (definition.subtitle !== undefined && typeof definition.subtitle !== 'string') fail('subtitle must be text.');
  if (typeof definition.publicFigures !== 'boolean') fail('declare publicFigures: true when any source cast caricatures named public figures, else false.');
  if (!Array.isArray(definition.series) || definition.series.length < 2) fail('a crossover combines at least two games.');
  const ids = new Set();
  for (const series of definition.series) {
    if (!ID.test(series?.id || '') || ids.has(series.id)) fail(`series ids must be unique lowercase ids: ${series?.id}`);
    if (typeof series.name !== 'string' || !series.name.trim()) fail(`series ${series.id} needs a display name.`);
    if (series.tag !== undefined && (typeof series.tag !== 'string' || !series.tag.trim() || series.tag.length > 12)) fail(`series ${series.id}: tag is a short roster-row label of at most 12 characters.`);
    if (typeof series.game !== 'string' || !series.game) fail(`series ${series.id} needs the repository-relative game directory.`);
    ids.add(series.id);
  }
  if (!ids.has(definition.shared)) fail('shared must name a series: its announcer, menu music, sound effects and hit effects serve every fight.');
  if (typeof definition.finalBoss !== 'string') fail('finalBoss names the one fighter who waits at the end of Arcade.');
  if (typeof definition.bossStage !== 'string') fail('bossStage names the arena of the final battle.');
  const perSeries = definition.arcade?.perSeries;
  if (perSeries !== undefined && (!Number.isInteger(perSeries) || perSeries < 1 || perSeries > 8)) fail('arcade.perSeries is a whole number from 1 to 8.');
  if (definition.interface !== undefined && (typeof definition.interface !== 'object' || Array.isArray(definition.interface))) fail('interface maps ui ids to image files.');
  for (const key of Object.keys(definition.interface || {})) if (!ID.test(key)) fail(`interface key ${key} is not a ui id.`);
  if (definition.ensemble !== undefined && (!Array.isArray(definition.ensemble) || definition.ensemble.length !== 4)) fail('ensemble lists four key-art images for a 2 x 2 composite.');
  if (definition.selectVideo !== undefined && (typeof definition.selectVideo !== 'string' || !/\.mp4$/i.test(definition.selectVideo))) fail('selectVideo is a repository MP4 that loops the select backdrop.');
  if (definition.titleMontage !== undefined) {
    if (!Array.isArray(definition.titleMontage) || definition.titleMontage.length < 2) fail('titleMontage lists at least two segments.');
    for (const segment of definition.titleMontage) {
      if (!!segment?.image === !!segment?.video) fail('each titleMontage segment is either an image (with seconds) or a video.');
      if (segment.image && !(segment.seconds >= 2 && segment.seconds <= 12)) fail('a still montage segment lasts 2-12 seconds.');
    }
  }
  return definition;
}

function loadSeries(definition) {
  return definition.series.map(entry => {
    const dir = path.resolve(ROOT, entry.game);
    if (!isInside(ROOT, dir) || !fs.existsSync(path.join(dir, 'assets/manifest.json')))
      throw new Error(`Series ${entry.id}: ${entry.game} is not an installed game (assets/manifest.json missing). Install it first: node build/tools/new-game.cjs install --run <run> --slot <id>.`);
    const manifest = read(path.join(dir, 'assets/manifest.json'));
    if (!Array.isArray(manifest.fighters) || !manifest.fighters.length || !Array.isArray(manifest.stages) || !manifest.stages.length)
      throw new Error(`Series ${entry.id}: the runtime manifest needs fighters and stages.`);
    if (manifest.generationPending) throw new Error(`Series ${entry.id}: the game is still awaiting generated art.`);
    return { ...entry, dir: fs.realpathSync(dir), manifest };
  });
}

// Merge the runtime manifests. Returns the manifest plus a map of crossover paths to their source files.
function compose(definition, series) {
  const files = new Map(), dropped = [];
  const add = (owner, src, label, digest) => {
    safePath(src);
    if (!src.startsWith('assets/')) throw new Error(`${label}: runtime files live under assets/: ${src}`);
    const from = sourceFile(owner.dir, src), known = files.get(src);
    if (known) {
      if (known.from === from || sha256(known.from) === sha256(from)) return src;
      throw new Error(`${label} (${owner.id}) and ${known.label} (${known.series}) both map ${src}; rename one source asset before combining.`);
    }
    files.set(src, { from, series: owner.id, label, digest: typeof digest === 'string' ? digest.toLowerCase() : null, tracked: !isInside(path.join(ROOT, 'output'), from) });
    return src;
  };
  const fighters = [], stages = [], audio = {}, seriesList = [], fighterSeries = new Map(), stageSeries = new Map();
  for (const owner of series) {
    const { manifest } = owner, entry = { id: owner.id, name: owner.name, tag: owner.tag || owner.name, fighters: [], stages: [] };
    for (const fighter of manifest.fighters) {
      if (!ID.test(fighter.id || '')) throw new Error(`Series ${owner.id}: fighter id ${fighter.id} is not a simple id.`);
      if (fighterSeries.has(fighter.id)) throw new Error(`Fighter ${fighter.id} is in both ${fighterSeries.get(fighter.id)} and ${owner.id}; fighter ids must be unique across a crossover.`);
      if (!fighter.poses?.idle) throw new Error(`Series ${owner.id}: fighter ${fighter.id} has no poses.`);
      fighterSeries.set(fighter.id, owner.id); entry.fighters.push(fighter.id);
      const copy = structuredClone(fighter);
      copy.series = owner.id;
      // One final boss per game: the others keep their boss moveset (style) as regular, selectable fighters.
      if (fighter.id === definition.finalBoss) copy.boss = true; else delete copy.boss;
      for (const [pose, meta] of Object.entries(copy.poses)) add(owner, meta.src, `${fighter.id} ${pose}`);
      for (const kind of FIGHTER_ART) if (copy[kind]) add(owner, srcOf(copy[kind]), `${fighter.id} ${kind}`);
      for (const kind of FIGHTER_CLIPS) if (copy[kind]) {
        if (!/^assets\/video\/[A-Za-z0-9_-]+\.mp4$/.test(copy[kind].src || '')) throw new Error(`${fighter.id} ${kind} must be an assets/video/*.mp4 clip.`);
        add(owner, copy[kind].src, `${fighter.id} ${kind}`, copy[kind].sha256);
      }
      fighters.push(copy);
    }
    for (const stage of manifest.stages) {
      if (!ID.test(stage.id || '')) throw new Error(`Series ${owner.id}: stage id ${stage.id} is not a simple id.`);
      if (stageSeries.has(stage.id)) throw new Error(`Arena ${stage.id} is in both ${stageSeries.get(stage.id)} and ${owner.id}; arena ids must be unique across a crossover.`);
      if (!stage.src) throw new Error(`Series ${owner.id}: arena ${stage.id} has no painted stage.`);
      stageSeries.set(stage.id, owner.id); entry.stages.push(stage.id);
      const copy = structuredClone(stage);
      copy.series = owner.id;
      add(owner, copy.src, `${stage.id} stage`);
      if (copy.sourceImage) add(owner, srcOf(copy.sourceImage), `${stage.id} reference`);
      for (const layer of copy.scenery?.layers || []) add(owner, layer.src, `${stage.id} scenery ${layer.id}`);
      stages.push(copy);
    }
    // Each fighter's voice lines and each arena's music travel with them; everything else comes from the shared series.
    const voiced = new Set(entry.fighters.flatMap(id => VOICE_LINES.map(line => `fighter_${id}_${line}`)));
    const scored = new Set(entry.stages.map(id => `${id}_music`));
    for (const [key, clip] of Object.entries(manifest.audio || {})) {
      if (!(voiced.has(key) || scored.has(key) || owner.id === definition.shared)) { dropped.push(`${owner.id}:${key}`); continue; }
      if (audio[key]) throw new Error(`Audio ${key} is mapped by two series.`);
      add(owner, clip.src, `audio ${key}`, clip.sha256);
      audio[key] = structuredClone(clip);
    }
    seriesList.push(entry);
  }
  const boss = fighters.filter(f => f.boss);
  if (boss.length !== 1) throw new Error(`finalBoss ${definition.finalBoss} is not a fighter of any series.`);
  if (!stageSeries.has(definition.bossStage)) throw new Error(`bossStage ${definition.bossStage} is not an arena of any series.`);
  const shared = series.find(owner => owner.id === definition.shared);
  const effects = structuredClone(shared.manifest.effects || {});
  for (const [id, effect] of Object.entries(effects)) add(shared, effect.src, `effect ${id}`);
  const ui = {};
  // Interface art either comes from the definition (repository files) or from the shared series.
  // The game-select title card is drawn by node build/tools/new-game.cjs title-card --crossover <definition>.
  if (definition.interface) for (const [id, file] of Object.entries(definition.interface)) {
    if (id === 'card' && !fs.existsSync(path.resolve(ROOT, file))) throw new Error(`interface card is missing: ${file}. Draw it with node build/tools/new-game.cjs title-card --crossover <definition> --approve-usd 0.08.`);
    ui[id] = { file: repoFile(file, `interface ${id}`) };
  }
  else for (const [id, value] of Object.entries(shared.manifest.ui || {})) ui[id] = add(shared, srcOf(value), `ui ${id}`);
  const manifest = {
    version: 1, title: definition.title.trim(), subtitle: (definition.subtitle || '').trim(), crossover: definition.slot, publicFigures: definition.publicFigures,
    series: seriesList, arcade: { perSeries: definition.arcade?.perSeries || 2, bossStage: definition.bossStage },
    fighters, stages, ui, effects, audio
  };
  if (!definition.titleMontage && shared.manifest.titleVideo) manifest.titleVideo = { ...structuredClone(shared.manifest.titleVideo), src: add(shared, shared.manifest.titleVideo.src, 'title loop', shared.manifest.titleVideo.sha256) };
  return { manifest, files, dropped };
}

function place(from, to, tracked) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!tracked) { try { fs.linkSync(from, to); return 'link'; } catch { /* another volume, or links unsupported: copy */ } }
  fs.copyFileSync(from, to);
  return 'copy';
}

function ffmpeg(args, what) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (result.error?.code === 'ENOENT') throw new Error(`${what} needs ffmpeg on PATH.`);
  if (result.status !== 0) throw new Error(`${what} failed: ${(result.stderr || result.error?.message || '').trim().slice(-800)}`);
}

function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=width,height,nb_read_packets', '-show_entries', 'format=duration',
    '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe could not read ${file}: ${(result.stderr || '').trim()}`);
  const data = JSON.parse(result.stdout), stream = data.streams?.[0] || {};
  return { width: stream.width, height: stream.height, frames: Number(stream.nb_read_packets), duration: Number(data.format?.duration) };
}

// A 2 x 2 key-art composite: the startup still under the title loop and the GAME SELECT card.
async function ensembleArt(files, output) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const { width, height, divider } = ENSEMBLE, canvas = createCanvas(width, height), context = canvas.getContext('2d');
  context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
  const cellW = (width - divider) / 2, cellH = (height - divider) / 2;
  for (const [index, file] of files.entries()) {
    const image = await loadImage(fs.readFileSync(file)), x = (index % 2) * (cellW + divider), y = Math.floor(index / 2) * (cellH + divider);
    const scale = Math.max(cellW / image.width, cellH / image.height), w = image.width * scale, h = image.height * scale;
    context.save(); context.beginPath(); context.rect(x, y, cellW, cellH); context.clip();
    context.drawImage(image, x + (cellW - w) / 2, y + (cellH - h) / 2, w, h); context.restore();
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, await canvas.encode('webp', 94));
}

// The title loop: each segment in order with a quick white flash between them and through the loop seam.
async function titleMontage(segments, output, scratch) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const { width, height, fps, transition, seam } = MONTAGE, inputs = [], chains = [], durations = [];
  fs.mkdirSync(scratch, { recursive: true });
  for (const [index, segment] of segments.entries()) {
    if (segment.image) {
      // Render the still at twice the output size so the slow push-in stays smooth.
      const image = await loadImage(fs.readFileSync(segment.file)), canvas = createCanvas(width * 2, height * 2), context = canvas.getContext('2d');
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height), w = image.width * scale, h = image.height * scale;
      context.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      const still = path.join(scratch, `still-${index}.png`); fs.writeFileSync(still, canvas.toBuffer('image/png'));
      const frames = Math.round(segment.seconds * fps);
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(segment.seconds), '-i', still);
      chains.push(`[${index}:v]zoompan=z='1+${(0.08 / frames).toFixed(6)}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},format=yuv420p,setsar=1,settb=AVTB[s${index}]`);
      durations.push(frames / fps);
    } else {
      const facts = probe(segment.file);
      if (!(facts.duration > transition * 2)) throw new Error(`Montage clip is too short: ${segment.video}`);
      inputs.push('-i', segment.file);
      chains.push(`[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},format=yuv420p,setsar=1,settb=AVTB[s${index}]`);
      durations.push(facts.duration);
    }
  }
  let label = 's0', length = durations[0];
  for (let index = 1; index < segments.length; index++) {
    const next = `x${index}`;
    chains.push(`[${label}][s${index}]xfade=transition=fadewhite:duration=${transition}:offset=${(length - transition).toFixed(3)}[${next}]`);
    label = next; length += durations[index] - transition;
  }
  chains.push(`[${label}]fade=t=in:st=0:d=${seam}:color=white,fade=t=out:st=${(length - seam).toFixed(3)}:d=${seam}:color=white[out]`);
  ffmpeg([...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', '-map_metadata', '-1', output], 'The title montage');
  const facts = probe(output);
  if (facts.width !== width || facts.height !== height || Math.abs(facts.duration - length) > 0.2) throw new Error(`The title montage came out ${facts.width}x${facts.height}, ${facts.duration}s (expected ${length.toFixed(2)}s).`);
  return { duration: Number(facts.duration.toFixed(3)), frames: facts.frames };
}

function verify(game, manifest) {
  const sources = new Set(runtimeSources(manifest));
  for (const fighter of manifest.fighters) if (fighter.selectVideo) sources.add(fighter.selectVideo.src);
  for (const src of sources) sourceFile(game, src);
  for (const fighter of manifest.fighters) for (const kind of FIGHTER_CLIPS) {
    const clip = fighter[kind];
    if (clip?.sha256 && sha256(path.join(game, clip.src)) !== clip.sha256.toLowerCase()) throw new Error(`Clip digest mismatch: ${fighter.id} ${kind}`);
  }
  if (new Set(manifest.fighters.map(f => f.id)).size !== manifest.fighters.length || new Set(manifest.stages.map(s => s.id)).size !== manifest.stages.length) throw new Error('Crossover ids must be unique.');
  if (manifest.fighters.filter(f => f.boss).length !== 1) throw new Error('A crossover has exactly one final boss.');
  for (const file of RUNTIME_FILES) if (!OPTIONAL_RUNTIME.has(file)) sourceFile(game, file);
  return sources.size;
}

// An installed crossover slot, re-verified the way an export's game/ is: every mapped file inside the slot, the clip
// digests intact and the runtime files present. The static-site packer takes it in place of an export.
function verifiedCrossover(game) {
  const source = fs.realpathSync(game), recordFile = path.join(source, 'installation.json');
  const record = fs.existsSync(recordFile) ? read(recordFile) : null;
  if (record?.source !== 'crossover') throw new Error(`${game} is not an installed crossover slot.`);
  const manifest = read(path.join(source, 'assets/manifest.json'));
  verify(source, manifest);
  return { source, manifest, record, sources: runtimeSources(manifest), poseCount: manifest.fighters.reduce((sum, fighter) => sum + Object.keys(fighter.poses).length, 0) };
}

async function buildCrossover({ definitionPath = path.join(ROOT, DEFAULT_DEFINITION), out = null, install = true, log = console.log } = {}) {
  definitionPath = path.resolve(definitionPath);
  const definition = loadDefinition(definitionPath), series = loadSeries(definition);
  const { manifest, files, dropped } = compose(definition, series);
  const slots = path.join(ROOT, 'output/games'), target = out ? path.resolve(out) : path.join(slots, definition.slot);
  if (!isInside(path.join(ROOT, 'output'), directoryTarget(target))) throw new Error('A crossover is built under output/.');
  for (const owner of series) if (target === owner.dir || isInside(target, owner.dir)) throw new Error(`The crossover cannot replace its source game ${owner.id}.`);
  const staging = path.join(path.dirname(target), `.${path.basename(target)}-staging`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    const counts = { link: 0, copy: 0 };
    for (const file of RUNTIME_FILES) {
      const from = path.join(ROOT, 'build/public', file);
      if (!fs.existsSync(from)) { if (OPTIONAL_RUNTIME.has(file)) continue; throw new Error(`Runtime file missing: build/public/${file}`); }
      fs.mkdirSync(path.dirname(path.join(staging, file)), { recursive: true }); fs.copyFileSync(from, path.join(staging, file));
    }
    // The same standalone server an export ships, so the slot also runs on its own with npm start.
    fs.copyFileSync(repoFile('build/public/builder/runtime-server.cjs', 'The bundled game server'), path.join(staging, 'start-server.cjs'));
    fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: `comfy-fighter-${definition.slot}`, version: '1.0.0', license: 'MIT', private: true,
      scripts: { start: 'node start-server.cjs' }, engines: { node: '>=22' } }, null, 2) + '\n');
    for (const [src, entry] of files) {
      if (entry.digest && sha256(entry.from) !== entry.digest) throw new Error(`Source digest mismatch: ${entry.series} ${entry.label} (${src})`);
      counts[place(entry.from, path.join(staging, src), entry.tracked)]++;
    }
    for (const [id, value] of Object.entries(manifest.ui)) {
      if (typeof value === 'string') continue;
      const src = `assets/ui/${id}${path.extname(value.file).toLowerCase()}`;
      place(value.file, path.join(staging, src), true); manifest.ui[id] = src; counts.copy++;
    }
    if (definition.ensemble) {
      await ensembleArt(definition.ensemble.map((file, index) => repoFile(file, `ensemble image ${index + 1}`)), path.join(staging, 'assets/ui/ensemble.webp'));
      manifest.ui.ensemble = 'assets/ui/ensemble.webp';
    }
    if (definition.titleMontage) {
      const segments = definition.titleMontage.map(segment => ({ ...segment, file: repoFile(segment.image || segment.video, 'title montage segment') }));
      const output = path.join(staging, 'assets/video/title.mp4');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      const facts = await titleMontage(segments, output, path.join(staging, '.montage'));
      fs.rmSync(path.join(staging, '.montage'), { recursive: true, force: true });
      manifest.titleVideo = { id: 'title', src: 'assets/video/title.mp4', duration: facts.duration, sha256: sha256(output), hasAudio: false };
    }
    // The select loop of the interface art the crossover borrows (Ultra: the original game's arcade select backdrop).
    if (definition.selectVideo) {
      const src = 'assets/video/select.mp4', output = path.join(staging, src);
      place(repoFile(definition.selectVideo, 'selectVideo'), output, true);
      manifest.selectVideo = { id: 'select', src, duration: Number(probe(output).duration.toFixed(3)), sha256: sha256(output), hasAudio: false };
    }
    fs.writeFileSync(path.join(staging, 'assets/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const mapped = verify(staging, manifest);
    const poses = manifest.fighters.reduce((sum, fighter) => sum + Object.keys(fighter.poses).length, 0);
    const record = {
      version: 1, source: 'crossover', definition: path.relative(ROOT, definitionPath).split(path.sep).join('/'), title: manifest.title, subtitle: manifest.subtitle,
      slot: definition.slot, fighters: manifest.fighters.length, stages: manifest.stages.length, poses, runtimeMedia: mapped, publicFigures: definition.publicFigures,
      finalBoss: definition.finalBoss, bossStage: definition.bossStage,
      series: series.map(owner => ({ id: owner.id, name: owner.name, game: owner.game, fighters: owner.manifest.fighters.length, stages: owner.manifest.stages.length,
        manifestSha256: sha256(path.join(owner.dir, 'assets/manifest.json')),
        installedFrom: fs.existsSync(path.join(owner.dir, 'installation.json')) ? read(path.join(owner.dir, 'installation.json')).source || null : null })),
      linked: counts.link, copied: counts.copy, droppedAudio: dropped, builtAt: new Date().toISOString(),
      note: `npm start serves this game at /${definition.slot}/ beside the main game; every title screen lists it under GAME SELECT.`
    };
    fs.writeFileSync(path.join(staging, 'installation.json'), JSON.stringify(record, null, 2) + '\n');
    if (!install && !out) { log(`Verified ${definition.slot} in ${path.relative(ROOT, staging)} (not installed).`); return { record, manifest, game: staging }; }
    const retired = path.join(path.dirname(target), `.${path.basename(target)}-retired`);
    fs.rmSync(retired, { recursive: true, force: true });
    try {
      if (fs.existsSync(target)) fs.renameSync(target, retired);
      fs.renameSync(staging, target);
    } catch (error) {
      if (!fs.existsSync(target) && fs.existsSync(retired)) fs.renameSync(retired, target);
      throw new Error(`Could not swap in ${path.relative(ROOT, target)} (${error.code || error.message}); stop npm start, then run this again.`);
    }
    fs.rmSync(retired, { recursive: true, force: true });
    log(`${manifest.title}: ${manifest.subtitle} -> ${path.relative(ROOT, target)}`);
    log(`  ${plural(manifest.fighters.length, 'fighter')} (${poses} poses), ${plural(manifest.stages.length, 'arena')}, ${mapped} runtime files (${counts.link} linked, ${counts.copy} copied).`);
    log(`  Final boss ${definition.finalBoss} in ${definition.bossStage}; Arcade draws ${manifest.arcade.perSeries} rivals from each of ${series.length} series.`);
    if (dropped.length) log(`  Left out ${dropped.length} shared clips of the other series (their menu music, announcer and effects).`);
    if (!out) log(`  Restart npm start to serve it at /${definition.slot}/.`);
    return { record, manifest, game: target };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--out') options.out = args[++index];
    else if (arg === '--no-install') options.install = false;
    else if (!arg.startsWith('--') && !options.definitionPath) options.definitionPath = arg;
    else { console.error('Usage: node build/tools/crossover.cjs [definition.json] [--out <directory under output/>] [--no-install]'); process.exit(2); }
  }
  buildCrossover(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { buildCrossover, loadDefinition, loadSeries, compose, ensembleArt, verifiedCrossover, SCHEMA };
