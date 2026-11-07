// Set reviewed-out sprite sheets aside so `new-game.cjs add-sheets` can redraw them: the PNG moves out of bundle/raw
// into <run>/set-aside/ (kept for the record), and the asset record and expectedAssets entry are removed.
// Usage: node build/tools/set-aside-sheets.cjs <run dir> <asset id> [<asset id> ...]
const fs = require('node:fs'), path = require('node:path');
const [run, ...ids] = process.argv.slice(2);
if (!run || !ids.length) throw new Error('Usage: set-aside-sheets.cjs <run dir> <asset id> [...]');
const bundle = path.resolve(run, 'bundle'), file = path.join(bundle, 'assets.json'), assets = JSON.parse(fs.readFileSync(file, 'utf8'));
const aside = path.resolve(run, 'set-aside'); fs.mkdirSync(aside, { recursive: true });
for (const id of ids) {
  const record = assets.assets.find(asset => asset.id === id);
  if (!record) throw new Error(`No asset ${id} in ${file}`);
  fs.renameSync(path.join(bundle, record.src), path.join(aside, path.basename(record.src)));
  assets.assets = assets.assets.filter(asset => asset.id !== id);
  if (Array.isArray(assets.game.expectedAssets)) assets.game.expectedAssets = assets.game.expectedAssets.filter(entry => entry !== id);
  console.log(`set aside ${id} (${path.basename(record.src)})`);
}
fs.writeFileSync(file, JSON.stringify(assets, null, 2) + '\n');
