(() => {
  'use strict';
  const $ = id => document.getElementById(id), source = item => typeof item === 'string' ? item : item?.src;
  const keyMap = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'down', KeyA: 'punch', KeyS: 'kick', KeyD: 'heavy', KeyF: 'special', KeyG: 'taunt' };
  class Controller {
    constructor() {
      this.room = null; this.side = null; this.seq = 0; this.manifest = null; this.catalog = [];
      this.pointers = new Map(); this.keyboard = new Set(); this.stickKeys = {}; this.lastKeys = ''; this.lastSent = 0;
      this.client = new window.FighterSessionClient('controller', {
        status: message => this.status(message), message: message => this.receive(message),
        disconnect: () => { this.clearInput(); this.render(); }, fatal: message => this.fail(message),
        latency: ms => { $('controller-latency').textContent = ms + ' ms'; }
      });
      fetch(new URL('assets/manifest.json', window.FighterSessionClient.baseURL())).then(response => response.ok ? response.json() : null).then(manifest => { this.manifest = manifest; this.render(); }).catch(() => {});
      $('controller-ready').onclick = () => { this.wake(); this.client.send({ type: 'ready', ready: !this.room?.players[this.side]?.ready }); };
      $('controller-leave').onclick = () => { this.clearInput(); this.client.stop(true); this.fail('You left the session. Scan a fresh player code to play again.'); };
      $('controller-fullscreen').onclick = async () => { try { await document.documentElement.requestFullscreen?.(); } catch (_) {} this.wake(); };
      this.bindControls();
      const presence = active => { this.clearInput(); this.client.send({ type: 'presence', active }); if (active && this.room) this.wake(); };
      document.addEventListener('visibilitychange', () => presence(!document.hidden));
      addEventListener('blur', () => presence(false)); addEventListener('focus', () => presence(!document.hidden));
      addEventListener('pagehide', () => presence(false)); addEventListener('pageshow', () => presence(!document.hidden));
      setInterval(() => this.flush(), 90);
      addEventListener('hashchange', () => { if (this.room) this.status('This phone is paired. Leave the current session before joining another.'); else this.connectFromURL(); });
      this.connectFromURL();
      window.FighterControllerDebug = Object.freeze({ snapshot: () => ({ connected: this.client.ready, side: this.side, phase: this.room?.phase, paused: !!this.room?.paused, fighter: this.room?.players[this.side]?.fighter, ready: this.room?.players[this.side]?.ready, frame: this.frame || 0, matchId: this.matchId, held: this.heldKeys(), pointers: this.pointers.size }) });
    }
    connectFromURL() {
      if (window.CFZ_CONFIG?.multiplayer === false) { this.status('Phone controllers need the multiplayer server. Run npm start from the exported game folder, then scan its player code.'); return; }
      const url = new URL(location.href), sessionId = url.searchParams.get('session') || url.pathname.match(/\/controller\/([a-f\d-]+)\/?$/)?.[1];
      const hash = new URLSearchParams(url.hash.slice(1)), side = Number(hash.get('side'));
      const saved = sessionId && window.FighterSessionClient.saved('controller', sessionId);
      if (saved?.token) this.client.open({ action: 'resume', sessionId, token: saved.token });
      else if (sessionId && hash.has('side') && [0, 1].includes(side) && hash.get('pair')) {
        $('controller-pair').hidden = false; $('controller-pair').disabled = false; $('controller-pair').textContent = 'CONNECT AS PLAYER ' + (side + 1);
        this.status('Ready to connect Player ' + (side + 1) + '.'); $('controller-instructions').textContent = 'Connect this phone to Player ' + (side + 1) + ' on the shared screen.';
        $('controller-pair').onclick = () => { this.wake(); $('controller-pair').disabled = true; this.client.open({ action: 'pair', sessionId, side, pairToken: hash.get('pair') }); };
      } else if (sessionId) this.status('Scan a current player QR code to claim a controller.');
    }
    status(message) { $('controller-status').textContent = message; }
    async wake() { try { if (!document.hidden && (!this.wakeLock || this.wakeLock.released)) this.wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) {} }
    receive(msg) {
      if (msg.type === 'welcome') {
        this.room = msg.room; this.side = msg.side; this.catalog = msg.catalog?.fighters || []; this.seq = 0; this.lastKeys = ''; this.lastSent = 0;
        const url = new URL('controller.html', window.FighterSessionClient.baseURL()); url.searchParams.set('session', msg.room.sessionId);
        history.replaceState(null, '', url); this.client.send({ type: 'presence', active: !document.hidden }); this.render();
      } else if (msg.type === 'room') {
        this.room = msg.room; if (!this.canInput()) this.clearInput(); this.render();
      } else if (msg.type === 'match') {
        this.matchId = msg.matchId; this.frame = msg.state.frame; this.clearInput(); this.render();
      } else if (msg.type === 'controller_state' && msg.matchId === this.matchId) {
        this.frame = msg.frame;
        $('controller-match-status').textContent = msg.phase === 'intro' ? 'FIGHTERS ENTERING / LOOK AT THE TV' : msg.phase === 'matchover' ? 'MATCH COMPLETE' : 'LOOK UP AT THE BIG SCREEN';
      } else if (msg.type === 'peer_left' || msg.type === 'error') { this.clearInput(); this.status(msg.message); }
    }
    render() {
      const room = this.room, connected = this.client.ready;
      $('controller-connect').hidden = !!room; $('controller-leave').hidden = !room;
      const fighting = !!room && ['intro', 'playing'].includes(room.phase);
      $('controller-lobby').hidden = !room || fighting; $('controller-controls').hidden = !fighting;
      document.body.classList.toggle('is-playing', fighting);
      if (!room) return;
      const mine = room.players[this.side], solo = room.playMode === 'solo';
      $('controller-player').textContent = 'PLAYER ' + (this.side + 1) + (solo ? ' / VS CPU' : ' / VERSUS');
      document.body.dataset.side = String(this.side);
      const fighters = this.catalog.length ? this.catalog : this.manifest?.fighters || [];
      $('controller-roster').replaceChildren(...fighters.map(fighter => {
        const data = this.manifest?.fighters?.find(f => f.id === fighter.id) || fighter;
        const button = document.createElement('button'); button.className = 'network-fighter'; button.dataset.fighter = fighter.id;
        button.disabled = !connected || !!mine?.ready || fighting; button.setAttribute('aria-pressed', String(mine?.fighter === fighter.id));
        const portrait = source(data.portrait) || source(data.hero);
        if (portrait) { const image = document.createElement('img'); image.src = new URL(portrait, window.FighterSessionClient.baseURL()); image.alt = ''; button.append(image); }
        const name = document.createElement('span'); name.textContent = fighter.name; button.append(name);
        button.onclick = () => this.client.send({ type: 'fighter', fighter: fighter.id }); return button;
      }));
      const fighter = fighters.find(f => f.id === mine?.fighter);
      $('controller-count').textContent = fighter ? '1 / 1' : '0 / 1'; $('controller-fighter-detail').textContent = fighter?.introTagline || 'Choose a fighter from the roster.';
      $('controller-ready').disabled = !connected || !mine?.fighter || fighting;
      $('controller-ready').textContent = mine?.ready ? 'NOT READY / CHANGE FIGHTER' : room.phase === 'finished' ? 'READY FOR REMATCH' : 'READY TO FIGHT';
      $('controller-result').textContent = room.phase === 'finished' ? 'RUN IT BACK?' : 'CHOOSE YOUR FIGHTER';
      $('controller-paused').hidden = !fighting || connected && !room.paused;
      $('controller-pause-reason').textContent = connected ? 'WAITING FOR EVERY PLAYER' : 'RECONNECTING THIS PHONE';
      $('controller-pad').inert = !connected || room.paused || room.phase !== 'playing';
      if (room.phase === 'intro') $('controller-match-status').textContent = 'FIGHTERS ENTERING / LOOK AT THE TV';
      this.status(!connected ? 'Connection lost. Reconnecting…' : fighting ? room.paused ? 'Return to the TV and all controllers to resume.' : 'Connected. Your phone controls P' + (this.side + 1) + '.' : mine?.ready ? solo ? 'Ready. Waiting for the shared screen…' : 'Ready. Waiting for the other player…' : room.phase === 'finished' ? 'Choose a fighter, then ready up for a rematch.' : 'Pick one fighter, then tap Ready to fight.');
    }
    bindControls() {
      for (const button of document.querySelectorAll('[data-key]')) {
        button.addEventListener('pointerdown', event => {
          event.preventDefault(); if (!this.canInput()) return;
          button.setPointerCapture(event.pointerId); this.pointers.set(event.pointerId, button.dataset.key); button.classList.add('down'); this.flush(true);
        });
        const release = event => { this.pointers.delete(event.pointerId); button.classList.toggle('down', [...this.pointers.values()].includes(button.dataset.key)); this.flush(true); };
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
        button.addEventListener('contextmenu', event => event.preventDefault());
      }
      const stick = $('controller-stick');
      const move = event => {
        const box = stick.getBoundingClientRect(), radius = box.width / 2;
        const x = Math.max(-1, Math.min(1, (event.clientX - box.left - radius) / radius));
        const y = Math.max(-1, Math.min(1, (event.clientY - box.top - radius) / radius));
        this.stickKeys = { ...(x < -.25 ? { left: true } : x > .25 ? { right: true } : {}), ...(y < -.25 ? { jump: true } : y > .25 ? { down: true } : {}) };
        $('controller-nub').style.transform = 'translate(' + x * 32 + 'px,' + y * 32 + 'px)'; this.flush(true);
      };
      stick.addEventListener('pointerdown', event => { event.preventDefault(); if (!this.canInput() || this.stickPointer !== undefined) return; this.stickPointer = event.pointerId; stick.setPointerCapture(event.pointerId); move(event); });
      stick.addEventListener('pointermove', event => { if (event.pointerId === this.stickPointer && this.canInput()) { event.preventDefault(); move(event); } });
      const releaseStick = event => { if (event.pointerId !== this.stickPointer) return; this.stickPointer = undefined; this.stickKeys = {}; $('controller-nub').style.transform = ''; this.flush(true); };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, releaseStick);
      stick.addEventListener('contextmenu', event => event.preventDefault());
      addEventListener('keydown', event => { if (!keyMap[event.code] || !this.canInput()) return; event.preventDefault(); this.keyboard.add(keyMap[event.code]); this.flush(true); });
      addEventListener('keyup', event => { if (keyMap[event.code]) { this.keyboard.delete(keyMap[event.code]); this.flush(true); } });
    }
    canInput() { return this.client.ready && this.room?.phase === 'playing' && !this.room.paused && !document.hidden; }
    heldKeys() { const keys = { ...this.stickKeys }; for (const key of [...this.pointers.values(), ...this.keyboard]) keys[key] = true; return keys; }
    flush(force = false) {
      if (!this.canInput()) return;
      const keys = this.heldKeys(), encoded = JSON.stringify(keys), now = performance.now();
      if (!force && encoded === this.lastKeys && now - this.lastSent < 85) return;
      this.lastKeys = encoded; this.lastSent = now; this.client.send({ type: 'input', seq: ++this.seq, keys });
    }
    clearInput() {
      this.pointers.clear(); this.keyboard.clear(); this.stickKeys = {}; this.stickPointer = undefined; this.lastKeys = '';
      for (const button of document.querySelectorAll('[data-key].down')) button.classList.remove('down'); $('controller-nub').style.transform = '';
      if (this.client.ready) this.client.send({ type: 'input', seq: ++this.seq, keys: {} });
    }
    fail(message) {
      this.clearInput(); this.room = null; this.side = null; this.matchId = null; this.frame = 0;
      $('controller-pair').hidden = true; $('controller-player').textContent = 'PHONE CONTROLLER';
      $('controller-instructions').textContent = 'Scan a fresh player code on the shared screen to connect.';
      history.replaceState(null, '', new URL('controller.html', window.FighterSessionClient.baseURL())); this.render(); this.status(message);
      this.wakeLock?.release().catch(() => {});
    }
  }
  new Controller();
})();
