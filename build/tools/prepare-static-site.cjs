// Package a verified game for static hosting. Never reads credentials or deploys remotely.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifiedExport } = require('./install-game.cjs');
const { directoryTarget, isInside, sourceFile, runtimeSources } = require('./lib/runtime-validation.cjs');
const ROOT = path.resolve(__dirname, '../..');
const CODE = ['index.html', 'style.css', 'engine.js', 'anim.js', 'render/arena.js', 'render/canvas-renderer.js', 'render/pixi-renderer.js', 'vendor/pixi.min.js', 'fonts/PressStart2P-Regular.ttf', 'fonts/OFL-PressStart2P.txt', 'game.js', 'runtime-config.js', 'session-client.js', 'multiplayer.js', 'controller.js', 'controller.html', 'network.css', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'arcade/title-backdrop.webp', 'arcade/title-ensemble.webp', 'arcade/select-backdrop.webp', 'arcade/menu-frame.webp', 'arcade/title-logo.webp'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.mp4': 'video/mp4' };
const digest = data => createHash('sha256').update(data).digest('hex');

function prepareStaticSite({ game, out } = {}) {
  if (!game || !out) throw new Error('Supply --game <verified export/game> and --out <deployment folder>.');
  game = path.resolve(game); out = path.resolve(out);
  const source = verifiedExport(game), site = path.join(out, 'site');
  if (!isInside(path.join(ROOT, 'output/deploy'), out) || directoryTarget(out) !== out) throw new Error('Deployment artifacts must be in a plain output/deploy/<run> directory.');
  if (site === source.source || isInside(source.source, site) || isInside(site, source.source)) throw new Error('Static output must be separate from the source game.');
  if (fs.existsSync(site) || fs.existsSync(path.join(out, 'deployment.json'))) throw new Error('Static site artifacts already exist; choose a fresh deployment folder.');
  const names = [...new Set([...CODE, 'assets/manifest.json', ...runtimeSources(source.manifest)])].sort();
  const files = names.map(name => {
    if (name.split('/').some(part => part.startsWith('.')) || /(?:^|\/)(?:sources|raw|builder|node_modules)(?:\/|$)/i.test(name)) throw new Error(`Unexpected deployment file: ${name}`);
    const contentType = ['LICENSE', 'THIRD-PARTY-NOTICES.txt'].includes(name) ? 'text/plain; charset=utf-8' : TYPES[path.extname(name).toLowerCase()];
    if (!contentType || !CODE.includes(name) && !name.startsWith('assets/')) throw new Error(`Unsupported deployment file: ${name}`);
    const file = sourceFile(source.source, name), bytes = fs.readFileSync(file);
    return { path: name, source: file, bytes: bytes.length, sha256: digest(bytes), contentType };
  });
  const html = fs.readFileSync(sourceFile(source.source, 'index.html'), 'utf8');
  if (!html.includes('https://github.com/dhaakon/comfy-fight-z')) throw new Error('The public game must link to its repository.');
  if (!fs.readFileSync(sourceFile(source.source, 'LICENSE')).equals(fs.readFileSync(path.join(ROOT, 'LICENSE')))) throw new Error('The static game must retain its complete MIT notice.');
  fs.mkdirSync(site, { recursive: true });
  for (const file of files) {
    const target = path.join(site, file.path); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.source, target);
    if (digest(fs.readFileSync(target)) !== file.sha256) throw new Error(`Copied file checksum mismatch: ${file.path}`);
  }
  const publicFiles = files.map(({ source: ignored, ...file }) => file);
  const report = { schema: 'comfy-fighter-static-deployment/v1', preparedAt: new Date().toISOString(), title: source.manifest.title,
    repository: 'https://github.com/dhaakon/comfy-fight-z', site: path.relative(ROOT, site).split(path.sep).join('/'),
    sourceExport: path.relative(ROOT, source.source).split(path.sep).join('/'),
    files: publicFiles, fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    artifactSha256: digest(publicFiles.map(file => `${file.path}\0${file.sha256}\n`).join('')),
    fighters: source.manifest.fighters.length, stages: source.manifest.stages.length, poses: source.poseCount,
    audioClips: Object.keys(source.manifest.audio || {}).length, sourceBundlesIncluded: false, credentialsRead: false, remoteDeploymentPerformed: false };
  fs.writeFileSync(path.join(out, 'deployment.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Prepared ${files.length} runtime files, ${(report.bytes / 1024 / 1024).toFixed(1)} MiB.\nSite: ${site}\nSHA-256: ${report.artifactSha256}\nAudit: ${path.join(out, 'deployment.json')}`);
  return report;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = {};
    if (args.length === 1 && args[0] === '--help') console.log('Usage: node build/tools/prepare-static-site.cjs --game <verified export/game> --out output/deploy/<fresh run>\nCopies only runtime HTML/CSS/JS, the MIT notice and manifest-mapped assets. Creates a local site/ and checksum audit; performs no remote deployment.');
    else {
      for (let i = 0; i < args.length; i++) {
        if (!['--game', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i].slice(2)]) throw new Error('Use --game <verified export/game> --out output/deploy/<fresh run>.');
        options[args[i].slice(2)] = args[++i];
      }
      prepareStaticSite(options);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareStaticSite };
