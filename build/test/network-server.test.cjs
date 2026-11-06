'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const { createGameServer } = require('../server/server.cjs');

const sourceRoot = path.resolve(__dirname, '../public');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url, options) {
  const ws = new WebSocket(url, options), messages = [];
  ws.on('message', data => messages.push(JSON.parse(data)));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return {
    ws, messages,
    send(message) { ws.send(JSON.stringify({ v: 1, ...message })); },
    clear() { messages.length = 0; },
    async wait(type, predicate = () => true, timeout = 5000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const found = messages.find(m => m.type === type && predicate(m)); if (found) return found;
        await delay(8);
      }
      // Pairing/resume secrets must never appear in assertion logs.
      throw new Error('Timed out waiting for ' + type + '; received: ' + messages.map(m => m.type + (m.code ? ':' + m.code : '')).slice(-12).join(', '));
    },
  };
}
async function fixture(t, options = {}) {
  const app = createGameServer({ root: sourceRoot, ...options });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return { app, url: 'ws://127.0.0.1:' + address.port + '/ws', http: 'http://127.0.0.1:' + address.port };
}
function temporaryGame(t, names = ['cobalt', 'ochre']) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfz-network-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('cfz-network-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.copyFileSync(path.join(sourceRoot, 'engine.js'), path.join(directory, 'engine.js'));
  fs.writeFileSync(path.join(directory, 'assets/manifest.json'), JSON.stringify({ fighters: names.map(id => ({ id, name: id })), stages: [{ id: 'rooftop', name: 'Rooftop' }, { id: 'harbor', name: 'Harbor' }] }));
  return directory;
}
async function onlinePair(url) {
  const a = await connect(url); a.send({ type: 'hello', role: 'player', action: 'create' }); const host = await a.wait('welcome');
  const b = await connect(url); b.send({ type: 'hello', role: 'player', action: 'join', room: host.room.code }); const guest = await b.wait('welcome');
  return { a, b, host, guest };
}
async function ready(a, b, ids = ['griddle', 'rivet']) {
  a.send({ type: 'fighter', fighter: ids[0] }); b.send({ type: 'fighter', fighter: ids[1] });
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
  return Promise.all([a.wait('match'), b.wait('match')]);
}
async function play(a, b) {
  await ready(a, b); a.send({ type: 'skip_intro' });
  return a.wait('snapshot', m => m.state.phase === 'fight');
}
async function pairPhone(url, pairing, sessionId, side) {
  const pairToken = new URLSearchParams(new URL(pairing.seats[side].url).hash.slice(1)).get('pair');
  const phone = await connect(url); phone.send({ type: 'hello', role: 'controller', action: 'pair', sessionId, side, pairToken });
  return { phone, welcome: await phone.wait('welcome'), pairToken };
}

test('online fighters share authoritative state, pause through introductions, and control only their own seat', async t => {
  const { app, url } = await fixture(t);
  const { a, b, host, guest } = await onlinePair(url);
  assert.equal(host.side, 0); assert.equal(guest.side, 1); assert.notEqual(host.token, guest.token);
  // Six fighters plus the final boss; styles travel with the catalog for online movesets.
  assert.equal(host.catalog.fighters.length, 7); assert.equal(host.catalog.fighters.filter(f => f.boss).length, 1);
  assert.ok(host.catalog.fighters.every(f => typeof f.style === 'string'));
  assert.ok(!JSON.stringify(guest.room).includes(host.token));
  const [first, second] = await ready(a, b);
  assert.equal(first.matchId, second.matchId); assert.deepEqual(first.state, second.state); assert.equal(first.state.cpu, false);
  const room = app.rooms.get(host.room.code);
  await delay(100); assert.equal(room.state.frame, 0);
  a.send({ type: 'intro_done', matchId: first.matchId }); await delay(80); assert.equal(room.state.frame, 0);
  b.send({ type: 'intro_done', matchId: first.matchId });
  await a.wait('snapshot', m => m.state.phase === 'fight'); a.clear(); b.clear();
  a.send({ type: 'input', seq: 1, side: 1, keys: { right: true, unknown: true }, state: { winner: 0 } });
  const moved = await a.wait('snapshot', m => m.state.fighters[0].x > first.state.fighters[0].x + 15);
  const otherView = await b.wait('snapshot', m => m.state.frame === moved.state.frame);
  assert.deepEqual(moved.state, otherView.state);
  assert.equal(moved.state.fighters[1].x, first.state.fighters[1].x);
  assert.equal(moved.state.winner, null);
  assert.equal(Object.hasOwn(moved.state.fighters[0], 'lastInput'), false);
  a.send({ type: 'input', seq: 2, keys: {} }); b.send({ type: 'input', seq: 1, keys: { left: 1 } });
  await b.wait('snapshot', m => m.state.fighters[1].x < first.state.fighters[1].x - 10);
  // A stale input cannot replace the latest release, and an unrefreshed input expires.
  a.send({ type: 'input', seq: 1, keys: { left: 1 } });
  await delay(400); const settled = room.state.fighters.map(f => f.x); await delay(100);
  assert.deepEqual(room.state.fighters.map(f => f.x), settled);
  assert.deepEqual(room.players[1].input, {});
  a.send({ type: 'ping', at: 123 }); assert.equal((await a.wait('pong')).at, 123);
});

