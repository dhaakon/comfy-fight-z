// Compile an actual mapped ComfyUI bundle through the browser builder, then test the exported game.
// This command never generates images or submits paid jobs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const PROJECT = path.resolve(__dirname, '..');
const MAX_ZIP_BYTES = 512 * 1024 * 1024;

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') return { help: true };
    if (!['--bundle', '--out', '--title'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: node tools/build-bundle.cjs --bundle <absolute bundle folder> --out <absolute fresh output folder> [--title "Game title"]');
    const key = argv[i].slice(2);
    if (options[key] !== undefined) throw new Error(`Duplicate argument: ${argv[i]}`);
    options[key] = argv[++i];
  }
  if (!path.isAbsolute(options.bundle || '') || !path.isAbsolute(options.out || '')) throw new Error('--bundle and --out must both be absolute directories.');
  return options;
}

function assertPlainPath(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink/junction paths are not supported for export: ${current}`);
    if (path.dirname(current) === current) break;
  }
}

function browserExecutable() {
  const requested = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (requested) {
    if (!fs.existsSync(requested)) throw new Error(`PLAYWRIGHT_EXECUTABLE_PATH does not exist: ${requested}`);
    return requested;
  }
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'ms-playwright')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches/ms-playwright') : path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(cache)) {
    const versions = fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const version of versions) for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium']) {
      const file = path.join(cache, version, relative);
      if (fs.existsSync(file)) return file;
    }
  }
  throw new Error('Chromium is unavailable. Run npx playwright install chromium or set PLAYWRIGHT_EXECUTABLE_PATH.');
}

async function serveProject() {
  const root = path.join(PROJECT, 'public');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
  const server = http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); return response.end(); }
    const target = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!target.startsWith(root + path.sep)) { response.writeHead(403); return response.end(); }
    fs.stat(target, (error, stat) => {
      if (error || !stat.isFile()) { response.writeHead(404); return response.end('Not found'); }
      response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (request.method === 'HEAD') return response.end();
      fs.createReadStream(target).on('error', () => response.destroy()).pipe(response);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function startGame(directory) {
  const port = await unusedPort(), url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['start-server.cjs'], { cwd: directory, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Exported game did not start: ${output}`)), 10000);
      const fail = error => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`Exported game exited (${code}): ${output}`)));
      child.stdout.on('data', chunk => { output += String(chunk); if (output.includes(url)) { clearTimeout(timeout); resolve(); } });
      child.stderr.on('data', chunk => { output += String(chunk); });
    });
  } catch (error) { child.kill(); throw error; }
  return { child, url };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
function safeArchivePath(name) {
  if (!name || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Unsafe archive entry: ${name}`);
}

function extractStoredZip(bytes, destination) {
  if (bytes.length < 22 || bytes.length > MAX_ZIP_BYTES) throw new Error('ZIP size is invalid or exceeds 512 MB.');
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 20) !== 0) throw new Error('ZIP end record is missing or unsupported.');
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Multi-disk ZIP is unsupported.');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  if (!count || count !== bytes.readUInt16LE(end + 8) || centralStart + centralSize !== end) throw new Error('ZIP directory bounds are invalid.');
  const files = new Map(), used = new Set(); let cursor = centralStart, localEnd = 0, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Corrupt ZIP central record.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16);
    const size = bytes.readUInt32LE(cursor + 20), uncompressed = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || method !== 0 || flags !== 0x800 || size !== uncompressed || offset !== localEnd || offset + 30 > centralStart) throw new Error('Unsupported or corrupt stored ZIP record.');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength), name = nameBytes.toString('utf8');
    safeArchivePath(name);
    if (used.has(name.toLowerCase())) throw new Error(`Duplicate archive path: ${name}`);
    used.add(name.toLowerCase());
    if (bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method || bytes.readUInt32LE(offset + 14) !== crc || bytes.readUInt32LE(offset + 18) !== size || bytes.readUInt32LE(offset + 22) !== size || bytes.readUInt16LE(offset + 26) !== nameLength) throw new Error(`Mismatched local ZIP header: ${name}`);
    const localExtra = bytes.readUInt16LE(offset + 28), start = offset + 30 + nameLength + localExtra;
    if (!bytes.subarray(offset + 30, offset + 30 + nameLength).equals(nameBytes) || start + size > centralStart) throw new Error(`Invalid ZIP data bounds: ${name}`);
    const data = bytes.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`ZIP checksum mismatch: ${name}`);
    expanded += size; if (expanded > MAX_ZIP_BYTES) throw new Error('Expanded ZIP exceeds 512 MB.');
    files.set(name, data); localEnd = start + size; cursor = next;
  }
  if (cursor !== end || localEnd !== centralStart) throw new Error('ZIP has unexplained data or mismatched record counts.');
  fs.mkdirSync(destination, { recursive: false });
  for (const [name, data] of files) {
    const target = path.resolve(destination, name);
    if (!target.startsWith(destination + path.sep)) throw new Error(`Archive path escapes export: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data, { flag: 'wx' });
  }
  return files;
}

