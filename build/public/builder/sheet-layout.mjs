// Split keyed artwork by its connected silhouettes, not by clipping at grid edges.
// Coordinates remain in the input image's scale. Source pixels are never changed.
export function segmentSheet(data, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 9 || height < 9 || data?.length !== width * height * 4) throw new Error('Invalid sheet pixel data.');
  const cw = width / 3, ch = height / 3, size = width * height;
  const labels = new Int32Array(size), queue = new Int32Array(size);
  const rows = new Uint8Array(height), columns = new Uint8Array(width);
  // Generated sheets sometimes contain a straight black/white frame. A full
  // opaque row/column near a nominal separator is unambiguously a grid line.
  const nearBoundary = (position, length) => [0, length / 3, length * 2 / 3, length - 1].some(edge => Math.abs(position - edge) <= Math.max(2, length / 3 * .045));
  for (let y = 0; y < height; y++) if (nearBoundary(y, height)) {
    let count = 0; for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 30) count++;
    if (count / width > .8) rows[y] = 1;
  }
  for (let x = 0; x < width; x++) if (nearBoundary(x, width)) {
    let count = 0; for (let y = 0; y < height; y++) if (data[(y * width + x) * 4 + 3] > 30) count++;
    if (count / height > .8) columns[x] = 1;
  }
  const components = [];
  for (let start = 0; start < size; start++) {
    if (labels[start] || data[start * 4 + 3] <= 30 || rows[Math.floor(start / width)] || columns[start % width]) continue;
    const id = components.length + 1, item = { id, left: width, top: height, right: -1, bottom: -1, count: 0, sumX: 0, sumY: 0 };
    let head = 0, tail = 1; queue[0] = start; labels[start] = id;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      item.count++; item.sumX += x; item.sumY += y;
      item.left = Math.min(item.left, x); item.right = Math.max(item.right, x); item.top = Math.min(item.top, y); item.bottom = Math.max(item.bottom, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) if (!rows[yy]) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) if (!columns[xx]) {
          const adjacent = yy * width + xx;
          if (!labels[adjacent] && data[adjacent * 4 + 3] > 30) { labels[adjacent] = id; queue[tail++] = adjacent; }
        }
      }
    }
    item.cx = item.sumX / item.count; item.cy = item.sumY / item.count;
    item.slot = Math.min(2, Math.floor(item.cy / ch)) * 3 + Math.min(2, Math.floor(item.cx / cw));
    components.push(item);
  }
  const anchors = Array(9).fill(null), minimum = Math.max(3, cw * ch * .001);
  for (const item of components) if (item.count >= minimum) {
    if (item.right - item.left > cw * 1.8 || item.bottom - item.top > ch * 1.8) throw new Error('Sheet silhouettes overlap multiple cells; separate the poses before building.');
    if (!anchors[item.slot] || item.count > anchors[item.slot].count) anchors[item.slot] = item;
  }
  if (anchors.some(item => !item)) throw new Error(`Cannot isolate all nine sheet poses (empty cells: ${anchors.flatMap((item, i) => item ? [] : [i + 1]).join(', ')}).`);
  const owners = new Int8Array(components.length + 1); owners.fill(-1);
  anchors.forEach((item, slot) => { owners[item.id] = slot; });
  const distance = (a, b) => Math.hypot(Math.max(0, a.left - b.right, b.left - a.right) / cw, Math.max(0, a.top - b.bottom, b.top - a.bottom) / ch);
  for (const item of components) if (owners[item.id] < 0 && item.count >= Math.max(2, cw * ch * .00002)) {
    let best = -1, score = Infinity;
    anchors.forEach((anchor, slot) => {
      const gap = distance(item, anchor);
      // Prefer the closest silhouette; a small tie-break keeps particles in
      // their nominal slot when two neighboring poses are equally close.
      const candidate = gap + (slot === item.slot ? 0 : .025);
      if (gap <= .45 && candidate < score) { score = candidate; best = slot; }
    });
    owners[item.id] = best;
  }
  const boxes = anchors.map(item => ({ x: item.left, y: item.top, right: item.right, bottom: item.bottom }));
  for (const item of components) {
    const owner = owners[item.id]; if (owner < 0) continue;
    const box = boxes[owner]; box.x = Math.min(box.x, item.left); box.y = Math.min(box.y, item.top); box.right = Math.max(box.right, item.right); box.bottom = Math.max(box.bottom, item.bottom);
  }
  const result = boxes.map(box => {
    const x = Math.max(0, box.x - 2), y = Math.max(0, box.y - 2), w = Math.min(width - 1, box.right + 2) - x + 1, h = Math.min(height - 1, box.bottom + 2) - y + 1;
    return { x, y, width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  });
  for (let index = 0; index < size; index++) {
    const owner = owners[labels[index]]; if (owner < 0) continue;
    const output = result[owner], x = index % width - output.x, y = Math.floor(index / width) - output.y;
    output.data.set(data.subarray(index * 4, index * 4 + 4), (y * output.width + x) * 4);
  }
  return result;
}
