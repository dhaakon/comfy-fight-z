const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../server/start.cjs');
const root = path.resolve(__dirname, '../../output/game');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Run npm run example or install a verified game first.');
// Games installed with `npm run install:game -- --game <export> --slot <id>` are served beside the main game at /<id>/,
// and every title screen lists them under GAME SELECT.
const slots = path.resolve(__dirname, '../../output/games'), mounts = { '/': root };
if (fs.existsSync(slots)) {
  for (const entry of fs.readdirSync(slots, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && /^[a-z0-9][a-z0-9-]{1,31}$/.test(entry.name) && fs.existsSync(path.join(slots, entry.name, 'index.html'))) mounts[`/${entry.name}/`] = path.join(slots, entry.name);
  }
}
start({ root, mounts, allowBuilder: true }).then(() => {
  const extra = Object.keys(mounts).filter(mount => mount !== '/');
  if (extra.length) console.log(`Game select: ${extra.join(', ')}`);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
