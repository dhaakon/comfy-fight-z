// Run a prepared ComfyUI API workflow one paid node at a time.
//   node comfyui/tools/run-sequential.cjs --workflow <api.json> [--server http://127.0.0.1:8188] [--dry-run]
//
// ComfyUI starts every ready cloud (API) node at once. A workspace limited to one concurrent
// job answers that burst with HTTP 429, and nodes that do not retry abort the whole prompt.
// This runner submits cumulative prompts instead: step k contains the paid nodes of steps
// 1..k (each ending in a free Preview Any), so earlier results are cache hits that stay "in
// use" and are never evicted or billed again, and exactly one new paid node runs. A final run
// of the original workflow then executes only free save/export nodes from the warm cache.
// Every step checks that earlier paid nodes were cached and stops at the first re-execution,
// so a lost cache (for example a ComfyUI restart) can never silently re-bill a batch.
// Submission uses the comfy CLI with --allow-spend: run it only for an approved batch.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isLink = value => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1]);

// Paid nodes in dependency order: a paid node that consumes another paid node's output runs after it.
function plan(workflow, objectInfo) {
  const ids = Object.keys(workflow), paid = ids.filter(id => objectInfo[workflow[id].class_type]?.api_node === true);
  const missing = [...new Set(ids.map(id => workflow[id].class_type))].filter(type => !objectInfo[type]);
  if (missing.length) throw new Error(`The running ComfyUI lacks: ${missing.join(', ')}. Install or update the node packs, then restart it.`);
  const parents = id => Object.values(workflow[id].inputs || {}).filter(isLink).map(link => link[0]);
  const ancestors = (id, seen = new Set()) => { for (const parent of parents(id)) if (!seen.has(parent)) { seen.add(parent); ancestors(parent, seen); } return seen; };
  const order = [], placed = new Set(), numeric = (a, b) => (Number(a) - Number(b)) || a.localeCompare(b);
  while (order.length < paid.length) {
    const ready = paid.filter(id => !placed.has(id) && [...ancestors(id)].every(parent => !paid.includes(parent) || placed.has(parent))).sort(numeric);
    if (!ready.length) throw new Error('Paid nodes form a cycle.');
    order.push(ready[0]); placed.add(ready[0]);
  }
  return { steps: order, ancestors };
}

// Steps 1..k with their free ancestors, each paid node feeding its own Preview Any output.
function cumulativePrompt(workflow, steps, ancestors, k) {
  const keep = new Set();
  for (const id of steps.slice(0, k)) { keep.add(id); for (const parent of ancestors(id)) keep.add(parent); }
  const prompt = Object.fromEntries([...keep].map(id => [id, workflow[id]]));
  steps.slice(0, k).forEach((id, index) => {
    const preview = String(900000 + index);
    if (workflow[preview]) throw new Error(`Workflow already uses node ID ${preview}.`);
    prompt[preview] = { class_type: 'PreviewAny', inputs: { source: [id, 0] }, _meta: { title: `Sequential step ${index + 1}` } };
  });
  return prompt;
}

function submit(file) {
  const result = spawnSync('comfy', ['--json', 'run', '--workflow', file, '--where', 'local', '--allow-spend', '--no-watch'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const lines = `${result.stdout || ''}`.split(/\r?\n/).filter(line => line.trim().startsWith('{'));
  const envelope = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean).find(item => item.type === 'envelope');
  if (!envelope?.ok || !envelope.data?.prompt_id) throw new Error(`Submission failed: ${JSON.stringify(envelope?.error || result.stderr || result.stdout).slice(0, 600)}`);
  return envelope.data.prompt_id;
}

async function outcome(server, promptId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const history = await fetch(`${server}/history/${promptId}`).then(response => response.json()).catch(() => ({}));
    const entry = history[promptId];
    if (entry?.status?.completed || entry?.status?.status_str === 'error') {
      const messages = entry.status.messages || [], find = type => messages.find(message => message[0] === type)?.[1];
      return { ok: entry.status.status_str === 'success', cached: find('execution_cached')?.nodes || [], error: find('execution_error') };
    }
    await sleep(2000);
  }
  throw new Error(`Prompt ${promptId} did not finish within ${Math.round(timeoutMs / 60000)} minutes.`);
}

