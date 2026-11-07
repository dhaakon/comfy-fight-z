const test = require('node:test');
const assert = require('node:assert/strict');
async function moduleUnderTest() { return import('../public/builder/sheet-layout.mjs'); }
function fixture() {
  const data = new Uint8ClampedArray(300 * 300 * 4);
  const fill = (x, y, w, h, color = [220, 80, 30, 255]) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data.set(color, (yy * 300 + xx) * 4);
  };
  for (let i = 0; i < 9; i++) fill(i % 3 * 100 + 40, Math.floor(i / 3) * 100 + 25, 20, 55);
  return { data, fill };
}
test('preserves a connected foot across a nominal cell boundary without including the next pose', async () => {
  const { segmentSheet } = await moduleUnderTest(), { data, fill } = fixture();
  fill(45, 75, 10, 35); // First pose crosses y=100; its center still belongs to row one.
  const untouched = data.slice(), result = segmentSheet(data, 300, 300);
  assert.equal(result.length, 9); assert.ok(result[0].y + result[0].height >= 110);
  assert.ok(result[0].y + result[0].height < result[3].y);
  assert.deepEqual(data, untouched, 'Input source stays unchanged');
  assert.equal([...result[0].data].filter((v, i) => i % 4 === 3 && v > 30).length, 1400);
});
test('removes black and white separator grids while preserving all nine silhouettes', async () => {
  const { segmentSheet } = await moduleUnderTest();
  for (const color of [[0, 0, 0, 255], [255, 255, 255, 255]]) {
    const { data, fill } = fixture();
    for (const edge of [0, 99, 199, 299]) { fill(edge, 0, 1, 300, color); fill(0, edge, 300, 1, color); }
    const result = segmentSheet(data, 300, 300);
    for (const cell of result) { assert.equal(cell.width, 24); assert.equal(cell.height, 59); }
  }
});
test('assigns a nearby detached particle to its silhouette and rejects missing poses', async () => {
  const { segmentSheet } = await moduleUnderTest(), { data, fill } = fixture();
  fill(63, 40, 3, 3, [0, 100, 255, 255]);
  const result = segmentSheet(data, 300, 300);
  assert.ok(result[0].x + result[0].width > 65);
  fill(240, 225, 20, 55, [0, 0, 0, 0]);
  assert.throws(() => segmentSheet(data, 300, 300), /Cannot isolate all nine/);
});
test('drops a whole extra figure drawn beside a pose but keeps a large short effect', async () => {
  const { segmentSheet } = await moduleUnderTest();
  const cell = (result, slot) => [...result[slot].data].filter((v, i) => i % 4 === 3 && v > 30).length;
  // A tenth figure, as tall as the first pose, 10 px to its right: it joins no cel.
  let { data, fill } = fixture(); fill(70, 25, 20, 55, [40, 60, 200, 255]);
  let result = segmentSheet(data, 300, 300);
  assert.equal(result[0].width, 24, 'The extra figure does not widen the first cel'); assert.equal(cell(result, 0), 1100);
  // A projectile half a figure tall beside the pose stays with it.
  ({ data, fill } = fixture()); fill(66, 40, 24, 24, [255, 200, 40, 255]);
  result = segmentSheet(data, 300, 300);
  assert.ok(result[0].x + result[0].width >= 90, 'The effect stays in the cel'); assert.equal(cell(result, 0), 1100 + 576);
});
test('a reviewed pick chooses the figure for a cell and the displaced figure joins no cel', async () => {
  const { segmentSheet } = await moduleUnderTest(), { data, fill } = fixture();
  // Cell two holds the intended small figure at x 112 and a larger stray figure at x 150; by default the larger wins.
  fill(105, 25, 14, 55, [40, 200, 90, 255]); fill(140, 25, 0, 0); 
  const stray = [255, 0, 255, 255]; fill(160, 20, 30, 62, stray);
  const pixels = (cell, color) => { let n = 0; for (let i = 0; i < cell.data.length; i += 4) if (cell.data[i] === color[0] && cell.data[i + 1] === color[1] && cell.data[i + 2] === color[2] && cell.data[i + 3]) n++; return n; };
  const before = segmentSheet(data, 300, 300);
  assert.ok(pixels(before[1], stray) > 0, 'without a pick the larger stray figure takes the cell');
  const after = segmentSheet(data, 300, 300, { picks: [null, [112 / 300, 52 / 300], null, null, null, null, null, null, null] });
  assert.equal(pixels(after[1], stray), 0, 'the pick keeps the stray figure out of the cell');
  assert.equal(pixels(after[1], [40, 200, 90, 255]), 14 * 55);
  assert.throws(() => segmentSheet(data, 300, 300, { picks: [[50 / 300, 52 / 300], [50 / 300, 52 / 300]] }), /one figure to two cells/);
});
