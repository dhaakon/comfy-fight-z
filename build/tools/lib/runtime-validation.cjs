const fs = require('node:fs');
const path = require('node:path');

function isInside(root, file) {
  const relative = path.relative(root, file);
  return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
function safePath(src) {
  if (typeof src !== 'string' || !src || /[\\:\x00-\x1f%?#]/.test(src) || src.startsWith('/') || src.split('/').some(part => !part || part === '.' || part === '..' || /[<>"|*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Unsafe asset path: ${src}`);
  return src;
}
function sourceFile(root, src) {
  safePath(src);
  const file = path.resolve(root, src);
  if (!isInside(root, file)) throw new Error(`Source escapes asset root: ${src}`);
  const resolved = fs.realpathSync(file);
  if (!isInside(fs.realpathSync(root), resolved)) throw new Error(`Source symlink escapes asset root: ${src}`);
  if (!fs.statSync(resolved).isFile()) throw new Error(`Asset must be a file: ${src}`);
  return resolved;
}
// Resolve existing ancestors too, so an output beneath a junction cannot alias an input.
function directoryTarget(folder) {
  folder = path.resolve(folder);
  if (fs.existsSync(folder)) return fs.realpathSync(folder);
  const parent = path.dirname(folder);
  if (parent === folder) throw new Error(`Cannot resolve directory: ${folder}`);
  return path.join(directoryTarget(parent), path.basename(folder));
}
function runtimeSources(manifest, { config, plan, strict = false } = {}) {
  if (!Array.isArray(manifest.fighters) || !Array.isArray(manifest.stages)) throw new Error('Runtime requires fighter and stage lists.');
  const sources = [], add = value => { const src = typeof value === 'string' ? value : value?.src; safePath(src); if (!src.startsWith('assets/')) throw new Error(`Runtime file must be under assets/: ${src}`); sources.push(src); };
  for (const fighter of manifest.fighters) {
    if (!fighter.poses || typeof fighter.poses !== 'object') throw new Error(`Missing fighter poses: ${fighter.id}`);
    Object.values(fighter.poses).forEach(add);
    for (const kind of ['portrait', 'hero', 'cutin', 'endingArt', 'sourceImage']) if (fighter[kind]) add(fighter[kind]);
    if (fighter.introVideo) { if (!Number.isFinite(fighter.introVideo.duration) || fighter.introVideo.duration <= 0 || fighter.introVideo.duration > 30 || !/\.mp4$/i.test(fighter.introVideo.src)) throw new Error(`Invalid introduction video mapping: ${fighter.id}`); add(fighter.introVideo); }
  }
  for (const stage of manifest.stages) { if (stage.src) add(stage.src); if (stage.sourceImage) add(stage.sourceImage); }
  for (const group of ['ui', 'effects', 'audio']) Object.values(manifest[group] || {}).forEach(add);
  if (manifest.openingVideo) {
    if (!Number.isFinite(manifest.openingVideo.duration) || manifest.openingVideo.duration <= 0 || !/\.mp4$/i.test(manifest.openingVideo.src)) throw new Error('Invalid opening video mapping.');
    add(manifest.openingVideo);
  }
  if (manifest.titleVideo) {
    if (!Number.isFinite(manifest.titleVideo.duration) || manifest.titleVideo.duration <= 0 || !/\.mp4$/i.test(manifest.titleVideo.src)) throw new Error('Invalid title video mapping.');
    add(manifest.titleVideo);
  }
  if (strict) {
    const sameIds = (actual, expected) => actual.length === expected.length && new Set(actual).size === actual.length && expected.every(id => actual.includes(id));
    if (!sameIds(manifest.fighters.map(f => f.id), config.fighters.map(f => f.id)) || !sameIds(manifest.stages.map(s => s.id), config.stages.map(s => s.id))) throw new Error('Strict runtime roster and stages must match config.');
    // The 27 required poses are mandatory; optional arcade in-betweens are all-or-nothing per sheet.
    const poses = Object.values(config.sheets).flat(), extras = [...Object.values(config.extraSheets || {}), ...Object.values(config.motionSheets || {})];
    for (const fighter of manifest.fighters) {
      const names = Object.keys(fighter.poses), expected = [...poses, ...extras.filter(sheet => sheet.some(pose => names.includes(pose))).flat()];
      if (!sameIds(names, expected)) throw new Error(`Strict runtime requires all configured pose names: ${fighter.id}`);
    }
    for (const job of plan?.jobs || []) {
      const owner = job.fighter ? manifest.fighters.find(f => f.id === job.fighter) : manifest.stages.find(s => s.id === job.stage);
      let present = true;
      if (job.kind === 'source') present = owner?.sourceImage;
      else if (['portrait', 'hero', 'cutin'].includes(job.kind)) present = owner?.[job.kind];
      else if (job.kind === 'ending') present = owner?.endingArt;
      else if (job.kind === 'sprites') present = job.poses.every(pose => owner?.poses?.[pose]);
      else if (job.kind === 'stage') present = owner?.src;
      else if (job.kind === 'ui') present = manifest.ui?.[job.id] || job.id === 'frame'; // the menu frame is optional: earlier releases predate it
      else if (job.kind === 'effects') present = job.poses.every(pose => manifest.effects?.[pose]?.src);
      if (!present) throw new Error(`Strict runtime asset mapping is missing: ${job.id}`);
    }
  }
  return sources;
}
module.exports = { isInside, safePath, sourceFile, directoryTarget, runtimeSources };
