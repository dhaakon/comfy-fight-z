const { importAssets, parseArgs } = require('./lib/assets.cjs');

if (require.main === module) {
  try {
    const report = importAssets(parseArgs(process.argv.slice(2)));
    console.log(`Imported ${report.imported.length}; unchanged ${report.unchanged.length}; missing ${report.missing.length}.`);
    for (const selection of report.selections) {
      console.log(`${selection.id}: ${selection.selected}${selection.candidates > 1 ? ` (newest of ${selection.candidates})` : ''}`);
    }
    console.log('Report: build/import-report.json');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
