// Peer-to-peer play without a server. Signalling goes through public Trystero (Nostr) relays;
// game data then flows browser-to-browser over encrypted WebRTC. A BroadcastChannel "loop"
// transport offers the same API for local testing (two tabs of one browser).
// Every inbound message is untrusted: size cap, JSON only, type allow-list, per-peer rate limit.
import { publicBase } from './share.js';

export const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.27.0/+esm';   // pinned (re-exports @trystero-p2p/nostr@0.27.0)
export const RELAYS = ['wss://relay.primal.net', 'wss://relay.nostr.net', 'wss://nostr-pub.wellorder.net', 'wss://relay.snort.social', 'wss://relay.nostr.com'];
const APP = 'family-puzzles', MAX_BYTES = 16384, MAX_PLAYERS = 12, MAX_PENDING = 5, TIMEOUT_MS = 20000;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // no 0/O/1/I/L
const INTERNAL = new Set(['hello', 'knock', 'welcome', 'deny', 'bye']);
export const FAIL_TEXT = 'Can’t connect — try both on Wi-Fi';

const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const b64u = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function newCode(){ const b = new Uint32Array(6); crypto.getRandomValues(b); const s = [...b].map(x => ALPHA[x % ALPHA.length]).join(''); return s.slice(0, 3) + '-' + s.slice(3); }
/** 'hx7 k2m' → 'HX7-K2M', or null. */
export function normalizeCode(c){ const s = String(c || '').toUpperCase().replace(/[\s-]/g, ''); return s.length === 6 && [...s].every(ch => ALPHA.includes(ch)) ? s.slice(0, 3) + '-' + s.slice(3) : null; }
export function cleanName(n){
  const s = String(n ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, 24).join('') || 'Guest';
}
/** '#j=HX7-K2M.<password>' → { code, password } or null (untrusted input). */
export function readJoinHash(hash = location.hash){
  const m = /^#j=([A-Za-z0-9-]{6,7})(?:\.([A-Za-z0-9_-]{22}))?$/.exec(String(hash || ''));
  const code = m && normalizeCode(m[1]); return code ? { code, password: m[2] || null } : null;
}
const chan = (code, lobby) => `fp1/${lobby ? 'lobby/' : ''}${code.replace('-', '')}`;
const lobbyPass = code => 'fp1-lobby-' + code;

// ---------- transports: open(channel, password) → { onPeer, onLeave, onFrame, send(frame, to?), close() } ----------
function loopTransport(channel, password){
  const me = b64u(rnd(9)), ev = { peer(){}, leave(){}, frame(){} }, known = new Set();
  let bc = null;
  const ready = crypto.subtle.digest('SHA-256', new TextEncoder().encode(channel + '\0' + password)).then(h => {
    bc = new BroadcastChannel('fp-loop:' + b64u(new Uint8Array(h)));
    bc.onmessage = ({ data: m }) => {
      if(!m || m.from === me || (m.to && m.to !== me)) return;
      if(m.k === 'hi'){ if(!known.has(m.from)){ known.add(m.from); bc.postMessage({ from: me, to: m.from, k: 'hi' }); ev.peer(m.from); } }
      else if(m.k === 'bye'){ if(known.delete(m.from)) ev.leave(m.from); }
      else if(m.k === 'f' && known.has(m.from)) ev.frame(m.f, m.from);
    };
    bc.postMessage({ from: me, k: 'hi' });
  });
  return { kind: 'loop', ev,
    send(f, to){ ready.then(() => bc && bc.postMessage({ from: me, to, k: 'f', f })); },
    close(){ ready.then(() => { if(!bc) return; bc.postMessage({ from: me, k: 'bye' }); bc.close(); bc = null; }); } };
}
let trysteroMod = null;
function trysteroTransport(channel, password){
  const ev = { peer(){}, leave(){}, frame(){}, error(){} }; let room = null, act = null, closed = false;
  (trysteroMod ||= import(TRYSTERO_URL)).then(({ joinRoom }) => {
    if(closed) return;
    room = joinRoom({ appId: APP, password, identity: 'none', maxUsers: MAX_PLAYERS + 1, maxReceiveBytes: MAX_BYTES, relayConfig: { urls: RELAYS } }, channel);
    act = room.makeAction('m');
    act.onMessage((d, { peerId }) => ev.frame(d, peerId));
    room.onPeerJoin(({ peerId }) => ev.peer(peerId));
    room.onPeerLeave(({ peerId }) => ev.leave(peerId));
    room.onError(e => ev.error(e));
  }).catch(e => ev.error(e));
  return { kind: 'trystero', ev,
    send(f, to){ act && act.send(f, to ? { target: to } : undefined).catch(() => {}); },
    close(){ closed = true; room && room.leave().catch(() => {}); } };
}
// TODO (not done): PeerJS 1.5.5 fallback transport (AES-GCM per message, key from password via HKDF).
const TRANSPORTS = { loop: loopTransport, trystero: trysteroTransport };