test('online disconnect and background presence pause combat, and resume revokes the old transport', async t => {
  const { app, url } = await fixture(t);
  const { a, b, guest } = await onlinePair(url); await play(a, b);
  const room = app.rooms.get(guest.room.code); a.clear(); b.send({ type: 'presence', active: false });
  await a.wait('room', m => m.room.paused && !m.room.players[1].active);
  const frame = room.state.frame; await delay(120); assert.equal(room.state.frame, frame);
  b.send({ type: 'presence', active: true }); await a.wait('snapshot', m => m.state.frame > frame);
  a.clear(); b.ws.terminate(); await a.wait('room', m => m.room.paused && !m.room.players[1].connected);
  const disconnectedFrame = room.state.frame; await delay(100); assert.equal(room.state.frame, disconnectedFrame);
  const resumed = await connect(url); resumed.send({ type: 'hello', role: 'player', action: 'resume', room: guest.room.code, token: guest.token });
  const again = await resumed.wait('welcome'); assert.equal(again.side, 1); assert.equal(again.playerId, guest.playerId);
  assert.equal((await resumed.wait('match')).matchId, room.matchId);
  await resumed.wait('snapshot', m => m.state.frame > disconnectedFrame);
  const replacement = await connect(url); replacement.send({ type: 'hello', role: 'player', action: 'resume', room: guest.room.code, token: guest.token });
  await replacement.wait('welcome'); await delay(40);
  assert.ok(resumed.ws.readyState >= WebSocket.CLOSING);
  assert.equal(room.players[1].ws.readyState, WebSocket.OPEN);
});

test('room capacity, roster, roles, protocol and stolen resume tokens are rejected', async t => {
  const { url } = await fixture(t); const { a, host } = await onlinePair(url);
  const extra = await connect(url); extra.send({ type: 'hello', role: 'player', action: 'join', room: host.room.code }); assert.equal((await extra.wait('error')).code, 'room_full');
  a.send({ type: 'fighter', fighter: 'unavailable' }); assert.equal((await a.wait('error')).code, 'fighter');
  a.clear(); a.send({ type: 'ready', ready: true }); assert.equal((await a.wait('error')).code, 'fighter');
  const thief = await connect(url); thief.send({ type: 'hello', role: 'player', action: 'resume', room: host.room.code, token: 'not-a-token' }); assert.equal((await thief.wait('error')).code, 'session_expired');
  const role = await connect(url); role.send({ type: 'hello', role: 'spectator', action: 'create' }); assert.equal((await role.wait('error')).code, 'role');
  const bad = await connect(url); bad.send({ type: 'hello', role: 'player', action: 'create', v: 99 }); assert.equal((await bad.wait('error')).code, 'protocol');
});

