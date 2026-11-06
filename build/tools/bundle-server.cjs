// Keep the browser exporter self-contained: its Node runtime includes pinned ws/QR dependencies.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
async function bundleServer() {
  const outfile = path.join(ROOT, 'public/builder/runtime-server.cjs');
  const result = await esbuild.build({ entryPoints: [path.join(ROOT, 'server/start.cjs')], outfile,
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', legalComments: 'inline',
    external: ['bufferutil', 'utf-8-validate'], metafile: true, logLevel: 'silent' });
  const packages = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const file = path.resolve(input);
    let directory = path.dirname(file);
    while (directory !== path.dirname(directory) && directory.includes('node_modules')) {
      if (fs.existsSync(path.join(directory, 'package.json'))) { packages.add(directory); break; }
      directory = path.dirname(directory);
    }
  }
  const notices = ['Third-party packages bundled in start-server.cjs.\nComfy Fighter Z itself is licensed under the accompanying MIT LICENSE.\n',
    '\nThe arcade typeface fonts/PressStart2P-Regular.ttf is "Press Start 2P" by Cody "CodeMan38" Boisclair, licensed under the SIL Open Font License 1.1 (fonts/OFL-PressStart2P.txt).\n'];
  for (const directory of [...packages].sort()) {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const licenses = fs.readdirSync(directory).filter(name => /^(?:licen[sc]e|copying)(?:\..*)?$/i.test(name));
    if (!licenses.length) throw new Error(`Missing license text for bundled package ${pkg.name}`);
    notices.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version} (${pkg.license || 'see below'})\n`);
    for (const name of licenses) notices.push(fs.readFileSync(path.join(directory, name), 'utf8'));
  }
  fs.writeFileSync(path.join(ROOT, 'public/THIRD-PARTY-NOTICES.txt'), notices.join('\n') + '\n');
  console.log(`Bundled multiplayer runtime (${fs.statSync(outfile).size} bytes, ${packages.size} dependency notices).`);
}
if (require.main === module) bundleServer().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { bundleServer };
