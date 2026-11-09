// Publish a rendered video and its companions (subtitles, transcript, chapters, poster) as assets of a GitHub release
// of this repository. The token comes from the user's git credential helper at run time and is never stored here.
// Idempotent: an existing release of the tag is reused and assets already uploaded are verified rather than re-sent.
//   node build/tools/publish-release-video.cjs --dir output/explainer/<run> --stem <file stem> --tag <tag> --title "<title>" --notes "<markdown>" [--target <commit>] [--receipt <json>] [--inspect]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const COMPANIONS = [['.mp4', 'video/mp4'], ['.srt', 'application/x-subrip'], ['.transcript.txt', 'text/plain'], ['.chapters.txt', 'text/plain'], ['.poster.jpg', 'image/jpeg']];

function repository() {
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\s*$/.exec(remote.stdout || '');
  if (!match) throw new Error('The origin remote is not a GitHub repository.');
  return match[1];
}

function token(repo) {
  const credential = spawnSync('git', ['credential', 'fill'], { input: `protocol=https\nhost=github.com\npath=${repo}.git\n\n`, encoding: 'utf8', windowsHide: true, cwd: ROOT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } });
  if (credential.status !== 0) throw new Error('The git credential helper returned no GitHub credential; sign in with git first.');
  const fields = Object.fromEntries(credential.stdout.trim().split(/\r?\n/).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
  if (!fields.password) throw new Error('No GitHub credential returned.');
  return fields.password;
}

async function publish({ dir, stem, tag, title, notes, target, receipt, inspect = false, log = console.log } = {}) {
  if (!dir || !stem || !tag) throw new Error('Supply --dir <run folder> --stem <file stem> --tag <tag> [--title --notes --target --receipt --inspect].');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(tag)) throw new Error('Tags use letters, digits, dots, dashes and underscores.');
  const repo = repository(), headers = { Authorization: `Bearer ${token(repo)}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Comfy-Fighter-Z-publisher' };
  async function api(route, options = {}) {
    const url = route.startsWith('https://') ? route : `https://api.github.com/repos/${repo}${route}`;
    if (!['api.github.com', 'uploads.github.com'].includes(new URL(url).hostname)) throw new Error('Unexpected API host.');
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(300000) });
    if (response.status === 404 && options.method === undefined) return null;
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status} for ${route.slice(0, 80)}: ${(await response.text()).slice(0, 300)}`);
    return response.json();
  }
  let release = await api(`/releases/tags/${tag}`);
  if (inspect) { log(JSON.stringify({ repository: repo, release: release && { id: release.id, url: release.html_url, draft: release.draft, assets: release.assets.map(asset => ({ name: asset.name, size: asset.size })) } }, null, 2)); return release; }
  const folder = path.resolve(ROOT, dir), media = COMPANIONS.map(([extension, type]) => {
    const file = path.join(folder, stem + extension);
    if (!fs.existsSync(file)) throw new Error(`Missing ${path.relative(ROOT, file)}; render the video first.`);
    const bytes = fs.readFileSync(file); return { name: stem + extension, type, bytes, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  });
  if (!release) {
    if (!title || !notes) throw new Error('A new release needs --title and --notes.');
    const commit = target || spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim();
    release = await api('/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: title, body: notes, draft: true, prerelease: false, make_latest: 'false' }) });
    log(`Created draft release ${tag} at ${commit.slice(0, 7)}.`);
  }
  const record = { tag, repository: repo, url: release.html_url, assets: [] };
  for (const item of media) {
    let asset = release.assets.find(asset => asset.name === item.name);
    if (!asset) {
      asset = await api(release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(item.name)}`, { method: 'POST', headers: { 'Content-Type': item.type }, body: item.bytes });
      log(`Uploaded ${item.name} (${(item.bytes.length / 1048576).toFixed(1)} MiB).`);
    }
    if (asset.state !== 'uploaded' || asset.size !== item.bytes.length || (asset.digest && asset.digest !== item.digest)) throw new Error(`Uploaded asset does not match the local file: ${item.name}`);
    record.assets.push({ name: item.name, bytes: item.bytes.length, digest: item.digest, url: asset.browser_download_url });
  }
  if (release.draft) release = await api(`/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'false' }) });
  if (release.draft) throw new Error('The release is still a draft.');
  record.publishedAt = new Date().toISOString();
  const receiptFile = path.resolve(ROOT, receipt || `output/diagnostics/${tag}-publication.json`);
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true }); fs.writeFileSync(receiptFile, JSON.stringify(record, null, 2) + '\n');
  log(`Published ${release.html_url} with ${record.assets.length} assets; receipt ${path.relative(ROOT, receiptFile)}.`);
  return record;
}

if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--inspect') { options.inspect = true; continue; }
    const key = { '--dir': 'dir', '--stem': 'stem', '--tag': 'tag', '--title': 'title', '--notes': 'notes', '--target': 'target', '--receipt': 'receipt' }[args[index]];
    if (!key || args[index + 1] === undefined) { console.error('Usage: node build/tools/publish-release-video.cjs --dir <run> --stem <stem> --tag <tag> --title "<title>" --notes "<markdown>" [--target <commit>] [--receipt <json>] [--inspect]'); process.exit(2); }
    options[key] = args[++index];
  }
  publish(options).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { publish };
