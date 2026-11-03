const { buildAssets, parseArgs } = require('./lib/assets.cjs');

async function main() {
  const { report } = await buildAssets(parseArgs(process.argv.slice(2)));
  console.log(`Assets: ${report.built.length}/${report.jobs} jobs built; ${report.missing.length} missing.`);
  for (const warning of report.warnings) console.log(`Warning: ${warning}`);
  console.log('Manifest: public/assets/manifest.json; report: build/asset-report.json');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
