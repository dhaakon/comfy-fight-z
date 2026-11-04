// Bundled into exports. Only Node built-ins and the included engine are needed at runtime.
const path = require('node:path');
const os = require('node:os');
const { createGameServer } = require('./server.cjs');

async function start(options = {}) {
  const root = path.resolve(options.root || process.env.GAME_ROOT || __dirname);
  const port = Number(process.env.PORT || 8080), host = process.env.HOST || '0.0.0.0';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535.');
  let mounts;
  if (process.env.GAME_MOUNTS) {
    mounts = JSON.parse(process.env.GAME_MOUNTS);
    if (!mounts || Array.isArray(mounts) || typeof mounts !== 'object') throw new Error('GAME_MOUNTS must map URL prefixes to game directories.');
    mounts = Object.fromEntries(Object.entries(mounts).map(([prefix, directory]) => [prefix, path.resolve(root, directory)]));
  }
  const game = createGameServer({ root, mounts, publicUrl: process.env.PUBLIC_URL,
    publicOrigins: (process.env.PUBLIC_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
    serveStatic: process.env.SERVE_STATIC !== '0', trustProxy: process.env.TRUST_PROXY === '1', ...options });
  await game.listen(port, host);
  const actualPort = game.server.address().port;
  console.log(`Comfy Fighter Z: http://127.0.0.1:${actualPort}`);
  if (process.env.PUBLIC_URL) console.log(`Public game: ${process.env.PUBLIC_URL}`);
  else if (host === '0.0.0.0' || host === '::') {
    for (const addresses of Object.values(os.networkInterfaces())) for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) console.log(`Phone / LAN: http://${address.address}:${actualPort}`);
    }
  }
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; await game.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return game;
}
if (require.main === module) start().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { start };
