// Install a verified standalone export as the local preview. No model calls or canonical media changes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { isInside, sourceFile, directoryTarget, runtimeSources } = require('./lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');
const SHEETS = require('../../comfyui/config/game.json').sheets;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function plainTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Export directories cannot contain symbolic links or junctions: ${file}`);
    if (entry.isDirectory()) plainTree(file);
    else if (!entry.isFile()) throw new Error(`Export contains an unsupported file: ${file}`);
  }
}

function verifiedExport(game) {
  const source = fs.realpathSync(game);
  if (!fs.statSync(source).isDirectory()) throw new Error('Choose the game/ directory from a verified export.');
  plainTree(source);
  for (const file of ['index.html', 'style.css', 'engine.js', 'anim.js', 'game.js', 'start-server.cjs', 'package.json']) sourceFile(source, file);
  const receipt = read(sourceFile(path.dirname(source), 'build-test.json'));
  const build = read(sourceFile(source, 'build-report.json'));
  const manifest = read(sourceFile(source, 'assets/manifest.json'));
  const bundle = read(sourceFile(source, 'sources/assets.json'));
  if (!['comfy-fighter-assets/v1', 'dad-fighter-assets/v1'].includes(bundle.schema) || bundle.partial || bundle.root !== '.' || !Array.isArray(bundle.assets)) throw new Error('Export needs a complete source assets.json.');
  if (receipt.status !== 'passed' || receipt.title !== manifest.title || receipt.sourceAssets !== bundle.assets.length) throw new Error('Export must have a matching passed build-test.json from build:bundle.');
  if (build.strict !== true || !Array.isArray(build.missing) || build.missing.length || !Array.isArray(build.warnings) || build.warnings.length) throw new Error('Install requires a complete strict export without missing media or warnings.');
  if (manifest.generationPending || !isDeepStrictEqual(bundle.game?.sheets, SHEETS) || manifest.fighters?.length < 2 || !manifest.stages?.length) throw new Error('Export requires two fighters, an arena and the complete 27-pose layout.');
  const sources = runtimeSources(manifest, { config: bundle.game, plan: { jobs: bundle.assets }, strict: true });
  for (const src of sources) sourceFile(source, src);
  const poseCount = manifest.fighters.reduce((count, fighter) => count + Object.keys(fighter.poses).length, 0);
  if (receipt.poseCount !== poseCount || build.sourceAssets !== bundle.assets.length || !Array.isArray(build.built) || build.built.length !== bundle.assets.length || bundle.assets.some(asset => !build.built.includes(asset.id))) throw new Error('Export verification counts do not match the game.');
  const sourceRoot = path.join(source, 'sources'), records = [...bundle.assets];
  for (const filename of ['audio.json', 'video.json']) {
    if (!fs.existsSync(path.join(sourceRoot, filename))) continue;
    const map = read(sourceFile(sourceRoot, filename));
    if (filename === 'audio.json') {
      if (!Array.isArray(map.assets)) throw new Error('Invalid exported audio map.');
      records.push(...map.assets);
    } else { if (map.openingVideo) records.push(map.openingVideo); if (map.titleVideo) records.push(map.titleVideo); records.push(...(map.fighterIntros || [])); }
  }
  for (const record of records) {
    if (!record) throw new Error('Missing source media mapping.');
    const file = sourceFile(sourceRoot, record.src);
    if (record.sha256 && createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== record.sha256.toLowerCase()) throw new Error(`Export source hash mismatch: ${record.id}`);
  }
  return { source, manifest, sources, poseCount };
}

const SLOT = /^[a-z0-9][a-z0-9-]{1,31}$/;

// Without a slot the export becomes the main preview (output/game); with one it is served beside it at /<slot>/.
function installGame({ game, root = ROOT, slot = null } = {}) {
  if (!game || !path.isAbsolute(game)) throw new Error('Supply --game <absolute verified export/game directory>.');
  if (slot !== null && !SLOT.test(slot)) throw new Error('Slot ids use 2-32 lowercase letters, digits or dashes.');
  root = fs.realpathSync(root);
  const verified = verifiedExport(game), destination = slot ? path.join(root, 'output/games', slot) : path.join(root, 'output/game');
  const diagnostics = path.join(root, 'output/diagnostics'), builder = path.join(root, 'build/public/builder');
  if (slot) fs.mkdirSync(path.dirname(destination), { recursive: true });
  for (const folder of [destination, diagnostics, builder]) if (directoryTarget(folder) !== folder) throw new Error(`Project path is redirected: ${folder}`);
  if (verified.source === destination || isInside(destination, verified.source) || isInside(verified.source, destination)) throw new Error(`Export must be separate from ${slot ? `output/games/${slot}` : 'output/game'}.`);
  plainTree(builder);
  fs.mkdirSync(diagnostics, { recursive: true });
  const stage = fs.mkdtempSync(path.join(diagnostics, 'game-install-'));
  const stagedGame = path.join(stage, 'game'), backup = path.join(stage, 'previous-game');
  fs.cpSync(verified.source, stagedGame, { recursive: true });
  fs.cpSync(builder, path.join(stagedGame, 'builder'), { recursive: true });
  const receipt = {
    version: 1, source: verified.source, title: verified.manifest.title, slot,
    fighters: verified.manifest.fighters.length, stages: verified.manifest.stages.length, poses: verified.poseCount,
    runtimeMedia: new Set(verified.sources).size, builderIncluded: true,
    installedAt: new Date().toISOString(), previousGame: fs.existsSync(destination) ? backup : null,
    note: slot ? `npm start serves this game at /${slot}/ beside the main game; every title screen lists it under GAME SELECT.` : 'npm start serves this installed game. npm run build restores the canonical build/public preview.'
  };
  fs.writeFileSync(path.join(stagedGame, 'installation.json'), JSON.stringify(receipt, null, 2) + '\n');
  if (fs.existsSync(destination)) {
    plainTree(destination);
    fs.renameSync(destination, backup);
  }
  try { fs.renameSync(stagedGame, destination); }
  catch (error) { if (fs.existsSync(backup)) fs.renameSync(backup, destination); throw error; }
  fs.writeFileSync(path.join(stage, 'installation.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`Installed ${receipt.title}: ${receipt.fighters} fighters, ${receipt.stages} arena(s), ${receipt.poses} generated poses into ${slot ? `output/games/${slot}/` : 'output/game/'}.`);
  console.log(receipt.note);
  if (receipt.previousGame) console.log(`Previous installation retained at ${receipt.previousGame}`);
  return receipt;
}

const USAGE = 'Usage: npm run install:game -- --game <absolute verified export/game directory> [--slot <id>]';
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log(`${USAGE}\nRequires a successful build:bundle export. Preserves the builder route and backs up the previous installation; canonical media is unchanged.\n--slot <id> installs beside the main game (output/games/<id>, served at /<id>/ by npm start).`);
  else {
    try {
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        if (!['--game', '--slot'].includes(args[i]) || !args[i + 1] || options[args[i].slice(2)] !== undefined) throw new Error(USAGE);
        options[args[i].slice(2)] = args[i + 1];
      }
      if (!options.game) throw new Error(USAGE);
      installGame({ game: options.game, slot: options.slot ?? null });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
module.exports = { installGame, verifiedExport };
