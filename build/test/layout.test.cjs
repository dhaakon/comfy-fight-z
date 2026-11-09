const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('repository separates generation, build source, the runnable example and output', () => {
  const directories = fs.readdirSync(root, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name).sort();
  assert.deepEqual(directories, ['build', 'comfyui', 'example', 'output']);
  for (const file of ['comfyui/workflows/comfy-hackathon.json', 'comfyui/custom_nodes/comfy_fighter_assets/__init__.py',
    'comfyui/config/game.json', 'comfyui/assets/plan.json', 'build/public/index.html', 'build/tools/build.cjs',
    'build/package-lock.json', 'example/run.cjs', 'output/README.md']) {
    assert.ok(fs.statSync(path.join(root, file)).isFile(), `Missing relocated source: ${file}`);
  }
});

test('image job paths keep generated media in output and recipes in comfyui', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'comfyui/assets/plan.json'), 'utf8'));
  for (const job of plan.jobs) {
    assert.ok(job.output.startsWith('output/assets/generated/raw/'), job.output);
    assert.ok(job.workflow.startsWith('comfyui/workflows/jobs/'), job.workflow);
    assert.ok(fs.statSync(path.join(root, job.workflow)).isFile());
  }
  const main = fs.readFileSync(path.join(root, 'comfyui/workflows/comfy-hackathon.json'));
  assert.ok(main.equals(fs.readFileSync(path.join(root, 'build/public/builder/templates/comfy-hackathon.json'))));
});

test('the comfy-fighter-z project skill is identical for Codex and Claude Code', () => {
  const codex = fs.readFileSync(path.join(root, '.agents/skills/comfy-fighter-z/SKILL.md'), 'utf8');
  const claude = fs.readFileSync(path.join(root, '.claude/skills/comfy-fighter-z/SKILL.md'), 'utf8');
  assert.equal(codex, claude);
  assert.match(codex, /^---\nname: comfy-fighter-z\ndescription: /);
  assert.ok(fs.statSync(path.join(root, 'comfyui/docs/agent-harness.md')).isFile());
});
