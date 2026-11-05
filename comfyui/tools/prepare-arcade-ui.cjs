// Convert reviewed ComfyUI outputs into the four browser-ready arcade assets.
// Never overwrites an existing output; this performs no model calls.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('../../build/node_modules/@napi-rs/canvas');
const names = ['title-backdrop', 'select-backdrop', 'menu-frame', 'title-logo'];
async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Usage: node comfyui/tools/prepare-arcade-ui.cjs <absolute Comfy output folder> <fresh absolute output folder>');
  if (fs.existsSync(output)) throw new Error('Choose a fresh output folder; reviewed art is never overwritten.');
  const files = names.map(name => {
    const matches = fs.readdirSync(input).filter(file => new RegExp('^' + name + '_[0-9]+_\\.png$').test(file));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${name} PNG; put reviewed images in a fresh input folder.`);
    return path.join(input, matches[0]);
  });
  fs.mkdirSync(output, { recursive: true });
  for (const [index, file] of files.entries()) {
    const img = await loadImage(file), canvas = createCanvas(img.width, img.height), ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    if (names[index] === 'title-logo') {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data;
      for (let i = 0; i < data.length; i += 4) {
        const spill = data[i + 1] - Math.max(data[i], data[i + 2]);
        if (spill > 95) data[i + 3] = 0;
        else if (spill > 28) { data[i + 3] = Math.round(data[i + 3] * (1 - (spill - 28) / 67)); data[i + 1] = Math.max(data[i], data[i + 2]); }
      }
      ctx.putImageData(pixels, 0, 0);
    }
    fs.writeFileSync(path.join(output, names[index] + '.webp'), await canvas.encode('webp', 90));
  }
  console.log('Prepared four arcade images in ' + output + '. Review them before replacing any project artwork.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