async function main() {
  const file = option('--workflow'), server = (option('--server') || 'http://127.0.0.1:8188').replace(/\/$/, '');
  if (!file) throw new Error('Usage: node comfyui/tools/run-sequential.cjs --workflow <api.json> [--server http://127.0.0.1:8188] [--dry-run]');
  const workflow = read(file), objectInfo = await fetch(`${server}/object_info`).then(response => response.json());
  const { steps, ancestors } = plan(workflow, objectInfo);
  const base = file.replace(/\.json$/i, ''), stateFile = `${base}.sequential.json`, stepsDir = `${base}.steps`;
  const state = fs.existsSync(stateFile) ? read(stateFile) : { workflow: path.resolve(file), steps: steps.map(id => ({ id, type: workflow[id].class_type, title: workflow[id]._meta?.title || '' })), done: [], final: null };
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  console.log(`${steps.length} paid nodes, one per step, then the full workflow. ${state.done.length} step(s) already done.`);
  if (args.includes('--dry-run')) { steps.forEach((id, i) => console.log(`${String(i + 1).padStart(3)} ${id} ${workflow[id].class_type} ${workflow[id]._meta?.title || ''}`)); return; }
  // Resuming relies on the server's warm cache: refuse if the last finished step left its history (a restart).
  const last = state.done[state.done.length - 1];
  if (last) {
    const history = await fetch(`${server}/history/${last.promptId}`).then(response => response.json());
    if (!history[last.promptId]) throw new Error('ComfyUI no longer has this run in its history (it restarted?), so its cache is gone. Resuming would bill finished steps again; start a fresh run instead.');
  }
  fs.mkdirSync(stepsDir, { recursive: true });
  for (let k = state.done.length + 1; k <= steps.length; k++) {
    const id = steps[k - 1], prompt = cumulativePrompt(workflow, steps, ancestors, k), stepFile = path.join(stepsDir, `step-${String(k).padStart(3, '0')}.api.json`);
    fs.writeFileSync(stepFile, JSON.stringify(prompt, null, 2) + '\n');
    for (let attempt = 1; ; attempt++) {
      const started = Date.now(), promptId = submit(stepFile);
      const result = await outcome(server, promptId, 30 * 60000);
      const rebilled = steps.slice(0, k - 1).filter(previous => !result.cached.includes(previous));
      if (rebilled.length) throw new Error(`Step ${k} re-executed earlier paid node(s) ${rebilled.join(', ')} instead of using the cache. Stopping to avoid further spend.`);
      if (result.ok) {
        state.done.push({ step: k, id, type: workflow[id].class_type, title: workflow[id]._meta?.title || '', promptId, attempts: attempt, seconds: Math.round((Date.now() - started) / 1000) }); save();
        console.log(`step ${k}/${steps.length} ok  ${id} ${workflow[id]._meta?.title || workflow[id].class_type} (${Math.round((Date.now() - started) / 1000)}s)`);
        break;
      }
      const message = `${result.error?.exception_type || ''}: ${result.error?.exception_message || 'unknown error'}`.trim();
      // Rate limits are refused before billing; wait and resubmit the same step a few times.
      if (/429|rate.?limit/i.test(message) && attempt < 6) { console.log(`step ${k} rate-limited (attempt ${attempt}); waiting ${30 * attempt}s`); await sleep(30000 * attempt); continue; }
      // A dropped download or connection may follow a billed generation: retry at most twice and say so.
      if (/ClientPayloadError|payload is not completed|ServerDisconnected|Connection reset|ClientConnectorError|TimeoutError|\b50[234]\b/i.test(message) && (state.transientRetries || 0) < 2 * steps.length && attempt < 3) {
        state.transientRetries = (state.transientRetries || 0) + 1; save();
        console.log(`step ${k} transient network error (attempt ${attempt}); the failed attempt may have been billed. Retrying in 20s: ${message.slice(0, 160)}`);
        await sleep(20000); continue;
      }
      throw new Error(`Step ${k} (${id} ${workflow[id].class_type}) failed: ${message}`);
    }
  }
  if (!state.final?.ok) {
    const promptId = submit(path.resolve(file)), result = await outcome(server, promptId, 30 * 60000);
    const executedPaid = steps.filter(id => !result.cached.includes(id));
    state.final = { promptId, ok: result.ok, executedPaidNodes: executedPaid, error: result.error?.exception_message || null }; save();
    if (!result.ok) throw new Error(`Final workflow run failed: ${result.error?.exception_type}: ${result.error?.exception_message}`);
    console.log(`Final run ok (${promptId}); paid nodes re-executed: ${executedPaid.length ? executedPaid.join(', ') : 'none'}.`);
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { plan, cumulativePrompt };
