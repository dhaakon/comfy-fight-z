(() => {
  'use strict';
  const $ = id => document.getElementById(id), E = window.FighterEngine;
  const canvas = $('arena'), ctx = canvas.getContext('2d'), images = new Map();
  const fallback = {
    title: 'Comfy Fighter Z',
    subtitle: 'Higgsfield Open Source Saga',
    fighters: ['allyson', 'deep', 'georgia', 'matt', 'photographer', 'rob'].map((id, i) => ({ id, name: id[0].toUpperCase() + id.slice(1), color: ['#ffd23f','#2edbc8','#ff3b6b','#9c7aff','#ff9457','#67aaff'][i], poses: {} })),
    stages: [{ id: 'yard', name: 'The Yard' }], ui: {}, effects: {}, audio: {}
  };
  let manifest = fallback, state = null, paused = false, last = performance.now(), accumulator = 0;
  let selected = [0, 1], stageIndex = 0, galleryEntries = [], cutin = null, selectedTab = 'arena', pickingSlot = 0;
  let audioEnabled = false, audioInteracted = false, music = null, musicId = null;
  let introScene = null, introVoice = null, impactFrames = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fallbackTaglines = {
    allyson: 'Every node leads to your defeat.', deep: 'Your queue ends here.', georgia: 'Watch the whole arena turn gold.',
    matt: 'No limits. Just latent power.', photographer: 'Smile. This is your last frame.', rob: 'Build complete. You are finished.'
  };
  const activeSounds = new Set();
  const keys = new Set(), pendingKeys = new Set(), touch = {};
  // Read-only snapshot for move tuning and automated browser checks.
  window.FighterDebug = Object.freeze({
    snapshot: () => state ? JSON.parse(JSON.stringify(state)) : null,
    presentation: () => ({ screen: !$('title-screen').hidden ? 'title' : introScene ? 'intro' : !$('selection-screen').hidden ? 'selection' : 'fight', introSlot: introScene?.slot ?? null })
  });
  const controls = [
    { KeyA: 'left', KeyD: 'right', KeyW: 'jump', KeyS: 'down', KeyF: 'punch', KeyG: 'kick', KeyH: 'special' },
    { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'down', KeyJ: 'punch', KeyK: 'kick', KeyL: 'special' }
  ];
  function art(src) { return typeof src === 'string' ? images.get(src) : null; }
  function assetSource(value) { return typeof value === 'string' ? value : value?.src; }
  function ui(name) { return art(assetSource(manifest.ui?.[name])); }
  function fighterData(slot) { return manifest.fighters[selected[slot]]; }
  function portraitSource(f, hero = false) { return [hero && f.hero, f.portrait, f.hero, f.sourceImage].map(assetSource).find(src => art(src)); }
  function generatedPortrait(f) { return !![f.hero, f.portrait].map(assetSource).find(src => art(src)); }
  function playSound(id, volume = .6) {
    const src = assetSource(manifest.audio?.[id]); if (!audioEnabled || !src) return;
    const sound = new Audio(src); sound.volume = volume; activeSounds.add(sound);
    const done = () => activeSounds.delete(sound); sound.addEventListener('ended', done, { once: true }); sound.addEventListener('error', done, { once: true });
    sound.play().catch(done);
    return sound;
  }
  function setMusic(id) {
    if (musicId === id && music) { if (audioEnabled && !paused) music.play().catch(() => {}); return; }
    music?.pause(); music = null; musicId = id;
    const entry = manifest.audio?.[id], src = assetSource(entry); if (!src) return;
    music = new Audio(src); music.loop = entry?.loop !== false; music.volume = .25;
    if (audioEnabled && !paused) music.play().catch(() => {});
  }
  function refreshAudio() {
    $('audio-button').textContent = audioEnabled ? 'SOUND ON' : 'SOUND OFF'; $('audio-button').setAttribute('aria-pressed', String(audioEnabled));
    if (!audioEnabled) { music?.pause(); introVoice?.pause(); activeSounds.forEach(sound => sound.pause()); activeSounds.clear(); }
    else if (!paused) {
      music?.play().catch(() => {});
      if (introScene) {
        if (!introVoice) introVoice = playSound('fighter_' + fighterData(introScene.slot).id + '_intro', .85);
        if (introVoice) {
          const voice = introVoice;
          try { voice.currentTime = introScene.elapsed / 1000; } catch (_) { /* A stream may not be seekable yet. */ }
          activeSounds.add(voice); voice.play().catch(() => activeSounds.delete(voice));
        }
      }
    }
  }
  function engageAudio() { if (!audioInteracted) { audioEnabled = true; audioInteracted = true; refreshAudio(); } }
  function clearIntro() {
    introVoice?.pause(); if (introVoice) activeSounds.delete(introVoice);
    introVoice = null; introScene = null; $('intro-screen').hidden = true;
    if (music) music.volume = .25;
  }
  function enterSaga() {
    if ($('title-start').disabled) return;
    engageAudio(); $('title-screen').hidden = true; $('selection-screen').hidden = false; $('fight-screen').hidden = true;
    $('controls-panel').hidden = false; $('touch-panel').hidden = true; setMusic('menu_music');
    $('fighter-grid').querySelector('button')?.focus();
  }
  function showTitle() {
    reset(); $('selection-screen').hidden = true; $('title-screen').hidden = false;
    $('controls-panel').hidden = true; $('touch-panel').hidden = true;
    $('title-start').focus();
  }
  function showIntroduction(slot) {
    introVoice?.pause(); if (introVoice) activeSounds.delete(introVoice);
    const fighter = fighterData(slot), voiceId = 'fighter_' + fighter.id + '_intro';
    const duration = Number(manifest.audio?.[voiceId]?.duration) || 2.8;
    introScene = { slot, elapsed: 0, duration: Math.max(2800, Math.min(7500, duration * 1000 + 600)) };
    const panel = $('intro-screen'); panel.hidden = false; panel.dataset.slot = String(slot); panel.classList.toggle('long-name', fighter.name.length > 14);
    panel.style.setProperty('--intro-accent', fighter.color || (slot ? '#2edbc8' : '#ffd23f'));
    panel.classList.remove('arriving'); void panel.offsetWidth; panel.classList.add('arriving');
    $('intro-slot').textContent = slot ? 'THE CHALLENGER ANSWERS' : 'PLAYER ONE ENTERS';
    $('intro-number').textContent = slot ? '02' : '01'; $('intro-name').textContent = fighter.name;
    $('intro-special').textContent = fighter.specialMove?.name || 'A NEW CHALLENGER';
    $('intro-tagline').textContent = '“' + (fighter.introTagline || fallbackTaglines[fighter.id] || 'This fight is mine.') + '”';
    const portrait = $('intro-portrait'), src = portraitSource(fighter, true); portrait.replaceChildren();
    if (src) { const img = document.createElement('img'); img.src = src; img.alt = fighter.name; portrait.append(img); }
    else { const emblem = document.createElement('span'); emblem.textContent = fighter.name.slice(0, 1); portrait.append(emblem); }
    panel.querySelectorAll('.intro-progress span').forEach((mark, index) => { mark.classList.toggle('active', index === slot); mark.classList.toggle('complete', index < slot); });
    if (music) music.volume = .1;
    introVoice = playSound(voiceId, .85);
  }
  function finishIntroduction() {
    if (!introScene) return;
    clearIntro(); keys.clear(); pendingKeys.clear(); Object.keys(touch).forEach(key => delete touch[key]); accumulator = 0;
    $('versus-overlay').hidden = false; $('pause-button').hidden = false; $('touch-panel').hidden = false;
    canvas.focus();
  }
  function updateIntroduction(milliseconds) {
    if (!introScene || paused || selectedTab !== 'arena') return;
    introScene.elapsed += milliseconds;
    if (introScene.elapsed >= introScene.duration) {
      if (introScene.slot === 0) showIntroduction(1); else finishIntroduction();
    }
  }
  function chooseFighter(index) {
    selected[pickingSlot] = index; $(pickingSlot ? 'fighter-two' : 'fighter-one').value = index;
    engageAudio(); playSound('ann_select', .45); refreshCards();
    $('fighter-grid').children[index]?.focus({ preventScroll: true });
  }
  function imageLoad(src) {
    if (!src || images.has(src)) return Promise.resolve();
    images.set(src, null);
    return new Promise(resolve => { const img = new Image(); img.onload = () => { images.set(src, img); resolve(); }; img.onerror = resolve; img.src = src; });
  }
  function makeOption(value, label) { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }
  function findEntries() {
    const entries = [];
    manifest.fighters.forEach(f => {
      Object.entries(f.poses || {}).forEach(([pose, meta]) => entries.push({ group: 'fighters', name: `${f.name} / ${pose}`, src: meta.src, info: `${meta.w} × ${meta.h} · anchor ${meta.ax}, ${meta.ay}` }));
      ['portrait', 'hero', 'cutin'].forEach(kind => { if (f[kind]) entries.push({ group: 'portraits', name: `${f.name} / ${kind}`, src: assetSource(f[kind]), info: 'Character artwork' }); });
    });
    manifest.stages.forEach(s => { if (s.src) entries.push({ group: 'stages', name: s.name, src: s.src, info: 'Stage background' }); });
    Object.entries(manifest.ui || {}).forEach(([name, src]) => entries.push({ group: 'ui', name, src: assetSource(src), info: 'Interface artwork' }));
    Object.entries(manifest.effects || {}).forEach(([name, meta]) => entries.push({ group: 'effects', name, src: assetSource(meta), info: 'Combat effect' }));
    Object.entries(manifest.audio || {}).forEach(([name, item]) => entries.push({ group: 'audio', name: name.replaceAll('_', ' '), src: assetSource(item), info: item.category || 'Generated audio' }));
    return entries;
  }
  function setBackground(element, image) {
    if (image) { element.style.backgroundImage = `linear-gradient(90deg,#111b1bd9,#111b1b80), url("${image.src}")`; element.style.backgroundSize = 'cover'; }
  }
  function refreshCards() {
    $('fighter-cards').replaceChildren();
    selected.forEach((index, slot) => {
      const f = manifest.fighters[index], card = document.createElement('article');
      card.className = 'fighter-card'; card.style.setProperty('--accent', f.color || (slot ? '#2edbc8' : '#ffd23f'));
      const frame = document.createElement('div'); frame.className = 'fighter-art';
      const source = portraitSource(f, true), generated = generatedPortrait(f);
      if (source) { const img = document.createElement('img'); img.src = source; img.alt = f.name; img.classList.toggle('reference', !generated); frame.append(img); }
      else { const placeholder = document.createElement('div'); placeholder.className = 'fallback-portrait'; placeholder.textContent = String(index + 1).padStart(2, '0'); frame.append(placeholder); }
      const plate = document.createElement('div'); plate.className = 'fighter-nameplate';
      const tag = document.createElement('span'); tag.className = 'mini-tag'; tag.textContent = slot ? ($('mode').value === 'cpu' ? 'CPU / CHALLENGER' : '2P / CHALLENGER') : '1P / PLAYER ONE';
      const title = document.createElement('h3'); title.textContent = f.name.toUpperCase();
      const artType = document.createElement('span'); artType.className = 'art-type'; artType.textContent = generated ? 'CHARACTER ART' : source ? 'SOURCE REFERENCE / ANIME ART PENDING' : 'CHARACTER ART PENDING';
      plate.append(tag, title, artType); frame.append(plate);
      const body = document.createElement('div'); body.className = 'fighter-card-body';
      const bio = document.createElement('p'); bio.className = 'fighter-bio'; bio.textContent = f.description ? f.description.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') : 'An original challenger enters The Yard.';
      const label = document.createElement('p'); label.className = 'move-title'; label.textContent = 'SIGNATURE MOVE / ' + (slot ? 'L' : 'H');
      const move = document.createElement('strong'); move.className = 'move-name'; move.textContent = f.specialMove?.name || 'Energy Break';
      const detail = document.createElement('p'); detail.className = 'move-description'; detail.textContent = f.specialMove?.description ? f.specialMove.description.split(/(?<=[.!?])\s+/)[0] : 'Launch an energy attack. Costs 30 meter.';
      body.append(bio, label, move, detail); card.append(frame, body); $('fighter-cards').append(card);
    });
    $('fighter-grid').replaceChildren();
    manifest.fighters.forEach((f, index) => {
      const tile = document.createElement('button'); tile.className = 'fighter-tile'; tile.dataset.fighter = f.id; tile.classList.toggle('long-name', f.name.length > 14);
      tile.style.setProperty('--accent', f.color || '#7a5cff'); tile.setAttribute('aria-label', 'Select ' + f.name + ' for player ' + (pickingSlot + 1));
      tile.classList.toggle('picked-one', selected[0] === index); tile.classList.toggle('picked-two', selected[1] === index);
      tile.setAttribute('aria-pressed', String(selected[pickingSlot] === index));
      const src = portraitSource(f);
      if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; tile.append(img); }
      else { const number = document.createElement('span'); number.className = 'tile-number'; number.textContent = String(index + 1).padStart(2, '0'); tile.append(number); }
      const name = document.createElement('span'); name.className = 'tile-name'; name.textContent = f.name; tile.append(name);
      selected.forEach((picked, slot) => { if (picked === index) { const badge = document.createElement('span'); badge.className = 'pick-badge' + (slot ? ' two' : ''); badge.textContent = slot ? '2P' : '1P'; tile.append(badge); } });
      tile.addEventListener('click', () => chooseFighter(index)); $('fighter-grid').append(tile);
    });
    document.querySelectorAll('[data-pick-slot]').forEach(button => button.classList.toggle('active', Number(button.dataset.pickSlot) === pickingSlot));
    $('pick-hint').textContent = 'Choose a fighter for ' + (pickingSlot ? 'the challenger.' : 'Player One.');
    $('roster-count').textContent = manifest.fighters.length;
    const stage = manifest.stages[stageIndex], background = art(stage.src) || art(assetSource(stage.sourceImage));
    $('stage-label').textContent = stage.name.toUpperCase(); $('stage-name').textContent = stage.name.toUpperCase();
    $('stage-art-status').textContent = art(stage.src) ? 'ONE PLAYABLE ARENA' : background ? 'SOURCE REFERENCE / ANIME STAGE PENDING' : 'STAGE ART PENDING';
    if (background) $('stage-thumb').style.backgroundImage = 'url("' + background.src + '")';
    const complete = selected.every(i => Object.values(manifest.fighters[i].poses || {}).filter(pose => art(pose.src)).length >= 27) && art(stage.src);
    $('placeholder-label').hidden = !!complete;
    $('placeholder-label').textContent = 'SPRITE ART PENDING / PROTOTYPE FIGHTERS';
    const count = manifest.fighters.reduce((total, f) => total + Object.values(f.poses || {}).filter(p => art(p.src)).length, 0);
    $('selection-art-status').textContent = count ? count + ' generated fighter poses loaded. Select your matchup and enter The Yard.' : 'Reference preview: character photos and the Yard reference are loaded. Anime sprites and generated audio are pending; combat uses visible prototype fighters.';
  }
  function renderGallery() {
    const counts = [
      [galleryEntries.filter(e => e.group === 'fighters' && art(e.src)).length, 'FIGHTER POSES'],
      [galleryEntries.filter(e => e.group === 'portraits' && art(e.src)).length, 'CHARACTER ART'],
      [galleryEntries.filter(e => e.group === 'stages' && art(e.src)).length, 'STAGES'],
      [galleryEntries.filter(e => ['ui', 'effects'].includes(e.group) && art(e.src)).length, 'UI + EFFECTS']
    ];
    $('coverage').replaceChildren();
    counts.forEach(([count, label]) => { const box = document.createElement('div'), num = document.createElement('strong'), text = document.createElement('span'); num.textContent = String(count).padStart(2, '0'); text.textContent = label; box.append(num, text); $('coverage').append(box); });
    const filter = $('lab-filter').value, entries = galleryEntries.filter(e => filter === 'all' || e.group === filter);
    $('asset-gallery').replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('div'); empty.className = 'lab-empty';
      const title = document.createElement('strong'); title.textContent = 'Your next generation starts here.';
      const message = document.createElement('span'); message.textContent = 'Import the ComfyUI outputs and run the asset build. This gallery will show every sprite, stage, portrait, and effect included in the game.';
      empty.append(title, message); $('asset-gallery').append(empty); return;
    }
    entries.forEach(entry => {
      const card = document.createElement('article'); card.className = 'asset-card';
      const preview = document.createElement('div'); preview.className = 'preview';
      if (entry.group === 'audio') { const player = document.createElement('audio'); player.controls = true; player.preload = 'none'; player.src = entry.src; player.setAttribute('aria-label', entry.name); preview.append(player); }
      else if (art(entry.src)) { const img = document.createElement('img'); img.src = entry.src; img.alt = entry.name; img.loading = 'lazy'; preview.append(img); }
      else preview.textContent = 'Image unavailable';
      const meta = document.createElement('div'); meta.className = 'meta';
      const name = document.createElement('strong'); name.textContent = entry.name;
      const info = document.createElement('small'); info.textContent = entry.info;
      meta.append(name, info); card.append(preview, meta); $('asset-gallery').append(card);
    });
  }
  function start() {
    engageAudio();
    clearIntro();
    state = E.create(selected.map(i => manifest.fighters[i].id), { cpu: $('mode').value === 'cpu' });
    paused = false; keys.clear(); pendingKeys.clear(); cutin = null; accumulator = 0; impactFrames = 0;
    $('title-screen').hidden = true; $('selection-screen').hidden = true; $('fight-screen').hidden = false; $('touch-panel').hidden = true;
    $('match-overlay').hidden = true; $('pause-overlay').hidden = true; $('pause-button').hidden = true;
    $('versus-overlay').hidden = true; $('versus-one').textContent = fighterData(0).name; $('versus-two').textContent = fighterData(1).name;
    $('arena-label').textContent = state.cpu ? 'ARCADE / VS CPU' : 'LOCAL / TWO PLAYERS';
    $('match-status').textContent = 'First to two rounds. Hold back to block.';
    setMusic('yard_music'); showIntroduction(0); $('intro-skip').focus();
  }
  function reset() {
    clearIntro();
    state = null; paused = false; keys.clear(); pendingKeys.clear(); cutin = null;
    $('title-screen').hidden = true; $('selection-screen').hidden = false; $('fight-screen').hidden = true;
    $('controls-panel').hidden = false; $('touch-panel').hidden = true;
    $('match-overlay').hidden = true; $('pause-overlay').hidden = true; $('pause-button').hidden = true; $('versus-overlay').hidden = true;
    $('arena-label').textContent = 'CHARACTER SELECT'; $('match-status').textContent = 'Choose your matchup.';
    refreshCards(); setMusic('menu_music');
  }
  function pause(value = !paused) {
    if (!state || state.phase === 'matchover') return;
    paused = value; keys.clear(); pendingKeys.clear(); Object.keys(touch).forEach(k => delete touch[k]);
    $('pause-overlay').hidden = !paused;
    if (paused) { music?.pause(); introVoice?.pause(); } else refreshAudio();
    if (selectedTab === 'arena') (paused ? $('resume-button') : introScene ? $('intro-skip') : canvas).focus({ preventScroll: true });
  }
  function cover(image, x, y, w, h) {
    const s = Math.max(w / image.width, h / image.height), sw = w / s, sh = h / s;
    ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
  }
  function stageDraw() {
    const background = art(manifest.stages[stageIndex].src) || art(assetSource(manifest.stages[stageIndex].sourceImage));
    if (background) { cover(background, 0, 0, 960, 540); return; }
    const sky = ctx.createLinearGradient(0, 0, 0, 440); sky.addColorStop(0, '#293c40'); sky.addColorStop(.65, '#798982'); sky.addColorStop(1, '#d7b084');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, 540);
    ctx.fillStyle = '#f6c38d'; ctx.globalAlpha = .65; ctx.beginPath(); ctx.arc(727, 151, 57, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    // A quiet suburban skyline built only from code until a generated stage is imported.
    [0, 160, 385, 575, 820].forEach((x, i) => {
      const y = 250 + (i % 3) * 15, w = 155 + i % 2 * 28;
      ctx.fillStyle = ['#48595a', '#526764', '#4a5c5b'][i % 3]; ctx.fillRect(x, y, w, 150);
      ctx.beginPath(); ctx.moveTo(x - 15, y); ctx.lineTo(x + w / 2, y - 62); ctx.lineTo(x + w + 15, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c4aa79'; ctx.fillRect(x + 22, y + 28, 25, 40); ctx.fillRect(x + w - 47, y + 28, 25, 40);
      ctx.fillStyle = '#344746'; ctx.fillRect(x + w / 2 - 15, y + 62, 30, 88);
    });
    ctx.fillStyle = '#344d45'; ctx.fillRect(0, 368, 960, 50);
    for (let x = 0; x < 960; x += 18) { ctx.fillStyle = '#79857b'; ctx.fillRect(x, 360, 3, 58); }
    ctx.fillStyle = '#888d7b'; ctx.fillRect(0, 407, 960, 15); ctx.fillStyle = '#333f40'; ctx.fillRect(0, 422, 960, 118);
    ctx.fillStyle = '#c9b88a55'; for (let x = -40; x < 960; x += 170) ctx.fillRect(x, 501, 92, 4);
    ctx.strokeStyle = '#222d31'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 450); ctx.lineTo(960, 450); ctx.stroke();
    // Telephone wire gives the flat fighting plane a useful horizon.
    ctx.strokeStyle = '#273c3e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 180); ctx.quadraticCurveTo(480, 245, 960, 185); ctx.stroke();
    ctx.fillStyle = '#263c3c'; ctx.fillRect(99, 177, 7, 241); ctx.fillRect(865, 180, 7, 240);
  }
  function fallbackFighter(f, data) {
    const color = data.color || '#f49653', walking = f.pose === 'walk' || f.pose === 'walk2';
    const crouch = ['crouch', 'sweep', 'cjab'].includes(f.pose), down = f.pose === 'down';
    ctx.save(); ctx.translate(f.x, E.GROUND - f.y); ctx.scale(f.facing, 1);
    if (down) { ctx.translate(10, -15); ctx.rotate(-Math.PI / 2); }
    if (crouch) { ctx.scale(1, .72); }
    const stride = walking ? Math.sin((state?.frame || 0) / 5) * 18 : 0;
    ctx.strokeStyle = '#1d292d'; ctx.lineWidth = 24; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-15, -80); ctx.lineTo(-26 + stride, -16); ctx.moveTo(15, -80); ctx.lineTo(27 - stride, -16); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 25; ctx.beginPath(); ctx.moveTo(-15, -81); ctx.lineTo(-24 + stride, -38); ctx.moveTo(15, -81); ctx.lineTo(f.pose === 'kick' ? 100 : 25 - stride, f.pose === 'kick' ? -95 : -38); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-33, -152); ctx.lineTo(32, -152); ctx.lineTo(25, -80); ctx.lineTo(-25, -80); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8c8a2'; ctx.beginPath(); ctx.arc(0, -174, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#26373a'; ctx.fillRect(-23, -193, 45, 13); ctx.fillRect(16, -182, 15, 5);
    ctx.strokeStyle = '#e8c8a2'; ctx.lineWidth = 16; ctx.beginPath();
    ctx.moveTo(25, -142); ctx.lineTo(f.pose === 'punch' ? 105 : f.pose === 'block' ? 36 : 54, f.pose === 'block' ? -180 : -125);
    ctx.moveTo(-25, -142); ctx.lineTo(f.pose === 'win' ? -35 : -8, f.pose === 'win' ? -217 : -122); ctx.stroke();
    ctx.strokeStyle = '#1c2a2c'; ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(-26 + stride, -8); ctx.lineTo(-5 + stride, -8); ctx.moveTo(27 - stride, -8); ctx.lineTo(45 - stride, -8); ctx.stroke();
    ctx.fillStyle = '#141f24'; ctx.fillRect(-15, -121, 30, 7); ctx.restore();
  }
  function drawFighter(f, slot) {
    const data = fighterData(slot), meta = data.poses?.[f.pose] || data.poses?.idle, img = art(meta?.src);
    ctx.fillStyle = '#10202155'; ctx.beginPath(); ctx.ellipse(f.x, E.GROUND + 3, 52, 10, 0, 0, Math.PI * 2); ctx.fill();
    if (!img) return fallbackFighter(f, data);
    const base = data.poses.idle || meta, scale = 205 / (base.bh || base.h || 400);
    ctx.save(); ctx.translate(f.x, E.GROUND - f.y); ctx.scale(f.facing * scale, scale);
    ctx.drawImage(img, -meta.ax, -meta.ay, meta.w, meta.h); ctx.restore();
  }
  function effect(name, x, y, facing = 1, opacity = 1, size = 120) {
    const meta = manifest.effects?.[name], img = art(assetSource(meta));
    if (img) { ctx.save(); ctx.globalAlpha = opacity; ctx.translate(x, y); ctx.scale(facing, 1); const ratio = size / Math.max(img.width, img.height); ctx.drawImage(img, -img.width * ratio / 2, -img.height * ratio / 2, img.width * ratio, img.height * ratio); ctx.restore(); return true; }
    return false;
  }
  function hud() {
    const fighters = state?.fighters || [E.create().fighters[0], E.create().fighters[1]];
    ctx.fillStyle = '#0e1b22b8'; ctx.fillRect(0, 0, 960, 88);
    if (ui('hud')) {
      // The generated HUD is a full-screen frame. Use its upper trim as decoration;
      // health bars, names and portraits are drawn from live game data below.
      const frame = ui('hud'); ctx.globalAlpha = .4;
      ctx.drawImage(frame, 0, 0, frame.width, frame.height * .07, 0, 0, 960, 22);
      ctx.globalAlpha = 1;
    }
    fighters.forEach((f, slot) => {
      const data = fighterData(slot), x = slot ? 550 : 55, width = 355, color = slot ? '#2edbc8' : '#ffd23f';
      ctx.textAlign = slot ? 'right' : 'left'; ctx.fillStyle = '#eeeee5'; ctx.font = 'bold 17px Arial'; ctx.fillText(data.name.toUpperCase(), slot ? 905 : 55, 26);
      ctx.fillStyle = '#17282c'; ctx.fillRect(x, 37, width, 19); ctx.fillStyle = color;
      ctx.fillRect(slot ? x + width * (1 - f.hp / 100) : x, 37, width * f.hp / 100, 19);
      ctx.fillStyle = '#ffffff44'; ctx.fillRect(slot ? x + width * (1 - f.hp / 100) : x, 37, width * f.hp / 100, 3);
      ctx.fillStyle = '#0d1e24'; ctx.fillRect(x, 64, width, 5); ctx.fillStyle = color; ctx.fillRect(slot ? x + width * (1 - f.energy / 100) : x, 64, width * f.energy / 100, 5);
      for (let i = 0; i < 2; i++) { ctx.fillStyle = f.wins > i ? color : '#506061'; ctx.beginPath(); ctx.arc(slot ? x + width - i * 13 : x + i * 13, 79, 3, 0, 7); ctx.fill(); }
      const portrait = art(portraitSource(data)); if (portrait) { ctx.save(); ctx.beginPath(); ctx.rect(slot ? 914 : 8, 16, 37, 43); ctx.clip(); cover(portrait, slot ? 914 : 8, 16, 37, 43); ctx.restore(); }
    });
    ctx.textAlign = 'center'; ctx.font = 'italic 46px Impact'; ctx.fillStyle = '#ffd23f'; ctx.fillText(Math.ceil((state?.time ?? 5940) / 60).toString().padStart(2, '0'), 480, 52);
    ctx.font = '8px Arial'; ctx.fillStyle = '#afc0bd'; ctx.fillText('ROUND ' + (state?.round || 1), 480, 72);
    if (ui('icons')) { ctx.globalAlpha = .65; ctx.drawImage(ui('icons'), 425, 476, 110, 36); ctx.globalAlpha = 1; }
  }
  function render() {
    ctx.clearRect(0, 0, 960, 540); ctx.save();
    if (impactFrames > 0 && !reducedMotion.matches) ctx.translate(Math.sin(performance.now() * .085) * Math.min(5, impactFrames), Math.cos(performance.now() * .06) * 2);
    stageDraw();
    if (!state && ui('title')) { ctx.globalAlpha = .6; cover(ui('title'), 0, 0, 960, 540); ctx.globalAlpha = 1; }
    const demo = E.create(selected.map(i => manifest.fighters[i].id));
    (state?.fighters || demo.fighters).forEach(drawFighter);
    if (state) {
      state.projectiles.forEach(p => {
        if (!effect('projectile', p.x, E.GROUND - p.y, p.facing, 1, 85)) {
          const gradient = ctx.createRadialGradient(p.x, E.GROUND - p.y, 2, p.x, E.GROUND - p.y, 28);
          gradient.addColorStop(0, '#fff8da'); gradient.addColorStop(.4, p.owner ? '#82d6c5' : '#ffa657'); gradient.addColorStop(1, '#ffffff00'); ctx.fillStyle = gradient; ctx.fillRect(p.x - 30, E.GROUND - p.y - 30, 60, 60);
        }
      });
      state.effects.forEach(e => {
        const progress = e.life / e.maxLife;
        if (effect(e.type, e.x, e.y, e.facing, progress, e.type === 'ko' ? 260 : e.type === 'powerup' ? 230 : 115)) return;
        if (e.type === 'ko') return;
        ctx.save(); ctx.globalAlpha = progress; ctx.strokeStyle = e.type === 'block' ? '#82d6c5' : '#ffc37f'; ctx.lineWidth = 3;
        ctx.beginPath(); if (e.type === 'dust') ctx.ellipse(e.x, e.y, 40 * (1 - progress) + 10, 9, 0, 0, 7);
        else if (e.type === 'powerup') ctx.ellipse(e.x, e.y, 50 * (1 - progress) + 30, 110, 0, 0, 7);
        else for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(e.x + Math.cos(a) * 5, e.y + Math.sin(a) * 5); ctx.lineTo(e.x + Math.cos(a) * 45 * (1 - progress + .3), e.y + Math.sin(a) * 45 * (1 - progress + .3)); }
        ctx.stroke(); ctx.restore();
      });
      if (cutin && cutin.life > 0) {
        const img = art(assetSource(fighterData(cutin.slot).cutin));
        if (img) { ctx.save(); ctx.globalAlpha = Math.min(1, cutin.life / 10); ctx.fillStyle = '#101b20cc'; ctx.fillRect(0, 125, 960, 110); cover(img, cutin.slot ? 480 : 0, 125, 480, 110); ctx.restore(); }
        const special = fighterData(cutin.slot).specialMove?.name;
        if (special) { ctx.save(); ctx.globalAlpha = Math.min(1, cutin.life / 10); ctx.fillStyle = '#130b27db'; ctx.fillRect(0, 220, 960, 42); ctx.textAlign = 'center'; ctx.font = 'italic 30px Impact'; ctx.fillStyle = cutin.slot ? '#2edbc8' : '#ffd23f'; ctx.fillText(special.toUpperCase() + '!', 480, 250); ctx.restore(); }
      }
    }
    ctx.restore(); hud();
    if (!state && ui('logo')) { const img = ui('logo'); ctx.drawImage(img, 380, 92, 200, Math.min(95, 200 * img.height / img.width)); }
    if (state && ['intro', 'roundover'].includes(state.phase)) {
      ctx.textAlign = 'center'; ctx.font = 'italic 76px Impact'; ctx.lineWidth = 7; ctx.strokeStyle = '#17282d'; ctx.strokeText(state.message, 480, 260); ctx.fillStyle = '#ffd23f'; ctx.fillText(state.message, 480, 260);
      ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#eff3e9'; ctx.fillText(state.phase === 'intro' ? 'GET READY' : state.winner === null ? 'EVENLY MATCHED' : fighterData(state.winner).name.toUpperCase() + ' TAKES THE ROUND', 480, 293);
    }
  }
  function frame(now) {
    const elapsed = Math.min(100, now - last); accumulator += elapsed; last = now;
    updateIntroduction(elapsed);
    while (accumulator >= 1000 / 60) {
      if (state && !introScene && !paused && selectedTab === 'arena') {
        const inputs = controls.map(map => { const input = {}; new Set([...keys, ...pendingKeys]).forEach(key => { if (map[key]) input[map[key]] = true; }); return input; }); Object.assign(inputs[0], touch);
        const previousPhase = state.phase, previousMoves = state.fighters.map(f => f.move), previousHealth = state.fighters.map(f => f.hp);
        E.tick(state, inputs);
        if (state.fighters.some((fighter, slot) => fighter.hp < previousHealth[slot] - 2)) impactFrames = 7;
        else if (impactFrames > 0) impactFrames--;
        if (previousPhase !== state.phase) {
          if (state.phase === 'fight') playSound('ann_fight', .7);
          if (state.phase === 'roundover') playSound('ann_ko', .7);
          if (state.phase === 'matchover') playSound('ann_victory', .7);
        }
        if (state.frame > 50) $('versus-overlay').hidden = true;
        state.fighters.forEach((f, slot) => {
          if (f.move && f.move !== previousMoves[slot] && ['punch','kick','special'].includes(f.move)) {
            playSound('sfx_' + f.move, .45);
            if (f.move === 'special') playSound('fighter_' + fighterData(slot).id + '_special', .75);
          }
        });
        if (state.effects.some(effect => effect.type === 'block' && effect.life === effect.maxLife)) playSound('sfx_block', .45);
        pendingKeys.clear();
        state.fighters.forEach((f, slot) => { if (f.move === 'special' && f.moveFrame === 1) cutin = { slot, life: 35 }; });
        if (cutin) cutin.life--;
        if (state.phase === 'matchover' && $('match-overlay').hidden) {
          const winner = state.fighters[0].wins > state.fighters[1].wins ? 0 : 1;
          $('match-overlay').hidden = false; $('pause-button').hidden = true;
          const heading = $('match-overlay').querySelector('h2'); heading.textContent = fighterData(winner).name.toUpperCase() + ' WINS';
          $('match-overlay').querySelector('p:not(.eyebrow)').textContent = `${state.fighters[0].wins} — ${state.fighters[1].wins} · The Yard has a champion.`;
          $('rematch-button').innerHTML = 'RUN IT BACK <span>→</span>'; $('match-status').textContent = 'Match complete. Play again or change your lineup.';
        }
      }
      accumulator -= 1000 / 60;
    }
    if (selectedTab === 'arena' && !$('fight-screen').hidden) render();
    requestAnimationFrame(frame);
  }
  async function init() {
    try {
      const response = await fetch('assets/manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Asset manifest unavailable');
      const data = await response.json();
      if (!data.fighters?.length || !data.stages?.length) throw new Error('Manifest needs fighters and stages');
      manifest = { ...fallback, ...data };
    } catch (error) { console.warn('Using prototype asset manifest:', error.message); }
    selected = [0, Math.min(1, manifest.fighters.length - 1)];
    document.title = manifest.title || fallback.title;
    const titleWords = document.title.split(' '), lastWord = titleWords.pop(); $('game-title').textContent = titleWords.join(' ').toUpperCase() + ' ';
    const emph = document.createElement('em'); emph.textContent = lastWord.toUpperCase(); $('game-title').append(emph);
    $('title-wordmark').textContent = titleWords.join(' ').toUpperCase() + ' ';
    $('title-wordmark').append(emph.cloneNode(true));
    $('saga-subtitle').textContent = manifest.subtitle || fallback.subtitle;
    manifest.fighters.forEach((f, i) => { $('fighter-one').append(makeOption(i, f.name)); $('fighter-two').append(makeOption(i, f.name)); }); $('fighter-two').value = selected[1];
    manifest.stages.forEach((s, i) => $('stage').append(makeOption(i, s.name)));
    galleryEntries = findEntries();
    const references = [...manifest.fighters.filter(f => !f.hero && !f.portrait), ...manifest.stages.filter(s => !s.src)].map(item => assetSource(item.sourceImage)).filter(Boolean);
    await Promise.all([...galleryEntries.filter(e => e.group !== 'audio').map(e => e.src), ...references].map(imageLoad));
    $('asset-count').textContent = galleryEntries.filter(e => e.group !== 'audio' && art(e.src)).length;
    setBackground($('selection-screen'), ui('select'));
    setBackground($('select-heading'), ui('title'));
    if (ui('logo')) { $('generated-logo').src = ui('logo').src; $('generated-logo').hidden = false; $('edition-stamp').hidden = true; }
    const titleArt = ui('title') || art(manifest.stages[0].src);
    if (titleArt) $('title-backdrop').style.backgroundImage = `url("${titleArt.src}")`;
    $('title-fighters').replaceChildren();
    manifest.fighters.forEach((fighter, index) => {
      const src = portraitSource(fighter, true); if (!src) return;
      const image = document.createElement('img'); image.src = src; image.alt = ''; image.style.setProperty('--fighter-index', index); image.style.setProperty('--fighter-aura', fighter.color || '#ffd23f');
      $('title-fighters').append(image);
    });
    refreshCards(); renderGallery(); setMusic('menu_music');
    $('title-start').disabled = false; $('title-load-status').textContent = 'PRESS ENTER OR TAP TO START';
    $('title-start').addEventListener('click', enterSaga); $('title-return').addEventListener('click', showTitle);
    $('intro-skip').addEventListener('click', finishIntroduction);
    $('fighter-one').addEventListener('change', event => { selected[0] = Number(event.target.value); reset(); });
    $('fighter-two').addEventListener('change', event => { selected[1] = Number(event.target.value); reset(); });
    $('stage').addEventListener('change', event => { stageIndex = Number(event.target.value); reset(); });
    $('mode').addEventListener('change', reset);
    document.querySelectorAll('[data-pick-slot]').forEach(button => button.addEventListener('click', () => { pickingSlot = Number(button.dataset.pickSlot); refreshCards(); }));
    $('audio-button').addEventListener('click', () => { audioInteracted = true; audioEnabled = !audioEnabled; refreshAudio(); });
    $('start-button').addEventListener('click', start); $('rematch-button').addEventListener('click', start);
    ['reset-button','back-select','result-select'].forEach(id => $(id).addEventListener('click', () => { reset(); $('fighter-grid').children[selected[pickingSlot]]?.focus({ preventScroll: true }); }));
    $('pause-button').addEventListener('click', () => pause()); $('resume-button').addEventListener('click', () => pause(false));
    $('lab-filter').addEventListener('change', renderGallery);
    document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
      selectedTab = button.dataset.tab; document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button));
      $('arena-view').hidden = selectedTab !== 'arena'; $('lab-view').hidden = selectedTab !== 'lab'; if (selectedTab === 'lab') pause(true);
    }));
    window.addEventListener('keydown', event => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      const interactiveTarget = !!event.target.closest('button, a, audio');
      if (selectedTab === 'arena' && introScene && !paused && !event.repeat && (event.code === 'Escape' || ['Enter', 'Space'].includes(event.code) && (!interactiveTarget || event.target.closest('#intro-skip')))) { event.preventDefault(); finishIntroduction(); return; }
      if (selectedTab === 'arena' && !$('title-screen').hidden && ['Enter', 'Space'].includes(event.code) && !event.repeat && !interactiveTarget) { event.preventDefault(); enterSaga(); return; }
      if (selectedTab === 'arena' && event.code === 'Escape' && !event.repeat) { event.preventDefault(); pause(); return; }
      if (controls.some(map => map[event.code]) && state && !introScene && selectedTab === 'arena') { event.preventDefault(); keys.add(event.code); if (!event.repeat) pendingKeys.add(event.code); }
    });
    window.addEventListener('keyup', event => keys.delete(event.code));
    window.addEventListener('blur', () => pause(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
    document.querySelectorAll('[data-control]').forEach(button => {
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touch[button.dataset.control] = true; });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, () => { delete touch[button.dataset.control]; }));
    });
    requestAnimationFrame(frame);
  }
  init();
})();