async function main(options) {
  const bundle = fs.realpathSync(options.bundle), output = path.resolve(options.out);
  const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const sourcePath = comparable(bundle), outputPath = comparable(output);
  if (outputPath === sourcePath || outputPath.startsWith(sourcePath + path.sep) || sourcePath.startsWith(outputPath + path.sep)) throw new Error('The output and source bundle must be separate directories, not nested.');
  assertPlainPath(output);
  if (fs.existsSync(output) && (!fs.statSync(output).isDirectory() || fs.readdirSync(output).length)) throw new Error('Output must be a new or empty directory; previous exports are never overwritten.');
  const manifestPath = path.join(bundle, 'assets.json'), manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const audioPath = path.join(bundle, 'audio.json'), audio = fs.existsSync(audioPath) ? JSON.parse(fs.readFileSync(audioPath, 'utf8')) : null;
  if (manifest.schema !== 'dad-fighter-assets/v1' || !Array.isArray(manifest.assets)) throw new Error('Expected the assets.json produced by the ComfyUI mapped bundle workflow.');
  fs.mkdirSync(output, { recursive: true });
  const report = { status: 'running', startedAt: new Date().toISOString(), bundle, output, title: options.title || manifest.game.title, sourceAssets: manifest.assets.length, checks: [], browserErrors: [], screenshots: [], generationSubmitted: false };
  const saveReport = () => fs.writeFileSync(path.join(output, 'build-test.json'), JSON.stringify(report, null, 2) + '\n');
  saveReport();
  let projectServer, browser, gameServer, builderPage, game;
  try {
    projectServer = await serveProject();
    const executablePath = browserExecutable(); report.browserExecutable = executablePath;
    browser = await chromium.launch({ headless: true, executablePath });
    builderPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    builderPage.on('pageerror', error => report.browserErrors.push(error.message));
    await builderPage.goto(`${projectServer.url}/builder/`);
    await builderPage.locator('#folder-input').setInputFiles(bundle);
    await builderPage.waitForFunction(() => document.querySelector('#fighter-list').children.length >= 2 || document.querySelector('#status').classList.contains('error'));
    if (await builderPage.locator('#status').evaluate(element => element.classList.contains('error'))) throw new Error(await builderPage.locator('#status').textContent());
    assert.equal(await builderPage.locator('#file-count').textContent(), `${manifest.assets.length}/${manifest.assets.length}`, 'All source images must load');
    assert.equal(await builderPage.locator('#allow-placeholders').isChecked(), false, 'Real test must not permit placeholder assets');
    if (options.title) await builderPage.fill('#game-title', options.title);
    console.log(`Building ${manifest.assets.length} real source assets with the browser compiler...`);
    await builderPage.click('#build-button');
    await builderPage.waitForFunction(() => !document.querySelector('#export-ready').hidden || document.querySelector('#status').classList.contains('error'), null, { timeout: 180000 });
    if (!await builderPage.locator('#export-ready').isVisible()) throw new Error(await builderPage.locator('#status').textContent());
    report.checks.push('strict browser build with every source image');
    await builderPage.screenshot({ path: path.join(output, 'builder.png'), fullPage: true }); report.screenshots.push('builder.png');
    const downloadPromise = builderPage.waitForEvent('download', { timeout: 60000 });
    await builderPage.click('#download-zip'); const download = await downloadPromise;
    const archive = path.join(output, 'game.zip'); await download.saveAs(archive);
    const archiveFiles = extractStoredZip(fs.readFileSync(archive), path.join(output, 'game'));
    const runtime = JSON.parse(archiveFiles.get('assets/manifest.json')), assetReport = JSON.parse(archiveFiles.get('build-report.json'));
    assert.equal(assetReport.strict, true); assert.deepEqual(assetReport.missing, []); assert.deepEqual(assetReport.warnings, []);
    assert.equal(assetReport.built.length, manifest.assets.length); assert.equal(runtime.title, report.title);
    let poseCount = 0;
    for (const fighter of runtime.fighters) {
      const expected = manifest.assets.filter(asset => asset.kind === 'sprites' && asset.fighter === fighter.id).flatMap(asset => asset.poses).sort();
      assert.deepEqual(Object.keys(fighter.poses).sort(), expected, `Pose map for ${fighter.id}`);
      poseCount += expected.length;
    }
    for (const asset of manifest.assets) assert.ok(archiveFiles.has(`sources/${asset.src}`), `Original source is retained: ${asset.id}`);
    for (const asset of audio?.assets || []) {
      assert.ok(archiveFiles.has(`sources/${asset.src}`), `Original audio is retained: ${asset.id}`);
      assert.ok(runtime.audio[asset.id]?.src && archiveFiles.has(runtime.audio[asset.id].src), `Runtime audio is mapped: ${asset.id}`);
    }
    report.audioCount = Object.keys(runtime.audio || {}).length;
    assert.equal(report.audioCount, audio?.assets.length || 0);
    assert.ok(archiveFiles.has('sources/assets.json')); assert.ok(archiveFiles.has('start-server.cjs'));
    report.poseCount = poseCount; report.exportedFiles = archiveFiles.size; report.zipBytes = fs.statSync(archive).size;
    report.checks.push('ZIP record bounds and CRC checksums', 'all source artwork retained', `${poseCount} mapped fighter poses`);
    saveReport();

    gameServer = await startGame(path.join(output, 'game'));
    game = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    game.on('pageerror', error => report.browserErrors.push(error.message));
    const failedRequests = [];
    game.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failedRequests.push(`${response.status()} ${response.url()}`); });
    await game.goto(gameServer.url);
    const expectedLoaded = runtime.fighters.reduce((count, fighter) => count + Object.keys(fighter.poses).length + ['portrait', 'hero', 'cutin'].filter(kind => fighter[kind]).length, 0)
      + runtime.stages.filter(stage => stage.src).length + Object.keys(runtime.ui).length + Object.keys(runtime.effects).length;
    await game.waitForFunction(count => Number(document.querySelector('#asset-count').textContent) === count, expectedLoaded, { timeout: 60000 });
    assert.equal(await game.title(), report.title); assert.equal(await game.locator('#placeholder-label').isVisible(), false);
    assert.equal(await game.locator('#fighter-one option').count(), runtime.fighters.length);
    if (report.audioCount) {
      report.audioDurations = await game.evaluate(async entries => {
        const durations = {};
        for (const [id, entry] of entries) durations[id] = await new Promise((resolve, reject) => {
          const media = new Audio(), timer = setTimeout(() => reject(new Error(`Audio metadata timeout: ${id}`)), 20000);
          media.preload = 'metadata'; media.onloadedmetadata = () => { clearTimeout(timer); resolve(media.duration); };
          media.onerror = () => { clearTimeout(timer); reject(new Error(`Audio decode failed: ${id}`)); }; media.src = entry.src;
        });
        return durations;
      }, Object.entries(runtime.audio));
      assert.ok(Object.values(report.audioDurations).every(duration => Number.isFinite(duration) && duration > 0));
      report.checks.push(`${report.audioCount} exported audio files decoded in browser`);
    }
    assert.equal(await game.evaluate(() => window.FighterDebug.presentation().screen), 'title');
    await game.screenshot({ path: path.join(output, 'game-title.png'), fullPage: true }); report.screenshots.push('game-title.png');
    await game.click('#title-start');
    assert.equal(await game.evaluate(() => window.FighterDebug.presentation().screen), 'selection');
    await game.screenshot({ path: path.join(output, 'character-select.png'), fullPage: true }); report.screenshots.push('character-select.png');
    await game.selectOption('#mode', 'cpu'); await game.click('#start-button');
    await game.waitForFunction(() => window.FighterDebug.presentation().introSlot === 0);
    if (runtime.fighters[0].introTagline) assert.ok((await game.locator('#intro-tagline').textContent()).includes(runtime.fighters[0].introTagline));
    const introStart = await game.evaluate(() => window.FighterDebug.snapshot());
    await game.waitForTimeout(200);
    assert.equal(await game.evaluate(() => window.FighterDebug.snapshot().frame), introStart.frame);
    assert.equal(await game.evaluate(() => window.FighterDebug.snapshot().time), introStart.time);
    await game.screenshot({ path: path.join(output, 'fighter-intro.png'), fullPage: true }); report.screenshots.push('fighter-intro.png');
    await game.click('#intro-skip');
    await game.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await game.evaluate(() => window.FighterDebug.snapshot().cpu), true);
    await game.waitForFunction(() => window.FighterDebug.snapshot().fighters[1].x < 650);
    report.cpuSnapshot = await game.evaluate(() => window.FighterDebug.snapshot());
    // Test attack contact against a stationary local opponent. The CPU deliberately
    // backs away from jabs and can interrupt the player, so a CPU hit is not deterministic.
    await game.click('#reset-button'); await game.selectOption('#mode', 'local'); await game.click('#start-button');
    await game.click('#intro-skip');
    await game.waitForFunction(() => window.FighterDebug.snapshot()?.phase === 'fight');
    assert.equal(await game.evaluate(() => window.FighterDebug.snapshot().cpu), false);
    await game.keyboard.down('KeyD');
    await game.waitForFunction(() => { const s = window.FighterDebug.snapshot(); return Math.abs(s.fighters[0].x - s.fighters[1].x) < 85; });
    await game.keyboard.up('KeyD');
    await game.keyboard.press('KeyF');
    await game.waitForFunction(() => window.FighterDebug.snapshot().fighters[1].hp < 100);
    report.combatSnapshot = await game.evaluate(() => window.FighterDebug.snapshot());
    await game.screenshot({ path: path.join(output, 'gameplay.png'), fullPage: true }); report.screenshots.push('gameplay.png');
    await game.click('[data-tab="lab"]'); await game.selectOption('#lab-filter', 'fighters');
    assert.equal(await game.locator('.asset-card img').count(), poseCount);
    await game.screenshot({ path: path.join(output, 'sprite-gallery.png'), fullPage: true }); report.screenshots.push('sprite-gallery.png');
    assert.deepEqual(failedRequests, []); assert.deepEqual(report.browserErrors, []);
    report.checks.push('exported standalone server started', 'all runtime images loaded with no placeholders', 'title enters character selection', 'fighter introduction freezes combat and can be skipped', 'CPU movement', 'local-versus player attack connects', 'sprite gallery contains every fighter pose', 'no browser page errors or failed runtime requests');
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); saveReport();
    console.log(`Built and verified ${archiveFiles.size} files, ${poseCount} fighter poses.\nZIP: ${archive}\nGame: ${path.join(output, 'game')}\nReport: ${path.join(output, 'build-test.json')}`);
    return report;
  } catch (error) {
    report.status = 'failed'; report.error = error.stack || error.message; report.finishedAt = new Date().toISOString();
    if (builderPage && !builderPage.isClosed()) await builderPage.screenshot({ path: path.join(output, 'build-failure.png'), fullPage: true }).catch(() => {});
    if (game && !game.isClosed()) {
      report.failureSnapshot = await game.evaluate(() => window.FighterDebug?.snapshot()).catch(() => null);
      await game.screenshot({ path: path.join(output, 'game-failure.png'), fullPage: true }).catch(() => {});
    }
    saveReport(); throw error;
  } finally {
    if (browser) await browser.close();
    if (gameServer) gameServer.child.kill();
    if (projectServer) await new Promise(resolve => projectServer.server.close(resolve));
  }
}

if (require.main === module) {
  Promise.resolve().then(() => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return console.log('Usage: node tools/build-bundle.cjs --bundle <absolute folder containing assets.json> --out <absolute new/empty output folder> [--title "Game title"]\nBuilds real images using the browser compiler, saves game.zip + game/, and runs gameplay checks. Never generates images or spends cloud credits.');
    return main(options);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { parseArgs, extractStoredZip, browserExecutable, main };