test('one phone pairs once to a projection, plays against the current CPU and receives compact state', async t => {
  const { app, url, http } = await fixture(t);
  const screen = await connect(url); screen.send({ type: 'hello', role: 'projection', action: 'create', playMode: 'solo' });
  const owner = await screen.wait('welcome'), pairing = await screen.wait('pairing');
  assert.equal(owner.room.players[1].cpu, true); assert.equal(pairing.seats[1], null);
  assert.ok(pairing.seats[0].qr.startsWith('data:image/png;base64,'));
  const link = new URL(pairing.seats[0].url); assert.equal(link.origin, http); assert.equal(link.pathname, '/controller.html'); assert.equal(link.searchParams.get('session'), owner.room.sessionId);
  const { phone, welcome, pairToken } = await pairPhone(url, pairing, owner.room.sessionId, 0);
  assert.equal(welcome.side, 0); assert.equal(welcome.role, 'controller');
  assert.ok(!JSON.stringify(welcome).includes(owner.token));
  const duplicate = await connect(url); duplicate.send({ type: 'hello', role: 'controller', action: 'pair', sessionId: owner.room.sessionId, side: 0, pairToken }); assert.equal((await duplicate.wait('error')).code, 'pairing');
  screen.send({ type: 'input', seq: 1, keys: { punch: true } }); assert.equal((await screen.wait('error')).code, 'role');
  phone.send({ type: 'fighter', fighter: 'griddle' }); phone.send({ type: 'ready', ready: true });
  const match = await screen.wait('match'); assert.equal(match.state.cpu, true); assert.notEqual(match.fighters[0], match.fighters[1]);
  phone.send({ type: 'intro_done' }); await delay(80); assert.equal(app.rooms.get(owner.room.code).state.frame, 0);
  screen.send({ type: 'intro_done' }); await screen.wait('snapshot', m => m.state.phase === 'fight');
  phone.send({ type: 'input', seq: 1, keys: { right: 1 } });
  await screen.wait('snapshot', m => m.state.fighters[0].x > match.state.fighters[0].x + 12);
  const compact = await phone.wait('controller_state', m => m.phase === 'fight' && m.frame > 90);
  assert.equal(compact.fighters.length, 2); assert.equal(Object.hasOwn(compact, 'state'), false);
  assert.equal(phone.messages.filter(m => m.type === 'snapshot').length, 0);
  await screen.wait('snapshot', m => m.state.fighters[1].x !== match.state.fighters[1].x || m.state.fighters[1].move !== null);
});

test('two phones own distinct seats; replacing and refreshing pairings revoke previous credentials', async t => {
  const { app, url } = await fixture(t);
  const screen = await connect(url); screen.send({ type: 'hello', role: 'projection', action: 'create', playMode: 'versus' });
  const owner = await screen.wait('welcome'), firstCodes = await screen.wait('pairing'); screen.clear();
  screen.send({ type: 'refresh_pairing' }); const codes = await screen.wait('pairing');
  const oldToken = new URLSearchParams(new URL(firstCodes.seats[0].url).hash.slice(1)).get('pair');
  const stale = await connect(url); stale.send({ type: 'hello', role: 'controller', action: 'pair', sessionId: owner.room.sessionId, side: 0, pairToken: oldToken }); assert.equal((await stale.wait('error')).code, 'pairing');
  const { phone: a, welcome: wa } = await pairPhone(url, codes, owner.room.sessionId, 0);
  const { phone: b, welcome: wb } = await pairPhone(url, codes, owner.room.sessionId, 1);
  assert.equal(wa.side, 0); assert.equal(wb.side, 1);
  await ready(a, b); screen.send({ type: 'skip_intro' }); await screen.wait('snapshot', m => m.state.phase === 'fight');
  a.send({ type: 'input', seq: 1, side: 1, keys: { right: 1 } }); b.send({ type: 'input', seq: 1, side: 0, keys: { left: 1 } });
  await screen.wait('snapshot', m => m.state.fighters[0].x > 540 && m.state.fighters[1].x < 900);
  screen.clear(); screen.send({ type: 'release_controller', side: 1 });
  const renewed = await screen.wait('pairing', m => !!m.seats[1]); assert.ok(renewed.seats[1]);
  assert.equal(app.rooms.get(owner.room.code).phase, 'lobby');
  const stolenResume = await connect(url); stolenResume.send({ type: 'hello', role: 'controller', action: 'resume', sessionId: owner.room.sessionId, token: wb.token }); assert.equal((await stolenResume.wait('error')).code, 'session_expired');
  const { phone: replacement } = await pairPhone(url, renewed, owner.room.sessionId, 1);
  replacement.send({ type: 'fighter', fighter: 'nimbus' }); await replacement.wait('room', m => m.room.players[1]?.fighter === 'nimbus');
});

