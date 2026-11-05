const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, cumulativePrompt } = require('../../comfyui/tools/run-sequential.cjs');

// A free loader feeds two paid nodes; a third paid node consumes the first; an exporter takes all.
const workflow = {
  1: { class_type: 'Load', inputs: { image: 'x.png' } },
  2: { class_type: 'Paid', inputs: { image: ['1', 0], seed: 1 } },
  3: { class_type: 'Paid', inputs: { image: ['2', 0], seed: 2 } },
  4: { class_type: 'Paid', inputs: { image: ['1', 0], seed: 3 } },
  5: { class_type: 'Save', inputs: { a: ['3', 0], b: ['4', 0] } },
  6: { class_type: 'Export', inputs: { saved: ['5', 0] } }
};
const objectInfo = { Load: {}, Paid: { api_node: true }, Save: {}, Export: { output_node: true } };

test('paid nodes run one per step, after every paid node they consume', () => {
  const { steps } = plan(workflow, objectInfo);
  assert.deepEqual(steps, ['2', '3', '4']);
  assert.throws(() => plan({ ...workflow, 7: { class_type: 'Unknown', inputs: {} } }, objectInfo), /lacks: Unknown/);
});

test('step k re-includes earlier paid nodes and their free ancestors, each ending in Preview Any', () => {
  const { steps, ancestors } = plan(workflow, objectInfo);
  const second = cumulativePrompt(workflow, steps, ancestors, 2);
  assert.deepEqual(Object.keys(second).sort(), ['1', '2', '3', '900000', '900001']);
  assert.deepEqual(second['900000'], { class_type: 'PreviewAny', inputs: { source: ['2', 0] }, _meta: { title: 'Sequential step 1' } });
  assert.deepEqual(second['900001'].inputs, { source: ['3', 0] });
  assert.equal(second['2'], workflow['2'], 'Nodes keep their IDs and inputs so cache keys match the final workflow');
  const last = cumulativePrompt(workflow, steps, ancestors, 3);
  assert.ok(!('5' in last) && !('6' in last), 'Free save/export nodes wait for the final full run');
  assert.throws(() => cumulativePrompt({ ...workflow, 900000: { class_type: 'Load', inputs: {} } }, steps, ancestors, 1), /already uses node ID/);
});