// ---------- protocol endpoint: envelope {v:1,t,d}, validation, rate limits ----------
function endpoint(tr, allowed, onMsg){
  const buckets = new Map();
  tr.ev.frame = (f, from) => {
    if(typeof f !== 'string' || f.length > MAX_BYTES) return;
    const now = Date.now(), b = buckets.get(from) || { n: 40, at: now };      // 20 msg/s, burst 40
    b.n = Math.min(40, b.n + (now - b.at) * 0.02); b.at = now; buckets.set(from, b);
    if(b.n < 1) return; b.n--;
    let m; try{ m = JSON.parse(f); }catch(_){ return; }
    if(!m || typeof m !== 'object' || m.v !== 1 || typeof m.t !== 'string' || !(INTERNAL.has(m.t) || allowed.has(m.t))) return;
    onMsg(m.t, m.d, from);
  };
  return (t, d, to) => { const f = JSON.stringify({ v: 1, t, d }); if(f.length <= MAX_BYTES) tr.send(f, to); };
}
function emitter(){ const ls = new Map(); return {
  on(t, cb){ if(!ls.has(t)) ls.set(t, new Set()); ls.get(t).add(cb); return () => ls.get(t).delete(cb); },
  emit(t, ...a){ ls.get(t)?.forEach(cb => { try{ cb(...a); }catch(e){ console.error(e); } }); } }; }

/** Host a game. Returns { code, password, joinLink, transport, onJoinRequest, approve, deny, send, on, onPeers, peers, close }. */
export function createRoom({ game = '', hostName = 'Host', transport = 'trystero' } = {}){
  const code = newCode(), password = b64u(rnd(16)), open = TRANSPORTS[transport];
  const allowed = new Set(), em = emitter(), players = new Map(), pending = new Map();
  let reqCb = () => {};
  const main = open(chan(code), password), lobby = open(chan(code, true), lobbyPass(code));
  const peersChanged = () => em.emit('@peers', [...players.values()]);
  const send = endpoint(main, allowed, (t, d, from) => {
    if(t === 'hello'){
      if(players.has(from) || players.size >= MAX_PLAYERS - 1) return;
      players.set(from, { id: from, name: cleanName(d?.name) });
      send('hello', { host: true, name: cleanName(hostName), game: String(game).slice(0, 40) }, from); peersChanged();
    } else if(t === 'bye'){ if(players.delete(from)) peersChanged(); }
    else if(players.has(from) && !INTERNAL.has(t)) em.emit(t, d, players.get(from));
  });
  main.ev.peer = () => {};
  main.ev.leave = id => { if(players.delete(id)) peersChanged(); };
  const lsend = endpoint(lobby, new Set(), (t, d, from) => {
    if(t !== 'knock' || pending.has(from) || pending.size >= MAX_PENDING) return;
    const req = { id: from, name: cleanName(d?.name) }; pending.set(from, req); reqCb(req);
  });
  lobby.ev.leave = id => pending.delete(id);
  const base = publicBase() || location.href.split('#')[0].split('?')[0];
  return { code, password, joinLink: `${base}#j=${code}.${password}`, transport,
    onJoinRequest(cb){ reqCb = cb; },
    approve(req){ if(pending.delete(req.id)) lsend('welcome', { password }, req.id); },
    deny(req){ if(pending.delete(req.id)) lsend('deny', {}, req.id); },
    send(type, data, to){ if(!INTERNAL.has(type)) (to ? [to.id ?? to] : [...players.keys()]).forEach(id => send(type, data, id)); },
    on(type, cb){ allowed.add(type); return em.on(type, cb); },
    onPeers(cb){ return em.on('@peers', cb); },
    peers: () => [...players.values()],
    close(){ players.forEach((_, id) => send('bye', {}, id)); main.close(); lobby.close(); players.clear(); } };
}

