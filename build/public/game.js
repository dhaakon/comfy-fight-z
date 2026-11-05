(() => {
  'use strict';
  const $ = id => document.getElementById(id), E = window.FighterEngine;
  // The arena canvas belongs to the renderer (WebGL when Pixi initializes); the HUD canvas on top is 2D.
  const canvas = $('arena'), images = new Map();
  const fallback = {
    title: 'Comfy Fighter Z',
    subtitle: 'Higgsfield Open Source Saga',
    fighters: ['griddle', 'rivet', 'tempo', 'nimbus', 'switchback', 'brick'].map((id, i) => ({ id, name: id[0].toUpperCase() + id.slice(1), color: ['#ff8b3d','#58c7ff','#f46bc4','#b99cff','#ffd44d','#ff6677'][i], poses: {} })),
    stages: [{ id: 'yard', name: 'The Yard' }], ui: {}, effects: {}, audio: {}
  };
  let manifest = fallback, state = null, paused = false, last = performance.now(), accumulator = 0;
  let selected = [0, 1], stageIndex = 0, galleryEntries = [], cutin = null, selectedTab = 'arena', pickingSlot = 0;
  let audioEnabled = false, audioInteracted = false, music = null, musicId = null;
  let introScene = null, introVoice = null;
  let openingActive = false, openingStarted = false, network = null;
  let networkRole = null, networkSide = null, networkMatchId = null;
  const fighterRenderer = window.FighterAnim?.createRenderer();
  // Motion is never reduced: the videos, auras and entrances are the product. (System preference ignored on purpose.)
  const reducedMotion = { matches: false };
  const fallbackTaglines = {
    griddle: 'The grill is hot. Your winning streak is toast.', rivet: 'I fix everything. Your stance is next.', tempo: 'Keep up with the beat, or take a seat.',
    nimbus: 'I raised a garden. I can handle a little thunder.', switchback: 'School run complete. Express knockout incoming.', brick: 'I built this block. Now hold your ground.'
  };
  const activeSounds = new Set();
  const keys = new Set(), pendingKeys = new Set(), touch = {};
  // Options and high scores persist per browser; the game works when storage is unavailable.
  const storage = {
    get(key, fallbackValue) { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallbackValue; } catch (_) { return fallbackValue; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Private windows may block storage. */ } }
  };
  const OPTIONS_KEY = 'cfz-options-v1', SCORES_KEY = 'cfz-hiscores-v1';
  const DEFAULT_OPTIONS = { debug: 'off', difficulty: 4, rounds: 2, time: 99, display: 'clean', music: 60, sfx: 80, voice: 90 };
  const options = { ...DEFAULT_OPTIONS, ...storage.get(OPTIONS_KEY, {}) };
  // Modes: arcade ladder (default single player), local versus, training, network sessions and attract demo.
  let mode = 'arcade', arcade = null, overlay = null, demo = null, idleTime = 0, goFrames = 0, lastIntroCall = null, continueTimer = null;
  const training = { action: 'stand', guard: 'none', meter: 'infinite', boxes: false, inputs: true, frames: true, history: [], frameData: null, watch: null, lastHit: -999 };
  const padHistory = [];
  const STYLE_LABELS = { balanced: 'BALANCED', power: 'POWER', speed: 'SPEED', zoner: 'ZONER', grappler: 'GRAPPLER', trickster: 'TRICKSTER', boss: 'FINAL BOSS' };
  // Read-only snapshot for move tuning and automated browser checks.
  // ?debug adds local-only test hooks; network matches stay server-authoritative.
  const debugHooks = /[?&]debug(?:=1)?(?:&|$)/.test(location.search) ? {
    setHealth: (slot, hp) => { if (state && !network?.active) state.fighters[slot].hp = hp; },
    setMeter: (slot, stocks) => { if (state && !network?.active) state.fighters[slot].stocks = stocks; },
    skipOverlay: () => overlay?.next?.()
  } : {};
  window.FighterDebug = Object.freeze({
    ...debugHooks,
    snapshot: () => state ? JSON.parse(JSON.stringify(state)) : null,
    renderer: () => arena.kind, pixel: (x, y) => arena.pixel(x, y), rendererStats: () => arena.stats(), reducedMotion: () => reducedMotion.matches,
    presentation: () => ({ screen: openingActive ? 'opening' : selectedTab === 'lab' ? 'lab' : !$('title-screen').hidden ? 'title' : introScene ? 'intro' : !$('selection-screen').hidden ? 'selection' : 'fight', titleMedia: $('title-screen').classList.contains('title-video-ready') ? 'video' : 'image', introSlot: introScene ? 0 : null, introMedia: introMedia(), introHalves: introScene?.halves.map(half => half.media) || null, controls: 'arrows-asdf', mode, overlay: overlay?.type || null, arcade: arcade ? { index: arcade.index, ladder: arcade.ladder.map(i => manifest.fighters[i].id), score: arcade.score, continues: arcade.continues } : null, gamepads: gamepads().length, humanPlayers: network?.active && !state?.cpu || mode === 'versus' && state && !state.cpu ? 2 : 1, stageId: manifest.stages[stageIndex]?.id, network: network?.active ? { role: networkRole, side: networkSide, matchId: networkMatchId, phase: network.room.phase, connected: network.client.ready, paused: !!network.room.paused } : null })
  });
  const controls = [
    { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'down', KeyA: 'punch', KeyS: 'kick', KeyD: 'heavy', KeyF: 'special', KeyG: 'taunt' }, {}
  ];
  // Standard gamepad layout: face buttons in the Neo Geo A/B/C/D spirit, shoulders for system moves.
  const PAD_BUTTONS = { 2: 'punch', 0: 'kick', 3: 'heavy', 1: 'special', 6: 'taunt' };
  const PAD_COMBOS = { 4: ['punch', 'kick'], 5: ['kick', 'heavy'], 7: ['special', 'heavy'] };
  const gamepads = () => Array.from(navigator.getGamepads?.() || []).filter(Boolean);
  function padInput(pad) {
    const input = {}; if (!pad) return input;
    const pressed = index => !!(pad.buttons[index]?.pressed || pad.buttons[index]?.value > .5);
    for (const [index, action] of Object.entries(PAD_BUTTONS)) if (pressed(+index)) input[action] = true;
    for (const [index, actions] of Object.entries(PAD_COMBOS)) if (pressed(+index)) actions.forEach(action => { input[action] = true; });
    const [x = 0, y = 0] = pad.axes || [];
    if (pressed(14) || x < -.5) input.left = true; if (pressed(15) || x > .5) input.right = true;
    if (pressed(12) || y < -.5) input.jump = true; if (pressed(13) || y > .5) input.down = true;
    return input;
  }
  // Versus gives player two the second pad, or the only pad when player one uses the keyboard.
  function padFor(slot) {
    const list = gamepads();
    if (mode === 'versus') return slot ? (list.length >= 2 ? list[1] : list[0]) : (list.length >= 2 ? list[0] : null);
    return slot ? null : list[0];
  }
  const profiles = () => Object.fromEntries(manifest.fighters.map(f => [f.id, { style: f.style, boss: f.boss === true, reaches: E.artReaches(f.poses) }]));
  const audioId = (...ids) => ids.find(id => id && manifest.audio?.[id]);
  function setScene(scene) {
    document.body.dataset.scene = scene;
    document.querySelectorAll('.card-motion').forEach(clip => { if (scene === 'selection') clip.play().catch(() => {}); else clip.pause(); });
  }
  function art(src) { return typeof src === 'string' ? images.get(src) : null; }
  function assetSource(value) { return typeof value === 'string' ? value : value?.src; }
  const menuMotionWanted = screenId => !openingActive && selectedTab === 'arena' && !$(screenId).hidden && !document.hidden && !reducedMotion.matches && !$('settings-dialog').open && !network?.dialog?.open;
  const titleMotionWanted = () => menuMotionWanted('title-screen');
  // A silent looping video plate behind a menu screen. The still artwork stays underneath as the fallback
  // and comes back whenever the clip stalls, fails, or motion is not wanted.
  function createMotionPlate(videoId, screenId, key, wanted) {
    const video = $(videoId), screen = $(screenId), readyClass = `${videoId}-ready`;
    let failed = false, pending = false, attempt = 0, timer = null;
    const stop = () => { attempt++; pending = false; clearTimeout(timer); timer = null; video.pause(); video.hidden = true; screen.classList.remove(readyClass); };
    const fail = () => { failed = true; stop(); };
    const watch = () => { clearTimeout(timer); const current = attempt; timer = setTimeout(() => { if (current === attempt && wanted() && !screen.classList.contains(readyClass)) fail(); }, 4000); };
    video.addEventListener('playing', () => { if (wanted()) { clearTimeout(timer); timer = null; screen.classList.add(readyClass); } else stop(); });
    video.addEventListener('error', () => { if (wanted()) fail(); });
    video.addEventListener('waiting', () => { if (wanted()) watch(); });
    function sync() {
      const src = assetSource(manifest[key]);
      if (!wanted()) { if (!video.paused || !video.hidden || pending) stop(); return; }
      if (failed || !src || !/^assets\/video\/[A-Za-z0-9_-]+\.mp4$/.test(src) || !video.canPlayType('video/mp4')) return;
      if (!video.hasAttribute('src')) { video.muted = true; video.playsInline = true; video.loop = true; video.src = src; }
      if (pending || !video.paused) return;
      video.hidden = false; pending = true; ++attempt; watch();
      const current = attempt;
      video.play().then(() => { if (current === attempt) pending = false; }).catch(() => { if (current === attempt && wanted()) fail(); });
    }
    return { sync, stop };
  }
  const titleMotion = createMotionPlate('title-video', 'title-screen', 'titleVideo', titleMotionWanted);
  const selectMotion = createMotionPlate('select-video', 'selection-screen', 'selectVideo', () => menuMotionWanted('selection-screen'));
  function ui(name) { return art(assetSource(manifest.ui?.[name])); }
  function fighterData(slot) { return manifest.fighters[selected[slot]]; }
  function portraitSource(f, hero = false) { return [hero && f.hero, f.portrait, f.hero, f.sourceImage].map(assetSource).find(src => art(src)); }
  function generatedPortrait(f) { return !![f.hero, f.portrait].map(assetSource).find(src => art(src)); }
  function finishOpening() {
    if (!openingActive) return;
    openingActive = false; $('opening-video').pause(); $('opening-screen').hidden = true; $('opening-gate').hidden = true;
    setScene('title'); $('title-screen').hidden = false; setMusic('menu_music'); refreshAudio(); $('title-start').focus({ preventScroll: true });
  }
  async function playOpening(withSound = false) {
    const entry = manifest.openingVideo, src = assetSource(entry); if (typeof src !== 'string' || !/^assets\/video\/[A-Za-z0-9_-]+\.mp4$/.test(src)) return;
    clearIntro(); state = null; paused = false; openingActive = true; setScene('opening');
    $('title-screen').hidden = true; $('selection-screen').hidden = true; $('fight-screen').hidden = true;
    $('controls-panel').hidden = true; $('touch-panel').hidden = true; $('opening-screen').hidden = false; $('opening-gate').hidden = true;
    music?.pause(); activeSounds.forEach(sound => sound.pause()); activeSounds.clear();
    const video = $('opening-video'); if (!openingStarted) { video.src = src; openingStarted = true; }
    const silent = entry?.hasAudio === false;
    $('opening-sound').hidden = silent; $('opening-play').textContent = silent ? 'PLAY OPENING' : 'PLAY OPENING WITH SOUND';
    video.currentTime = 0; video.muted = silent || !withSound; $('opening-sound').textContent = withSound ? 'SOUND ON' : 'ENABLE SOUND';
    if (withSound && !silent) { audioEnabled = true; audioInteracted = true; }
    try { await video.play(); if (openingActive) $('opening-skip').focus({ preventScroll: true }); }
    catch (_) { if (openingActive) { $('opening-gate').hidden = false; $('opening-play').focus({ preventScroll: true }); } }
  }
  // Separate music, effects and voice buses; voices duck the music while they speak.
  const musicLevel = () => .35 * options.music / 100;
  let ducks = 0;
  function playSound(id, volume = .6) {
    const src = assetSource(manifest.audio?.[id]); if (!audioEnabled || !src) return;
    const bus = id.startsWith('sfx_') ? 'sfx' : 'voice', level = volume * options[bus] / 100;
    if (level <= 0) return;
    const sound = new Audio(src); sound.volume = Math.min(1, level); activeSounds.add(sound);
    if (bus === 'voice' && music) { ducks++; music.volume = musicLevel() * .45; }
    const done = () => {
      if (!activeSounds.delete(sound)) return;
      if (bus === 'voice' && --ducks <= 0) { ducks = 0; if (music && !introScene) music.volume = musicLevel(); }
    };
    sound.addEventListener('ended', done, { once: true }); sound.addEventListener('error', done, { once: true });
    sound.play().catch(done);
    return sound;
  }
  function setMusic(id) {
    if (musicId === id && music) { if (audioEnabled && !paused) music.play().catch(() => {}); return; }
    music?.pause(); music = null; musicId = id;
    const entry = manifest.audio?.[id], src = assetSource(entry); if (!src) return;
    music = new Audio(src); music.loop = entry?.loop !== false; music.volume = musicLevel();
    if (audioEnabled && !paused) music.play().catch(() => {});
  }
  // Scene music picks the generated track for each moment, falling back to older bundles' tracks.
  function sceneMusic(scene) {
    const stage = manifest.stages[stageIndex], boss = state && fighterData(1)?.boss && mode === 'arcade';
    const choices = { title: ['menu_music'], select: ['select_music', 'menu_music'], fight: [boss && 'boss_music', `${stage?.id}_music`, 'yard_music', 'menu_music'],
      victory: ['victory_music'], continue: ['continue_music', 'select_music'], gameover: ['gameover_music'], ending: ['ending_music', 'menu_music'] }[scene] || ['menu_music'];
    const id = audioId(...choices);
    if (id) setMusic(id); else if (scene !== 'victory' && scene !== 'gameover') { music?.pause(); music = null; musicId = null; }
  }
  function refreshAudio() {
    $('audio-button').textContent = audioEnabled ? 'SOUND ON' : 'SOUND OFF'; $('audio-button').setAttribute('aria-pressed', String(audioEnabled));
    if (openingActive) { music?.pause(); $('opening-video').muted = manifest.openingVideo?.hasAudio === false || !audioEnabled; return; }
    if (!audioEnabled) { music?.pause(); introVoice?.pause(); activeSounds.forEach(sound => sound.pause()); activeSounds.clear(); }
    else if (!paused) {
      music?.play().catch(() => {});
      if (introScene && introMedia() !== 'loading') {
        // Resume the voice that should be speaking at this point of the scene.
        const line = currentVoiceLine();
        if (line && !introVoice) { introVoice = playSound(line.id, .85); introScene.spoken = line; }
        if (line && introVoice) {
          const voice = introVoice;
          try { voice.currentTime = (introScene.elapsed - line.start) / 1000; } catch (_) { /* A stream may not be seekable yet. */ }
          activeSounds.add(voice); voice.play().catch(() => activeSounds.delete(voice));
        }
      }
    }
  }
  function engageAudio() { if (!audioInteracted) { audioEnabled = true; audioInteracted = true; refreshAudio(); } }
  const introHalves = () => [...$('intro-screen').querySelectorAll('.intro-half')];
  const introVideo = slot => $(slot ? 'intro-video-2' : 'intro-video');
  function clearIntroVideo(slot) {
    const video = introVideo(slot);
    video.onplaying = video.onerror = video.onended = null;
    video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
    introHalves()[slot].classList.remove('has-video');
  }
  function clearIntro() {
    introVoice?.pause(); if (introVoice) activeSounds.delete(introVoice);
    clearIntroVideo(0); clearIntroVideo(1);
    introVoice = null; introScene = null; $('intro-screen').hidden = true;
    if (music) music.volume = musicLevel();
  }
  // Combined media state of both halves: loading until every clip has decided, video if any clip plays.
  function introMedia() {
    if (!introScene) return null;
    const media = introScene.halves.map(half => half.media);
    return media.includes('loading') ? 'loading' : media.includes('video') ? 'video' : 'sprite';
  }
  // Voice lines play one after the other; the scene timeline says whose turn it is.
  function currentVoiceLine() {
    if (!introScene) return null;
    return introScene.voices.find(line => introScene.elapsed >= line.start && introScene.elapsed < line.end) || null;
  }
  // The final boss waits at the end of Arcade mode; other modes may pick them.
  const selectable = index => !(mode === 'arcade' && manifest.fighters[index]?.boss);
  function firstSelectable(from = 0, step = 1) {
    for (let i = 0, index = from; i < manifest.fighters.length; i++, index = (index + step + manifest.fighters.length) % manifest.fighters.length) if (selectable(index)) return index;
    return 0;
  }
  function enterSaga(next = 'arcade') {
    if ($('title-start').disabled) return;
    if (network?.active) network.leave();
    endDemo(false);
    mode = typeof next === 'string' ? next : 'arcade'; arcade = null; pickingSlot = 0;
    if (!selectable(selected[0])) selected[0] = firstSelectable();
    if (mode === 'arcade' && selected[1] === selected[0]) selected[1] = firstSelectable(selected[0] + 1);
    setScene('selection');
    engageAudio(); $('title-screen').hidden = true; $('selection-screen').hidden = false; $('fight-screen').hidden = true;
    $('controls-panel').hidden = true; $('touch-panel').hidden = true; sceneMusic('select'); playSound('ann_select', .8);
    refreshCards();
    $('fighter-grid').querySelector('button')?.focus();
  }
  function showTitle() {
    endDemo(false); closeOverlay(); arcade = null;
    reset(); $('selection-screen').hidden = true; $('title-screen').hidden = false;
    setScene('title'); sceneMusic('title'); idleTime = 0; refreshHiScore();
    $('controls-panel').hidden = true; $('touch-panel').hidden = true;
    $('title-start').focus();
  }
  function refreshHiScore() {
    const best = storage.get(SCORES_KEY, [])[0];
    $('title-hiscore').hidden = !best; if (best) $('title-hiscore').textContent = `HI-SCORE ${String(best.score).padStart(8, '0')} · ${best.name}`;
  }
  // Attract mode: after a quiet minute on the title, two CPUs play a short demo round.
  function startDemo() {
    if (state || network?.active || openingActive || $('title-screen').hidden || selectedTab !== 'arena') return;
    const pool = manifest.fighters.map((_, index) => index).filter(index => !manifest.fighters[index].boss);
    if (pool.length < 2) return;
    const a = pool[Math.floor(Math.random() * pool.length)], others = pool.filter(index => index !== a), b = others[Math.floor(Math.random() * others.length)];
    selected = [a, b]; stageIndex = Math.floor(Math.random() * manifest.stages.length); mode = 'demo';
    demo = { started: performance.now() };
    beginMatch(E.create([manifest.fighters[a].id, manifest.fighters[b].id], { cpuSlots: [true, true], cpuLevel: 6, roundsToWin: 1, roundTime: 60, profiles: profiles(), seed: Date.now() % 2 ** 31 }), 'DEMO PLAY', { intros: false });
    $('demo-label').hidden = false;
  }
  function endDemo(returnToTitle = true) {
    if (!demo) return;
    demo = null; $('demo-label').hidden = true; mode = 'arcade';
    if (returnToTitle) showTitle();
  }
  function closeOverlay() {
    clearInterval(continueTimer); continueTimer = null;
    for (const id of ['vs-screen', 'win-screen', 'continue-screen', 'gameover-screen', 'ending-screen', 'name-entry', 'movelist-overlay', 'training-panel']) $(id).hidden = true;
    $('staff-roll').hidden = true;
    overlay = null;
  }
  // Both fighters are introduced at once on a split screen. Each half plays that fighter's clip,
  // or the sprite entrance when no clip is mapped or it fails. Combat stays frozen until it ends.
  function showIntroduction(speakers = 'both') {
    introVoice?.pause(); if (introVoice) activeSounds.delete(introVoice);
    introVoice = null;
    const panel = $('intro-screen'); panel.hidden = false;
    panel.classList.remove('arriving'); void panel.offsetWidth; panel.classList.add('arriving');
    const scene = { elapsed: 0, duration: 0, halves: [], voices: [], spoken: null };
    let voiceStart = 0;
    [0, 1].forEach(slot => {
      clearIntroVideo(slot);
      const fighter = fighterData(slot), voiceId = 'fighter_' + fighter.id + '_intro', half = introHalves()[slot];
      const voiceDuration = Number(manifest.audio?.[voiceId]?.duration) || 2.8;
      const speaks = speakers === 'both' || (speakers === 'challenger' ? slot === 1 : slot === 0);
      if (speaks) { scene.voices.push({ id: voiceId, start: voiceStart, end: voiceStart + voiceDuration * 1000 }); voiceStart += voiceDuration * 1000 + 250; }
      half.classList.toggle('long-name', fighter.name.length > 14);
      half.style.setProperty('--intro-accent', fighter.color || (slot ? '#7894a5' : '#c4a25e'));
      $(slot ? 'intro-name-2' : 'intro-name').textContent = fighter.name;
      $(slot ? 'intro-special-2' : 'intro-special').textContent = fighter.specialMove?.name || 'A NEW CHALLENGER';
      $(slot ? 'intro-tagline-2' : 'intro-tagline').textContent = '“' + (fighter.introTagline || fallbackTaglines[fighter.id] || 'This fight is mine.') + '”';
      $(slot ? 'intro-slot-2' : 'intro-slot').textContent = slot ? (state.cpu ? 'THE CHALLENGER ANSWERS' : 'PLAYER TWO ENTERS') : 'PLAYER ONE ENTERS';
      const stage = $(slot ? 'intro-portrait-2' : 'intro-portrait'), src = portraitSource(fighter, true); stage.replaceChildren();
      if (fighterRenderer && art(fighter.poses?.idle?.src)) { const actor = document.createElement('canvas'); actor.className = 'intro-actor'; if (!slot) actor.id = 'intro-actor'; actor.width = 600; actor.height = 600; actor.setAttribute('aria-label', fighter.name + ' entrance animation'); stage.append(actor); }
      else if (src) { const img = document.createElement('img'); img.src = src; img.alt = fighter.name; stage.append(img); }
      else { const emblem = document.createElement('span'); emblem.textContent = fighter.name.slice(0, 1); stage.append(emblem); }
      const entry = { slot, media: 'sprite', loadElapsed: 0, stallElapsed: 0, actor: { ...state.fighters[slot], x: 300, y: 0, facing: slot ? -1 : 1 } };
      scene.halves.push(entry);
      const clip = fighter.introVideo, videoSrc = assetSource(clip), video = introVideo(slot);
      // Intro media is a local exported asset, never an arbitrary remote URL.
      const safeClip = typeof videoSrc === 'string' && /^assets\/video\/[A-Za-z0-9_-]+\.mp4$/.test(videoSrc) && video.canPlayType('video/mp4');
      if (!safeClip) return;
      entry.media = 'loading';
      entry.clipDuration = Math.max(1000, Math.min(12000, (Number(clip.duration) || 8) * 1000));
      const useFallback = () => {
        if (introScene !== scene || entry.media === 'sprite') return;
        clearIntroVideo(slot); entry.media = 'sprite';
      };
      video.onplaying = () => {
        if (introScene !== scene) return;
        if (paused || selectedTab !== 'arena') { video.pause(); return; }
        entry.media = 'video'; video.hidden = false; half.classList.add('has-video');
      };
      video.onerror = useFallback;
      video.muted = true; video.playsInline = true; video.loop = true; video.src = videoSrc;
      video.play().catch(useFallback);
    });
    // The scene lasts for the longer clip or the last voice line, whichever is later; clips loop meanwhile.
    const voiced = Math.max(2800, Math.min(9000, (scene.voices[scene.voices.length - 1]?.end || 0) + 300));
    scene.duration = Math.max(voiced, ...scene.halves.map(half => half.clipDuration || 0));
    introScene = scene;
    setScene('intro');
    if (music) music.volume = musicLevel() * .3;
    // Sprite-only scenes speak at once; clips start the voice when they begin playing.
    const first = currentVoiceLine();
    if (first && introMedia() !== 'loading') { introVoice = playSound(first.id, .85); scene.spoken = first; }
    panel.querySelectorAll('.intro-progress span').forEach(mark => mark.classList.add('active'));
  }
  function finishIntroduction(skip = true) {
    if (!introScene) return;
    clearIntro(); keys.clear(); pendingKeys.clear(); Object.keys(touch).forEach(key => delete touch[key]); accumulator = 0;
    setScene('fight');
    $('versus-overlay').hidden = false; $('pause-button').hidden = !!network?.active; $('touch-panel').hidden = network?.active && networkRole === 'projection';
    if (network?.active) network.introDone(!!skip);
    canvas.focus();
  }
  function updateIntroduction(milliseconds) {
    if (!introScene) return;
    if (paused || selectedTab !== 'arena') { [0, 1].forEach(slot => { const video = introVideo(slot); if (!video.paused) video.pause(); }); return; }
    const scene = introScene;
    let waiting = false;
    for (const half of scene.halves) {
      const video = introVideo(half.slot);
      if (half.media === 'loading') {
        half.loadElapsed += milliseconds;
        if (half.loadElapsed >= 3000) video.onerror?.();
        else if (video.paused && !video.error) video.play().catch(() => { if (introScene === scene) video.onerror?.(); });
        waiting = true;
      } else if (half.media === 'video') {
        if (video.paused) video.play().catch(() => { if (introScene === scene) video.onerror?.(); });
        if (video.readyState < 2 || video.seeking) {
          half.stallElapsed += milliseconds;
          if (half.stallElapsed >= 3000) video.onerror?.();
          waiting = true;
        } else half.stallElapsed = 0;
      }
    }
    if (introScene !== scene || waiting) return;
    scene.elapsed += milliseconds;
    // Voices take turns: start the next line when the timeline reaches it.
    const line = currentVoiceLine();
    if (line && line !== scene.spoken) { introVoice?.pause(); if (introVoice) activeSounds.delete(introVoice); introVoice = playSound(line.id, .85); scene.spoken = line; }
    for (const half of scene.halves) {
      const actor = $(half.slot ? 'intro-portrait-2' : 'intro-portrait').querySelector('canvas');
      if (!actor) continue;
      const introContext = actor.getContext('2d'); introContext.clearRect(0, 0, 600, 600);
      fighterRenderer.draw(introContext, half.actor, fighterData(half.slot), art, state, { ground: 575, height: 480, reducedMotion: reducedMotion.matches, introFrame: scene.elapsed * .06 });
    }
    if (scene.elapsed >= scene.duration) finishIntroduction(false);
  }
  function chooseFighter(index) {
    selected[pickingSlot] = index; $(pickingSlot ? 'fighter-two' : 'fighter-one').value = index;
    engageAudio(); refreshCards();
    $('fighter-grid').querySelector(`[data-index="${index}"]`)?.focus({ preventScroll: true });
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
      ['portrait', 'hero', 'cutin', 'endingArt'].forEach(kind => { if (f[kind]) entries.push({ group: 'portraits', name: `${f.name} / ${kind}`, src: assetSource(f[kind]), info: 'Character artwork' }); });
    });
    manifest.stages.forEach(s => { if (s.src) entries.push({ group: 'stages', name: s.name, src: s.src, info: 'Stage background' }); });
    Object.entries(manifest.ui || {}).forEach(([name, src]) => entries.push({ group: 'ui', name, src: assetSource(src), info: 'Interface artwork' }));
    Object.entries(manifest.effects || {}).forEach(([name, meta]) => entries.push({ group: 'effects', name, src: assetSource(meta), info: 'Combat effect' }));
    Object.entries(manifest.audio || {}).forEach(([name, item]) => entries.push({ group: 'audio', name: name.replaceAll('_', ' '), src: assetSource(item), info: item.category || 'Generated audio' }));
    // Generated clips: the menu loop, an optional opening and each fighter's introduction.
    const clip = (name, video, info) => { if (assetSource(video)) entries.push({ group: 'video', name, src: assetSource(video), info: `${info} · ${Math.round(video.duration || 0)} s` }); };
    clip('Menu loop', manifest.titleVideo, 'Title and menu animation'); clip('Select loop', manifest.selectVideo, 'Character-select animation'); clip('Opening', manifest.openingVideo, 'Startup film');
    manifest.fighters.forEach(f => { clip(`${f.name} / introduction`, f.introVideo, 'Fight introduction'); clip(`${f.name} / select idle`, f.selectVideo, 'Select-screen idle loop'); });
    return entries;
  }
  function setBackground(element, image) {
    if (image) { element.style.backgroundImage = `linear-gradient(90deg,#111b1bd9,#111b1b80), url("${image.src}")`; element.style.backgroundSize = 'cover'; }
  }
  function refreshCards() {
    $('fighter-cards').replaceChildren();
    const opponentLabel = mode === 'versus' ? '2P' : mode === 'training' ? 'DUMMY' : 'CPU';
    const pickSlots = document.querySelectorAll('[data-pick-slot]');
    pickSlots[1].textContent = opponentLabel; pickSlots[1].hidden = mode === 'arcade';
    if (mode === 'arcade') pickingSlot = 0;
    $('stage-cycle').hidden = mode === 'arcade' || manifest.stages.length < 2;
    $('start-button').firstChild.textContent = mode === 'arcade' ? 'START ARCADE ' : mode === 'training' ? 'START TRAINING ' : "LET'S FIGHT ";
    if (mode === 'versus') {
      const pads = gamepads().length;
      $('device-status').hidden = false;
      $('device-status').textContent = pads >= 2 ? 'TWO GAMEPADS CONNECTED · 1P PAD 1 + KEYBOARD · 2P PAD 2' : pads === 1 ? '1P KEYBOARD · 2P GAMEPAD' : 'CONNECT A GAMEPAD FOR PLAYER TWO · WITHOUT ONE, 2P IS THE CPU';
    } else $('device-status').hidden = true;
    selected.forEach((index, slot) => {
      const f = manifest.fighters[index], card = document.createElement('article');
      card.className = 'fighter-card'; card.style.setProperty('--accent', f.color || (slot ? '#7894a5' : '#c4a25e'));
      const frame = document.createElement('div'); frame.className = 'fighter-art';
      const source = portraitSource(f, true), generated = generatedPortrait(f);
      if (source) { const img = document.createElement('img'); img.src = source; img.alt = f.name; img.classList.toggle('reference', !generated); frame.append(img); }
      // The fighter's generated idle stance plays on the card: start to finish, a beat of stillness, then again.
      // Without an idle loop the introduction clip stands in, darkened behind the hero art.
      const idle = assetSource(f.selectVideo), motion = idle || assetSource(f.introVideo);
      if (generated && typeof motion === 'string' && /^assets\/video\/[A-Za-z0-9_-]+\.mp4$/.test(motion)) {
        const clip = document.createElement('video'); clip.className = idle ? 'card-motion card-idle' : 'card-motion'; clip.muted = true; clip.playsInline = true; clip.autoplay = true; clip.preload = 'auto';
        clip.setAttribute('aria-hidden', 'true'); clip.onerror = () => clip.remove();
        if (idle) { clip.playbackRate = 1.25; clip.loop = false; clip.onended = () => setTimeout(() => { if (clip.isConnected && !$('selection-screen').hidden) { clip.currentTime = 0; clip.play().catch(() => {}); } }, 400); }
        else clip.loop = true;
        clip.src = motion; frame.append(clip);
      }
      else { const placeholder = document.createElement('div'); placeholder.className = 'fallback-portrait'; placeholder.textContent = String(index + 1).padStart(2, '0'); frame.append(placeholder); }
      const plate = document.createElement('div'); plate.className = 'fighter-nameplate';
      const tag = document.createElement('span'); tag.className = 'mini-tag'; tag.textContent = slot ? `${mode === 'versus' ? '2P' : mode === 'training' ? 'DUMMY' : 'CPU'} / ${STYLE_LABELS[f.style] || 'CHALLENGER'}` : `1P / ${STYLE_LABELS[f.style] || 'YOUR FIGHTER'}`;
      const title = document.createElement('h3'); title.textContent = f.name.toUpperCase();
      const artType = document.createElement('span'); artType.className = 'art-type'; artType.textContent = generated ? 'CHARACTER ART' : source ? 'SOURCE REFERENCE / ANIME ART PENDING' : 'CHARACTER ART PENDING';
      plate.append(tag, title, artType); frame.append(plate);
      const body = document.createElement('div'); body.className = 'fighter-card-body';
      const bio = document.createElement('p'); bio.className = 'fighter-bio'; bio.textContent = f.description ? f.description.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') : 'An original challenger enters the arena.';
      const label = document.createElement('p'); label.className = 'move-title'; label.textContent = 'SPECIAL ↓↘→ · SUPER F+D';
      const move = document.createElement('strong'); move.className = 'move-name'; move.textContent = f.superMove?.name ? `${f.specialMove?.name || 'Energy Break'} · ${f.superMove.name}` : f.specialMove?.name || 'Energy Break';
      const detail = document.createElement('p'); detail.className = 'move-description'; detail.textContent = f.specialMove?.description ? f.specialMove.description.split(/(?<=[.!?])\s+/)[0] : 'Launch an energy attack. Costs 30 meter.';
      body.append(bio, label, move, detail); card.append(frame, body);
      // Arcade hides the ladder: the opponent card previews the road to the final boss.
      if (slot && mode === 'arcade') {
        card.replaceChildren(); card.classList.add('mystery-card');
        const mysteryFrame = document.createElement('div'); mysteryFrame.className = 'fighter-art';
        const mark = document.createElement('div'); mark.className = 'fallback-portrait'; mark.textContent = '?'; mysteryFrame.append(mark);
        const mysteryPlate = document.createElement('div'); mysteryPlate.className = 'fighter-nameplate';
        const mysteryTag = document.createElement('span'); mysteryTag.className = 'mini-tag'; mysteryTag.textContent = 'ARCADE LADDER';
        const heading = document.createElement('h3'); heading.textContent = 'CHALLENGERS AWAIT';
        mysteryPlate.append(mysteryTag, heading); mysteryFrame.append(mysteryPlate);
        const mysteryBody = document.createElement('div'); mysteryBody.className = 'fighter-card-body';
        const rivals = manifest.fighters.filter((item, i) => !item.boss && i !== selected[0]).length, boss = manifest.fighters.find(item => item.boss);
        const line = document.createElement('p'); line.className = 'fighter-bio'; line.textContent = `${rivals} rivals across ${manifest.stages.length} arena${manifest.stages.length === 1 ? '' : 's'}${boss ? ', then the final boss.' : '.'} Continue after a loss.`;
        mysteryBody.append(line); card.append(mysteryFrame, mysteryBody);
      }
      $('fighter-cards').append(card);
    });
    $('fighter-grid').replaceChildren();
    manifest.fighters.forEach((f, index) => {
      if (!selectable(index)) return;
      const tile = document.createElement('button'); tile.className = 'fighter-tile'; tile.dataset.fighter = f.id; tile.dataset.index = String(index); tile.classList.toggle('long-name', f.name.length > 14); tile.classList.toggle('boss-tile', !!f.boss);
      tile.style.setProperty('--accent', f.color || '#7a5cff'); tile.style.setProperty('--name-chars', String(Math.max(7, f.name.length))); tile.setAttribute('aria-label', (pickingSlot ? `Choose ${mode === 'versus' ? 'player two' : mode === 'training' ? 'training dummy' : 'CPU opponent'} ` : 'Play as ') + f.name);
      tile.classList.toggle('picked-one', selected[0] === index); tile.classList.toggle('picked-two', selected[1] === index && mode !== 'arcade');
      tile.setAttribute('aria-pressed', String(selected[pickingSlot] === index));
      const src = portraitSource(f);
      if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; tile.append(img); }
      else { const number = document.createElement('span'); number.className = 'tile-number'; number.textContent = String(index + 1).padStart(2, '0'); tile.append(number); }
      const name = document.createElement('span'); name.className = 'tile-name'; name.textContent = f.name; tile.append(name);
      selected.forEach((picked, slot) => { if (picked === index && !(slot && mode === 'arcade')) { const badge = document.createElement('span'); badge.className = 'pick-badge' + (slot ? ' two' : ''); badge.textContent = slot ? opponentLabel : '1P'; tile.append(badge); } });
      tile.addEventListener('click', () => chooseFighter(index)); $('fighter-grid').append(tile);
    });
    document.querySelectorAll('[data-pick-slot]').forEach(button => { const active = Number(button.dataset.pickSlot) === pickingSlot; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('pick-hint').textContent = 'ARROWS TO CHOOSE · ENTER TO FIGHT';
    $('roster-count').textContent = manifest.fighters.filter((_, index) => selectable(index)).length;
    const stage = manifest.stages[stageIndex], background = art(stage.src) || art(assetSource(stage.sourceImage));
    $('stage-label').textContent = stage.name.toUpperCase(); $('stage-name').textContent = stage.name.toUpperCase(); $('stage-cycle-name').textContent = stage.name.toUpperCase();
    $('fight-stage-label').textContent = `${manifest.title} / ${stage.name}`.toUpperCase();
    $('result-stage-label').textContent = `${stage.name} HAS A CHAMPION`.toUpperCase();
    $('title-stage-label').textContent = manifest.stages.length > 1 ? `${manifest.stages.length} ENVIRONMENTS / CHOOSE YOUR ARENA` : stage.name.toUpperCase();
    const numberWord = count => ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'][count] || String(count);
    const arenaCount = `${numberWord(manifest.stages.length)} ${manifest.stages.length === 1 ? 'ARENA' : 'ARENAS'}`;
    const stageSummary = manifest.stages.length === 1 && stage.id === 'yard' && stage.name === 'The Yard' ? 'ONE YARD' : arenaCount;
    $('title-roster-summary').textContent = `${window.CFZ_CONFIG?.multiplayer ? 'LOCAL / ONLINE' : 'SINGLE PLAYER'} · ${numberWord(manifest.fighters.length)} ${manifest.fighters.length === 1 ? 'FIGHTER' : 'FIGHTERS'} · ${stageSummary}`;
    $('selection-eyebrow').textContent = `ONE NIGHT. ${arenaCount}. YOUR FIGHTERS.`;
    $('stage-art-status').textContent = mode === 'arcade' ? `ARCADE · ${manifest.fighters.filter((item, i) => !item.boss && i !== selected[0]).length + (manifest.fighters.some(item => item.boss) ? 1 : 0)} BATTLES` : art(stage.src) ? manifest.stages.length > 1 ? `STAGE ${stageIndex + 1} OF ${manifest.stages.length} · ◀ ▶ TO CHANGE` : 'ONE PLAYABLE ARENA' : background ? 'SOURCE REFERENCE / ANIME STAGE PENDING' : 'STAGE ART PENDING';
    if (background) $('stage-thumb').style.backgroundImage = 'url("' + background.src + '")';
    const complete = selected.every(i => Object.values(manifest.fighters[i].poses || {}).filter(pose => art(pose.src)).length >= 27) && art(stage.src);
    $('placeholder-label').hidden = !!complete;
    $('placeholder-label').textContent = manifest.generationPending ? 'FICTIONAL ART AWAITING GENERATION / PROTOTYPE FIGHTERS' : 'SPRITE ART PENDING / PROTOTYPE FIGHTERS';
    const count = manifest.fighters.reduce((total, f) => total + Object.values(f.poses || {}).filter(p => art(p.src)).length, 0);
    $('selection-art-status').textContent = count ? count + ' generated fighter poses loaded. Select your matchup and enter ' + stage.name + '.' : 'Reference preview: source artwork is loaded. Generated art and audio are pending; combat uses visible prototype fighters.';
  }
  function renderGallery() {
    const counts = [
      [galleryEntries.filter(e => e.group === 'fighters' && art(e.src)).length, 'FIGHTER POSES'],
      [galleryEntries.filter(e => e.group === 'portraits' && art(e.src)).length, 'CHARACTER ART'],
      [galleryEntries.filter(e => e.group === 'stages' && art(e.src)).length, 'STAGES'],
      [galleryEntries.filter(e => ['ui', 'effects'].includes(e.group) && art(e.src)).length, 'UI + EFFECTS'],
      [galleryEntries.filter(e => e.group === 'video').length, 'VIDEOS']
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
      else if (entry.group === 'video') { const player = document.createElement('video'); player.controls = true; player.muted = true; player.loop = true; player.playsInline = true; player.preload = 'metadata'; player.src = entry.src; player.setAttribute('aria-label', entry.name); preview.append(player); }
      else if (art(entry.src)) { const img = document.createElement('img'); img.src = entry.src; img.alt = entry.name; img.loading = 'lazy'; preview.append(img); }
      else preview.textContent = 'Image unavailable';
      const meta = document.createElement('div'); meta.className = 'meta';
      const name = document.createElement('strong'); name.textContent = entry.name;
      const info = document.createElement('small'); info.textContent = entry.info;
      meta.append(name, info); card.append(preview, meta); $('asset-gallery').append(card);
    });
  }
  function cycleStage(step) {
    stageIndex = (stageIndex + step + manifest.stages.length) % manifest.stages.length; $('stage').value = String(stageIndex);
    refreshCards(); playSound('sfx_menu_move', .45);
  }
  function applyOptions() {
    const wrap = canvas.parentElement;
    wrap.classList.toggle('filter-scanlines', options.display === 'scanlines'); wrap.classList.toggle('filter-crt', options.display === 'crt');
    if (music) music.volume = musicLevel();
  }
  function openTrainingPanel() {
    if (mode !== 'training' || !state) return;
    $('pause-overlay').hidden = true; $('training-panel').hidden = false;
    $('train-action').value = training.action; $('train-guard').value = training.guard; $('train-meter').value = training.meter;
    $('train-boxes').checked = training.boxes; $('train-inputs').checked = training.inputs; $('train-frames').checked = training.frames;
    overlay = { type: 'training', next: closeTrainingPanel }; $('train-action').focus({ preventScroll: true });
  }
  function closeTrainingPanel() {
    if (overlay?.type === 'training') overlay = null;
    $('training-panel').hidden = true; if (paused) pause(false);
  }
  function matchOptions(extra = {}) {
    return { roundsToWin: options.rounds, roundTime: options.time, cpuLevel: options.difficulty, profiles: profiles(), seed: Math.floor(Math.random() * 2 ** 31), ...extra };
  }
  function start() {
    if (network?.active) { network.rematch(); return; }
    closeOverlay();
    const ids = selected.map(i => manifest.fighters[i].id);
    if (mode === 'arcade') { startArcade(); return; }
    if (mode === 'training') {
      training.history = []; training.frameData = null; training.watch = null;
      // Training skips the round countdown and starts immediately.
      const session = E.create(ids, matchOptions({ cpu: training.action === 'cpu', training: true, trainingMeter: training.meter, roundTime: 0 }));
      session.phase = 'fight'; session.message = '';
      beginMatch(session, 'TRAINING', { intros: false });
      return;
    }
    // Local versus: player two needs a gamepad; otherwise the CPU takes the second seat.
    const human = !!padFor(1);
    beginMatch(E.create(ids, matchOptions({ cpu: !human })), human ? 'VERSUS / 1P VS 2P' : 'VERSUS / 1P VS CPU');
  }
  function beginMatch(nextState, label, { intros = 'both' } = {}) {
    engageAudio();
    clearIntro(); closeOverlay();
    state = nextState; lastIntroCall = null; goFrames = 0;
    paused = false; keys.clear(); pendingKeys.clear(); cutin = null; accumulator = 0; resetView();
    $('title-screen').hidden = true; $('selection-screen').hidden = true; $('fight-screen').hidden = false; $('touch-panel').hidden = true;
    $('match-overlay').hidden = true; $('pause-overlay').hidden = true; $('pause-button').hidden = true;
    $('versus-overlay').hidden = true; $('versus-one').textContent = fighterData(0).name; $('versus-two').textContent = fighterData(1).name;
    $('arena-label').textContent = label;
    $('versus-overlay').querySelectorAll('div > span')[1].textContent = state.cpu ? 'CPU CHALLENGER' : mode === 'training' ? 'TRAINING DUMMY' : 'PLAYER TWO';
    $('match-status').textContent = mode === 'training' ? 'Training: health and meter refill. Pause for options.' : `First to ${state.options?.roundsToWin ?? 2} rounds. Hold back to block.`;
    $('pause-training').hidden = mode !== 'training';
    sceneMusic('fight');
    if (intros === false || mode === 'training') {
      setScene('fight'); $('pause-button').hidden = !!network?.active || mode === 'demo'; $('touch-panel').hidden = mode === 'demo';
      canvas.focus({ preventScroll: true });
    } else { showIntroduction(intros); $('intro-skip').focus(); }
  }
  // Arcade: a shuffled ladder of every rival, then the final boss in the last arena.
  function buildLadder(player) {
    const rivals = manifest.fighters.map((_, index) => index).filter(index => index !== player && !manifest.fighters[index].boss);
    for (let i = rivals.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rivals[i], rivals[j]] = [rivals[j], rivals[i]]; }
    const boss = manifest.fighters.findIndex(f => f.boss);
    return boss >= 0 && boss !== player ? [...rivals, boss] : rivals;
  }
  function startArcade() {
    const ladder = buildLadder(selected[0]);
    arcade = { player: selected[0], ladder: ladder.length ? ladder : [firstSelectable(selected[0] + 1)], index: 0, score: 0, continues: 0, perfects: 0, matchScore: 0 };
    nextArcadeMatch();
  }
  function nextArcadeMatch() {
    closeOverlay();
    const opponent = arcade.ladder[arcade.index], boss = !!manifest.fighters[opponent].boss;
    selected = [arcade.player, opponent];
    stageIndex = boss ? manifest.stages.length - 1 : arcade.index % manifest.stages.length;
    // The CPU sharpens as the ladder climbs; the boss adds its own edge in the engine.
    const level = Math.max(1, Math.min(8, options.difficulty - 1 + Math.floor(arcade.index * .7)));
    const label = boss ? 'ARCADE / FINAL BATTLE' : `ARCADE / STAGE ${arcade.index + 1} OF ${arcade.ladder.length}`;
    arcade.matchScore = arcade.score;
    refreshCards();
    showVersus(boss ? 'FINAL BATTLE' : `STAGE ${arcade.index + 1}`, boss, () =>
      beginMatch(E.create(selected.map(i => manifest.fighters[i].id), matchOptions({ cpu: true, cpuLevel: level })), label, { intros: arcade.index === 0 ? 'both' : 'challenger' }));
  }
  function setArt(img, sources) {
    const src = sources.map(assetSource).find(item => item && art(item));
    img.hidden = !src; if (src) img.src = src; else img.removeAttribute('src');
  }
  function showVersus(roundLabel, boss, done) {
    // The split-screen introduction is the only pre-fight screen now; the announcer still calls the match.
    closeOverlay(); clearIntro(); state = null;
    playSound(audioId(boss && 'ann_finalbattle', 'ann_versus') || '', .9);
    done(); return;
    // eslint-disable-next-line no-unreachable
    $('title-screen').hidden = true; $('selection-screen').hidden = true; $('fight-screen').hidden = false; setScene('fight');
    const [one, two] = [fighterData(0), fighterData(1)];
    setArt($('vs-art-one'), [one.hero, one.portrait]); setArt($('vs-art-two'), [two.hero, two.portrait]);
    $('vs-name-one').textContent = one.name.toUpperCase(); $('vs-name-two').textContent = two.name.toUpperCase();
    $('vs-style-one').textContent = STYLE_LABELS[one.style] || ''; $('vs-style-two').textContent = STYLE_LABELS[two.style] || '';
    $('vs-stage').textContent = manifest.stages[stageIndex].name.toUpperCase();
    $('vs-round').textContent = roundLabel;
    $('vs-screen').hidden = false; sceneMusic('select');
    // Take focus from the hidden start button so Enter advances this screen instead of restarting Arcade.
    $('vs-screen').focus({ preventScroll: true });
    playSound(audioId(boss && 'ann_finalbattle', 'ann_versus') || '', .9);
    const finish = () => { if (overlay?.type !== 'vs') return; clearTimeout(overlay.timer); overlay = null; $('vs-screen').hidden = true; done(); };
    overlay = { type: 'vs', next: finish, timer: setTimeout(finish, 2800) };
  }
  // Arcade results: win screens with quotes, continues, game over, endings and initials.
  function tallyRow(list, label, value) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; list.append(dt, dd); }
  function showWinScreen(winner, { quote = true, onNext } = {}) {
    closeOverlay();
    const fighter = fighterData(winner);
    setArt($('win-art'), [fighter.hero, fighter.portrait]);
    $('win-eyebrow').textContent = mode === 'arcade' ? (winner === 0 ? 'YOU WIN' : 'YOU LOSE') : `${winner ? (state?.cpu ? 'CPU' : '2P') : '1P'} WINS`;
    $('win-name').textContent = fighter.name.toUpperCase();
    $('win-quote').textContent = quote ? '“' + (fighter.winQuote || fighter.introTagline || 'Next.') + '”' : '';
    $('win-quote').hidden = !quote;
    const tally = $('win-tally'); tally.replaceChildren();
    if (arcade && mode === 'arcade') {
      tallyRow(tally, 'STAGE SCORE', String(arcade.score - arcade.matchScore).padStart(7, '0'));
      tallyRow(tally, 'TOTAL', String(arcade.score).padStart(8, '0'));
      if (arcade.continues) tallyRow(tally, 'CONTINUES', String(arcade.continues));
    }
    $('win-screen').hidden = false; sceneMusic('victory');
    playSound(`fighter_${fighter.id}_win`, .95);
    const next = () => { if (overlay?.type !== 'win') return; clearTimeout(overlay.timer); overlay = null; $('win-screen').hidden = true; onNext?.(); };
    overlay = { type: 'win', next, timer: onNext ? setTimeout(next, 7000) : null };
    $('win-continue').hidden = !onNext; $('win-continue').focus({ preventScroll: true });
  }
  function arcadeWin() {
    const last = arcade.index >= arcade.ladder.length - 1;
    arcade.score += 10000 * (arcade.index + 1);
    showWinScreen(0, { onNext: () => { if (last) showEnding(); else { arcade.index++; nextArcadeMatch(); } } });
  }
  function arcadeLoss() {
    closeOverlay();
    const fighter = fighterData(0);
    setArt($('continue-art'), [fighter.hero, fighter.portrait]);
    let count = 9; $('continue-count').textContent = String(count);
    $('continue-screen').hidden = false; sceneMusic('continue'); playSound('ann_continue', .9);
    overlay = { type: 'continue', next: () => { if (overlay?.type !== 'continue') return; closeOverlay(); arcade.continues++; nextArcadeMatch(); },
      quit: () => { if (overlay?.type !== 'continue') return; closeOverlay(); gameOver(); },
      tick: () => { count--; $('continue-count').textContent = String(Math.max(0, count)); playSound('sfx_timer', .5); if (count < 0) overlay?.quit(); } };
    $('continue-yes').focus({ preventScroll: true });
    continueTimer = setInterval(() => overlay?.type === 'continue' && overlay.tick(), 1000);
  }
  function gameOver() {
    closeOverlay(); state = null;
    $('gameover-score').textContent = `SCORE ${String(arcade?.score || 0).padStart(8, '0')}`;
    $('gameover-screen').hidden = false; sceneMusic('gameover'); playSound('ann_gameover', .9);
    const score = arcade?.score || 0, fighter = fighterData(0)?.id;
    overlay = { type: 'gameover', next: () => { if (overlay?.type !== 'gameover') return; clearTimeout(overlay.timer); closeOverlay(); maybeNameEntry(score, fighter, false, showTitle); } };
    overlay.timer = setTimeout(overlay.next, 3500);
  }
  function showEnding() {
    closeOverlay(); state = null;
    const fighter = fighterData(0), text = fighter.ending || `${fighter.name} stands victorious. The neighborhood tournament has a new champion.`;
    setArt($('ending-art'), [fighter.endingArt, fighter.cutin, fighter.hero]);
    $('ending-name').textContent = fighter.name.toUpperCase(); $('ending-eyebrow').textContent = 'ENDING';
    $('ending-text').textContent = '';
    $('ending-screen').hidden = false; sceneMusic('ending');
    let typed = 0;
    const typing = setInterval(() => { typed += 2; $('ending-text').textContent = text.slice(0, typed); if (typed >= text.length) clearInterval(typing); }, 40);
    const credits = () => {
      clearInterval(typing); $('ending-text').textContent = text;
      const body = $('staff-roll-body'); body.replaceChildren();
      const add = (tag, value) => { const element = document.createElement(tag); element.textContent = value; body.append(element); };
      add('h3', manifest.title.toUpperCase());
      add('h4', 'CHAMPION'); add('p', `${fighter.name} · ${String(arcade.score).padStart(8, '0')} POINTS`);
      add('h4', 'THE NEIGHBORHOOD'); manifest.fighters.forEach(item => add('p', `${item.name}${item.boss ? ' — Final Boss' : ''}`));
      add('h4', 'ARENAS'); manifest.stages.forEach(stage => add('p', stage.name));
      add('h4', 'ART, MUSIC & VOICES'); add('p', 'Generated with ComfyUI cloud workflows'); add('p', 'Fictional characters invented from text');
      add('h4', 'BUILT WITH'); add('p', 'The Comfy Fighter Z builder'); add('p', manifest.subtitle || '');
      add('h4', ''); add('h3', 'THANK YOU FOR PLAYING');
      $('staff-roll').hidden = false; overlay = { type: 'ending', next: finish }; overlay.timer = setTimeout(finish, 26000);
    };
    const finish = () => { if (overlay?.type !== 'ending') return; clearTimeout(overlay.timer); const score = arcade.score + 50000 * Math.max(0, 1 - arcade.continues * .25); closeOverlay(); maybeNameEntry(Math.round(score), fighter.id, true, showTitle); };
    overlay = { type: 'ending', next: () => { if (overlay?.type !== 'ending') return; clearTimeout(overlay.timer); credits(); } };
    overlay.timer = setTimeout(overlay.next, Math.max(9000, text.length * 40 + 5000));
    $('ending-skip').focus({ preventScroll: true });
  }
  function maybeNameEntry(score, fighter, cleared, done) {
    const scores = storage.get(SCORES_KEY, []);
    if (!score || scores.length >= 5 && score <= scores[scores.length - 1].score) { done(); return; }
    closeOverlay();
    const letters = ['A', 'A', 'A']; let cursor = 0;
    const draw = () => { $('name-letters').replaceChildren(...letters.map((letter, index) => { const span = document.createElement('span'); span.textContent = letter; span.classList.toggle('active', index === cursor); return span; })); };
    $('name-score').textContent = String(score).padStart(8, '0'); draw(); $('name-entry').hidden = false;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!?';
    overlay = { type: 'name',
      key: code => {
        if (code === 'ArrowUp' || code === 'ArrowDown') { const i = alphabet.indexOf(letters[cursor]); letters[cursor] = alphabet[(i + (code === 'ArrowUp' ? 1 : -1) + alphabet.length) % alphabet.length]; playSound('sfx_menu_move', .5); }
        if (code === 'ArrowLeft') cursor = Math.max(0, cursor - 1);
        if (code === 'ArrowRight') cursor = Math.min(2, cursor + 1);
        if (code === 'Enter' || code === 'Space') {
          if (cursor < 2) { cursor++; playSound('sfx_menu_select', .5); }
          else {
            const entry = { name: letters.join(''), score, fighter, cleared, date: new Date().toISOString().slice(0, 10) };
            storage.set(SCORES_KEY, [...scores, entry].sort((a, b) => b.score - a.score).slice(0, 5)); playSound('sfx_menu_select', .6);
            closeOverlay(); done(); return;
          }
        }
        draw();
      } };
  }
  function showMoveList() {
    const body = $('movelist-body'); body.replaceChildren();
    [...new Set(state ? [selected[0], selected[1]] : [selected[0]])].forEach(index => {
      const fighter = manifest.fighters[index], section = document.createElement('section');
      section.style.setProperty('--accent', fighter.color || '#c9a25e');
      const heading = document.createElement('h3'); heading.textContent = fighter.name.toUpperCase();
      const tag = document.createElement('small'); tag.textContent = STYLE_LABELS[fighter.style] || 'BALANCED'; heading.append(tag);
      const list = document.createElement('ul');
      for (const move of E.moveList(fighter)) {
        const item = document.createElement('li'), name = document.createElement('b'), input = document.createElement('kbd');
        name.textContent = move.name; input.textContent = move.input; item.append(name, input);
        if (move.note) { const note = document.createElement('small'); note.textContent = move.note; item.append(note); }
        list.append(item);
      }
      section.append(heading, list); body.append(section);
    });
    $('movelist-overlay').hidden = false; $('movelist-close').focus({ preventScroll: true });
    const previous = overlay;
    overlay = { type: 'moves', next: () => { $('movelist-overlay').hidden = true; overlay = previous?.type === 'moves' ? null : previous; ($('pause-overlay').hidden ? canvas : $('resume-button')).focus({ preventScroll: true }); } };
  }
  function matchFinished() {
    if (network?.active) { showMatchOverlay(); return; }
    if (mode === 'demo') { setTimeout(() => endDemo(true), 1800); return; }
    if (mode === 'arcade' && arcade) { if (state.winner === 0) arcadeWin(); else arcadeLoss(); return; }
    if (state.winner !== null) showWinScreen(state.winner, { onNext: showMatchOverlay }); else showMatchOverlay();
  }
  function showMatchOverlay() {
    if (!state) return;
    const winner = state.winner ?? (state.fighters[0].wins > state.fighters[1].wins ? 0 : 1);
    $('match-overlay').hidden = false; $('pause-button').hidden = true;
    $('match-overlay').querySelector('h2').textContent = state.winner === null ? 'DRAW GAME' : fighterData(winner).name.toUpperCase() + ' WINS';
    $('match-overlay').querySelector('p:not(.eyebrow)').textContent = `${state.fighters[0].wins} – ${state.fighters[1].wins} · ${manifest.stages[stageIndex].name} has a champion.`;
    $('rematch-button').textContent = network?.active ? 'REMATCH / READY UP ›' : 'RUN IT BACK ›';
    $('match-status').textContent = network?.active ? 'Match complete. Both players can ready up in the session panel.' : 'Match complete. Play again or change your lineup.';
    $('rematch-button').focus({ preventScroll: true });
  }
  // Training dummy behaviour, position reset, frame data and input history.
  function dummyInput() {
    const dummy = state.fighters[1], player = state.fighters[0], back = dummy.facing === 1 ? 'left' : 'right', input = {};
    if (training.action === 'crouch') input.down = true;
    if (training.action === 'jump') input.jump = state.frame % 50 < 30;
    const guarding = training.guard === 'all' || training.guard === 'after' && state.frame - training.lastHit < 90;
    if (guarding && (player.move || state.projectiles.length)) { input[back] = true; input.down = player.moveVariant === 'crouch' || training.action === 'crouch'; if (player.moveVariant === 'air') input.down = false; }
    return input;
  }
  function resetTraining() {
    if (mode !== 'training' || !state) return;
    const ids = state.fighters.map(f => f.id);
    state = E.create(ids, matchOptions({ cpu: training.action === 'cpu', training: true, trainingMeter: training.meter, roundTime: 0 }));
    state.phase = 'fight'; state.message = ''; training.frameData = null; training.watch = null; resetView();
  }
  const ARROWS = { '-1,-1': '↖', '0,-1': '↑', '1,-1': '↗', '-1,0': '←', '0,0': '•', '1,0': '→', '-1,1': '↙', '0,1': '↓', '1,1': '↘' };
  function recordTraining(input) {
    const h = (input.right ? 1 : 0) - (input.left ? 1 : 0), v = input.jump ? -1 : input.down ? 1 : 0;
    const label = ARROWS[`${h},${v}`] + ' ' + [['punch', 'A'], ['kick', 'S'], ['heavy', 'D'], ['special', 'F'], ['taunt', 'G']].filter(([key]) => input[key]).map(([, letter]) => letter).join('');
    const last = training.history[0];
    if (last && last.label === label) last.frames++;
    else { training.history.unshift({ label, frames: 1 }); training.history.length = Math.min(16, training.history.length); }
    // Frame data: measure each P1 move from start to both fighters becoming free.
    const [player, dummy] = state.fighters, moving = !!player.move;
    if (moving && (!training.watch || training.watch.move !== player.move || player.moveFrame === 1)) training.watch = { move: player.move, variant: player.moveVariant, result: 'whiff', start: state.motionFrame };
    const watch = training.watch;
    if (watch) {
      if (state.effects.some(e => e.life === e.maxLife && e.attacker === 0)) watch.result = state.effects.some(e => e.type === 'hit' && e.life === e.maxLife) ? 'hit' : 'block';
      if (!player.move && !player.stun && watch.p1 === undefined) watch.p1 = state.motionFrame;
      if (!dummy.stun && !dummy.move && watch.dummy === undefined && watch.p1 !== undefined) watch.dummy = state.motionFrame;
      if (watch.p1 !== undefined && (watch.result === 'whiff' || watch.dummy !== undefined)) {
        const data = E.moveData({ move: watch.move, moveVariant: watch.variant }) || {};
        training.frameData = { move: watch.move, startup: data.startup, total: (data.startup || 0) + (data.active || 0) + (data.recovery || 0), result: watch.result,
          advantage: watch.result === 'whiff' ? null : (watch.dummy ?? watch.p1) - watch.p1 };
        training.watch = null;
      }
    }
  }
  function reset() {
    if (network?.active) { network.open(); return; }
    clearIntro();
    state = null; paused = false; keys.clear(); pendingKeys.clear(); cutin = null;
    setScene('selection');
    $('title-screen').hidden = true; $('selection-screen').hidden = false; $('fight-screen').hidden = true;
    $('controls-panel').hidden = true; $('touch-panel').hidden = true;
    $('match-overlay').hidden = true; $('pause-overlay').hidden = true; $('pause-button').hidden = true; $('versus-overlay').hidden = true;
    $('arena-label').textContent = 'CHARACTER SELECT'; $('match-status').textContent = 'Choose your matchup.';
    refreshCards(); sceneMusic('select');
  }
  function pause(value = !paused) {
    if (!state || state.phase === 'matchover') return;
    if (network?.active) { if (value) network.open(); else network.close(); return; }
    paused = value; keys.clear(); pendingKeys.clear(); Object.keys(touch).forEach(k => delete touch[k]);
    $('pause-overlay').hidden = !paused;
    if (paused) { music?.pause(); introVoice?.pause(); } else refreshAudio();
    if (selectedTab === 'arena') (paused ? $('resume-button') : introScene ? $('intro-skip') : canvas).focus({ preventScroll: true });
  }
  // Arena drawing lives in render/: Pixi when available, Canvas 2D otherwise. The HUD canvas sits on top.
  const arena = window.CFZArena.create({ canvas, hud: $('arena-hud'), engine: E, deps: { art, assetSource, ui, fighterData, portraitSource } });
  function resetView() { arena.reset(); }
  function render() {
    arena.draw({ state, manifest, stageIndex, selected, mode, arcade, training, cutin, goFrames, fighterRenderer, reducedMotion: reducedMotion.matches, debugBoxes: options.debug === 'boxes', bestScore: storage.get(SCORES_KEY, [])[0]?.score || 0 });
    // The last ten seconds tick once per second; the renderer itself makes no sound.
    if (state && mode !== 'training' && state.options?.roundTime !== 0 && state.phase === 'fight' && state.time % 60 === 59 && Math.ceil(state.time / 60) <= 10) playSound('sfx_timer', .35);
  }
  function readInput(slot = 0) {
    const input = {};
    if (slot === 0) {
      for (const key of new Set([...keys, ...pendingKeys])) if (controls[0][key]) input[controls[0][key]] = true;
      Object.assign(input, touch);
    }
    return Object.assign(input, padInput(padFor(slot)));
  }
  // Gamepads drive menus too: Start pauses or confirms, A confirms, B backs out, the D-pad navigates.
  function menuKey(code, activate = false) {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : canvas;
    if (activate && !overlay?.key && target.matches?.('button, a')) { target.click(); return; }
    target.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
  }
  function pollPads() {
    for (const pad of gamepads()) {
      const before = padHistory[pad.index] || { buttons: [], dirs: [] };
      const buttons = pad.buttons.map(button => !!(button.pressed || button.value > .5)), axes = pad.axes || [];
      const dirs = [axes[1] < -.6, axes[1] > .6, axes[0] < -.6, axes[0] > .6];
      padHistory[pad.index] = { buttons, dirs };
      const edge = index => buttons[index] && !before.buttons[index], dirEdge = index => dirs[index] && !before.dirs[index];
      if (buttons.some(Boolean) || dirs.some(Boolean)) idleTime = 0;
      if (demo && buttons.some((pressed, index) => pressed && !before.buttons[index])) { endDemo(true); return; }
      const fighting = state && !introScene && !paused && !overlay && !$('fight-screen').hidden && state.phase !== 'matchover';
      if (edge(9)) { if (fighting) menuKey('Escape'); else menuKey('Enter', true); continue; }
      if (fighting || (state && !paused && !overlay && !introScene)) continue;
      if (edge(0)) menuKey('Enter', true);
      if (edge(1) || edge(8)) menuKey('Escape');
      if (edge(12) || dirEdge(0)) menuKey('ArrowUp');
      if (edge(13) || dirEdge(1)) menuKey('ArrowDown');
      if (edge(14) || dirEdge(2)) menuKey('ArrowLeft');
      if (edge(15) || dirEdge(3)) menuKey('ArrowRight');
    }
  }
  function clearInput() { keys.clear(); pendingKeys.clear(); Object.keys(touch).forEach(key => delete touch[key]); }
  // Throttled one-shots keep simultaneous hits from stacking the same sample.
  const lastPlayed = new Map();
  function cue(ids, volume = .6, gap = 90) {
    const id = audioId(...[].concat(ids)); if (!id) return;
    const now = performance.now(); if (now - (lastPlayed.get(id) || 0) < gap) return;
    lastPlayed.set(id, now); return playSound(id, volume);
  }
  const fighterLine = (slot, line) => [`fighter_${fighterData(slot).id}_${line}`];
  function presentState(previousPhase, previousMoves, previousHealth) {
    const previousY = presentState.previousY || [0, 0];
    // Round calls: ROUND n / FINAL ROUND, READY?, GO!, then the result.
    if (state.phase === 'intro' && lastIntroCall !== state.round) {
      lastIntroCall = state.round;
      cue(state.message === 'FINAL ROUND' ? ['ann_final', 'ann_round3'] : [`ann_round${Math.min(3, state.round)}`], .9, 0);
    }
    if (state.phase === 'intro' && state.phaseFrames === 40) cue('ann_ready', .9, 0);
    if (previousPhase === 'intro' && state.phase === 'fight') { cue(['ann_go', 'ann_fight'], .9, 0); goFrames = 50; }
    if (previousPhase === 'fight' && state.phase === 'roundover' && state.result) {
      const kind = state.result.kind;
      cue(kind === 'time' ? ['ann_timeover'] : kind === 'doubleko' ? ['ann_doubleko', 'ann_ko'] : ['ann_ko'], .95, 0);
      if (kind !== 'time') cue('sfx_ko', .8, 0);
      state.fighters.forEach((f, slot) => { if (f.hp === 0) cue(fighterLine(slot, 'ko'), .9, 0); });
      if (arcade && mode === 'arcade' && state.result.winner === 0) {
        // KOF-style round bonuses: time, remaining life and perfect.
        const bonus = state.result.time * 100 + state.result.hp[0] * 200 + (state.result.perfect ? 20000 : 0);
        arcade.score += bonus; if (state.result.perfect) arcade.perfects++;
      }
    }
    if (state.phase === 'roundover' && state.phaseFrames === 109) {
      if (state.message === 'PERFECT') cue('ann_perfect', .95, 0);
      else if (state.message === 'DRAW GAME') cue('ann_draw', .95, 0);
    }
    if (state.frame > 50) $('versus-overlay').hidden = true;
    state.fighters.forEach((f, slot) => {
      if (f.move && f.move !== previousMoves[slot]) {
        const move = f.move;
        if (['punch', 'kick', 'rekka'].includes(move)) cue(['sfx_whiff'], .35, 60);
        else if (['heavy', 'blowback', 'gcBlowback', 'rush', 'armorRush', 'rising'].includes(move)) { cue(['sfx_whiff_heavy', 'sfx_whiff'], .45, 60); if (Math.random() < .35) cue(fighterLine(slot, 'attack'), .75, 600); }
        else if (['roll', 'gcRoll', 'teleport'].includes(move)) cue(['sfx_dash'], .45);
        else if (move === 'super') { cue(['sfx_super', 'sfx_special'], .8, 0); cue([...fighterLine(slot, 'super'), ...fighterLine(slot, 'special')], .95, 0); }
        else if (['special', 'fireball', 'fastball', 'doubleball', 'skyshot'].includes(move)) {
          cue('sfx_special', .5); cue(fighterLine(slot, 'special'), .85, 900);
          if (move === 'special') cutin = { slot, life: 35 };
        }
        else if (move === 'taunt') cue(fighterLine(slot, 'attack'), .8, 0);
      }
      if (f.y > 0 && previousY[slot] === 0 && !f.launched && !f.move) cue('sfx_jump', .3, 80);
      if (f.running && !(presentState.running || [])[slot]) cue('sfx_dash', .35, 200);
    });
    presentState.previousY = state.fighters.map(f => f.y); presentState.running = state.fighters.map(f => f.running);
    for (const effect of state.effects) if (effect.life === effect.maxLife) {
      if (effect.type === 'hit') {
        // Impacts sound on contact, scaled by damage.
        cue(effect.damage >= 13 ? ['sfx_heavy', 'sfx_kick'] : effect.damage >= 9 ? ['sfx_kick', 'sfx_punch'] : ['sfx_punch'], .55, 40);
        const victim = effect.attacker === 0 ? 1 : 0;
        if (effect.heavy && Math.random() < .3 && state.fighters[victim].hp > 0) cue(fighterLine(victim, 'hurt'), .7, 700);
        if (effect.attacker === 0 && arcade && mode === 'arcade') arcade.score += (effect.damage || 0) * 100;
        if (effect.attacker === 0 && mode === 'training') training.lastHit = state.frame;
        if (effect.attacker === 1 && mode === 'training') training.lastHit = state.frame;
      }
      if (effect.type === 'block' || effect.type === 'armor') cue('sfx_block', .45, 50);
      if (effect.type === 'dust') cue('sfx_land', .25, 120);
      if (effect.type === 'dizzy') cue('sfx_dizzy', .6, 0);
      if (effect.type === 'banner') {
        if (effect.text === 'COUNTER') cue('sfx_counter', .55, 0);
        if (arcade && mode === 'arcade' && effect.slot === 0) arcade.score += { 'FIRST ATTACK': 3000, COUNTER: 500, REVERSAL: 2000, 'GUARD CANCEL': 500, 'THROW ESCAPE': 500, 'QUICK RISE': 300 }[effect.text] || 0;
      }
    }
    if (state.phase === 'matchover' && !state.routed) { state.routed = true; matchFinished(); }
  }
  function receiveSnapshot(message) {
    if (!network?.active || message.matchId !== networkMatchId || !message.state?.fighters || !state) return;
    const next = message.state;
    if (next.frame <= state.frame) return;
    const previousPhase = state.phase, previousMoves = state.fighters.map(f => f.move), previousHealth = state.fighters.map(f => f.hp);
    // Keep each rendered fighter object stable for pose transitions and animation trails.
    const fighters = next.fighters.map((fighter, slot) => Object.assign(state.fighters[slot] || {}, fighter));
    Object.assign(state, next, { fighters });
    presentState(previousPhase, previousMoves, previousHealth);
  }
  function networkMatch(message, role, side, fresh) {
    networkRole = role; networkSide = side; networkMatchId = message.matchId; mode = 'online'; arcade = null; endDemo(false);
    selected = message.fighters.map(id => Math.max(0, manifest.fighters.findIndex(fighter => fighter.id === id)));
    stageIndex = Math.max(0, manifest.stages.findIndex(stage => stage.id === message.stage));
    refreshCards();
    beginMatch(message.state, role === 'projection' ? message.state.cpu ? 'PHONE CONTROLLER / VS CPU' : 'TWO PHONES / VERSUS' : 'ONLINE VERSUS / YOU ARE P' + (side + 1));
    paused = !!network.room?.paused;
    $('back-select').textContent = 'SESSION PANEL'; $('reset-button').textContent = 'SESSION / CONTROLLERS';
    $('result-select').textContent = 'SESSION / CHANGE FIGHTER';
    if (!message.introPending || !fresh && message.state.frame > 0) {
      clearIntro(); setScene('fight'); $('versus-overlay').hidden = state.frame > 50;
      $('touch-panel').hidden = role === 'projection';
      presentState(null, [], state.fighters.map(f => f.hp));
    }
  }
  function frame(now) {
    const elapsed = Math.min(100, now - last); accumulator += elapsed; last = now;
    titleMotion.sync(); selectMotion.sync();
    updateIntroduction(elapsed);
    pollPads();
    // Attract mode starts after a quiet minute on the title screen.
    if (!state && !openingActive && selectedTab === 'arena' && !$('title-screen').hidden && !$('settings-dialog').open && !network?.dialog?.open) {
      idleTime += elapsed; if (idleTime > 60000) { idleTime = 0; startDemo(); }
    } else if (!demo) idleTime = 0;
    while (accumulator >= 1000 / 60) {
      if (network?.active) {
        network.input(!introScene && !paused && selectedTab === 'arena' ? readInput() : {});
        pendingKeys.clear();
      }
      if (state && !introScene && !paused && selectedTab === 'arena') {
        // Network matches only render server snapshots; no client prediction or CPU tick.
        if (!network?.active) {
          const previousPhase = state.phase, previousMoves = state.fighters.map(f => f.move), previousHealth = state.fighters.map(f => f.hp);
          // Versus reads player two's pad; training drives the dummy; the demo ignores players entirely.
          const inputs = [mode === 'demo' ? {} : readInput(0), mode === 'versus' ? readInput(1) : mode === 'training' && !state.cpu ? dummyInput() : {}];
          E.tick(state, inputs);
          if (mode === 'training') recordTraining(inputs[0]);
          presentState(previousPhase, previousMoves, previousHealth); pendingKeys.clear();
        }
        if (cutin) cutin.life--;
        if (goFrames > 0) goFrames--;
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
    const demoCast = {
      griddle: 'A completely invented cheerful barbecue dad in his late forties.',
      rivet: 'A completely invented workshop dad in his early fifties.',
      tempo: 'A completely invented music-teacher parent in their late thirties.',
      nimbus: 'A completely invented community-garden mom in her mid forties.',
      switchback: 'A completely invented bicycle-courier dad in his early forties.',
      brick: 'A completely invented neighborhood caretaker granddad in his early sixties.'
    };
    // The ensemble title art shows the six included heroes; the final boss does not change that cast.
    const heroes = manifest.fighters.filter(f => !f.boss);
    const includedCast = heroes.length === 6 && heroes.every(f => demoCast[f.id] && f.description?.startsWith(demoCast[f.id]));
    const heroCount = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'][heroes.length] || String(heroes.length);
    $('title-eyebrow').textContent = `${heroCount} ${heroes.length === 1 ? 'CHALLENGER' : 'CHALLENGERS'}. ONE OPEN SOURCE SHOWDOWN.`;
    const generatedUi = !!(ui('select') && ui('title'));
    document.body.classList.toggle('cfz-arcade-art', document.title.trim().toLowerCase() === 'comfy fighter z' && !generatedUi);
    if (ui('logo')) { $('arcade-logo').src = ui('logo').src; $('arcade-logo').hidden = false; }
    if (ui('frame')) { document.body.style.setProperty('--menu-frame', `url("${ui('frame').src}")`); document.body.classList.add('cfz-frame'); }
    document.body.classList.toggle('cfz-ensemble', includedCast && document.body.classList.contains('cfz-arcade-art'));
    if (!ui('logo')) $('arcade-logo').hidden = !document.body.classList.contains('cfz-arcade-art');
    const titleWords = document.title.split(' '), lastWord = titleWords.pop(); $('game-title').textContent = titleWords.join(' ').toUpperCase() + ' ';
    const emph = document.createElement('em'); emph.textContent = lastWord.toUpperCase(); $('game-title').append(emph);
    $('title-wordmark').textContent = titleWords.join(' ').toUpperCase() + ' ';
    $('title-wordmark').append(emph.cloneNode(true));
    $('saga-subtitle').textContent = manifest.subtitle || fallback.subtitle;
    manifest.fighters.forEach((f, i) => { $('fighter-one').append(makeOption(i, f.name)); $('fighter-two').append(makeOption(i, f.name)); }); $('fighter-two').value = selected[1];
    manifest.stages.forEach((s, i) => $('stage').append(makeOption(i, s.name)));
    $('stage-control').hidden = manifest.stages.length < 2;
    document.body.classList.toggle('multiple-stages', manifest.stages.length > 1);
    galleryEntries = findEntries();
    const references = [...manifest.fighters.filter(f => !f.hero && !f.portrait), ...manifest.stages.filter(s => !s.src)].map(item => assetSource(item.sourceImage)).filter(Boolean);
    await Promise.all([...galleryEntries.filter(e => !['audio', 'video'].includes(e.group)).map(e => e.src), ...references].map(imageLoad));
    $('asset-count').textContent = galleryEntries.filter(e => !['audio', 'video'].includes(e.group) && art(e.src)).length;
    setBackground($('selection-screen'), ui('select'));
    setBackground($('select-heading'), ui('title'));
    if (ui('logo')) { $('generated-logo').src = ui('logo').src; $('generated-logo').hidden = false; $('edition-stamp').hidden = true; }
    const titleArt = ui('title') || art(manifest.stages[0].src);
    if (titleArt) $('title-backdrop').style.backgroundImage = `url("${titleArt.src}")`;
    // A generated cast ensemble (CFZ Title Ensemble Art) is the startup image for any roster.
    const ensemble = ui('ensemble');
    if (ensemble) { $('title-backdrop').style.setProperty('--ensemble-art', `url("${ensemble.src}")`); document.body.classList.add('cfz-ensemble'); }
    // The included cast uses one composed illustration, rather than layered portraits.
    $('title-fighters').replaceChildren();
    refreshCards(); renderGallery(); setMusic('menu_music');
    $('title-start').disabled = false; $('title-versus').disabled = false; $('title-training').disabled = false; refreshHiScore(); $('title-load-status').textContent = manifest.generationPending ? 'FICTIONAL ART AWAITING GENERATION · PLAY THE PROTOTYPE' : 'PRESS ENTER OR TAP TO START';
    $('opening-replay').hidden = !assetSource(manifest.openingVideo);
    $('opening-skip').addEventListener('click', finishOpening); $('opening-continue').addEventListener('click', finishOpening);
    $('opening-play').addEventListener('click', () => playOpening(true)); $('opening-replay').addEventListener('click', () => playOpening(audioEnabled));
    $('opening-video').addEventListener('ended', finishOpening); $('opening-video').addEventListener('error', finishOpening);
    $('opening-sound').addEventListener('click', () => {
      audioEnabled = $('opening-video').muted; audioInteracted = true; refreshAudio();
      $('opening-sound').textContent = audioEnabled ? 'SOUND ON' : 'ENABLE SOUND'; $('opening-video').play().catch(() => { $('opening-gate').hidden = false; });
    });
    let settingsPausedLocal = false;
    const settings = $('settings-dialog');
    const closeSettings = () => {
      settings.close();
      if (network?.active) network.presence(!document.hidden);
      else if (settingsPausedLocal) pause(false);
      settingsPausedLocal = false;
    };
    $('settings-open').addEventListener('click', () => {
      if (network?.active) network.presence(false);
      else if (state && !paused && state.phase !== 'matchover') { settingsPausedLocal = true; pause(true); }
      settings.showModal();
    });
    $('settings-close').addEventListener('click', closeSettings);
    settings.addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
    settings.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', closeSettings));
    $('fullscreen-button').addEventListener('click', async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); }
      catch (_) { $('fullscreen-button').title = 'Fullscreen is unavailable in this browser. The game already fills the viewport.'; }
    });
    document.addEventListener('fullscreenchange', () => { $('fullscreen-button').textContent = document.fullscreenElement ? '⛶ EXIT FULLSCREEN' : '⛶ FULLSCREEN'; $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); });
    $('title-start').addEventListener('click', () => enterSaga('arcade')); $('title-return').addEventListener('click', showTitle);
    $('title-versus').addEventListener('click', () => enterSaga('versus')); $('title-training').addEventListener('click', () => enterSaga('training'));
    $('stage-prev').addEventListener('click', () => cycleStage(-1)); $('stage-next').addEventListener('click', () => cycleStage(1));
    $('pause-moves').addEventListener('click', showMoveList);
    $('pause-training').addEventListener('click', openTrainingPanel);
    $('pause-quit').addEventListener('click', () => { if (network?.active) { network.open(); return; } paused = false; $('pause-overlay').hidden = true; showTitle(); });
    $('movelist-close').addEventListener('click', () => overlay?.next?.());
    $('win-continue').addEventListener('click', () => overlay?.next?.());
    $('continue-yes').addEventListener('click', () => overlay?.next?.()); $('continue-no').addEventListener('click', () => overlay?.quit?.());
    $('ending-skip').addEventListener('click', () => overlay?.next?.());
    // Training options apply immediately to the running session.
    $('train-action').addEventListener('change', event => { training.action = event.target.value; if (state && mode === 'training') state.cpu = training.action === 'cpu'; });
    $('train-guard').addEventListener('change', event => { training.guard = event.target.value; });
    $('train-meter').addEventListener('change', event => { training.meter = event.target.value; if (state?.options) state.options.trainingMeter = training.meter; });
    for (const [id, key] of [['train-boxes', 'boxes'], ['train-inputs', 'inputs'], ['train-frames', 'frames']]) $(id).addEventListener('change', event => { training[key] = event.target.checked; });
    $('train-reset').addEventListener('click', () => { resetTraining(); closeTrainingPanel(); });
    $('train-close').addEventListener('click', closeTrainingPanel);
    // Persisted options: difficulty, rounds, timer, display filter and the three volume buses.
    const optionInputs = { 'opt-difficulty': 'difficulty', 'opt-rounds': 'rounds', 'opt-time': 'time', 'opt-display': 'display', 'opt-debug': 'debug', 'opt-music': 'music', 'opt-sfx': 'sfx', 'opt-voice': 'voice' };
    for (const [id, key] of Object.entries(optionInputs)) {
      $(id).value = String(options[key]);
      $(id).addEventListener(id.startsWith('opt-m') || id === 'opt-sfx' || id === 'opt-voice' ? 'input' : 'change', event => {
        options[key] = key === 'display' || key === 'debug' ? event.target.value : Number(event.target.value);
        storage.set(OPTIONS_KEY, options); applyOptions();
        if (key === 'sfx') playSound('sfx_menu_move', .6);
      });
    }
    applyOptions();
    $('intro-skip').addEventListener('click', finishIntroduction);
    $('fighter-one').addEventListener('change', event => { selected[0] = Number(event.target.value); reset(); });
    $('fighter-two').addEventListener('change', event => { selected[1] = Number(event.target.value); reset(); });
    $('stage').addEventListener('change', event => { stageIndex = Number(event.target.value); reset(); });
    $('mode').addEventListener('change', reset);
    document.querySelectorAll('[data-pick-slot]').forEach(button => button.addEventListener('click', () => { pickingSlot = Number(button.dataset.pickSlot); refreshCards(); }));
    $('audio-button').addEventListener('click', () => { audioInteracted = true; audioEnabled = !audioEnabled; refreshAudio(); });
    $('start-button').addEventListener('click', start); $('rematch-button').addEventListener('click', start);
    ['reset-button','back-select','result-select'].forEach(id => $(id).addEventListener('click', () => { closeOverlay(); reset(); $('fighter-grid').querySelector(`[data-index="${selected[pickingSlot]}"]`)?.focus({ preventScroll: true }); }));
    $('pause-button').addEventListener('click', () => pause()); $('resume-button').addEventListener('click', () => pause(false));
    $('lab-filter').addEventListener('change', renderGallery);
    document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
      selectedTab = button.dataset.tab; document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button));
      $('arena-view').hidden = selectedTab !== 'arena'; $('lab-view').hidden = selectedTab !== 'lab'; if (selectedTab === 'lab') pause(true);
      setScene(selectedTab === 'lab' ? 'lab' : introScene ? 'intro' : state ? 'fight' : !$('title-screen').hidden ? 'title' : 'selection');
    }));
    window.addEventListener('keydown', event => {
      if (settings.open || network?.dialog.open || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      const interactiveTarget = !!event.target.closest?.('button, a, audio');
      idleTime = 0;
      if (demo) { event.preventDefault(); endDemo(true); return; }
      // Full-screen arcade overlays own the keyboard while they are visible.
      if (overlay && selectedTab === 'arena' && !event.repeat) {
        if (overlay.key) { event.preventDefault(); overlay.key(event.code); return; }
        if (overlay.type === 'continue') {
          if (event.code === 'Escape') { event.preventDefault(); overlay.quit(); return; }
          if (['KeyA', 'KeyS', 'KeyD', 'KeyF'].includes(event.code)) { event.preventDefault(); overlay.tick(); return; }
        }
        if (['Enter', 'Space', 'Escape'].includes(event.code) && overlay.next && (!interactiveTarget || event.code !== 'Enter' || event.target.closest('.vs-screen, .win-screen, .continue-screen, .ending-screen, .gameover-screen, .movelist-overlay'))) {
          event.preventDefault(); if (event.code === 'Escape' && overlay.type === 'continue') overlay.quit(); else overlay.next(); return;
        }
      }
      // Arrow keys move focus between menu buttons on the title, pause and result screens.
      const menu = event.target.closest?.('.title-copy, .pause-overlay, .match-overlay, .continue-screen, .training-panel');
      if (menu && interactiveTarget && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code) && !event.target.closest('.fighter-tile')) {
        const buttons = [...menu.querySelectorAll('button:not([hidden]):not([disabled])')].filter(button => button.offsetParent !== null);
        const index = buttons.indexOf(event.target);
        if (index >= 0) { event.preventDefault(); buttons[(index + (['ArrowUp', 'ArrowLeft'].includes(event.code) ? -1 : 1) + buttons.length) % buttons.length].focus(); playSound('sfx_menu_move', .4); return; }
      }
      if (openingActive) {
        if (!event.repeat && (event.code === 'Escape' || event.code === 'Space' && (!interactiveTarget || event.target.closest('#opening-skip')))) { event.preventDefault(); finishOpening(); }
        return;
      }
      if (selectedTab === 'arena' && !$('selection-screen').hidden) {
        const tile = event.target.closest('.fighter-tile');
        if (tile && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code)) {
          // Move through the visible grid; Arcade hides the final boss.
          event.preventDefault();
          const tiles = [...$('fighter-grid').querySelectorAll('.fighter-tile')].map(item => Number(item.dataset.index));
          const position = Math.max(0, tiles.indexOf(selected[pickingSlot])), step = event.code === 'ArrowLeft' ? -1 : event.code === 'ArrowRight' ? 1 : event.code === 'ArrowUp' ? -3 : 3;
          chooseFighter(tiles[(position + step + tiles.length * 3) % tiles.length]); playSound('sfx_menu_move', .4); return;
        }
        if (!event.repeat && ['KeyQ', 'KeyE', 'BracketLeft', 'BracketRight'].includes(event.code) && mode !== 'arcade') { event.preventDefault(); cycleStage(['KeyQ', 'BracketLeft'].includes(event.code) ? -1 : 1); return; }
        if (!event.repeat && event.code === 'Tab' && mode !== 'arcade' && tile) { event.preventDefault(); pickingSlot = pickingSlot ? 0 : 1; refreshCards(); $('fighter-grid').querySelector(`[data-index="${selected[pickingSlot]}"]`)?.focus({ preventScroll: true }); return; }
        if (!event.repeat && event.code === 'Enter' && (tile || !interactiveTarget)) { event.preventDefault(); playSound('sfx_menu_select', .5); start(); return; }
        if (!event.repeat && event.code === 'Escape') { event.preventDefault(); showTitle(); return; }
      }
      if (selectedTab === 'arena' && introScene && !paused && !event.repeat && (event.code === 'Escape' || ['Enter', 'Space'].includes(event.code) && (!interactiveTarget || event.target.closest('#intro-skip')))) { event.preventDefault(); finishIntroduction(); return; }
      if (selectedTab === 'arena' && !$('title-screen').hidden && ['Enter', 'Space'].includes(event.code) && !event.repeat && !interactiveTarget) { event.preventDefault(); playSound('sfx_menu_select', .5); enterSaga('arcade'); return; }
      if (selectedTab === 'arena' && mode === 'training' && state && !paused && event.code === 'KeyR' && !event.repeat) { event.preventDefault(); resetTraining(); return; }
      if (selectedTab === 'arena' && event.code === 'Escape' && !event.repeat) { event.preventDefault(); pause(); return; }
      if (controls.some(map => map[event.code]) && state && !introScene && selectedTab === 'arena') { event.preventDefault(); keys.add(event.code); if (!event.repeat) pendingKeys.add(event.code); }
    });
    window.addEventListener('keyup', event => keys.delete(event.code));
    window.addEventListener('blur', () => { clearInput(); if (!network?.active) pause(true); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearInput(); if (!network?.active) pause(true); titleMotion.stop(); selectMotion.stop(); if (openingActive) $('opening-video').pause(); }
      else if (openingActive) $('opening-video').play().catch(() => { if (openingActive) $('opening-gate').hidden = false; });
    });
    document.querySelectorAll('[data-control]').forEach(button => {
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touch[button.dataset.control] = true; });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, () => { delete touch[button.dataset.control]; }));
    });
    if (window.FighterMultiplayer) {
      network = new window.FighterMultiplayer(manifest, {
        unlock: engageAudio, clearInput,
        idle: () => { if (openingActive) finishOpening(); showTitle(); },
        focus: () => { if (state) canvas.focus({ preventScroll: true }); },
        connection: connected => { if (!connected && state) { paused = true; clearInput(); music?.pause(); introVoice?.pause(); } },
        room: (room, role, side) => {
          networkRole = role; networkSide = side; paused = !!room.paused;
          if (paused) { clearInput(); music?.pause(); introVoice?.pause(); } else if (state) refreshAudio();
        },
        match: networkMatch, snapshot: receiveSnapshot,
        introComplete: () => { clearIntro(); clearInput(); setScene('fight'); $('versus-overlay').hidden = state?.frame > 50; $('touch-panel').hidden = networkRole === 'projection'; canvas.focus({ preventScroll: true }); },
        end: () => { networkRole = null; networkSide = null; networkMatchId = null; clearInput();
          $('back-select').textContent = '? CHARACTER SELECT'; $('reset-button').textContent = 'CHANGE FIGHTERS ?'; $('result-select').textContent = 'CHARACTER SELECT'; showTitle(); }
      });
      $('title-online').disabled = false; $('title-phones').disabled = false;
    }
    if (!network?.autoConnect() && assetSource(manifest.openingVideo)) playOpening(false);
    requestAnimationFrame(frame);
  }
  init();
})();
