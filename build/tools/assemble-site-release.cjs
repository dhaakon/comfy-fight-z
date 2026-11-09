// Assemble one static release from prepared sites: the root game at the top and every other game under its mount
// folder, exactly as prepare-static-site.cjs audited them. A file that repeats across games (a crossover's shared art,
// clips and sounds) is hard-linked to its first copy, so the release holds and uploads it once; GNU tar and rsync -H
// keep the links on the host. Writes SHA256SUMS (every file, for `sha256sum -c` on the host) and release.json (the
// mounts with each site's audit). No credentials are read and nothing is uploaded.
//   node build/tools/assemble-site-release.cjs --out output/deploy/<run>/release --root <prepared dir> [--mount <id>=<prepared dir> ...]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { directoryTarget, isInside } = require('./lib/runtime-validation.cjs');

const ROOT = path.resolve(__dirname, '../..');
const MOUNT = /^[a-z0-9][a-z0-9-]{1,31}$/;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

function preparedSite(mount, prepared) {
  if (mount && !MOUNT.test(mount)) throw new Error(`Mount ids use 2-32 lowercase letters, digits or dashes: ${mount}`);
  const dir = path.resolve(ROOT, prepared), audit = path.join(dir, 'deployment.json');
  if (!fs.existsSync(audit)) throw new Error(`${prepared} has no deployment.json; run prepare-static-site.cjs first.`);
  const report = read(audit);
  if (report.schema !== 'comfy-fighter-static-deployment/v1' || !Array.isArray(report.files)) throw new Error(`${prepared} is not a prepared static site.`);
  return { mount, dir, report };
}

function assembleRelease({ out, root, mounts = {}, log = console.log } = {}) {
  if (!out || !root) throw new Error('Supply --out output/deploy/<run>/release --root <prepared dir> [--mount <id>=<prepared dir> ...].');
  out = path.resolve(ROOT, out);
  if (!isInside(path.join(ROOT, 'output/deploy'), out) || directoryTarget(out) !== out) throw new Error('A release is assembled under output/deploy/<run>/.');
  if (fs.existsSync(out)) throw new Error(`${path.relative(ROOT, out)} exists; choose a fresh release folder.`);
  const sites = [preparedSite('', root), ...Object.entries(mounts).sort(([a], [b]) => a.localeCompare(b)).map(([mount, prepared]) => preparedSite(mount, prepared))];
  const byHash = new Map(), sums = [], files = [];
  let uniqueBytes = 0, linked = 0, linkedBytes = 0;
  fs.mkdirSync(out, { recursive: true });
  for (const site of sites) {
    for (const file of site.report.files) {
      const relative = site.mount ? `${site.mount}/${file.path}` : file.path;
      if (!site.mount && sites.some(other => other.mount && (relative === other.mount || relative.startsWith(other.mount + '/')))) throw new Error(`The root game's ${relative} collides with a mount folder.`);
      const source = path.join(site.dir, 'site', file.path), target = path.join(out, relative), data = fs.readFileSync(source);
      if (digest(data) !== file.sha256 || data.length !== file.bytes) throw new Error(`Prepared file changed since its audit: ${relative}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const first = byHash.get(file.sha256);
      if (first) {
        try { fs.linkSync(first, target); linked++; linkedBytes += file.bytes; }
        catch { fs.copyFileSync(source, target); uniqueBytes += file.bytes; }
      } else { fs.copyFileSync(source, target); byHash.set(file.sha256, target); uniqueBytes += file.bytes; }
      sums.push(`${file.sha256}  ${relative}`);
      files.push({ path: relative, bytes: file.bytes, sha256: file.sha256, contentType: file.contentType });
    }
  }
  fs.writeFileSync(path.join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
  const release = {
    schema: 'comfy-fighter-site-release/v1', assembledAt: new Date().toISOString(), repository: sites[0].report.repository,
    mounts: sites.map(site => ({ mount: site.mount ? `/${site.mount}/` : '/', folder: site.mount || '.', title: site.report.title, sourceExport: site.report.sourceExport, sourceKind: site.report.sourceKind,
      fighters: site.report.fighters, stages: site.report.stages, poses: site.report.poses, files: site.report.fileCount, bytes: site.report.bytes, artifactSha256: site.report.artifactSha256 })),
    fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), uniqueBytes, linkedFiles: linked, linkedBytes,
    releaseSha256: digest(sums.join('\n')), credentialsRead: false, remoteDeploymentPerformed: false
  };
  fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  log(`Assembled ${files.length} files for ${sites.length} mounts: ${(release.bytes / 1048576).toFixed(0)} MiB mapped, ${(uniqueBytes / 1048576).toFixed(0)} MiB on disk (${linked} files hard-linked, ${(linkedBytes / 1048576).toFixed(0)} MiB saved).`);
  log(`Release: ${path.relative(ROOT, out)}\nSHA-256: ${release.releaseSha256}`);
  return release;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2), options = { mounts: {} };
    for (let i = 0; i < args.length; i++) {
      const value = args[i + 1];
      if (args[i] === '--out' && value) options.out = args[++i];
      else if (args[i] === '--root' && value) options.root = args[++i];
      else if (args[i] === '--mount' && value && value.includes('=')) { const [mount, prepared] = value.split(/=(.*)/s); options.mounts[mount] = prepared; i++; }
      else throw new Error('Usage: node build/tools/assemble-site-release.cjs --out output/deploy/<run>/release --root <prepared dir> [--mount <id>=<prepared dir> ...]');
    }
    assembleRelease(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assembleRelease };
