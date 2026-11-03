const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('pending fictional preview never regenerates media and cannot pass a strict release', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-pending-demo-'));
  t.after(() => { const resolved = path.resolve(folder); if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('cfz-pending-demo-')) throw new Error('Unexpected temporary fixture path'); fs.rmSync(resolved, {recursive:true, force:true}); });
  const write = (relative, data) => { const file = path.join(folder,relative); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,typeof data === 'string' ? data : JSON.stringify(data)); };
  for (const file of ['tools/build.cjs','tools/lib/runtime-validation.cjs']) write(file,fs.readFileSync(path.join(root,file),'utf8'));
  write('tools/build-assets.cjs','throw new Error("A pending demo must not generate or reuse any art");');
  write('public/index.html','<title>Fictional demo awaiting generation</title>');
  const manifest = {version:1,title:'Fictional demo',generationPending:true,fighters:[{id:'invented',name:'Invented',poses:{}}],stages:[{id:'yard',name:'The Yard'}],ui:{},effects:{},audio:{}};
  write('public/assets/manifest.json',manifest);
  const run = (...args) => spawnSync(process.execPath,['tools/build.cjs',...args],{cwd:folder,encoding:'utf8',windowsHide:true});
  const normal = run(); assert.equal(normal.status,0,normal.stderr); assert.match(normal.stdout,/media-free preview/);
  assert.deepEqual(fs.readdirSync(path.join(folder,'dist/assets')),['manifest.json']);
  const strict = run('--strict'); assert.notEqual(strict.status,0); assert.match(strict.stderr,/awaiting generation.*strict release/);
  manifest.fighters[0].portrait = 'assets/previous.webp'; write('public/assets/manifest.json',manifest);
  const contaminated = run(); assert.notEqual(contaminated.status,0); assert.match(contaminated.stderr,/must not reference any previous media/);
  delete manifest.fighters[0].portrait; write('public/assets/manifest.json',manifest);
  write('public/assets/unmapped-old.webp','retired media fixture');
  const orphaned = run(); assert.notEqual(orphaned.status,0); assert.match(orphaned.stderr,/unexpected asset files/);
});
