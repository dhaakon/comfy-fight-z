const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

// The custom node pack imports ComfyUI's API, so its local logic runs only inside an
// installed ComfyUI Python. Set COMFYUI_PYTHON and COMFYUI_ROOT to include it.
const python = process.env.COMFYUI_PYTHON, comfyRoot = process.env.COMFYUI_ROOT;
test('custom node pack validates arcade metadata, optional sheets and complete exports', { skip: !python || !comfyRoot ? 'Set COMFYUI_PYTHON and COMFYUI_ROOT to run the node-pack checks' : false }, () => {
  const result = spawnSync(python, [path.join(root, 'comfyui/tools/test_comfy_nodes.py')], { cwd: root, env: { ...process.env, COMFYUI_ROOT: comfyRoot }, encoding: 'utf8', timeout: 300000, windowsHide: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /0 failure\(s\)/);
});
test('living-scenery nodes plan, paint, separate and extract placed layers', { skip: !python || !comfyRoot ? 'Set COMFYUI_PYTHON and COMFYUI_ROOT to run the node-pack checks' : false }, () => {
  const result = spawnSync(python, [path.join(root, 'comfyui/tools/test_scenery_nodes.py')], { cwd: root, env: { ...process.env, COMFYUI_ROOT: comfyRoot }, encoding: 'utf8', timeout: 300000, windowsHide: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /0 failure\(s\)/);
});
