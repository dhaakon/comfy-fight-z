const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../server/start.cjs');
const root = path.resolve(__dirname, '../../output/game');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Run npm run example or install a verified game first.');
start({ root, allowBuilder: true }).catch(error => { console.error(error.message); process.exitCode = 1; });
