import { validateManifest, validateAudioManifest, buildGame, zipFiles, writeDirectory } from './pack.js';

const $ = id => document.getElementById(id);
let manifest = null, audioManifest = null, files = new Map(), selectedFiles = [], builtFiles = null, busy = false;
let fighters = [], stages = [], objectURLs = new Map(), sample = false;

function message(text, type = '') { $('status').textContent = text; $('status').className = `status-message ${type}`; }
function clearPreviews() { for (const url of objectURLs.values()) URL.revokeObjectURL(url); objectURLs.clear(); }
function previewURL(src) { const file = files.get(src); if (!file) return null; if (!objectURLs.has(src)) objectURLs.set(src, URL.createObjectURL(file)); return objectURLs.get(src); }
function make(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function invalidate() { builtFiles = null; $('export-ready').hidden = true; $('progress-area').hidden = true; message(''); updateReadiness(); }
function updateReadiness() {
  $('build-button').disabled = !manifest || busy;
  if (!manifest) return;
  const activeFighters = fighters.filter(f => f.enabled), activeStages = stages.filter(s => s.enabled);
  const relevant = manifest.assets.filter(a => (!a.fighter || activeFighters.some(f => f.id === a.fighter)) && (!a.stage || activeStages.some(s => s.id === a.stage)));
  const found = relevant.filter(a => files.has(a.src)).length, missing = relevant.length - found;
  $('fighter-count').textContent = activeFighters.length;
  $('sheet-count').textContent = relevant.filter(a => a.kind === 'sprites').length;
  $('file-count').textContent = `${found}/${relevant.length}`;
  const status = $('readiness');
  status.className = `readiness ${missing ? 'incomplete' : 'complete'}`;
  if (activeFighters.length < 2 || activeStages.length < 1) { status.textContent = 'Choose at least two fighters and one arena before building.'; status.className = 'readiness incomplete'; }
  else if (missing) status.textContent = `${missing} source image${missing === 1 ? ' is' : 's are'} missing. Choose the matching asset folder, or explicitly allow placeholders for a prototype.`;
  else status.textContent = `All ${found} source images are available. Ready to process your game art.`;
  const audioCount = audioManifest?.assets.filter(a => files.has(a.src)).length || 0;
  status.textContent += audioManifest ? ` Audio: ${audioCount}/${audioManifest.assets.length} files available.` : ' Audio is not loaded; include audio.json in this folder to add music, voices and effects.';
}
function customization() { return { title: $('game-title').value.trim(), fighters: structuredClone(fighters), stages: structuredClone(stages), allowPlaceholders: $('allow-placeholders').checked }; }
function renderFighters() {
  $('fighter-list').replaceChildren();
  fighters.forEach((fighter, index) => {
    const card = make('article', 'fighter-editor'); card.style.setProperty('--fighter-color', fighter.color);
    const top = make('div', 'fighter-top'), label = make('label', 'fighter-toggle'), enabled = document.createElement('input');
    enabled.type = 'checkbox'; enabled.checked = fighter.enabled; enabled.dataset.fighterEnabled = fighter.id; enabled.setAttribute('aria-label', `Include ${fighter.name}`);
    label.append(enabled, make('span', '', `FIGHTER ${String(index + 1).padStart(2, '0')}`)); top.append(label, make('span', 'fighter-id', fighter.id));
    const preview = make('div', 'fighter-preview');
    const art = ['portrait', 'hero', 'reference', 'source'].map(kind => manifest.assets.find(a => a.fighter === fighter.id && a.kind === kind && files.has(a.src))).find(Boolean);
    if (art) { const img = document.createElement('img'); img.src = previewURL(art.src); img.alt = fighter.name; preview.append(img); }
    else preview.append(make('span', 'fighter-initial', String(index + 1).padStart(2, '0')));
    const fields = make('div', 'fighter-fields'), name = document.createElement('input'), color = document.createElement('input');
    name.type = 'text'; name.maxLength = 60; name.value = fighter.name; name.dataset.fighterName = fighter.id; name.setAttribute('aria-label', `Name for fighter ${index + 1}`);
    color.type = 'color'; color.value = fighter.color; color.dataset.fighterColor = fighter.id; color.setAttribute('aria-label', `Color for fighter ${index + 1}`);
    const count = manifest.assets.filter(a => a.fighter === fighter.id && files.has(a.src)).length, total = manifest.assets.filter(a => a.fighter === fighter.id).length;
    fields.append(name, color); card.append(top, preview, fields, make('p', 'fighter-details', `${count}/${total} source assets · ${count ? 'Artwork loaded' : 'Artwork pending'}`));
    const character = manifest.game.fighters.find(f => f.id === fighter.id);
    if (character?.description || character?.specialMove) {
      const details = make('details', 'character-description'); details.append(make('summary', '', character.specialMove?.name || 'Character concept'));
      if (character.description) details.append(make('p', '', character.description));
      if (character.specialMove) details.append(make('p', '', `SPECIAL · ${character.specialMove.description}`));
      card.append(details);
    }
    enabled.addEventListener('change', () => { fighter.enabled = enabled.checked; card.classList.toggle('disabled', !fighter.enabled); invalidate(); });
    name.addEventListener('input', () => { fighter.name = name.value; invalidate(); });
    color.addEventListener('input', () => { fighter.color = color.value; card.style.setProperty('--fighter-color', fighter.color); invalidate(); });
    $('fighter-list').append(card);
  });
}
function renderStages() {
  $('stage-list').replaceChildren();
  stages.forEach((stage, index) => {
    const card = make('label', 'stage-editor'), checkbox = document.createElement('input'), name = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = stage.enabled; checkbox.dataset.stageEnabled = stage.id; checkbox.setAttribute('aria-label', `Include ${stage.name}`);
    name.type = 'text'; name.value = stage.name; name.maxLength = 60; name.dataset.stageName = stage.id; name.setAttribute('aria-label', `Name for stage ${index + 1}`);
    checkbox.addEventListener('change', () => { stage.enabled = checkbox.checked; card.classList.toggle('disabled', !stage.enabled); invalidate(); });
    name.addEventListener('input', () => { stage.name = name.value; invalidate(); });
    card.append(checkbox, name); $('stage-list').append(card);
  });
}
function renderAssets() {
  $('asset-grid').replaceChildren(); if (!manifest) return;
  const filter = $('asset-filter').value;
  for (const asset of manifest.assets.filter(a => filter === 'all' || (filter === 'character' ? ['reference', 'portrait', 'hero', 'cutin'].includes(a.kind) : a.kind === filter))) {
    const card = make('article', 'asset-card'), preview = make('div', 'asset-preview'), url = previewURL(asset.src);
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = asset.id; img.loading = 'lazy'; img.onerror = () => { preview.replaceChildren(make('span', '', 'UNREADABLE IMAGE')); }; preview.append(img); }
    else preview.textContent = 'ARTWORK PENDING';
    const meta = make('div', 'asset-meta'); meta.append(make('strong', '', asset.id), make('small', url ? 'found' : 'missing', `${asset.kind.toUpperCase()} · ${url ? 'AVAILABLE' : 'MISSING'}`));
    if (asset.poses?.length) meta.append(make('p', 'pose-list', asset.poses.join(' · ')));
    card.append(preview, meta); $('asset-grid').append(card);
  }
  if (filter === 'all' || filter === 'audio') for (const asset of audioManifest?.assets || []) {
    const card = make('article', 'asset-card'), preview = make('div', 'asset-preview audio-preview'), url = previewURL(asset.src);
    if (url) { const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = url; audio.setAttribute('aria-label', asset.id); preview.append(audio); }
    else preview.textContent = 'AUDIO PENDING';
    const meta = make('div', 'asset-meta'); meta.append(make('strong', '', asset.id), make('small', url ? 'found' : 'missing', `${asset.category.toUpperCase()} · ${url ? 'AVAILABLE' : 'MISSING'}`));
    card.append(preview, meta); $('asset-grid').append(card);
  }
}
function mapFolder(folderFiles, manifestFolder = null) {
  const map = new Map();
  for (const file of folderFiles) {
    const original = (file.webkitRelativePath || file.name).replaceAll('\\', '/');
    const candidates = manifestFolder !== null ? (original.startsWith(manifestFolder) ? [original.slice(manifestFolder.length)] : []) : [original, original.split('/').slice(1).join('/')];
    for (const relative of candidates.filter(Boolean)) {
      if (![...(manifest?.assets || []), ...(audioManifest?.assets || [])].some(a => a.src === relative)) continue;
      if (map.has(relative) && map.get(relative) !== file) throw new Error(`More than one file maps to ${relative}. Choose the exact asset root folder.`);
      map.set(relative, file);
    }
  }
  return map;
}
function loadManifest(json, label, isExample = false) {
  const checked = validateManifest(json);
  clearPreviews(); manifest = checked; audioManifest = null; sample = isExample; files = new Map();
  fighters = manifest.game.fighters.map(f => ({ id: f.id, name: f.name, color: /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#ff9c59', enabled: true }));
  stages = manifest.game.stages.map(s => ({ id: s.id, name: s.name, enabled: true }));
  $('game-title').value = manifest.game.title; $('source-label').textContent = label; $('example-notice').hidden = !sample;
  $('customize-empty').hidden = true; $('customize-content').hidden = false; $('allow-placeholders').checked = false;
  invalidate(); renderFighters(); renderStages(); renderAssets();
}
async function readJson(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('This JSON is too large. Choose the assets.json manifest, not an image or workflow file.');
  try { return JSON.parse(await file.text()); } catch { throw new Error('Unable to read that JSON. Choose the assets.json file produced by the asset workflow.'); }
}
async function selectManifest(file) {
  if (busy) throw new Error('Wait for the current build or export to finish before loading another project.');
  if (!file) return;
  loadManifest(await readJson(file), file.name);
  if (selectedFiles.length) { files = mapFolder(selectedFiles); renderFighters(); renderAssets(); updateReadiness(); }
  message('Asset map loaded. Choose its folder to provide the source artwork.', 'success');
}
async function selectFolder(fileList) {
  if (busy) throw new Error('Wait for the current build or export to finish before loading another project.');
  const chosen = Array.from(fileList); if (!chosen.length) return;
  const maps = chosen.filter(file => file.name === 'assets.json');
  if (maps.length > 1) throw new Error('Several assets.json files were found. Choose one game’s asset root folder.');
  let base = null;
  if (maps.length === 1) {
    const file = maps[0], relative = file.webkitRelativePath || file.name;
    base = relative.slice(0, -file.name.length);
    loadManifest(await readJson(file), `${base || 'Selected folder' }assets.json`);
  } else if (!manifest) throw new Error('No assets.json was found. Select the asset root folder, or load the JSON separately first.');
  const audioMaps = chosen.filter(file => file.name === 'audio.json' && (base === null || (file.webkitRelativePath || file.name) === `${base}audio.json`));
  if (audioMaps.length > 1) throw new Error('Several audio.json files were found. Choose the exact asset root.');
  audioManifest = audioMaps.length ? validateAudioManifest(await readJson(audioMaps[0]), manifest.game) : null;
  const mapped = mapFolder(chosen, base);
  clearPreviews(); files = mapped; selectedFiles = chosen;
  if (mapped.size) { sample = false; $('example-notice').hidden = true; }
  invalidate(); renderFighters(); renderAssets();
  message(`${files.size} source files matched to the image and audio maps.`, 'success');
}
function guard(fn) { return async (...args) => { try { await fn(...args); } catch (error) { message(error.message || String(error), 'error'); } }; }
function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll('input,select,#load-example,#build-button,#download-zip,#export-directory')) control.disabled = value;
  $('build-button').disabled = value || !manifest;
  if (!('showDirectoryPicker' in window)) $('export-directory').disabled = true;
}
async function build() {
  if (!manifest || busy) return;
  builtFiles = null; $('export-ready').hidden = true; message('');
  const custom = customization();
  if (!custom.title) throw new Error('Give your game a title before building.');
  if (custom.fighters.filter(f => f.enabled).length < 2 || !custom.stages.some(s => s.enabled)) throw new Error('Choose at least two fighters and one stage.');
  setBusy(true); $('progress-area').hidden = false;
  try {
    builtFiles = await buildGame({ manifest, audioManifest, files, customization: custom, onProgress: ({done,total,message:text}) => { $('build-progress').value = total ? Math.round(done / total * 100) : 0; $('progress-label').textContent = text || 'Building game…'; } });
    const bytes = [...builtFiles.values()].reduce((sum, blob) => sum + blob.size, 0);
    $('build-progress').value = 100; $('progress-label').textContent = 'Game packaged. Choose an export below.';
    $('build-summary').textContent = `${builtFiles.size} files · ${(bytes / 1024 / 1024).toFixed(1)} MB · ${custom.fighters.filter(f => f.enabled).length} fighters`;
    $('export-ready').hidden = false;
    message(custom.allowPlaceholders && manifest.assets.some(a => !files.has(a.src)) ? 'Prototype built with placeholder artwork. The exported game labels missing art.' : 'Your custom game is built and ready to export.', 'success');
  } finally { setBusy(false); }
}
async function download() {
  if (!builtFiles || busy) return;
  setBusy(true);
  try {
    const blob = await zipFiles(builtFiles), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${$('game-title').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dad-fighter-game'}.zip`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    message('Game ZIP downloaded. Extract it and follow the included README to play.', 'success');
  } finally { setBusy(false); }
}
async function exportDirectory() {
  if (!builtFiles || busy) return;
  if (!('showDirectoryPicker' in window)) throw new Error('Directory export is unavailable in this browser. Download the game ZIP instead.');
  let handle;
  try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
  catch (error) { if (error.name === 'AbortError') return; throw error; }
  setBusy(true);
  try { await writeDirectory(handle, builtFiles); message(`Game exported to ${handle.name}. Follow its README to play.`, 'success'); }
  finally { setBusy(false); }
}
$('manifest-input').addEventListener('change', guard(event => selectManifest(event.target.files[0])));
$('folder-input').addEventListener('change', guard(event => selectFolder(event.target.files)));
$('load-example').addEventListener('click', guard(async () => {
  const response = await fetch('example-assets.json'); if (!response.ok) throw new Error('Example project is unavailable. Load your assets.json instead.');
  selectedFiles = []; loadManifest(await response.json(), 'Example project · no generated artwork', true);
  message('Example loaded. Enable placeholder assets to try a prototype export.', 'success');
}));
$('asset-filter').addEventListener('change', renderAssets);
$('game-title').addEventListener('input', invalidate);
$('allow-placeholders').addEventListener('change', invalidate);
$('build-button').addEventListener('click', guard(build));
$('download-zip').addEventListener('click', guard(download));
$('export-directory').addEventListener('click', guard(exportDirectory));
const drop = $('drop-zone');
for (const event of ['dragenter','dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('dragging'); });
for (const event of ['dragleave','drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('dragging'); });
drop.addEventListener('drop', guard(async event => {
  const dropped = Array.from(event.dataTransfer.files).filter(file => /\.json$/i.test(file.name));
  if (dropped.length !== 1) throw new Error('Drop one assets.json file, then choose its asset folder.');
  await selectManifest(dropped[0]);
}));
if (!('showDirectoryPicker' in window)) { $('export-directory').disabled = true; $('directory-hint').textContent = 'This browser does not support directory export. Download and extract the ZIP instead.'; }
for (const label of document.querySelectorAll('label.button[for]')) {
  label.tabIndex = 0; label.setAttribute('role', 'button');
  label.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $(label.htmlFor).click(); } });
}
