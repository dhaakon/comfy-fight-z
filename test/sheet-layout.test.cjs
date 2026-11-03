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