test('mounted games use their own engine manifest and isolate room and QR credentials', async t => {
  const customRoot = temporaryGame(t);
  const { url, http } = await fixture(t, { mounts: { '/': sourceRoot, '/phone-photo-demo/': customRoot }, publicUrl: 'https://arcade.example/' });
  const otherUrl = url.replace('/ws', '/phone-photo-demo/ws');
  const { a, host } = await onlinePair(url);
  const cross = await connect(otherUrl); cross.send({ type: 'hello', role: 'player', action: 'join', room: host.room.code }); assert.equal((await cross.wait('error')).code, 'room_missing');
  const custom = await onlinePair(otherUrl); assert.deepEqual(custom.host.catalog.fighters.map(f => f.id), ['cobalt', 'ochre']);
  custom.a.send({ type: 'stage', stage: 'harbor' }); custom.a.send({ type: 'fighter', fighter: 'griddle' }); assert.equal((await custom.a.wait('error')).code, 'fighter');
  const [match] = await ready(custom.a, custom.b, ['cobalt', 'ochre']); assert.equal(match.stage, 'harbor'); assert.deepEqual(match.fighters, ['cobalt', 'ochre']);
  assert.equal(a.messages.some(m => m.type === 'match'), false);
  const screen = await connect(otherUrl); screen.send({ type: 'hello', role: 'projection', action: 'create' }); const owner = await screen.wait('welcome'), pairing = await screen.wait('pairing');
  assert.equal(new URL(pairing.seats[0].url).pathname, '/phone-photo-demo/controller.html');
  assert.equal(new URL(pairing.seats[0].url).origin, 'https://arcade.example');
  const pairToken = new URLSearchParams(new URL(pairing.seats[0].url).hash.slice(1)).get('pair');
  const wrongGame = await connect(url); wrongGame.send({ type: 'hello', role: 'controller', action: 'pair', sessionId: owner.room.sessionId, side: 0, pairToken }); assert.equal((await wrongGame.wait('error')).code, 'session_expired');
  const config = await (await fetch(http + '/phone-photo-demo/runtime-config.js')).text(); assert.match(config, /"wsPath":"\/phone-photo-demo\/ws"/);
});

test('match completion requires fresh readiness for rematches and preserves one fighter per seat', async t => {
  const { app, url } = await fixture(t); const { a, b, host } = await onlinePair(url); const initial = await play(a, b);
  const room = app.rooms.get(host.room.code);
  // Move only the clock to a real round-end boundary rather than waiting two full 99-second rounds.
  room.state.time = 1; room.state.fighters[0].hp = 100; room.state.fighters[1].hp = 1; room.state.fighters[0].wins = 1;
  await a.wait('room', m => m.room.phase === 'finished');
  assert.equal(room.state.phase, 'matchover'); assert.equal(room.state.winner, 0); assert.ok(room.players.every(p => !p.ready));
  a.clear(); b.clear(); a.send({ type: 'ready', ready: true }); await delay(80); assert.equal(room.phase, 'finished');
  b.send({ type: 'ready', ready: true }); const next = await a.wait('match');
  // The rematch starts both fighters on a full life bar of the mounted game's engine.
  const fullLife = require(path.join(sourceRoot, 'engine.js')).MAX_HP;
  assert.notEqual(next.matchId, initial.matchId); assert.equal(next.state.fighters.length, 2); assert.ok(next.state.fighters.every(f => f.hp === fullLife && f.wins === 0));
});

test('expired controller seats receive fresh codes and disconnected projections end their rooms', async t => {
  const { app, url } = await fixture(t, { graceMs: 70, maintenanceMs: 10 });
  const screen = await connect(url); screen.send({ type: 'hello', role: 'projection', action: 'create' }); const owner = await screen.wait('welcome'), pairing = await screen.wait('pairing');
  const { phone } = await pairPhone(url, pairing, owner.room.sessionId, 0); screen.clear(); phone.ws.terminate();
  await screen.wait('pairing', m => !!m.seats[0]); assert.equal(app.rooms.get(owner.room.code).players[0], null);
  screen.ws.terminate(); await delay(140); assert.equal(app.rooms.has(owner.room.code), false);
});

