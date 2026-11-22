#!/usr/bin/env node
/**
 * Local E2E for Доброта «Нужды»: mock /dobro/* + static client + Puppeteer screenshots.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('/tmp/node_modules/puppeteer-core');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOBROTA = path.join(ROOT, 'dobrota');
const ART = '/opt/cursor/artifacts';
const PORT = 8791;
const API_PORT = 8792;

const state = { users: {}, feed: [], needs: [], seq: 1 };

function json(res, obj, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : null); } catch { resolve(null); }
    });
  });
}

function publicNeed(n, viewerId) {
  const prayed = n.prayed || {};
  const helped = n.helped || {};
  return {
    id: n.id, type: 'need', title: n.text, text: n.text, category: 'need', points: 0,
    createdAt: n.createdAt, photoUrl: n.photo || null, hasPhoto: !!n.photo,
    authorName: n.authorName, authorId: n.authorId, isYou: n.authorId === viewerId,
    status: n.status, contact: n.contact || '', hasContact: !!n.contact,
    prayCount: n.prayCount || 0, helpCount: n.helpCount || 0,
    prayed: !!prayed[viewerId], helped: !!helped[viewerId],
    offers: n.authorId === viewerId ? (n.offers || []) : []
  };
}

function publicState(viewerId) {
  const u = state.users[viewerId];
  const feed = [
    ...state.feed.map((f) => ({ ...f, type: 'deed', isYou: f.authorId === viewerId })),
    ...state.needs.filter((n) => n.status === 'open' || n.authorId === viewerId).map((n) => publicNeed(n, viewerId))
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    ok: true,
    me: {
      name: (u && u.name) || '', totalPoints: (u && u.points) || 0, deedCount: (u && u.deedCount) || 0,
      exists: !!u, hasPin: !!(u && u.pin)
    },
    board: [],
    feed,
    deeds: (u && u.deeds) || [],
    features: { needs: true }
  };
}

function award(userId, kind, needId) {
  const u = state.users[userId];
  if (!u) return null;
  const deed = {
    id: state.seq++, title: kind === 'pray' ? 'Молитва' : 'Помощь',
    category: kind === 'pray' ? 'care' : 'help', points: 5,
    createdAt: new Date().toISOString(), status: 'approved',
    kind: kind === 'pray' ? 'need_pray' : 'need_help', needId
  };
  u.deeds.unshift(deed);
  u.points = (u.points || 0) + 5;
  u.deedCount = (u.deedCount || 0) + 1;
  return deed;
}

const apiServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, { ok: true });
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  if (req.method === 'GET' && (p === '/dobro/ping' || p === '/dobro')) {
    return json(res, { ok: true, app: 'dobrota', push: false, needs: true });
  }
  if (req.method === 'GET' && p === '/dobro/state') {
    return json(res, publicState(url.searchParams.get('id') || ''));
  }
  if (req.method === 'POST' && p === '/dobro/register') {
    const body = await readBody(req);
    const id = (body && body.id) || String(Date.now());
    state.users[id] = { name: (body && body.name) || 'Участник', pin: body && body.pin, points: 0, deedCount: 0, deeds: [] };
    return json(res, { ok: true, id, name: state.users[id].name, hasPin: true }, 201);
  }
  if (req.method === 'POST' && p === '/dobro/need') {
    const body = await readBody(req);
    const u = state.users[body && body.id];
    if (!u) return json(res, { ok: false, error: 'auth' }, 404);
    const need = {
      id: state.seq++, text: String(body.text || '').trim(), authorId: body.id, authorName: u.name,
      contact: String(body.contact || '').trim(), photo: body.photo || null,
      createdAt: new Date().toISOString(), status: 'open', prayCount: 0, helpCount: 0,
      prayed: {}, helped: {}, offers: []
    };
    state.needs.unshift(need);
    return json(res, { ok: true, need: publicNeed(need, body.id) }, 201);
  }
  if (req.method === 'POST' && p === '/dobro/need/pray') {
    const body = await readBody(req);
    const need = state.needs.find((n) => n.id === Number(body.needId));
    if (!need) return json(res, { ok: false, error: 'need' }, 404);
    let awarded = false; let deed = null;
    if (!need.prayed[body.id]) {
      need.prayed[body.id] = 1;
      need.prayCount = Object.keys(need.prayed).length;
      deed = award(body.id, 'pray', need.id);
      awarded = true;
    }
    return json(res, { ok: true, awarded, already: !awarded, points: awarded ? 5 : 0, prayCount: need.prayCount, deed });
  }
  if (req.method === 'POST' && p === '/dobro/need/help') {
    const body = await readBody(req);
    const need = state.needs.find((n) => n.id === Number(body.needId));
    if (!need) return json(res, { ok: false, error: 'need' }, 404);
    let awarded = false; let deed = null;
    if (!need.helped[body.id]) {
      need.helped[body.id] = 1;
      need.helpCount = Object.keys(need.helped).length;
      deed = award(body.id, 'help', need.id);
      awarded = true;
    }
    const hasContact = !!need.contact;
    if (!hasContact && !need.offers.some((o) => o.id === body.id)) {
      need.offers.unshift({ id: body.id, name: state.users[body.id]?.name || 'Участник', createdAt: new Date().toISOString() });
    }
    return json(res, {
      ok: true, awarded, already: !awarded, points: awarded ? 5 : 0, helpCount: need.helpCount,
      hasContact, contact: need.contact || '', offered: !hasContact, deed
    });
  }
  if (req.method === 'POST') return json(res, { ok: true });
  json(res, { ok: false, error: 'not_found' }, 404);
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

const staticServer = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(DOBROTA, rel);
  if (!file.startsWith(DOBROTA) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('no');
  }
  let buf = fs.readFileSync(file);
  if (rel.endsWith('app.js')) {
    buf = Buffer.from(buf.toString('utf8').replace(
      /const API = '[^']+'/,
      `const API = 'http://127.0.0.1:${API_PORT}'`
    ).replace(
      /navigator\.serviceWorker\.register/,
      'false&&navigator.serviceWorker.register'
    ));
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(buf);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshPage(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('dobrota-rules-seen-v1', '1'); } catch {}
    try { localStorage.setItem('dobrota-push-prompt-v1', '1'); } catch {}
  });
  return { ctx, page };
}

async function register(page, name, pin) {
  await page.goto(`http://127.0.0.1:${PORT}/?tab=feed&_=${Date.now()}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#gate-form', { visible: true, timeout: 10000 });
  await page.evaluate((n, p) => {
    document.getElementById('gate-mode-login')?.classList.add('hidden');
    document.getElementById('gate-mode-register')?.classList.remove('hidden');
    document.getElementById('gate-name').value = n;
    document.getElementById('gate-pin').value = p;
    document.getElementById('gate-pin2').value = p;
    document.getElementById('gate-submit').click();
  }, name, pin);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 10000 });
  await wait(700);
  await page.evaluate(() => document.getElementById('push-prompt-no')?.click());
}

async function main() {
  await new Promise((r) => apiServer.listen(API_PORT, '127.0.0.1', r));
  await new Promise((r) => staticServer.listen(PORT, '127.0.0.1', r));
  fs.mkdirSync(ART, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=390,844']
  });

  // Author: form + publish
  const a = await freshPage(browser);
  await register(a.page, 'Анна', '1234');
  await a.page.evaluate(() => document.querySelector('.tab[data-tab="add"]').click());
  await wait(400);
  await a.page.evaluate(() => document.getElementById('mode-need').click());
  await wait(300);
  await a.page.waitForSelector('#need-form:not(.hidden)');
  await a.page.type('#need-text', 'Нужна помощь с покупками для бабушки');
  await a.page.type('#need-contact', '@anna_help');
  await a.page.screenshot({ path: path.join(ART, 'dobrota-need-form.png') });
  await a.page.click('#btn-need-add');
  await wait(1000);
  await a.page.evaluate(() => document.querySelector('.feed-filter[data-filter="needs"]').click());
  await wait(400);
  await a.page.screenshot({ path: path.join(ART, 'dobrota-need-feed-author.png') });
  await a.ctx.close();

  // Helper: actions
  const h = await freshPage(browser);
  await register(h.page, 'Игорь', '5678');
  await h.page.evaluate(() => document.querySelector('.feed-filter[data-filter="needs"]').click());
  await wait(600);
  await h.page.waitForSelector('.need-card .need-pray', { timeout: 8000 });
  await h.page.screenshot({ path: path.join(ART, 'dobrota-need-card-actions.png') });
  await h.page.evaluate(() => document.querySelector('.need-pray').click());
  await wait(800);
  await h.page.evaluate(() => document.querySelector('.need-help')?.click());
  await wait(800);
  await h.page.screenshot({ path: path.join(ART, 'dobrota-need-after-actions.png') });

  const feedText = await h.page.$eval('#feed-list', (el) => el.innerText);
  const me = await h.page.$eval('#me-chip', (el) => el.textContent);
  const points = Number((me.match(/·\s*(\d+)/) || [])[1] || 0);
  const ok = /нужда/i.test(feedText) && points >= 10;
  console.log(JSON.stringify({ ok, me, points, feedText: feedText.slice(0, 200) }));

  await h.ctx.close();
  await browser.close();
  apiServer.close();
  staticServer.close();
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