/** Join a game. password → direct; code only → host must approve.
 *  status: 'connecting' | 'waiting-approval' | 'connected' | 'host-left' | 'denied' | 'failed' */
export function joinRoom({ code, password = null, name = 'Guest', transport = 'trystero' } = {}){
  code = normalizeCode(code); const open = TRANSPORTS[transport], allowed = new Set(), em = emitter();
  const g = { status: 'connecting', host: null, transport, error: null };
  const set = s => { if(g.status !== s){ g.status = s; em.emit('@status', s); } };
  let main = null, lobby = null, timer = null, gone = false, send = () => {};
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if(g.status === 'connecting'){ g.error = FAIL_TEXT; set('failed'); } }, TIMEOUT_MS); };
  const connect = pw => {
    main = open(chan(code), pw);
    send = endpoint(main, allowed, (t, d, from) => {
      if(t === 'hello' && d?.host === true && (!g.host || g.host.id === from)){
        g.host = { id: from, name: cleanName(d.name), game: String(d.game || '').slice(0, 40) }; clearTimeout(timer); set('connected');
      } else if(g.host && from === g.host.id){ if(t === 'bye'){ g.host = null; set('host-left'); } else if(!INTERNAL.has(t)) em.emit(t, d, g.host); }
    });
    main.ev.peer = id => send('hello', { name: cleanName(name) }, id);
    main.ev.leave = id => { if(g.host?.id === id){ g.host = null; set('host-left'); } };   // host coming back re-hellos → connected
  };
  if(!code){ g.error = 'That code doesn’t look right.'; g.status = 'failed'; }
  else if(password) connect(password);
  else {
    lobby = open(chan(code, true), lobbyPass(code));
    const lsend = endpoint(lobby, new Set(), (t, d, from) => {
      if(t === 'welcome' && typeof d?.password === 'string' && /^[A-Za-z0-9_-]{22}$/.test(d.password)){ lobby.close(); lobby = null; set('connecting'); arm(); connect(d.password); }
      else if(t === 'deny'){ clearTimeout(timer); lobby.close(); lobby = null; set('denied'); }
    });
    lobby.ev.peer = id => { lsend('knock', { name: cleanName(name) }, id); clearTimeout(timer); set('waiting-approval'); };
  }
  if(code) arm();
  return Object.assign(g, {
    send(type, data){ if(g.host && !INTERNAL.has(type)) send(type, data, g.host.id); },
    on(type, cb){ allowed.add(type); return em.on(type, cb); },
    onStatus(cb){ return em.on('@status', cb); },
    leave(){ if(gone) return; gone = true; clearTimeout(timer); if(g.host) send('bye', {}, g.host.id); main?.close(); lobby?.close(); set('left'); } });
}

/** Pairing UI using the shell's helpers: big spaced code, QR, copy link. */
export function pairingUI({ h, qrCanvas, copy, toast }, host){
  const qr = qrCanvas && qrCanvas(host.joinLink, 320);
  return h('div', { className: 'pairing' },
    h('p', { className: 'pair-code', style: 'font-size:2.6rem;letter-spacing:.3em;font-weight:700' }, host.code.replace('-', ' ')),
    qr ? h('div', {}, qr) : null,
    h('button', { onclick: async () => toast(await copy(host.joinLink) ? 'Link copied!' : 'Couldn’t copy.') }, '📋 Copy link'));
}
