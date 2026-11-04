/* Shared, resumable transport for versus players, the TV and phone controllers. */
(() => {
  'use strict';
  class SessionClient {
    constructor(role, callbacks = {}) {
      this.role = role; this.callbacks = callbacks; this.ws = null; this.ready = false;
      this.manual = true; this.retries = 0; this.disconnectedAt = 0;
      this.pingTimer = setInterval(() => { if (this.ready) this.send({ type: 'ping', at: performance.now() }); }, 2000);
    }
    static baseURL() { return new URL(window.CFZ_CONFIG?.basePath || './', document.baseURI); }
    static key(role, id) { return 'cfz-session:' + SessionClient.baseURL().pathname + ':' + role + ':' + id; }
    static saved(role, id) { try { return JSON.parse(sessionStorage.getItem(this.key(role, id))); } catch (_) { return null; } }
    open(hello) {
      this.stop(); this.manual = false; this.hello = { ...hello, role: this.role };
      this.retries = 0; this.disconnectedAt = 0; this.connect();
    }
    connect() {
      if (this.manual) return;
      this.ready = false; this.callbacks.status?.(this.hello.action === 'resume' ? 'Reconnecting…' : 'Connecting…');
      const url = new URL(window.CFZ_CONFIG?.wsPath || 'ws', SessionClient.baseURL());
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url); this.ws = ws;
      const opening = setTimeout(() => { if (!this.ready && ws === this.ws) ws.close(); }, 10000);
      ws.onopen = () => { if (ws === this.ws) this.send({ type: 'hello', ...this.hello }); };
      ws.onmessage = event => {
        if (ws !== this.ws) return;
        let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.v !== 1) return this.fail('The game version changed. Reload to reconnect.');
        if (msg.type === 'welcome') {
          clearTimeout(opening); this.ready = true; this.retries = 0; this.disconnectedAt = 0;
          this.sessionId = msg.room.sessionId; this.roomCode = msg.room.code; this.token = msg.token;
          const identity = this.role === 'player' ? { room: this.roomCode } : { sessionId: this.sessionId };
          this.hello = { role: this.role, action: 'resume', ...identity, token: this.token };
          this.storageId = this.role === 'player' ? this.roomCode : this.sessionId;
          try { sessionStorage.setItem(SessionClient.key(this.role, this.storageId), JSON.stringify({ token: msg.token, side: msg.side })); } catch (_) { /* Private browsing can disable storage. */ }
        }
        if (msg.type === 'closed' || msg.type === 'error' && msg.fatal) return this.fail(msg.message || 'This session has ended.');
        if (msg.type === 'pong') { this.callbacks.latency?.(Math.max(0, Math.round(performance.now() - msg.at))); return; }
        this.callbacks.message?.(msg);
      };
      ws.onerror = () => this.callbacks.status?.('Connection interrupted. Retrying…');
      ws.onclose = event => {
        clearTimeout(opening);
        if (ws !== this.ws || this.manual) return;
        this.ready = false; this.callbacks.disconnect?.();
        if (event.code === 4001) return this.fail('This seat is now open in another window.');
        if (!this.disconnectedAt) this.disconnectedAt = Date.now();
        if (Date.now() - this.disconnectedAt >= 45000) return this.fail('Could not reconnect. Start a new room or scan a fresh controller code.');
        this.callbacks.status?.('Connection lost. Reconnecting…');
        this.retryTimer = setTimeout(() => this.connect(), Math.min(4000, 500 * 2 ** this.retries++));
      };
    }
    send(message) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ v: 1, ...message })); }
    forget() { try { sessionStorage.removeItem(SessionClient.key(this.role, this.storageId || this.hello?.room || this.hello?.sessionId)); } catch (_) {} }
    stop(leave = false) {
      this.manual = true; this.ready = false; clearTimeout(this.retryTimer);
      if (leave) { this.send({ type: 'leave' }); this.forget(); }
      if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    }
    dispose(leave = false) { this.stop(leave); clearInterval(this.pingTimer); }
    fail(message) { this.forget(); this.stop(); this.callbacks.fatal?.(message); }
  }
  window.FighterSessionClient = SessionClient;
})();
