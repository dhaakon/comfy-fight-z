const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const install = path.resolve(__dirname, '../../comfyui/tools/install-comfy-nodes.cjs');

function workspace(t, previous) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-pack-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['main.py', 'nodes.py']) fs.writeFileSync(path.join(root, file), '');
  if (previous) {
    const directory = path.join(root, 'custom_nodes/dad_fighter_assets');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '__init__.py'), previous);
    fs.writeFileSync(path.join(directory, 'keep.txt'), 'Preserve existing installation files.');
  }
  return root;
}

test('pack install preserves its previous namespace outside the active loader and is repeatable', t => {
  const root = workspace(t, 'class DadFighterAssetsExtension: pass');
  const run = () => spawnSync(process.execPath, [install, '--comfy-root', root], { encoding: 'utf8', windowsHide: true });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.ok(fs.existsSync(path.join(root, 'custom_nodes/comfy_fighter_assets/factories.py')));
  assert.equal(fs.existsSync(path.join(root, 'custom_nodes/dad_fighter_assets')), false);
  const backups = fs.readdirSync(path.join(root, 'custom_nodes/.disabled'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(root, 'custom_nodes/.disabled', backups[0], 'keep.txt'), 'utf8'), 'Preserve existing installation files.');
  assert.equal(run().status, 0);
  assert.deepEqual(fs.readdirSync(path.join(root, 'custom_nodes/.disabled')), backups);
});

test('pack install refuses an unrelated previous folder before copying the canonical pack', t => {
  const root = workspace(t, 'unrelated project code');
  const result = spawnSync(process.execPath, [install, '--comfy-root', root], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not the expected project-owned installation/);
  assert.equal(fs.existsSync(path.join(root, 'custom_nodes/comfy_fighter_assets')), false);
  assert.equal(fs.readFileSync(path.join(root, 'custom_nodes/dad_fighter_assets/__init__.py'), 'utf8'), 'unrelated project code');
});
