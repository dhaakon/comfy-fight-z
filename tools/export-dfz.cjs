const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_ROOT, inside, writeJson, readProject, parseArgs } = require('./lib/assets.cjs');

function exportDfz({ root = DEFAULT_ROOT, out } = {}) {
  if (!out) throw new Error('Supply --out <new staging directory>; this adapter never updates an existing game repository.');
  const project = readProject(root);
  root = project.root;
  const target = path.resolve(out);
  if (target === root || root.startsWith(target + path.sep)) throw new Error('Export must use a dedicated staging directory.');
  const marker = path.join(target, '.comfy-dfz-export');
  if (fs.existsSync(target) && fs.readdirSync(target).length && !fs.existsSync(marker)) {
    throw new Error('Export destination is nonempty and is not an adapter staging directory. Choose a new directory.');
  }
  const reportFile = path.join(target, 'export-report.json');
  let previousFiles = [];
  if (fs.existsSync(marker)) {
    if (!fs.existsSync(reportFile)) throw new Error('Staging directory has no managed-file inventory. Choose a new directory.');
    previousFiles = JSON.parse(fs.readFileSync(reportFile, 'utf8')).managedFiles;
    if (!Array.isArray(previousFiles)) throw new Error('Older staging export has no managed-file inventory. Choose a new directory.');
    for (const file of previousFiles) {
      if (typeof file !== 'string' || !(file.startsWith('src/assets/') || file === 'src/data.js')) {
        throw new Error('Invalid staging managed-file inventory. Choose a new directory.');
      }
      inside(target, file);
    }
  }
  const manifestFile = path.join(root, 'public/assets/manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('Build assets first with npm run build:assets.');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const copies = [], meta = {};
  const queue = (src, destination) => {
    const source = inside(path.join(root, 'public'), src);
    if (!fs.existsSync(source)) throw new Error(`Missing built asset: ${src}`);
    copies.push({ source, destination: inside(target, `src/assets/${destination}`) });
  };
  for (const fighter of manifest.fighters) {
    meta[fighter.id] = {};
    for (const [pose, record] of Object.entries(fighter.poses)) {
      queue(record.src, `fighters/${fighter.id}_${pose}.webp`);
      const { src, ...geometry } = record;
      meta[fighter.id][pose] = geometry;
    }
    if (fighter.portrait) queue(fighter.portrait, `portraits/${fighter.id}.webp`);
    if (fighter.hero) queue(fighter.hero, `heroes/${fighter.id}.webp`);
    if (fighter.cutin) queue(fighter.cutin, `cutins/${fighter.id}.webp`);
  }
  for (const stage of manifest.stages) if (stage.src) queue(stage.src, `stages/${stage.id}.webp`);
  for (const [id, src] of Object.entries(manifest.ui)) queue(src, `ui/${id}.webp`);
  for (const [id, effect] of Object.entries(manifest.effects)) queue(effect.src, `effects/${id}.webp`);
  const managedFiles = [...copies.map(copy => path.relative(target, copy.destination).split(path.sep).join('/')),
    'src/assets/fighters/meta.json', 'src/data.js'];
  const currentFiles = new Set(managedFiles);
  const staleFiles = previousFiles.filter(file => !currentFiles.has(file));
  // Remove only files tracked by an earlier successful export, never whole directories.
  for (const file of staleFiles) {
    const stale = inside(target, file);
    if (fs.existsSync(stale)) {
      if (!fs.lstatSync(stale).isFile()) throw new Error(`Managed export path is no longer a regular file: ${file}`);
      fs.unlinkSync(stale);
    }
  }
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(marker, 'Generated asset staging directory for the Dad Fighter Z adapter.\n');
  for (const copy of copies) {
    fs.mkdirSync(path.dirname(copy.destination), { recursive: true });
    fs.copyFileSync(copy.source, copy.destination);
  }
  writeJson(path.join(target, 'src/assets/fighters/meta.json'), meta);
  fs.writeFileSync(path.join(target, 'src/data.js'), `// Generated pose metadata. Merge this assignment into the destination game data.\nwindow.POSE_META = ${JSON.stringify(meta)};\n`);
  const report = { files: copies.length, managedFiles, removed: staleFiles,
    fighters: manifest.fighters.map(f => f.id), stages: manifest.stages.map(s => s.id),
    limitations: ['Art and pose metadata only; combat engine and roster code are not rewritten.',
      'The destination roster ids must match these fighter ids.',
      'Merge POSE_META into data.js without removing other game data.',
      'Reference-specific reaction cut-ins, summons, announcer voices, and music need their own assets.',
      'UI and effect files require explicit renderer hooks in the destination game.'] };
  writeJson(reportFile, report);
  return report;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = exportDfz(args);
    console.log(`Exported ${report.files} art files to ${path.resolve(args.out)}.`);
    console.log('This is an asset staging export; see export-report.json for integration requirements.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { exportDfz };
