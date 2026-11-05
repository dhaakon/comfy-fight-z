'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');

const VERSION = 1;
const STEP = 1000 / 60;
const INPUTS = ['left', 'right', 'jump', 'down', 'punch', 'kick', 'heavy', 'special', 'taunt'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2' };
const PUBLIC_FILES = new Set(['index.html', 'game.js', 'engine.js', 'anim.js', 'style.css', 'session-client.js', 'multiplayer.js', 'network.css', 'controller.html', 'controller.js', 'favicon.ico', 'LICENSE', 'THIRD-PARTY-NOTICES.txt']);

function browserURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Public URLs must be HTTP(S) addresses without credentials.');
  url.search = ''; url.hash = '';
  return url;
}

function basePath(value) {
  if (typeof value !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value))
    throw new Error('Game mount paths must start and end with / and contain simple path segments.');
  return value;
}

function createGameServer(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '../public'));
  const configuredUrl = options.publicUrl ?? process.env.PUBLIC_URL;
  const publicUrl = configuredUrl ? browserURL(configuredUrl).href : null;
  const configuredOrigins = options.publicOrigins ?? options.publicOrigin ?? process.env.PUBLIC_ORIGINS ?? process.env.PUBLIC_ORIGIN ?? publicUrl ?? '';
  const origins = Array.isArray(configuredOrigins) ? configuredOrigins : configuredOrigins.split(',');
  const allowedOrigins = new Set(origins.map(value => value.trim()).filter(Boolean).map(value => browserURL(value).origin));
  const mounts = Object.entries(options.mounts || { '/': root }).map(([mount, directory]) => {
    const gameRoot = fs.realpathSync(path.resolve(directory));
    // This intentionally stays a runtime require when the transport is bundled for export.
    const runtimeRequire = createRequire(path.join(gameRoot, 'start-server.cjs'));
    const engine = runtimeRequire(path.join(gameRoot, 'engine.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(gameRoot, 'assets/manifest.json'), 'utf8'));
    const fighters = manifest.fighters?.map(f => ({ id: f.id, name: f.name, color: f.color, introTagline: f.introTagline, style: f.style, boss: f.boss === true })) || [];
    const stages = manifest.stages?.map(s => ({ id: s.id, name: s.name })) || [];
    if (!fighters.length || !stages.length || fighters.some(f => typeof f.id !== 'string') || stages.some(s => typeof s.id !== 'string') || new Set(fighters.map(f => f.id)).size !== fighters.length || new Set(stages.map(s => s.id)).size !== stages.length)
      throw new Error('Every game mount needs a runtime manifest with unique fighter and stage IDs.');
    if (typeof engine.create !== 'function' || typeof engine.tick !== 'function') throw new Error('Game mount engine must expose create() and tick().');
    // Fighting styles travel with the runtime manifest so online matches use each fighter's moveset.
    const profiles = Object.fromEntries(fighters.map(f => [f.id, { style: f.style, boss: f.boss }]));
    return { basePath: basePath(mount), root: gameRoot, engine, profiles, catalog: { fighters, stages }, fighters: new Set(fighters.map(f => f.id)), stages: new Set(stages.map(s => s.id)) };
  }).sort((a, b) => b.basePath.length - a.basePath.length);
  if (!mounts.length) throw new Error('Configure at least one game mount.');
  const findMount = pathname => mounts.find(game => pathname.startsWith(game.basePath));
  const canonicalBase = (game, origin) => {
    const url = browserURL(publicUrl || origin);
    // A single exported game may itself be hosted beneath a public URL prefix.
    url.pathname = game.basePath === '/' && mounts.length === 1 ? url.pathname.replace(/\/?$/, '/') : game.basePath;
    return url.href;
  };
  const rooms = new Map(), sessions = new Map();
  const graceMs = options.graceMs ?? 45000, pairingMs = options.pairingMs ?? 600000;
  const idleMs = options.idleMs ?? 900000, maxRooms = options.maxRooms ?? 64;
  const introMs = options.introMs ?? 30000;
  let closed = false;

  const server = http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
    const game = findMount(pathname);
    if (!game || pathname.includes('\0') || pathname.includes('\\')) { res.writeHead(404); return res.end(); }
    const relative = pathname.slice(game.basePath.length);
    if (relative === 'runtime-config.js') {
      const config = { multiplayer: true, basePath: game.basePath, publicUrl: publicUrl ? canonicalBase(game, publicUrl) : null, wsPath: game.basePath + 'ws', protocol: VERSION };
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : 'window.CFZ_CONFIG = ' + JSON.stringify(config) + ';\n');
    }
    if (relative === 'healthz') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', protocol: VERSION, transport: 'websocket', basePath: game.basePath }));
    }
    if (options.serveStatic === false) { res.writeHead(404); return res.end(); }
    const route = relative.match(/^(project|controller)(?:\/([0-9a-f-]+))?\/?$/);
    if (route?.[2] && !UUID.test(route[2])) { res.writeHead(404); return res.end(); }
    const page = route ? (route[1] === 'project' ? 'index.html' : 'controller.html') : relative === 'builder/' && options.allowBuilder === true ? 'builder/index.html' : relative || 'index.html';
    // Exports contain a runnable backend too: never expose it, packages or dotfiles over HTTP.
    const extension = path.extname(page).toLowerCase();
    const arcade = ['arcade/title-backdrop.webp', 'arcade/title-ensemble.webp', 'arcade/select-backdrop.webp', 'arcade/menu-frame.webp', 'arcade/title-logo.webp'].includes(page);
    const asset = (page.startsWith('assets/') || arcade) && Object.hasOwn(MIME, extension) && !['.cjs', '.mjs', '.js', '.html'].includes(extension);
    const builder = options.allowBuilder === true && page.startsWith('builder/') && ['.js', '.mjs', '.css', '.html', '.json', '.cjs'].includes(extension);
    if ((!PUBLIC_FILES.has(page) && !asset && !builder) || page.split('/').some(part => part.startsWith('.'))) { res.writeHead(404); return res.end(); }
    const file = path.resolve(game.root, page);
    if (!file.startsWith(game.root + path.sep)) { res.writeHead(404); return res.end(); }
    if (builder) {
      try {
        let partPath = game.root;
        for (const part of page.split('/')) { partPath = path.join(partPath, part); if (fs.lstatSync(partPath).isSymbolicLink()) { res.writeHead(404); return res.end(); } }
      } catch { res.writeHead(404); return res.end(); }
    }
    fs.realpath(file, (realErr, realFile) => {
      if (realErr || !realFile.startsWith(game.root + path.sep)) { res.writeHead(404); return res.end(); }
      fs.stat(realFile, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404); return res.end(); }
        if (route) {
          fs.readFile(realFile, 'utf8', (readErr, html) => {
            if (readErr) { res.writeHead(404); return res.end(); }
            const body = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + game.basePath + '">');
            res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
            res.end(req.method === 'HEAD' ? undefined : body);
          });
          return;
        }
        let start = 0, end = stat.size - 1, status = 200;
        if (req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); return res.end(); }
          start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); return res.end(); }
          status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        }
        res.writeHead(status, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': asset ? 'public, max-age=3600' : 'no-cache' });
        if (req.method === 'HEAD' || stat.size === 0) return res.end();
        const stream = fs.createReadStream(realFile, { start, end });
        stream.on('error', () => res.destroy()); stream.pipe(res);
      });
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  function send(ws, message) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 512 * 1024) { ws.close(1013, 'Connection too slow; reconnect'); return; }
    ws.send(typeof message === 'string' ? message : JSON.stringify({ v: VERSION, ...message }));
  }
  function broadcast(room, message) {
    const encoded = JSON.stringify({ v: VERSION, ...message });
    for (const player of room.players) if (player && !(player.role === 'controller' && message.type === 'snapshot')) send(player.ws, encoded);
    send(room.projector?.ws, encoded);
  }
  const activeMatch = room => ['intro', 'playing'].includes(room.phase);
  const paused = room => room.players.some(p => !p || (!p.cpu && (!p.ws || !p.active))) || !!(room.projector && (!room.projector.ws || !room.projector.active));
  const canStart = room => !activeMatch(room) && !paused(room) && room.players.every(p => p.ready && room.game.fighters.has(p.fighter));
  function roomInfo(room) {
    return { code: room.code, sessionId: room.id, basePath: room.game.basePath, mode: room.mode, phase: room.phase, matchId: room.matchId, paused: paused(room), introPending: room.phase === 'intro', stage: room.stage,
      playMode: room.playMode || 'versus', winner: room.phase === 'finished' ? room.state?.winner : null,
      projection: room.projector ? { connected: !!room.projector.ws, active: room.projector.active } : null,
      players: room.players.map((p, side) => p ? { side, cpu: !!p.cpu, connected: !!p.ws || !!p.cpu, active: p.active, fighter: p.fighter, ready: p.ready, reconnectUntil: p.disconnectedAt ? p.disconnectedAt + graceMs : null } : null) };
  }
  const publishRoom = room => broadcast(room, { type: 'room', room: roomInfo(room) });
  function fail(ws, code, message, fatal = false) { send(ws, { type: 'error', code, message, fatal }); if (fatal) ws?.close(1008, code); }
  function snapshot(room) {
    const state = JSON.parse(JSON.stringify(room.state, (key, value) => ['lastInput', 'buffer'].includes(key) ? undefined : value));
    return { type: 'snapshot', matchId: room.matchId, state, introPending: room.phase === 'intro' };
  }
  const matchPayload = room => ({ ...snapshot(room), type: 'match', stage: room.stage, fighters: room.players.map(p => p.fighter) });
  function controllerState(room) {
    if (!room.projector || !room.state) return;
    for (const p of room.players) if (p?.role === 'controller') send(p.ws, { type: 'controller_state', matchId: room.matchId, phase: room.phase === 'intro' ? 'intro' : room.state.phase, winner: room.state.winner, frame: room.state.frame, paused: paused(room), fighters: room.state.fighters.map(f => ({ id: f.id, hp: f.hp, energy: f.energy, wins: f.wins })) });
  }
  function clearInputs(room) { for (const p of room.players) if (p) { p.input = {}; p.taps.clear(); } }
  function completeIntro(room) {
    if (room.phase !== 'intro') return;
    room.phase = 'playing'; clearInputs(room);
    broadcast(room, { type: 'intro_complete', matchId: room.matchId }); publishRoom(room); broadcast(room, snapshot(room)); controllerState(room);
  }
  function startMatch(room) {
    room.matchId = crypto.randomUUID(); room.state = room.game.engine.create(room.players.map(p => p.fighter), { cpu: room.playMode === 'solo', profiles: room.game.profiles, seed: crypto.randomInt(1, 2 ** 31) });
    room.phase = 'intro'; room.introFrames = 0; room.lastActivity = Date.now();
    for (const p of room.players) { p.input = {}; p.taps.clear(); p.seq = -1; p.introDone = p.cpu || p.role === 'controller'; }
    if (room.projector) room.projector.introDone = false;
    publishRoom(room); broadcast(room, matchPayload(room)); controllerState(room);
  }
  function newPlayer(side, role = 'player') {
    return { id: crypto.randomUUID(), side, role, token: crypto.randomBytes(24).toString('base64url'), fighter: null, ready: false, ws: null, active: true, input: {}, taps: new Set(), seq: -1, lastInput: 0, disconnectedAt: 0, introDone: false };
  }
  function prepareCpu(room) {
    const cpu = room.players[1]; if (!cpu?.cpu) return;
    cpu.fighter = [...room.game.fighters].find(id => id !== room.players[0]?.fighter) || [...room.game.fighters][0]; cpu.ready = true;
  }
  function configureProjection(room, playMode) {
    room.playMode = playMode; room.state = null; room.matchId = null; room.phase = 'lobby';
    if (playMode === 'solo') { room.players[1] = { ...newPlayer(1, 'cpu'), cpu: true, token: null }; room.pairing[1] = null; prepareCpu(room); }
    else if (room.players[1]?.cpu) { room.players[1] = null; renewPair(room, 1); }
    for (const p of room.players) if (p) p.ready = !!p.cpu;
    clearInputs(room); room.lastActivity = Date.now();
  }
  function welcome(ws, room, member, extra = {}) {
    send(ws, { type: 'welcome', role: ws.role, token: member.token, room: roomInfo(room), catalog: room.game.catalog, basePath: room.game.basePath, ...extra });
    publishRoom(room); if (room.state && room.phase !== 'lobby') send(ws, matchPayload(room));
  }
  function attach(ws, room, player) {
    const old = player.ws; player.ws = ws; player.active = true; player.disconnectedAt = 0;
    player.input = {}; player.taps.clear(); player.seq = -1; player.lastInput = Date.now();
    ws.room = room; ws.player = player; ws.role = player.role;
    if (old && old !== ws) old.close(4001, 'Seat resumed in another window');
    welcome(ws, room, player, { side: player.side, playerId: player.id });
  }
  function newRoom(game, mode, stage) {
    let code; do { code = crypto.randomBytes(6).toString('hex').toUpperCase(); } while (rooms.has(code));
    const room = { id: crypto.randomUUID(), code, game, mode, players: [null, null], phase: 'lobby', state: null, matchId: null, stage: stage || game.catalog.stages[0].id, lastActivity: Date.now(), pairing: [null, null], pairVersion: 0 };
    rooms.set(code, room); sessions.set(room.id, room); return room;
  }
  function removeRoom(room) { rooms.delete(room.code); sessions.delete(room.id); }
  function closeRoom(room, message) {
    broadcast(room, { type: 'closed', message });
    for (const member of [...room.players, room.projector]) if (member?.ws) { member.ws.room = null; member.ws.player = null; member.ws.close(1000, 'Session ended'); }
    removeRoom(room);
  }
  function renewPair(room, side) { if (!room.players[side]) room.pairing[side] = { token: crypto.randomBytes(18).toString('base64url'), expiresAt: Date.now() + pairingMs }; }
  async function publishPairing(room) {
    const revision = ++room.pairVersion;
    try {
      const seats = await Promise.all(room.pairing.map(async (pair, side) => {
        if (room.players[side] || !pair) return null;
        const url = new URL('controller.html', room.publicUrl);
        url.searchParams.set('session', room.id); url.hash = new URLSearchParams({ side: String(side), pair: pair.token }).toString();
        if (!pair.qr) pair.qr = await QRCode.toDataURL(url.href, { errorCorrectionLevel: 'M', margin: 4, width: 360 });
        return { side, url: url.href, qr: pair.qr, expiresAt: pair.expiresAt };
      }));
      if (sessions.get(room.id) === room && revision === room.pairVersion) send(room.projector?.ws, { type: 'pairing', sessionId: room.id, seats });
    } catch { if (sessions.has(room.id)) fail(room.projector?.ws, 'qr', 'Could not create pairing codes. Refresh the codes to retry.'); }
  }
  function attachProjection(ws, room) {
    const owner = room.projector, old = owner.ws; owner.ws = ws; owner.active = true; owner.disconnectedAt = 0;
    ws.room = room; ws.role = 'projection';
    if (old && old !== ws) old.close(4001, 'Projection resumed in another window');
    welcome(ws, room, owner); publishPairing(room);
  }
  function projectionHello(ws, msg) {
    let room;
    if (msg.role === 'projection' && msg.action === 'create') {
      if (rooms.size >= maxRooms) return fail(ws, 'capacity', 'All sessions are busy. Try again shortly.', true);
      const playMode = msg.playMode ?? 'solo';
      if (!['solo', 'versus'].includes(playMode) || (msg.stage !== undefined && !ws.game.stages.has(msg.stage))) return fail(ws, 'configuration', 'Choose a valid game mode and arena.', true);
      room = newRoom(ws.game, 'projection', msg.stage); room.publicUrl = canonicalBase(ws.game, ws.browserOrigin);
      room.projector = { token: crypto.randomBytes(24).toString('base64url'), ws: null, active: true, disconnectedAt: 0, introDone: false };
      configureProjection(room, playMode); renewPair(room, 0); renewPair(room, 1); return attachProjection(ws, room);
    }
    if (!['pair', 'resume'].includes(msg.action)) return fail(ws, 'role', 'Use a projection QR code to pair a controller.', true);
    if (typeof msg.sessionId !== 'string' || !UUID.test(msg.sessionId)) return fail(ws, 'session', 'Open a valid projection or scan its QR code.', true);
    room = sessions.get(msg.sessionId);
    if (!room || room.mode !== 'projection' || room.game !== ws.game) return fail(ws, 'session_expired', 'This projection session has ended. Scan a new QR code.', true);
    if (msg.role === 'projection') {
      if (msg.action !== 'resume' || typeof msg.token !== 'string' || msg.token !== room.projector.token) return fail(ws, 'session_expired', 'This screen does not own that projection. Create a new session.', true);
      room.lastActivity = Date.now(); return attachProjection(ws, room);
    }
    let player;
    if (msg.action === 'resume') {
      player = room.players.find(p => p?.role === 'controller' && typeof msg.token === 'string' && p.token === msg.token);
      if (!player) return fail(ws, 'session_expired', 'This controller has been released. Scan the new QR code.', true);
    } else {
      if (![0, 1].includes(msg.side)) return fail(ws, 'pairing', 'Scan the QR code for your player.', true);
      const pair = room.pairing[msg.side];
      if (room.players[msg.side] || !pair || pair.expiresAt <= Date.now() || typeof msg.pairToken !== 'string' || pair.token !== msg.pairToken) return fail(ws, 'pairing', 'This QR code has expired or is already paired. Scan a fresh code on the projection.', true);
      player = newPlayer(msg.side, 'controller'); room.players[msg.side] = player; room.pairing[msg.side] = null; publishPairing(room);
    }
    room.lastActivity = Date.now(); return attach(ws, room, player);
  }
  function releasePlayer(room, player) {
    room.players[player.side] = null;
    if (player.ws) { player.ws.player = null; player.ws.room = null; }
    room.state = null; room.matchId = null; room.phase = 'lobby';
    for (const p of room.players) if (p) p.ready = !!p.cpu;
    clearInputs(room); prepareCpu(room); room.lastActivity = Date.now();
    broadcast(room, { type: 'peer_left', message: room.projector ? 'A controller was released. Scan its new QR code to join.' : 'The other player left. Share the invite to start another match.' });
    publishRoom(room);
    if (room.projector) { renewPair(room, player.side); publishPairing(room); }
    else if (room.players.every(p => !p)) removeRoom(room);
  }
  function markIntro(ws, msg, room, member) {
    if (msg.matchId !== undefined && msg.matchId !== room.matchId) return;
    if (room.phase !== 'intro') return;
    if (msg.type === 'skip_intro') return completeIntro(room);
    member.introDone = true;
    if (room.projector ? room.projector.introDone : room.players.every(p => p.introDone)) completeIntro(room);
  }
  function handle(ws, msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.v !== VERSION) return fail(ws, 'protocol', 'Reload to use the current game version.', true);
    if (msg.type === 'hello') {
      if (ws.room) return fail(ws, 'already_joined', 'Already connected to a room.');
      if (['projection', 'controller'].includes(msg.role)) return projectionHello(ws, msg);
      if (msg.role !== 'player') return fail(ws, 'role', 'Unsupported connection role.', true);
      let room, player;
      if (msg.action === 'create') {
        if (rooms.size >= maxRooms) return fail(ws, 'capacity', 'All rooms are busy. Try again shortly.', true);
        if (msg.stage !== undefined && !ws.game.stages.has(msg.stage)) return fail(ws, 'stage', 'Choose an available arena.', true);
        room = newRoom(ws.game, 'online', msg.stage); player = newPlayer(0); room.players[0] = player;
      } else if (['join', 'resume'].includes(msg.action)) {
        if (typeof msg.room !== 'string' || !/^[A-F0-9]{12}$/.test(msg.room)) return fail(ws, 'room', 'Enter a valid room code or invite link.', true);
        room = rooms.get(msg.room);
        if (!room || room.game !== ws.game) return fail(ws, 'room_missing', 'This room has expired or belongs to another game. Ask for a new invite.', true);
        if (room.mode !== 'online') return fail(ws, 'role', 'Use this projection controller QR code.', true);
        if (msg.action === 'resume') {
          player = room.players.find(p => p && typeof msg.token === 'string' && p.token === msg.token);
          if (!player) return fail(ws, 'session_expired', 'This seat has expired. Reopen the invite or create a room.', true);
        } else {
          const side = room.players.findIndex(p => !p); if (side < 0) return fail(ws, 'room_full', 'This room already has two players.', true);
          player = newPlayer(side); room.players[side] = player;
        }
      } else return fail(ws, 'action', 'Invalid connection request.', true);
      room.lastActivity = Date.now(); return attach(ws, room, player);
    }
    if (ws.role === 'projection' && ws.room?.projector?.ws === ws) {
      const room = ws.room;
      if (msg.type === 'ping') return send(ws, { type: 'pong', at: Number.isFinite(msg.at) ? msg.at : 0 });
      if (msg.type === 'leave') return closeRoom(room, 'The projection ended this session.');
      if (['intro_done', 'skip_intro'].includes(msg.type)) return markIntro(ws, msg, room, room.projector);
      if (msg.type === 'configure_projection') {
        if (activeMatch(room)) return fail(ws, 'in_match', 'Finish the match before changing game mode.');
        const playMode = msg.playMode ?? room.playMode;
        if (!['solo', 'versus'].includes(playMode) || (msg.stage !== undefined && !room.game.stages.has(msg.stage))) return fail(ws, 'configuration', 'Choose a valid game mode and arena.');
        if (playMode === 'solo' && room.players[1] && !room.players[1].cpu) return fail(ws, 'configuration', 'Release Player 2 phone before switching to single player.');
        if (msg.stage !== undefined) room.stage = msg.stage;
        configureProjection(room, playMode); publishRoom(room); publishPairing(room); return;
      }
      if (msg.type === 'presence' && typeof msg.active === 'boolean') {
        room.projector.active = msg.active; clearInputs(room);
        if (canStart(room)) return startMatch(room); publishRoom(room); return controllerState(room);
      }
      if (msg.type === 'refresh_pairing') { for (const side of [0, 1]) renewPair(room, side); room.lastActivity = Date.now(); return publishPairing(room); }
      if (msg.type === 'release_controller' && [0, 1].includes(msg.side)) {
        const p = room.players[msg.side]; if (p?.cpu) return fail(ws, 'cpu_seat', 'The CPU opponent does not use a phone.');
        if (p) { const old = p.ws; releasePlayer(room, p); if (old) { send(old, { type: 'closed', message: 'The projection released this controller. Scan the new QR code.' }); old.close(1000, 'Controller released'); } } return;
      }
      return fail(ws, 'role', 'The projection displays the match. Use a paired phone to play.');
    }
    if (!ws.player || ws.player.ws !== ws) return fail(ws, 'session', 'Join a room first.', true);
    const room = ws.room, p = ws.player;
    if (msg.type === 'ping') return send(ws, { type: 'pong', at: Number.isFinite(msg.at) ? msg.at : 0 });
    if (msg.type === 'leave') { releasePlayer(room, p); return ws.close(1000, 'Left room'); }
    if (['intro_done', 'skip_intro'].includes(msg.type)) {
      if (p.role === 'controller' && msg.type === 'intro_done') return;
      return markIntro(ws, msg, room, p);
    }
    if (msg.type === 'presence') { if (typeof msg.active !== 'boolean') return; p.active = msg.active; clearInputs(room); if (canStart(room)) return startMatch(room); publishRoom(room); return controllerState(room); }
    if (msg.type === 'fighter') {
      if (activeMatch(room)) return fail(ws, 'in_match', 'Finish this match before changing fighters.');
      if (!room.game.fighters.has(msg.fighter)) return fail(ws, 'fighter', 'Choose an available fighter.');
      p.fighter = msg.fighter; p.ready = false; prepareCpu(room); room.lastActivity = Date.now(); return publishRoom(room);
    }
    if (msg.type === 'stage') {
      if (p.side !== 0 || room.mode !== 'online') return fail(ws, 'role', 'Only the room host selects the arena.');
      if (activeMatch(room)) return fail(ws, 'in_match', 'Finish this match before changing arenas.');
      if (!room.game.stages.has(msg.stage)) return fail(ws, 'stage', 'Choose an available arena.');
      room.stage = msg.stage; for (const member of room.players) if (member) member.ready = false; return publishRoom(room);
    }
    if (msg.type === 'ready') {
      if (activeMatch(room)) return;
      if (typeof msg.ready !== 'boolean' || (msg.ready && !room.game.fighters.has(p.fighter))) return fail(ws, 'fighter', 'Choose your fighter first.');
      p.ready = msg.ready; room.lastActivity = Date.now(); if (canStart(room)) startMatch(room); else publishRoom(room); return;
    }
    if (msg.type === 'input') {
      if (room.phase !== 'playing' || paused(room)) return;
      if (!Number.isSafeInteger(msg.seq) || msg.seq < 0 || msg.seq <= p.seq || !msg.keys || typeof msg.keys !== 'object' || Array.isArray(msg.keys)) return;
      p.seq = msg.seq; const next = {};
      for (const key of INPUTS) if (msg.keys[key] === 1 || msg.keys[key] === true) next[key] = 1;
      // Preserve keydown/up taps that arrive together before the next simulation tick.
      for (const key of INPUTS) if (next[key] && !p.input[key]) p.taps.add(key);
      p.input = next; p.lastInput = Date.now(); return;
    }
    fail(ws, 'message', 'Unsupported message.');
  }
  server.on('upgrade', (req, socket, head) => {
    const reject = status => { socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\n\r\n'); };
    const game = mounts.find(mount => req.url === mount.basePath + 'ws');
    if (!game) return reject('404 Not Found');
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.remoteAddress);
    const forwarded = req.headers['x-real-ip'];
    const address = options.trustProxy === true && loopback && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : socket.remoteAddress;
    if (wss.clients.size >= 256 || [...wss.clients].filter(ws => ws.address === address).length >= 32) return reject('503 Service Unavailable');
    if (req.headers.origin) {
      try { const origin = browserURL(req.headers.origin); if (allowedOrigins.size ? !allowedOrigins.has(origin.origin) : origin.host !== req.headers.host) return reject('403 Forbidden'); } catch { return reject('403 Forbidden'); }
    }
    wss.handleUpgrade(req, socket, head, ws => { ws.address = address; ws.game = game; ws.browserOrigin = req.headers.origin || 'http://' + req.headers.host; wss.emit('connection', ws); });
  });
  wss.on('connection', ws => {
    ws.alive = true; ws.started = Date.now(); ws.count = 0; ws.controlCount = 0; ws.window = Date.now();
    ws.on('pong', () => { ws.alive = true; }); ws.on('error', () => {});
    ws.on('message', (data, binary) => {
      if (binary) return fail(ws, 'format', 'JSON messages required.', true);
      if (Date.now() - ws.window >= 1000) { ws.window = Date.now(); ws.count = 0; ws.controlCount = 0; }
      if (++ws.count > 180) return fail(ws, 'rate', 'Too many messages.', true);
      let msg; try { msg = JSON.parse(data.toString()); } catch { return fail(ws, 'format', 'Invalid JSON.', true); }
      if (msg?.type !== 'input' && msg?.type !== 'ping' && ++ws.controlCount > 20) return fail(ws, 'rate', 'Too many room actions.', true);
      handle(ws, msg);
    });
    ws.on('close', () => {
      const p = ws.player, room = ws.room;
      if (room?.projector?.ws === ws) { room.projector.ws = null; room.projector.active = false; room.projector.disconnectedAt = Date.now(); clearInputs(room); publishRoom(room); controllerState(room); return; }
      if (!p || p.ws !== ws || !room || !rooms.has(room.code)) return;
      p.ws = null; p.active = false; p.input = {}; p.taps.clear(); p.disconnectedAt = Date.now(); if (!activeMatch(room)) p.ready = false;
      clearInputs(room); publishRoom(room); controllerState(room);
    });
  });
  let previous = performance.now(), accumulator = 0, steps = 0;
  const loop = setInterval(() => {
    const now = performance.now(); accumulator += Math.min(now - previous, 100); previous = now;
    while (accumulator >= STEP) {
      accumulator -= STEP; steps++;
      for (const room of rooms.values()) {
        if (!activeMatch(room) || paused(room)) continue;
        room.lastActivity = Date.now();
        if (room.phase === 'intro') { room.introFrames++; if (room.introFrames * STEP >= introMs) completeIntro(room); continue; }
        const controls = room.players.map(p => {
          if (p.cpu) return {};
          if (Date.now() - p.lastInput > 300) { p.input = {}; p.taps.clear(); }
          const keys = { ...p.input }; for (const key of p.taps) keys[key] = 1; p.taps.clear(); return keys;
        });
        room.game.engine.tick(room.state, controls);
        if (steps % 2 === 0 || room.state.phase === 'matchover') broadcast(room, snapshot(room));
        if (steps % 6 === 0 || room.state.phase === 'matchover') controllerState(room);
        if (room.state.phase === 'matchover') { room.phase = 'finished'; for (const p of room.players) p.ready = !!p.cpu; publishRoom(room); }
      }
    }
  }, 8);
  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.projector) {
        if (room.projector.disconnectedAt && now - room.projector.disconnectedAt > graceMs) { closeRoom(room, 'The projection did not reconnect. Open a new session.'); continue; }
        for (const p of room.players) if (p?.disconnectedAt && now - p.disconnectedAt > graceMs) releasePlayer(room, p);
        let renewed = false; for (const side of [0, 1]) if (room.pairing[side]?.expiresAt <= now) { renewPair(room, side); renewed = true; } if (renewed) publishPairing(room);
      }
      const expired = room.players.some(p => p?.disconnectedAt && now - p.disconnectedAt > graceMs);
      if (expired || now - room.lastActivity > idleMs) closeRoom(room, expired ? 'A player did not reconnect in time. Create a new room.' : 'This room expired after being idle.');
    }
    for (const ws of wss.clients) if (!ws.room && now - ws.started > 10000) ws.close(1008, 'Join timeout');
  }, options.maintenanceMs ?? 1000);
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 10000);
  return {
    server, wss, rooms,
    listen(port = options.port ?? Number(process.env.PORT || 8080), host = options.host ?? process.env.HOST ?? '0.0.0.0') {
      return new Promise((resolve, reject) => { const failListen = error => reject(error); server.once('error', failListen); server.listen(port, host, () => { server.removeListener('error', failListen); resolve(server.address()); }); });
    },
    async close() {
      if (closed) return; closed = true; clearInterval(loop); clearInterval(maintenance); clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { createGameServer };
