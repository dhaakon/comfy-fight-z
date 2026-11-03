#!/usr/bin/env node
// Free, local build of the reviewed generated bundle. No ComfyUI or model calls.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const HELP = 'Usage: npm run example -- [--out <fresh export folder>] [--no-install] [--no-install-browser]\nBuilds the included 56 images and 22 audio clips locally, verifies gameplay, and installs output/game.\nNo ComfyUI, API key, FFmpeg or paid model run is required. Chromium is installed once if missing.\n--no-install keeps the existing output/game and only creates the standalone export.';

function parseArgs(args) {
  const options = { install: true, installBrowser: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    if (args[i] === '--no-install') options.install = false;
    else if (args[i] === '--no-install-browser') options.installBrowser = false;
    else if (args[i] === '--out' && args[i + 1] && !args[i + 1].startsWith('--') && !options.out) options.out = path.resolve(args[++i]);
    else throw new Error(HELP);
  }
  return options;
}

function command(program, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: 'inherit', ...options });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser installation exited ${code}. Run npm --prefix build exec -- playwright install chromium, then retry.`)));
  });
}

async function ensureBrowser({ root = ROOT, installBrowser = true, detect, execute = command, env = process.env } = {}) {
  detect ||= require('../build/tools/build-bundle.cjs').browserExecutable;
  try { return detect(); }
  catch (error) {
    if (!installBrowser || env.PLAYWRIGHT_EXECUTABLE_PATH) throw error;
    console.log('Chromium is not installed. Downloading the browser pinned by this project once; no model or ComfyUI service is contacted.');
    await execute(process.execPath, [path.join(root, 'build/node_modules/playwright/cli.js'), 'install', 'chromium'], { cwd: path.join(root, 'build'), env });
    return detect();
  }
}

async function run({ root = ROOT, out, install = true, installBrowser = true, services = {} } = {}) {
  root = fs.realpathSync(root);
  const { verifyBundle } = require('../build/tools/lib/example-bundle.cjs');
  const { directoryTarget, isInside } = require('../build/tools/lib/runtime-validation.cjs');
  const bundle = path.join(root, 'example/bundle');
  if (!fs.existsSync(path.join(bundle, 'assets.json'))) throw new Error('The generated example bundle is missing. Use a checkout that includes example/bundle; npm run example never submits cloud generation.');
  const checked = await (services.verify || verifyBundle)(bundle);
  const runId = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').replace('.', '-');
  out = path.resolve(out || path.join(root, 'output/example', runId, 'export'));
  if (directoryTarget(out) !== out || out === bundle || isInside(bundle, out) || isInside(out, bundle)) throw new Error('Example output must be separate from the source bundle and cannot use redirected paths.');
  if (fs.existsSync(out) && (!fs.statSync(out).isDirectory() || fs.readdirSync(out).length)) throw new Error('Choose a new or empty --out folder; previous examples are preserved.');
  console.log(`Verified bundled source files: ${checked.manifest.assets.length} images, ${checked.audio.assets.length} audio clips. Building locally without cloud inference.`);
  await (services.browser || ensureBrowser)({ root, installBrowser });
  const build = services.build || require('../build/tools/build-bundle.cjs').main;
  const report = await build({ bundle, out });
  if (report.status !== 'passed') throw new Error('The example did not pass its strict export/gameplay checks.');
  if (install) {
    const installGame = services.install || require('../build/tools/install-game.cjs').installGame;
    installGame({ game: path.join(out, 'game'), root });
    console.log('\nReady. Run npm start from the repository, then open http://127.0.0.1:8080/\nCustomize the bundle at http://127.0.0.1:8080/builder/');
  } else console.log(`\nStandalone game: ${path.join(out, 'game')}\nRun npm start inside that game folder. The previous output/game is unchanged.`);
  console.log(`ZIP: ${path.join(out, 'game.zip')}\nBuild checks: ${path.join(out, 'build-test.json')}`);
  return { out, installed: install, report };
}

if (require.main === module) Promise.resolve().then(() => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  return run(options);
}).catch(error => { console.error(error.code === 'MODULE_NOT_FOUND' ? 'Install project dependencies first: npm ci\n' + error.message : error.message); process.exitCode = 1; });
module.exports = { parseArgs, ensureBrowser, run };