test('static HTTP serves only game files, supports bounded video ranges, and optionally serves the local builder', async t => {
  const root = temporaryGame(t);
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><head></head><body>Game</body>');
  fs.writeFileSync(path.join(root, 'controller.html'), '<!doctype html><head></head><body>Phone</body>');
  fs.writeFileSync(path.join(root, 'session-client.js'), 'window.example=true;');
  fs.writeFileSync(path.join(root, 'assets/film.mp4'), Buffer.from('0123456789'));
  fs.writeFileSync(path.join(root, 'assets/music.flac'), Buffer.from('audio'));
  fs.mkdirSync(path.join(root, 'builder')); fs.writeFileSync(path.join(root, 'builder/runtime-server.cjs'), 'local bundle');
  fs.writeFileSync(path.join(root, 'builder/index.html'), '<!doctype html><title>Builder</title>');
  fs.writeFileSync(path.join(root, 'builder/palette.mjs'), 'export const colors=[];');
  fs.writeFileSync(path.join(root, 'start-server.cjs'), 'server private'); fs.writeFileSync(path.join(root, 'credentials.pem'), 'private');
  const { http } = await fixture(t, { root });
  assert.equal((await fetch(http + '/healthz')).status, 200); assert.equal((await fetch(http + '/session-client.js')).status, 200);
  for (const file of ['start-server.cjs', 'credentials.pem', 'package.json', 'builder/runtime-server.cjs', 'server/server.cjs', '.env']) assert.equal((await fetch(http + '/' + file)).status, 404);
  const suffix = await fetch(http + '/assets/film.mp4', { headers: { Range: 'bytes=-4' } }); assert.equal(suffix.status, 206); assert.equal(suffix.headers.get('Content-Range'), 'bytes 6-9/10'); assert.equal(await suffix.text(), '6789');
  const huge = await fetch(http + '/assets/film.mp4', { headers: { Range: 'bytes=5-99999999999999999999999' } }); assert.equal(huge.status, 206); assert.equal(await huge.text(), '56789');
  for (const range of ['bytes=-0', 'bytes=10-', 'bytes=7-3', 'bytes=0-1,4-5', 'bytes=']) assert.equal((await fetch(http + '/assets/film.mp4', { headers: { Range: range } })).status, 416);
  assert.equal((await fetch(http + '/assets/music.flac')).headers.get('Content-Type'), 'audio/flac');
  const projection = await (await fetch(http + '/project')).text(); assert.match(projection, /<base href="\/">/);
  const local = await fixture(t, { root, allowBuilder: true }); assert.equal((await fetch(local.http + '/builder/runtime-server.cjs')).status, 200);
  assert.equal((await fetch(local.http + '/builder/')).status, 200);
  assert.equal((await fetch(local.http + '/builder/palette.mjs')).headers.get('Content-Type'), 'text/javascript; charset=utf-8');
  // A directory junction is available without special Windows symlink privileges.
  fs.mkdirSync(path.join(root, 'internal')); fs.writeFileSync(path.join(root, 'internal/private.cjs'), 'do not serve');
  fs.symlinkSync(path.join(root, 'internal'), path.join(root, 'builder/link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fetch(local.http + '/builder/link/private.cjs')).status, 404);
});

test('WebSocket origins are enforced; X-Real-IP is trusted only with an explicit loopback proxy option', async t => {
  const defaultServer = await fixture(t);
  await assert.rejects(connect(defaultServer.url, { origin: 'https://untrusted.example' }), /403/);
  const normal = await connect(defaultServer.url, { origin: defaultServer.http, headers: { 'X-Real-IP': '203.0.113.2' } });
  normal.send({ type: 'hello', role: 'player', action: 'create' }); await normal.wait('welcome');
  assert.notEqual([...defaultServer.app.wss.clients][0].address, '203.0.113.2');
  const proxied = await fixture(t, { trustProxy: true, publicOrigins: ['https://arcade.example'] });
  const first = await connect(proxied.url, { origin: 'https://arcade.example', headers: { 'X-Real-IP': '203.0.113.2' } });
  first.send({ type: 'hello', role: 'player', action: 'create' }); await first.wait('welcome');
  assert.equal([...proxied.app.wss.clients][0].address, '203.0.113.2');
  const second = await connect(proxied.url, { origin: 'https://arcade.example', headers: { 'X-Real-IP': 'invalid, 203.0.113.3' } });
  second.send({ type: 'hello', role: 'player', action: 'create' }); await second.wait('welcome');
  assert.notEqual([...proxied.app.wss.clients][1].address, 'invalid, 203.0.113.3');
});

test('games.json lists every mounted game with its generated key art so title screens can offer a game select', async t => {
  const second = temporaryGame(t, ['keystone', 'cheddar']);
  const manifest = JSON.parse(fs.readFileSync(path.join(second, 'assets/manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(second, 'assets/manifest.json'), JSON.stringify({ ...manifest, title: 'Comfy Fighter Z', subtitle: 'Blue Wave Saga', ui: { title: { src: 'assets/ui/title.png' }, ensemble: 'assets/ui/ensemble.png', logo: '../escape.png', hud: 'assets/ui/hud.png' } }));
  const { http } = await fixture(t, { mounts: { '/': sourceRoot, '/blue-wave/': second } });
  const main = await (await fetch(http + '/games.json')).json();
  assert.deepEqual(main.games.map(game => [game.basePath, game.current, game.fighters, game.stages]), [['/', true, 7, 3], ['/blue-wave/', false, 2, 2]]);
  assert.deepEqual(main.games[1].art, { title: 'assets/ui/title.png', ensemble: 'assets/ui/ensemble.png' }, 'only generated interface art under assets/ui is listed');
  assert.equal(main.games[1].subtitle, 'Blue Wave Saga');
  const other = await (await fetch(http + '/blue-wave/games.json')).json();
  assert.deepEqual(other.games.map(game => game.current), [false, true]);
  const single = await fixture(t);
  const alone = await (await fetch(single.http + '/games.json')).json();
  assert.equal(alone.games.length, 1); assert.equal(alone.games[0].current, true);
});
