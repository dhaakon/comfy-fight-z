(() => {
  'use strict';
  const $ = id => document.getElementById(id), source = item => typeof item === 'string' ? item : item?.src;
  class Multiplayer {
    constructor(manifest, hooks) {
      this.manifest = manifest; this.hooks = hooks; this.room = null; this.role = 'player';
      this.side = null; this.seq = 0; this.lastKeys = ''; this.lastSent = 0; this.keys = {};
      this.pairing = []; this.dialogPaused = false;
      const dialog = document.createElement('dialog'); dialog.id = 'network-dialog'; dialog.className = 'network-dialog';
      dialog.innerHTML = `<div class="network-heading"><div><p class="eyebrow">COMFY FIGHTER Z / CONNECT</p><h2 id="network-title">ONLINE VERSUS</h2></div><button id="network-close" class="text-button" aria-label="Close session panel">CLOSE ×</button></div>
        <p id="network-status" class="network-status" role="status">Invite a friend. Each player chooses one fighter.</p>
        <div id="network-setup"><div id="network-online-setup"><button id="network-create" class="primary">CREATE A ROOM</button><label class="network-join-label">HAVE AN INVITE?<input id="network-code" autocomplete="off" maxlength="300" placeholder="Paste an invite link or room code"></label><button id="network-join" class="text-button">JOIN ROOM →</button></div>
        <div id="network-projection-setup" hidden><p>Put this screen on a TV, then scan a QR code with your phone. No app or account needed.</p><fieldset class="network-play-modes"><legend>PLAY MODE</legend><label><input type="radio" name="network-play-mode" value="solo" checked><span>1 PHONE VS CPU</span></label><label><input type="radio" name="network-play-mode" value="versus"><span>2 PHONES VS</span></label></fieldset><button id="network-project" class="primary">START SHARED SCREEN</button><p class="network-help">On a home network, open the game using your computer’s LAN address so phones can reach it.</p></div></div>
        <section id="network-lobby" hidden><div class="network-room-line"><strong id="network-room-code"></strong><span id="network-latency"></span></div><div id="network-invite-box"><label>INVITE YOUR OPPONENT<input id="network-invite" readonly aria-label="Invite link"></label><button id="network-copy" class="text-button">COPY INVITE</button></div>
        <div id="network-seats" class="network-seats"></div><div id="network-pairing" class="network-pairing" hidden></div>
        <div id="network-player-choice"><p class="eyebrow">YOUR FIGHTER</p><div id="network-roster" class="network-roster"></div><p id="network-fighter-detail" class="network-help"></p><button id="network-ready" class="primary">READY TO FIGHT</button></div>
        <div id="network-projection-actions" hidden><button id="network-refresh" class="text-button">REFRESH UNCLAIMED QR CODES</button></div>
        <div class="network-room-actions"><button id="network-watch" class="text-button" hidden>RETURN TO THE FIGHT</button><button id="network-leave" class="text-button">LEAVE SESSION</button></div></section>
        <p class="network-help">Online players: arrows to move · A punch · S kick · D heavy · F special.</p>`;
      document.body.append(dialog); this.dialog = dialog;
      const badge = document.createElement('button'); badge.id = 'network-badge'; badge.className = 'network-badge'; badge.hidden = true; badge.textContent = 'SESSION'; document.body.append(badge);
      const pause = document.createElement('div'); pause.id = 'network-pause'; pause.className = 'network-pause'; pause.hidden = true;
      pause.innerHTML = '<p class="eyebrow">MATCH ON HOLD</p><h2 id="network-pause-reason">RECONNECTING</h2><p>Return to every connected game screen or phone to resume.</p><button id="network-manage" class="primary">SESSION PANEL</button>';
      $('fight-screen').append(pause);
      $('title-online').onclick = () => this.open('player'); $('title-phones').onclick = () => this.open('projection');
      $('network-close').onclick = () => this.close(); dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
      $('network-create').onclick = () => this.connect('player', { action: 'create' });
      $('network-project').onclick = () => this.connect('projection', { action: 'create', playMode: document.querySelector('input[name="network-play-mode"]:checked').value });
      $('network-join').onclick = () => this.join($('network-code').value);
      $('network-code').addEventListener('keydown', event => { if (event.key === 'Enter') this.join(event.target.value); });
      $('network-copy').onclick = async () => { try { await navigator.clipboard.writeText($('network-invite').value); this.status('Invite copied. Send it to your opponent.'); } catch (_) { $('network-invite').select(); this.status('Copy the selected invite link.'); } };
      $('network-ready').onclick = () => { this.hooks.unlock(); this.client?.send({ type: 'ready', ready: !this.room?.players[this.side]?.ready }); };
      $('network-leave').onclick = () => this.leave(); $('network-watch').onclick = () => this.close();
      $('network-refresh').onclick = () => this.client?.send({ type: 'refresh_pairing' });
      $('network-badge').onclick = () => this.open(); $('network-manage').onclick = () => this.open();
      const presence = () => this.presence(!document.hidden && document.hasFocus());
      addEventListener('blur', () => this.presence(false)); addEventListener('focus', presence);
      addEventListener('pagehide', () => this.presence(false)); addEventListener('pageshow', presence);
      document.addEventListener('visibilitychange', presence);
      setInterval(() => this.flush(), 90);
    }
    get active() { return !!this.room; }
    get playable() { return !!this.room && this.role === 'player' && this.client?.ready && this.room.phase === 'playing' && !this.room.paused && !this.dialog.open && !document.hidden; }
    status(message) { $('network-status').textContent = message; }
    open(role = this.role) {
      this.hooks.unlock();
      if (!this.room) { this.role = role; this.hooks.idle(); }
      $('network-title').textContent = this.role === 'projection' ? 'PHONE CONTROLLERS' : 'ONLINE VERSUS';
      $('network-online-setup').hidden = this.role !== 'player'; $('network-projection-setup').hidden = this.role !== 'projection';
      if (!this.dialog.open) this.dialog.showModal();
      if (this.room && ['intro', 'playing'].includes(this.room.phase)) { this.dialogPaused = true; this.presence(false); }
      this.render();
      if (window.CFZ_CONFIG?.multiplayer === false) {
        this.status('This is a static preview. Run npm start from the exported game folder, or use the hosted multiplayer demo to connect players and phones.');
        ['network-create', 'network-join', 'network-project'].forEach(id => { $(id).disabled = true; });
      }
    }
    close() { this.dialog.close(); this.dialogPaused = false; this.presence(!document.hidden); this.hooks.focus(); }
    join(value) {
      let code = value.trim(); try { code = new URL(code).searchParams.get('room') || ''; } catch (_) {}
      if (!/^[a-f\d]{12}$/i.test(code)) return this.status('Use the 12-character room code or the full invite link.');
      code = code.toUpperCase(); const saved = window.FighterSessionClient.saved('player', code);
      this.connect('player', saved?.token ? { action: 'resume', room: code, token: saved.token } : { action: 'join', room: code });
    }
    connect(role, hello) {
      if (window.CFZ_CONFIG?.multiplayer === false) { this.open(role); return; }
      this.client?.dispose(); this.room = null; this.role = role; this.pairing = []; this.lastMatchId = null;
      this.client = new window.FighterSessionClient(role, {
        status: message => this.status(message), message: msg => this.receive(msg),
        latency: ms => { $('network-latency').textContent = ms + ' ms'; },
        disconnect: () => { this.clearInput(); this.hooks.connection(false); this.render(); },
        fatal: message => { this.room = null; this.hooks.end(); this.open(role); this.status(message); this.render(); }
      });
      this.client.open(hello); this.render();
    }
    autoConnect() {
      const url = new URL(location.href), project = url.searchParams.get('project') || url.pathname.match(/\/project\/([a-f\d-]+)\/?$/)?.[1], room = url.searchParams.get('room');
      if (project) {
        this.open('projection'); const saved = window.FighterSessionClient.saved('projection', project);
        if (saved?.token) this.connect('projection', { action: 'resume', sessionId: project, token: saved.token });
        else this.status('Start a new shared screen here. Its controls will appear as QR codes.');
        return true;
      }
      if (room) { this.open('player'); $('network-code').value = room; this.join(room); return true; }
      return false;
    }
    receive(msg) {
      if (msg.type === 'welcome') {
        this.room = msg.room; this.side = msg.side; this.seq = 0; this.keys = {}; this.lastKeys = ''; this.lastSent = 0;
        const url = new URL(location.href); url.searchParams.delete('room'); url.searchParams.delete('project');
        url.searchParams.set(this.role === 'projection' ? 'project' : 'room', this.role === 'projection' ? msg.room.sessionId : msg.room.code); url.hash = '';
        history.replaceState(null, '', url); this.hooks.connection(true); this.presence(!document.hidden);
        this.hooks.room(msg.room, this.role, this.side); this.render();
      } else if (msg.type === 'room') {
        const returnedToLobby = this.room && this.room.phase !== 'lobby' && msg.room.phase === 'lobby';
        this.room = msg.room; this.hooks.room(msg.room, this.role, this.side);
        if (!this.playable) this.clearInput(); this.render();
        if (returnedToLobby) this.open();
      } else if (msg.type === 'match') {
        const fresh = msg.matchId !== this.lastMatchId; this.lastMatchId = msg.matchId; this.clearInput(); this.close();
        this.hooks.match(msg, this.role, this.side, fresh); this.render();
      } else if (msg.type === 'snapshot') this.hooks.snapshot(msg);
      else if (msg.type === 'intro_complete') this.hooks.introComplete();
      else if (msg.type === 'pairing') { this.pairing = msg.seats || []; this.renderPairing(); }
      else if (msg.type === 'error' || msg.type === 'peer_left') this.status(msg.message);
    }
    invite() {
      const url = new URL(window.CFZ_CONFIG?.publicUrl || window.FighterSessionClient.baseURL());
      url.search = ''; url.hash = ''; url.searchParams.set('room', this.room.code); return url.href;
    }
    render() {
      const room = this.room, clientReady = !!this.client?.ready;
      $('network-setup').hidden = !!room; $('network-lobby').hidden = !room; $('network-badge').hidden = !room;
      $('network-pause').hidden = !room || !['intro', 'playing'].includes(room.phase) || clientReady && !room.paused;
      $('network-pause-reason').textContent = !clientReady ? 'RECONNECTING' : room?.pauseReason || 'WAITING FOR ALL PLAYERS';
      if (!room) return;
      const mine = room.players[this.side], projection = this.role === 'projection';
      $('network-title').textContent = projection ? 'PHONE CONTROLLERS' : 'ONLINE VERSUS';
      $('network-room-code').textContent = projection ? 'SHARED SCREEN / ' + (room.playMode === 'solo' ? 'PHONE VS CPU' : 'TWO PLAYERS') : 'ROOM ' + room.code;
      $('network-badge').textContent = projection ? 'PHONE SESSION' : 'ONLINE / P' + (this.side + 1);
      $('network-invite-box').hidden = projection; if (!projection) $('network-invite').value = this.invite();
      $('network-player-choice').hidden = projection; $('network-pairing').hidden = !projection; $('network-projection-actions').hidden = !projection;
      const fighting = ['intro', 'playing'].includes(room.phase); $('network-watch').hidden = !fighting;
      $('network-seats').replaceChildren(...room.players.map((player, side) => {
        const seat = document.createElement('article'); seat.className = 'network-seat';
        const label = document.createElement('span'); label.textContent = 'P' + (side + 1) + (player?.cpu ? ' / CPU' : side === this.side ? ' / YOU' : '');
        const fighter = this.manifest.fighters.find(f => f.id === player?.fighter);
        const name = document.createElement('strong'); name.textContent = fighter?.name || 'OPEN SEAT';
        const status = document.createElement('small'); status.textContent = !player ? 'Waiting for a challenger' : !player.connected ? 'Reconnecting…' : player.ready ? 'READY' : fighting ? 'IN THE MATCH' : 'Choosing a fighter';
        seat.append(label, name, status);
        if (projection && player && !player.cpu) { const release = document.createElement('button'); release.className = 'text-button'; release.textContent = 'RELEASE PHONE'; release.onclick = () => this.client.send({ type: 'release_controller', side }); seat.append(release); }
        return seat;
      }));
      if (!projection) {
        $('network-roster').replaceChildren(...this.manifest.fighters.map(fighter => {
          const button = document.createElement('button'); button.className = 'network-fighter'; button.dataset.fighter = fighter.id;
          button.disabled = !clientReady || fighting || !!mine?.ready; button.setAttribute('aria-pressed', String(mine?.fighter === fighter.id));
          const imgSource = source(fighter.portrait) || source(fighter.hero);
          if (imgSource) { const image = document.createElement('img'); image.src = imgSource; image.alt = ''; button.append(image); }
          const name = document.createElement('span'); name.textContent = fighter.name; button.append(name);
          button.onclick = () => { this.hooks.unlock(); this.client.send({ type: 'fighter', fighter: fighter.id }); };
          return button;
        }));
        const fighter = this.manifest.fighters.find(f => f.id === mine?.fighter);
        $('network-fighter-detail').textContent = fighter ? (fighter.specialMove?.name || fighter.name) + ' / ' + (fighter.introTagline || 'Ready for the next challenger.') : 'Choose one fighter, then ready up.';
        $('network-ready').disabled = !clientReady || !mine?.fighter || fighting;
        $('network-ready').textContent = mine?.ready ? 'NOT READY / CHANGE FIGHTER' : room.phase === 'finished' ? 'READY FOR REMATCH' : 'READY TO FIGHT';
      }
      this.status(!clientReady ? 'Connection lost. Reconnecting…' : fighting ? room.paused ? 'Match paused until every player returns.' : 'Match in progress.' : room.phase === 'finished' ? 'Choose your fighter and ready up for a rematch.' : projection ? 'Scan a player code, choose your fighter on the phone and tap Ready.' : mine?.ready ? 'Ready. Waiting for your opponent…' : 'Choose your fighter. Both players must be ready.');
      if (projection) this.renderPairing();
    }
    renderPairing() {
      if (this.role !== 'projection' || !this.room) return;
      $('network-pairing').replaceChildren(...this.pairing.flatMap((entry, index) => {
        if (!entry || this.room.players[entry.side ?? index]) return [];
        const card = document.createElement('article'); card.className = 'network-qr'; const side = entry.side ?? index;
        const label = document.createElement('h3'); label.textContent = 'PLAYER ' + (side + 1);
        const image = document.createElement('img'); image.src = entry.qr; image.alt = 'Scan to connect Player ' + (side + 1); image.width = 220; image.height = 220;
        const hint = document.createElement('p'); hint.textContent = 'Scan with your phone camera';
        const link = document.createElement('a'); link.href = entry.url; link.textContent = 'OPEN CONTROLLER'; link.target = '_blank'; link.rel = 'noopener noreferrer';
        card.append(label, image, hint, link); return [card];
      }));
    }
    presence(active) {
      if (!this.client?.ready) return;
      this.clearInput(); this.hooks.clearInput(); this.client.send({ type: 'presence', active: !!active && !this.dialogPaused });
    }
    input(keys) { this.keys = this.playable ? keys : {}; this.flush(); }
    flush() {
      if (!this.playable) return;
      const encoded = JSON.stringify(this.keys), now = performance.now();
      if (encoded === this.lastKeys && now - this.lastSent < 85) return;
      this.lastKeys = encoded; this.lastSent = now; this.client.send({ type: 'input', seq: ++this.seq, keys: this.keys });
    }
    clearInput() { this.keys = {}; this.lastKeys = ''; if (this.client?.ready && this.role === 'player') this.client.send({ type: 'input', seq: ++this.seq, keys: {} }); }
    introDone(skip = false) { this.client?.send({ type: skip ? 'skip_intro' : 'intro_done' }); }
    rematch() { this.open(); }
    leave() {
      this.client?.dispose(true); this.client = null; this.room = null; this.side = null; this.lastMatchId = null; this.dialogPaused = false;
      const url = new URL(location.href); url.searchParams.delete('room'); url.searchParams.delete('project'); history.replaceState(null, '', url);
      this.dialog.close(); this.render(); this.hooks.end();
    }
  }
  window.FighterMultiplayer = Multiplayer;
})();
