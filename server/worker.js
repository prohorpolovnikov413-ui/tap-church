const ORIGINS = new Set([
  'https://prohorpolovnikov413-ui.github.io'
]);
const ONLINE_MS = 180000;
const SCORE_MIN_MS = 5 * 60 * 1000;
const NICK_MIN_MS = 60000;
const SYNC_MIN_MS = 5 * 60 * 1000;
const FLUSH_MS = 10 * 60 * 1000;
const CACHE_ONLINE = 'https://zavhoz-board.internal/online-v1';
const CACHE_LADDER = 'https://zavhoz-board.internal/ladder-v1';
const CACHE_FLUSH = 'https://zavhoz-board.internal/flush-v1';
const memStore = new Map();
const TOP_N = 50;
const REF_PCT = 5;
const REF_CAP = 50;
const REF_CHEST = 2000;
const REF_GIFT = 500;
const BAD = [
  'хуй','хуя','хуе','хуё','пизд','бляд','блят','ебан','ёбан','ебат','ёбат',
  'сука','суки','сучк','мудил','мудак','жопа','залуп','гандон','гондон',
  'пидор','пидар','педик','чмо','падла','тварь','дерьм','срать','срал'
];

function cors(origin) {
  const allow = origin && (ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  const headers = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, cache-control',
    'access-control-max-age': '86400',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'cdn-cache-control': 'no-store',
    pragma: 'no-cache',
    expires: '0',
    vary: 'Origin'
  };
  if (allow) headers['access-control-allow-origin'] = origin;
  return headers;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) }
  });
}

function validId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

function validRef(r) {
  return typeof r === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(r);
}

function stripBlankish(s) {
  return s.replace(/[\u0000-\u001F\u007F\u00A0\u200B-\u200F\u202A-\u202E\u2060\u2800\u3164\uFEFF\uFFA0]/g, '');
}

function cleanNick(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'nick' };
  let s = stripBlankish(raw).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 16) return { ok: false, error: 'nick' };
  if (!/^[0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ _-]+$/.test(s)) return { ok: false, error: 'nick' };
  if (!s.replace(/[\s_-]+/g, '').length) return { ok: false, error: 'nick' };
  const low = s.toLowerCase();
  for (const w of BAD) if (low.includes(w)) return { ok: false, error: 'nick' };
  return { ok: true, nick: s };
}

function validScore(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e18;
}


async function cacheRead(url) {
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      const r = await caches.default.match(new Request(url));
      if (r) return await r.json();
    }
  } catch (e) {}
  return memStore.has(url) ? memStore.get(url) : null;
}

async function cacheWrite(url, obj) {
  memStore.set(url, obj);
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      await caches.default.put(
        new Request(url),
        new Response(JSON.stringify(obj), {
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' }
        })
      );
    }
  } catch (e) {}
}

async function getFlushMeta() {
  const m = await cacheRead(CACHE_FLUSH);
  return m && typeof m === 'object' ? m : {};
}

async function markFlushed(key, now) {
  const m = await getFlushMeta();
  m[key] = now;
  await cacheWrite(CACHE_FLUSH, m);
}

async function maybeFlush(kv, key, value, now) {
  const m = await getFlushMeta();
  if (m[key] && now - m[key] < FLUSH_MS) return false;
  await kv.put(key, JSON.stringify(value));
  m[key] = now;
  await cacheWrite(CACHE_FLUSH, m);
  return true;
}

async function getOnline(kv, now) {
  let map = await cacheRead(CACHE_ONLINE);
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    map = await readJson(kv, 'online', {});
  }
  return pruneOnline(map, now);
}

async function touchOnline(kv, id, now) {
  const map = await getOnline(kv, now);
  map[id] = now;
  await cacheWrite(CACHE_ONLINE, map);
  await maybeFlush(kv, 'online', map, now);
  return map;
}

async function getLadder(kv) {
  let ladder = await cacheRead(CACHE_LADDER);
  if (!Array.isArray(ladder)) ladder = await readJson(kv, 'ladder', []);
  return ladder;
}

async function setLadder(kv, ladder, now, forceFlush) {
  await cacheWrite(CACHE_LADDER, ladder);
  if (forceFlush) {
    await kv.put('ladder', JSON.stringify(ladder));
    await markFlushed('ladder', now);
    return;
  }
  await maybeFlush(kv, 'ladder', ladder, now);
}

function isQuotaErr(err) {
  const s = String((err && (err.message || err)) || '');
  return /KV put\(\) limit|exceeded for the day|write.*limit/i.test(s);
}

function saveFingerprint(save) {
  if (!save || typeof save !== 'object') return '';
  const o = Object.assign({}, save);
  delete o.t;
  delete o.syncAt;
  if (o.st && typeof o.st === 'object') {
    o.st = Object.assign({}, o.st);
    delete o.st.play;
  }
  try { return JSON.stringify(o); } catch (e) { return ''; }
}

async function readJson(kv, key, fallback) {
  const v = await kv.get(key, { type: 'json' });
  return v == null ? fallback : v;
}

function pruneOnline(map, now) {
  const out = {};
  for (const [id, ts] of Object.entries(map || {})) {
    if (typeof ts === 'number' && now - ts <= ONLINE_MS) out[id] = ts;
  }
  return out;
}

function countOnline(map, now) {
  let n = 0;
  for (const ts of Object.values(map || {})) if (typeof ts === 'number' && now - ts <= ONLINE_MS) n++;
  return n;
}

function sortLadder(ladder) {
  ladder.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
  return ladder;
}

function publicList(ladder, limit, meId) {
  return ladder.slice(0, limit).map((e, i) => ({
    rank: i + 1,
    nick: e.nick || 'Гость',
    score: e.score || 0,
    me: e.id === meId
  }));
}

function findMe(ladder, id) {
  if (!id) return null;
  const i = ladder.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const e = ladder[i];
  return { rank: i + 1, nick: e.nick || 'Гость', score: e.score || 0, of: ladder.length };
}

function bonusPct(invited) {
  return Math.min(REF_CAP, Math.max(0, (invited || 0) * REF_PCT));
}

function mePayload(rec) {
  const invited = (rec && rec.invited) || 0;
  return {
    ok: true,
    invitedCount: invited,
    unclaimed: (rec && rec.unclaimed) || 0,
    bonusPct: bonusPct(invited),
    chest: REF_CHEST,
    gift: REF_GIFT,
    cap: REF_CAP,
    pct: REF_PCT
  };
}

async function resolveRef(kv, ref) {
  if (!validRef(ref)) return null;
  const mapped = await kv.get('r:' + ref);
  if (mapped && validId(mapped)) return mapped;
  // A short invite code must never be treated as a playerId (that would attach the referrer's record).
  // Only accept a raw id if it looks like a full playerId, not a 12-char ref.
  const compact = String(ref).replace(/-/g, '');
  if (validId(ref) && compact.length >= 20) {
    const rec = await readJson(kv, 'p:' + ref, null);
    if (rec) return ref;
  }
  return null;
}


function validSecret(s) {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{24,80}$/.test(s);
}

async function shaHex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randToken(n) {
  const a = new Uint8Array(n || 24);
  crypto.getRandomValues(a);
  let bin = '';
  for (const b of a) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sanitizeSave(save) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
  let raw;
  try { raw = JSON.stringify(save); } catch (e) { return null; }
  if (raw.length > 180000) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveTotal(save) {
  const n = save && typeof save.total === 'number' ? save.total : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function incomingWins(cur, incAt, incSave) {
  if (!cur) return true;
  const ta = incAt || 0;
  const tb = cur.syncAt || 0;
  if (Math.abs(ta - tb) < 2000) return saveTotal(incSave) > saveTotal(cur.save);
  return ta > tb;
}

async function registerRefCode(kv, id, code) {
  if (!validRef(code) || !validId(id)) return;
  const existing = await kv.get('r:' + code);
  if (!existing) await kv.put('r:' + code, id);
}


const DOBRO_KEY = 'dobro:v1';
const DOBRO_FEED_MAX = 50;
const DOBRO_HIST_MAX = 50;
const DOBRO_PHOTO_MAX = 60 * 1024;
const DOBRO_DEED_MS = 10000;
const DOBRO_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DOBRO_VISION_FALLBACK = '@cf/llava-hf/llava-1.5-7b-hf';
const DOBRO_PHASH_PREFIX = 'dobro:phash:';
const DOBRO_CATS = {
  help: { id: 'help', points: 15, label: 'Помощь' },
  family: { id: 'family', points: 15, label: 'Семья' },
  care: { id: 'care', points: 15, label: 'Забота' },
  home: { id: 'home', points: 15, label: 'Дом' },
  street: { id: 'street', points: 15, label: 'Улица' },
  animals: { id: 'animals', points: 15, label: 'Животные' },
  nature: { id: 'nature', points: 15, label: 'Природа' },
  gift: { id: 'gift', points: 10, label: 'Подарок' },
  time: { id: 'time', points: 20, label: 'Время' },
  other: { id: 'other', points: 10, label: 'Другое' }
};
const DOBRO_CAT_ALIASES = {
  smile: 'gift',
  big: 'help',
  volunteer: 'time'
};
function resolveDobroCat(raw) {
  const key = DOBRO_CAT_ALIASES[raw] || raw;
  return DOBRO_CATS[key] || null;
}
function publicDobroCategory(raw) {
  const cat = resolveDobroCat(raw);
  return cat ? cat.id : (raw || 'other');
}

function cleanDobroName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'nick' };
  let s = stripBlankish(raw).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 40) return { ok: false, error: 'nick' };
  if (!/^[0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ _-]+$/.test(s)) return { ok: false, error: 'nick' };
  if (!s.replace(/[\s_-]+/g, '').length) return { ok: false, error: 'nick' };
  const low = s.toLowerCase();
  for (const w of BAD) if (low.includes(w)) return { ok: false, error: 'nick' };
  return { ok: true, name: s };
}

function cleanDobroTitle(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'title' };
  let s = stripBlankish(raw).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (s.length < 3) return { ok: false, error: 'title' };
  const low = s.toLowerCase();
  for (const w of BAD) if (low.includes(w)) return { ok: false, error: 'title' };
  return { ok: true, title: s };
}

function parseDobroPhoto(value) {
  if (value == null || value === '') {
    return { ok: false, error: 'photo', errorText: 'Нужно приложить фото доброго дела' };
  }
  if (typeof value !== 'string') return { ok: false, error: 'photo', errorText: 'Неверный формат фото' };
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!m) return { ok: false, error: 'photo', errorText: 'Можно только JPEG, PNG или WebP' };
  const b64 = m[1].replace(/\s+/g, '');
  if (b64.length < 64) return { ok: false, error: 'photo', errorText: 'Фото повреждено или пустое' };
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor(b64.length * 3 / 4) - pad;
  if (bytes > DOBRO_PHOTO_MAX) return { ok: false, error: 'photo', errorText: 'Фото слишком большое' };
  const mime = value.slice(5, value.indexOf(';'));
  return { ok: true, photo: `data:${mime};base64,${b64}`, base64: b64 };
}

async function dobroPhotoHash(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dig = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function dobroLooksBlank(base64) {
  // Reject only tiny/near-uniform payloads (solid-color stubs), not normal phone photos.
  const bin = atob(base64);
  if (bin.length < 800) return true;
  let sum = 0, sumSq = 0, n = 0;
  const step = Math.max(1, Math.floor(bin.length / 500));
  for (let i = 0; i < bin.length; i += step) {
    const v = bin.charCodeAt(i);
    sum += v; sumSq += v * v; n++;
  }
  if (n < 20) return true;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  // JPEG of a real scene has much higher byte variance; keep threshold low to avoid false rejects.
  return variance < 6;
}

function dobroExtractJson(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function dobroVerifyPrompt(title, categoryLabel) {
  return [
    'Ты мягкий модератор приложения «Доброта» (добрые дела). Задача — НЕ доказывать, что дело настоящее, а только отсечь недопустимый контент.',
    `Текст дела: «${title}». Категория: «${categoryLabel}».`,
    'По умолчанию ОДОБРЯЙ почти любое фото: обычные жизненные кадры, помощь, улыбки, предметы, место, руки, еда, природа, скриншоты без запрещённого, мемы без запрещённого, размытые/неидеальные снимки, слабая связь с текстом — всё это НОРМАЛЬНО, approved=true.',
    'Отклоняй (approved=false) ТОЛЬКО если на фото явно видно запрещённое:',
    '1) 18+ / обнажёнка / эротика / сексуальный контент;',
    '2) сигареты, вейпы, курение, табак;',
    '3) алкоголь (бутылки, бокалы с алкоголем, пьянство);',
    '4) наркотики или атрибуты употребления;',
    '5) насилие, кровь, ранения, оружие;',
    '6) неприличные жесты (средний палец и т.п.).',
    'Если сомневаешься — одобряй. Не отклоняй за «недоказанность» дела, сток, коллаж или «не то фото».',
    'reason при отказе — короткая понятная фраза по-русски, например: «На фото нельзя показывать алкоголь», «Уберите курение/вейп с кадра», «Нельзя фото с обнажёнкой или эротикой», «Нельзя насилие, кровь или оружие», «Уберите неприличный жест».',
    'Ответь ТОЛЬКО JSON без markdown: {"approved":true|false,"reason":"кратко по-русски (до 120 символов)"}'
  ].join('\n');
}

function dobroErrText(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  try {
    return String(err.message || err.error || err.statusText || JSON.stringify(err));
  } catch {
    return String(err);
  }
}

function dobroIsLicenseError(err) {
  const t = dobroErrText(err).toLowerCase();
  return /license|agree|acceptable use|aup|terms|must agree|not accepted|meta.?license/.test(t);
}

function dobroIsVerifyInfraFail(reason) {
  const t = String(reason || '');
  return /не удалось проверить|временно недоступн|нет ai|ai binding|попробуйте ещё|попробуйте чуть|автоматически|error/i.test(t);
}

function dobroAiResultText(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  return (
    result.response || result.description || result.result
    || (Array.isArray(result.content) ? result.content.map((c) => c.text || '').join(' ') : '')
    || (typeof result === 'object' ? JSON.stringify(result) : '')
  );
}

async function dobroAiAgree(env, model) {
  try {
    await env.AI.run(model, { prompt: 'agree' });
    return true;
  } catch {
    return false;
  }
}

async function dobroAiRunOnce(env, model, prompt, photoDataUrl) {
  // Preferred Workers AI vision shape: prompt + image as data URI string (not huge number[])
  try {
    return await env.AI.run(model, {
      prompt,
      image: photoDataUrl,
      max_tokens: 200
    });
  } catch (e1) {
    if (dobroIsLicenseError(e1)) throw e1;
    // Chat/messages shape with image_url data URI
    try {
      return await env.AI.run(model, {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: photoDataUrl } }
          ]
        }],
        max_tokens: 200
      });
    } catch (e2) {
      if (dobroIsLicenseError(e2)) throw e2;
      // Last: image as number[] (small photos only — avoid giant payloads)
      const bytes = Uint8Array.from(atob(photoDataUrl.replace(/^data:[^;]+;base64,/, '')), (c) => c.charCodeAt(0));
      if (bytes.length > 80 * 1024) throw e2;
      return await env.AI.run(model, {
        prompt,
        image: [...bytes],
        max_tokens: 200
      });
    }
  }
}

async function dobroAiRunWithAgree(env, model, prompt, photoDataUrl) {
  try {
    return await dobroAiRunOnce(env, model, prompt, photoDataUrl);
  } catch (err) {
    if (!dobroIsLicenseError(err)) throw err;
    await dobroAiAgree(env, model);
    return await dobroAiRunOnce(env, model, prompt, photoDataUrl);
  }
}

async function verifyDobroPhoto(env, { title, categoryLabel, photo, base64, userId }) {
  const hash = await dobroPhotoHash(base64);
  const hashKey = DOBRO_PHASH_PREFIX + hash;
  const used = await env.KV.get(hashKey);
  if (used) {
    return {
      status: 'rejected',
      reason: used === userId ? 'Вы уже отправляли это же фото' : 'Это фото уже использовали раньше',
      hash
    };
  }
  if (dobroLooksBlank(base64)) {
    return { status: 'rejected', reason: 'Кажется, фото пустое — прикрепите обычный снимок', hash };
  }
  // Fail-open: no AI binding → accept
  if (!env.AI || typeof env.AI.run !== 'function') {
    return {
      status: 'approved',
      reason: 'Проверка недоступна — принято автоматически',
      hash,
      failOpen: true
    };
  }

  const prompt = dobroVerifyPrompt(title, categoryLabel);
  const photoDataUrl = photo || (`data:image/jpeg;base64,` + base64);
  let modelText = '';
  let lastErr = null;
  const models = [DOBRO_VISION_MODEL, DOBRO_VISION_FALLBACK];
  for (const model of models) {
    try {
      const result = await dobroAiRunWithAgree(env, model, prompt, photoDataUrl);
      modelText = dobroAiResultText(result);
      if (modelText) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!modelText) {
    // Fail-open on infra/AI errors (license, format, quota, timeout…)
    return {
      status: 'approved',
      reason: 'Проверка недоступна — принято автоматически',
      hash,
      failOpen: true,
      error: dobroErrText(lastErr).slice(0, 200)
    };
  }

  const parsed = dobroExtractJson(String(modelText));
  // Soft default: if model answer is unclear, approve (only explicit false rejects)
  const approved = !(parsed && parsed.approved === false);
  let reason = String((parsed && parsed.reason) || '').trim().slice(0, 140);
  if (!reason) {
    reason = approved
      ? 'Фото принято'
      : 'На фото есть недопустимый контент — загрузите другой снимок';
  }
  if (approved) {
    await env.KV.put(hashKey, userId, { expirationTtl: 60 * 60 * 24 * 180 });
  }
  return { status: approved ? 'approved' : 'rejected', reason, hash };
}

function dobroPhotoKey(deedId) {
  return 'dobro:photo:' + String(deedId);
}

function deedHasPhoto(d) {
  return !!(d && (d.hasPhoto || d.photo));
}

async function putDobroPhotoBlob(kv, deedId, dataUrl) {
  if (!dataUrl) return false;
  // Separate KV value keeps dobro:v1 small; TTL ~180d matches photo hash policy
  await kv.put(dobroPhotoKey(deedId), dataUrl, { expirationTtl: 60 * 60 * 24 * 180 });
  return true;
}

async function getDobroPhotoBlob(kv, deedId) {
  try {
    return (await kv.get(dobroPhotoKey(deedId))) || null;
  } catch {
    return null;
  }
}

async function deleteDobroPhotoBlob(kv, deedId) {
  try { await kv.delete(dobroPhotoKey(deedId)); } catch {}
}

function applyDobroApproval(st, userId, deedId, reason) {
  const user = st.users[userId];
  if (!user || !Array.isArray(user.deeds)) return { ok: false, error: 'deed' };
  const idx = user.deeds.findIndex((d) => d.id === deedId);
  if (idx < 0) return { ok: false, error: 'deed' };
  const cur = user.deeds[idx];
  if (cur.status === 'approved' && (cur.points || 0) > 0) {
    // Still ensure feed entry if photo exists but was missing from feed
    if (deedHasPhoto(cur) && !st.feed.some((f) => f.id === cur.id)) {
      st.feed.unshift({
        id: cur.id,
        title: cur.title,
        category: publicDobroCategory(cur.category),
        points: cur.points,
        createdAt: cur.createdAt,
        hasPhoto: true,
        authorName: user.name || 'Участник',
        authorId: userId,
        status: 'approved',
        reason: cur.reason || reason || ''
      });
    }
    return { ok: true, already: true, deed: cur };
  }
  const cat = resolveDobroCat(cur.category);
  const points = cur.awardPoints || (cat && cat.points) || 0;
  if (cat) cur.category = cat.id;
  cur.status = 'approved';
  cur.reason = reason || 'Фото принято';
  cur.points = points;
  // Do not keep bulky base64 on the deed — photo lives in dobro:photo:{id}
  if (cur.photo) {
    cur.hasPhoto = true;
    delete cur.photo;
  }
  user.points = (user.points || 0) + points;
  user.deedCount = (user.deedCount || 0) + 1;
  if (deedHasPhoto(cur) && !st.feed.some((f) => f.id === cur.id)) {
    st.feed.unshift({
      id: cur.id,
      title: cur.title,
      category: publicDobroCategory(cur.category),
      points: cur.points,
      createdAt: cur.createdAt,
      hasPhoto: true,
      authorName: user.name || 'Участник',
      authorId: userId,
      status: 'approved',
      reason: cur.reason
    });
  }
  return { ok: true, deed: cur };
}

function emptyDobro() {
  return { users: {}, feed: [], seq: 1 };
}

async function getDobro(kv) {
  const state = await readJson(kv, DOBRO_KEY, null);
  if (!state || typeof state !== 'object') return emptyDobro();
  if (!state.users || typeof state.users !== 'object') state.users = {};
  if (!Array.isArray(state.feed)) state.feed = [];
  if (!state.seq) state.seq = 1;
  return state;
}

async function putDobro(kv, state) {
  await kv.put(DOBRO_KEY, JSON.stringify(state));
}

async function pruneDobroPhotos(kv, state) {
  const dropped = [];
  if (state.feed.length > DOBRO_FEED_MAX) {
    dropped.push(...state.feed.slice(DOBRO_FEED_MAX));
    state.feed = state.feed.slice(0, DOBRO_FEED_MAX);
  }
  // Normalize feed: photos live in dobro:photo:{id}, not inside dobro:v1
  for (const item of state.feed) {
    if (item.photo && kv) {
      await putDobroPhotoBlob(kv, item.id, item.photo);
      item.hasPhoto = true;
      delete item.photo;
    } else if (item.photo) {
      item.hasPhoto = true;
      delete item.photo;
    }
  }
  for (const u of Object.values(state.users)) {
    if (!Array.isArray(u.deeds)) u.deeds = [];
    if (u.deeds.length > DOBRO_HIST_MAX) u.deeds = u.deeds.slice(0, DOBRO_HIST_MAX);
    for (const d of u.deeds) {
      if (!d.photo) continue;
      // Move any leftover inline base64 into KV; never drop pending/error before publish
      if (kv) await putDobroPhotoBlob(kv, d.id, d.photo);
      d.hasPhoto = true;
      delete d.photo;
    }
  }
  if (kv) {
    for (const item of dropped) {
      if (item && item.id != null) await deleteDobroPhotoBlob(kv, item.id);
    }
  }
}

/** Re-attach approved deeds with photos that never made it into feed (prune bug). */
async function repairDobroFeed(kv, state) {
  let changed = false;
  const inFeed = new Set(state.feed.map((f) => f.id));
  for (const [uid, user] of Object.entries(state.users || {})) {
    if (!user || !Array.isArray(user.deeds)) continue;
    for (const d of user.deeds) {
      if ((d.status || 'approved') !== 'approved') continue;
      if (inFeed.has(d.id)) continue;
      let photo = d.photo || null;
      if (!photo) photo = await getDobroPhotoBlob(kv, d.id);
      if (!photo && !d.hasPhoto) continue;
      if (photo) {
        await putDobroPhotoBlob(kv, d.id, photo);
        d.hasPhoto = true;
        delete d.photo;
      } else if (!d.hasPhoto) {
        continue;
      }
      state.feed.unshift({
        id: d.id,
        title: d.title,
        category: publicDobroCategory(d.category),
        points: d.points || 0,
        createdAt: d.createdAt,
        hasPhoto: true,
        authorName: user.name || 'Участник',
        authorId: uid,
        status: 'approved',
        reason: d.reason || ''
      });
      inFeed.add(d.id);
      changed = true;
    }
  }
  if (changed) {
    state.feed.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    await pruneDobroPhotos(kv, state);
  }
  return changed;
}

async function resolveDeedPhotoUrl(kv, deedOrFeedItem) {
  if (!deedOrFeedItem) return null;
  if (deedOrFeedItem.photo) return deedOrFeedItem.photo;
  if (deedOrFeedItem.photoUrl) return deedOrFeedItem.photoUrl;
  if (deedOrFeedItem.hasPhoto || deedOrFeedItem.id != null) {
    const blob = await getDobroPhotoBlob(kv, deedOrFeedItem.id);
    if (blob) return blob;
  }
  return null;
}

async function publicDobro(state, id, kv) {
  const u = (id && state.users[id]) || null;
  const board = Object.entries(state.users)
    .filter(([, rec]) => (rec.deedCount || 0) > 0)
    .map(([uid, rec]) => ({
      id: uid,
      name: rec.name || 'Участник',
      totalPoints: rec.points || 0,
      deedCount: rec.deedCount || 0
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints || b.deedCount - a.deedCount || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 30)
    .map((e, i) => ({
      rank: i + 1,
      name: e.name,
      totalPoints: e.totalPoints,
      deedCount: e.deedCount,
      isYou: e.id === id
    }));
  // Approved feed items with a photo (inline legacy or KV blob)
  const feedSrc = state.feed
    .filter((item) => (item.status || 'approved') === 'approved')
    .slice(0, DOBRO_FEED_MAX);
  const feed = [];
  for (const item of feedSrc) {
    const photoUrl = await resolveDeedPhotoUrl(kv, item);
    if (!photoUrl) continue; // лента только с фото
    feed.push({
      id: item.id,
      title: item.title,
      category: publicDobroCategory(item.category),
      points: item.points,
      createdAt: item.createdAt,
      photoUrl,
      authorName: item.authorName,
      authorId: item.authorId || '',
      isYou: item.authorId === id,
      status: item.status || 'approved',
      reason: item.reason || ''
    });
  }
  const deeds = [];
  if (u && Array.isArray(u.deeds)) {
    for (const d of u.deeds) {
      deeds.push({
        id: d.id,
        title: d.title,
        category: publicDobroCategory(d.category),
        points: d.status === 'approved' || !d.status ? (d.points || 0) : 0,
        createdAt: d.createdAt,
        photoUrl: await resolveDeedPhotoUrl(kv, d),
        status: d.status || 'approved',
        reason: d.reason || '',
        canRecover: d.status === 'error' || (d.status === 'rejected' && dobroIsVerifyInfraFail(d.reason))
      });
    }
  }
  return {
    ok: true,
    me: {
      name: (u && u.name) || '',
      totalPoints: (u && u.points) || 0,
      deedCount: (u && u.deedCount) || 0
    },
    board,
    feed,
    deeds
  };
}

function dobroNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findDobroUserByName(state, name) {
  const key = dobroNameKey(name);
  if (!key) return null;
  for (const [id, rec] of Object.entries(state.users || {})) {
    if (dobroNameKey(rec && rec.name) === key) return { id, rec };
  }
  return null;
}

function cleanDobroPin(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, error: 'pin' };
  const s = String(raw).trim();
  if (!/^\d{4}$/.test(s)) return { ok: false, error: 'pin', errorText: 'PIN — ровно 4 цифры' };
  return { ok: true, pin: s };
}

async function hashDobroPin(pin, salt) {
  return shaHex(String(salt) + ':' + String(pin));
}

function newDobroSyncToken() {
  return randToken(24);
}

/* ─── Dobrota Web Push (VAPID + aes128gcm, WebCrypto only) ─── */
const DOBRO_PUSH_USERS = 'dobro:push:users';
const DOBRO_PUSH_U = (id) => 'dobro:push:u:' + id;
// Must match client VAPID_PUBLIC_KEY (base64url uncompressed P-256). Fill after keygen.
const DOBRO_VAPID_PUBLIC_KEY = 'BPJeqvTjwX8B9THQQ_-f2_J8vPla06QP8-oZTcO2AFvIUAoTShM04gvurnDYetxPmuKiCF_imAWqt3jY5KjkomM';

function b64urlToBytes(s) {
  const str = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function concatBytes(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function utf8(s) { return new TextEncoder().encode(s); }

async function hkdfBits(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt, info
  }, key, length * 8));
}

async function importVapidPrivateKey(env) {
  const raw = env.VAPID_PRIVATE_KEY;
  if (!raw || typeof raw !== 'string') return null;
  let jwk = null;
  try { jwk = JSON.parse(raw); } catch {}
  if (!jwk || !jwk.d) {
    // Accept bare base64url "d" and rebuild JWK from DOBRO_VAPID_PUBLIC_KEY
    if (!DOBRO_VAPID_PUBLIC_KEY) return null;
    const pub = b64urlToBytes(DOBRO_VAPID_PUBLIC_KEY);
    if (pub.length !== 65 || pub[0] !== 4) return null;
    jwk = {
      kty: 'EC', crv: 'P-256', ext: true,
      d: raw.trim(),
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65))
    };
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidJwt(endpoint, env, privateKey) {
  const origin = new URL(endpoint).origin;
  const subject = (env.VAPID_SUBJECT && String(env.VAPID_SUBJECT).trim()) || 'mailto:dobrota@localhost';
  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(utf8(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject
  })));
  const data = utf8(header + '.' + payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data));
  return header + '.' + payload + '.' + bytesToB64url(sig);
}

async function encryptWebPush(payloadStr, p256dhB64, authB64) {
  const clientPubRaw = b64urlToBytes(p256dhB64);
  const clientAuth = b64urlToBytes(authB64);
  const localKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const clientKey = await crypto.subtle.importKey('raw', clientPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, localKeys.privateKey, 256));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', localKeys.publicKey));
  const keyInfo = concatBytes(utf8('WebPush: info'), new Uint8Array([0]), clientPubRaw, asPublic);
  const ikm = await hkdfBits(clientAuth, ecdhSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdfBits(salt, ikm, concatBytes(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdfBits(salt, ikm, concatBytes(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concatBytes(utf8(payloadStr), new Uint8Array([2]));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded));
  // aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext+tag
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, sealed.length + 16, false); // record size hint; single-record
  // RFC 8188: rs is the size of each record including header overhead for streaming;
  // for Web Push single record, use a large rs (e.g. 4096) as libraries do.
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concatBytes(salt, rs, new Uint8Array([65]), asPublic, sealed);
}

async function sendWebPush(env, sub, payloadObj) {
  const privateKey = await importVapidPrivateKey(env);
  if (!privateKey || !DOBRO_VAPID_PUBLIC_KEY) return { ok: false, status: 0, skip: true };
  const body = await encryptWebPush(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
  const jwt = await vapidJwt(sub.endpoint, env, privateKey);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + jwt + ', k=' + DOBRO_VAPID_PUBLIC_KEY,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
      Topic: 'dobrota-daily'
    },
    body
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status };
}

function dobroMoscowDayKey(iso) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(iso ? new Date(iso) : new Date());
  } catch {
    return (iso ? new Date(iso) : new Date()).toISOString().slice(0, 10);
  }
}

function dobroUserHasApprovedToday(user) {
  const today = dobroMoscowDayKey();
  if (!user || !Array.isArray(user.deeds)) return false;
  return user.deeds.some((d) => (d.status || 'approved') === 'approved' && d.createdAt && dobroMoscowDayKey(d.createdAt) === today);
}

function dobroCalcStreak(user) {
  const days = new Set();
  (user && user.deeds || []).forEach((d) => {
    if ((d.status || 'approved') === 'approved' && d.createdAt) days.add(dobroMoscowDayKey(d.createdAt));
  });
  if (!days.size) return 0;
  const today = dobroMoscowDayKey();
  const parts = today.split('-').map(Number);
  const todayUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  if (!days.has(today) && !days.has(dobroMoscowDayKey(new Date(todayUtc - 86400000)))) return 0;
  let s = 0;
  let cursor = days.has(today) ? todayUtc : todayUtc - 86400000;
  while (days.has(dobroMoscowDayKey(new Date(cursor)))) {
    s++;
    cursor -= 86400000;
  }
  return s;
}

function dobroDailyPushText(streak) {
  if (streak > 0) {
    return 'Сегодня ещё нет доброго дела 🔥 Серия: ' + streak + ' — успей до полуночи';
  }
  return 'Сегодня ещё нет доброго дела 🔥 Успей до полуночи';
}

async function readPushUserIds(kv) {
  try {
    const raw = await kv.get(DOBRO_PUSH_USERS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((id) => typeof id === 'string' && id.length >= 8) : [];
  } catch { return []; }
}

async function writePushUserIds(kv, ids) {
  await kv.put(DOBRO_PUSH_USERS, JSON.stringify(ids));
}

async function readPushSubs(kv, userId) {
  try {
    const raw = await kv.get(DOBRO_PUSH_U(userId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function writePushSubs(kv, userId, subs) {
  if (!subs.length) await kv.delete(DOBRO_PUSH_U(userId));
  else await kv.put(DOBRO_PUSH_U(userId), JSON.stringify(subs));
}

function normalizePushSub(body) {
  const sub = body && (body.subscription || body);
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//i.test(sub.endpoint)) return null;
  const keys = sub.keys || {};
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length < 20 || keys.auth.length < 8) return null;
  return { endpoint: sub.endpoint.slice(0, 2048), p256dh: keys.p256dh, auth: keys.auth };
}

async function runDobroDailyPush(env) {
  if (!env.VAPID_PRIVATE_KEY || !DOBRO_VAPID_PUBLIC_KEY) return { ok: false, skip: true };
  const userIds = await readPushUserIds(env.KV);
  if (!userIds.length) return { ok: true, sent: 0 };
  const state = await getDobro(env.KV);
  let sent = 0, removed = 0;
  const stillUsers = [];
  for (const userId of userIds) {
    const user = state.users[userId];
    let subs = await readPushSubs(env.KV, userId);
    if (!subs.length) continue;
    if (dobroUserHasApprovedToday(user)) {
      stillUsers.push(userId);
      continue;
    }
    const streak = dobroCalcStreak(user);
    const payload = {
      title: 'Доброта',
      body: dobroDailyPushText(streak),
      url: './?tab=add',
      tag: 'dobrota-daily'
    };
    const keep = [];
    let dirty = false;
    for (const sub of subs) {
      try {
        const r = await sendWebPush(env, sub, payload);
        if (r.skip) { keep.push(sub); continue; }
        if (r.status === 404 || r.status === 410) { removed++; dirty = true; continue; }
        if (r.ok) sent++;
        keep.push(sub);
      } catch {
        keep.push(sub);
      }
    }
    if (dirty || keep.length !== subs.length) await writePushSubs(env.KV, userId, keep);
    if (keep.length) stillUsers.push(userId);
  }
  // Prune empty users from index only when changed
  if (stillUsers.length !== userIds.length || stillUsers.some((id, i) => id !== userIds[i])) {
    await writePushUserIds(env.KV, stillUsers);
  }
  return { ok: true, sent, removed };
}

async function handleDobro(request, env, ctx, url, path, origin) {
  if (request.method === 'GET' && (path === '/dobro/ping' || path === '/dobro')) {
    return json({
      ok: true,
      app: 'dobrota',
      push: !!(env.VAPID_PRIVATE_KEY && DOBRO_VAPID_PUBLIC_KEY)
    }, 200, origin);
  }
  if (request.method === 'GET' && path === '/dobro/state') {
    const id = url.searchParams.get('id') || '';
    if (id && !validId(id)) return json({ ok: false, error: 'id' }, 400, origin);
    const state = await getDobro(env.KV);
    const repaired = await repairDobroFeed(env.KV, state);
    if (repaired) await putDobro(env.KV, state);
    const payload = await publicDobro(state, id || '', env.KV);
    if (id && state.users[id]) {
      payload.me.hasPin = !!state.users[id].pinHash;
      payload.me.exists = true;
    } else if (id) {
      payload.me.exists = false;
      payload.me.hasPin = false;
    }
    return json(payload, 200, origin);
  }
  if (request.method === 'POST' && path === '/dobro/register') {
    const body = await request.json().catch(() => null);
    const nm = cleanDobroName(body && body.name);
    const pin = cleanDobroPin(body && body.pin);
    if (!nm.ok) return json({ ok: false, error: 'nick', errorText: 'Имя: 2–40 символов' }, 400, origin);
    if (!pin.ok) return json({ ok: false, error: 'pin', errorText: pin.errorText || 'PIN — 4 цифры' }, 400, origin);
    let id = body && body.id;
    if (id && !validId(id)) return json({ ok: false, error: 'id' }, 400, origin);
    if (!id) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      id = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    const state = await getDobro(env.KV);
    const taken = findDobroUserByName(state, nm.name);
    if (taken && taken.id !== id) {
      return json({ ok: false, error: 'nick_taken', errorText: 'Такое имя уже занято — войдите в существующий аккаунт' }, 409, origin);
    }
    if (taken && taken.id === id && taken.rec.pinHash) {
      return json({ ok: false, error: 'exists', errorText: 'Аккаунт уже есть — войдите по имени и PIN' }, 409, origin);
    }
    const salt = randToken(12);
    const pinHash = await hashDobroPin(pin.pin, salt);
    const rec = state.users[id] || { name: nm.name, points: 0, deedCount: 0, deeds: [], lastAt: 0 };
    rec.name = nm.name;
    rec.pinSalt = salt;
    rec.pinHash = pinHash;
    state.users[id] = rec;
    await putDobro(env.KV, state);
    return json({ ok: true, id, name: nm.name, hasPin: true }, 201, origin);
  }
  if (request.method === 'POST' && path === '/dobro/login') {
    const body = await request.json().catch(() => null);
    const nm = cleanDobroName(body && body.name);
    const pin = cleanDobroPin(body && body.pin);
    if (!nm.ok) return json({ ok: false, error: 'nick', errorText: 'Введите имя аккаунта' }, 400, origin);
    if (!pin.ok) return json({ ok: false, error: 'pin', errorText: pin.errorText || 'PIN — 4 цифры' }, 400, origin);
    const state = await getDobro(env.KV);
    const found = findDobroUserByName(state, nm.name);
    if (!found) return json({ ok: false, error: 'auth', errorText: 'Аккаунт с таким именем не найден' }, 404, origin);
    if (!found.rec.pinHash || !found.rec.pinSalt) {
      return json({ ok: false, error: 'no_pin', errorText: 'У этого аккаунта ещё нет PIN. Откройте его на старом устройстве и задайте PIN или используйте ссылку входа' }, 403, origin);
    }
    const hash = await hashDobroPin(pin.pin, found.rec.pinSalt);
    if (hash !== found.rec.pinHash) {
      return json({ ok: false, error: 'auth', errorText: 'Неверное имя или PIN' }, 403, origin);
    }
    return json({ ok: true, id: found.id, name: found.rec.name || nm.name, hasPin: true }, 200, origin);
  }
  if (request.method === 'POST' && path === '/dobro/set-pin') {
    const body = await request.json().catch(() => null);
    if (!body || !validId(body.id)) return json({ ok: false, error: 'id' }, 400, origin);
    const pin = cleanDobroPin(body.pin);
    if (!pin.ok) return json({ ok: false, error: 'pin', errorText: pin.errorText || 'PIN — 4 цифры' }, 400, origin);
    const state = await getDobro(env.KV);
    const rec = state.users[body.id];
    if (!rec) return json({ ok: false, error: 'auth', errorText: 'Сначала создайте аккаунт' }, 404, origin);
    if (rec.pinHash) {
      const old = cleanDobroPin(body.oldPin);
      if (!old.ok) return json({ ok: false, error: 'pin', errorText: 'Нужен текущий PIN' }, 400, origin);
      const oldHash = await hashDobroPin(old.pin, rec.pinSalt || '');
      if (oldHash !== rec.pinHash) return json({ ok: false, error: 'auth', errorText: 'Неверный текущий PIN' }, 403, origin);
    }
    const salt = randToken(12);
    rec.pinSalt = salt;
    rec.pinHash = await hashDobroPin(pin.pin, salt);
    state.users[body.id] = rec;
    await putDobro(env.KV, state);
    return json({ ok: true, hasPin: true }, 200, origin);
  }
  if (request.method === 'POST' && path === '/dobro/sync/issue') {
    const body = await request.json().catch(() => null);
    if (!body || !validId(body.id)) return json({ ok: false, error: 'id' }, 400, origin);
    const state = await getDobro(env.KV);
    const rec = state.users[body.id];
    if (!rec) return json({ ok: false, error: 'auth', errorText: 'Аккаунт не найден' }, 404, origin);
    const token = newDobroSyncToken();
    await env.KV.put('dobro:sync:' + token, JSON.stringify({
      id: body.id,
      name: rec.name || 'Участник',
      at: Date.now()
    }), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ ok: true, token, name: rec.name || 'Участник' }, 200, origin);
  }
  if (request.method === 'GET' && path === '/dobro/sync/info') {
    const token = url.searchParams.get('token') || '';
    if (!validSecret(token)) return json({ ok: false, error: 'token' }, 400, origin);
    const raw = await env.KV.get('dobro:sync:' + token);
    if (!raw) return json({ ok: false, error: 'token', errorText: 'Ссылка недействительна или устарела' }, 404, origin);
    let info = null;
    try { info = JSON.parse(raw); } catch {}
    if (!info || !info.id) return json({ ok: false, error: 'token' }, 404, origin);
    return json({ ok: true, id: info.id, name: info.name || 'Участник' }, 200, origin);
  }
  if (request.method === 'POST' && path === '/dobro/sync/claim') {
    const body = await request.json().catch(() => null);
    const token = body && body.token;
    if (!validSecret(token)) return json({ ok: false, error: 'token', errorText: 'Ссылка недействительна' }, 400, origin);
    const raw = await env.KV.get('dobro:sync:' + token);
    if (!raw) return json({ ok: false, error: 'token', errorText: 'Ссылка недействительна или устарела' }, 404, origin);
    let info = null;
    try { info = JSON.parse(raw); } catch {}
    if (!info || !validId(info.id)) return json({ ok: false, error: 'token' }, 404, origin);
    const state = await getDobro(env.KV);
    const rec = state.users[info.id];
    if (!rec) return json({ ok: false, error: 'auth', errorText: 'Аккаунт не найден' }, 404, origin);
    return json({ ok: true, id: info.id, name: rec.name || info.name || 'Участник', hasPin: !!rec.pinHash }, 200, origin);
  }
  if (request.method === 'POST' && path === '/dobro/nick') {
    const body = await request.json().catch(() => null);
    if (!body || !validId(body.id)) return json({ ok: false, error: 'id' }, 400, origin);
    const nm = cleanDobroName(body.name);
    if (!nm.ok) return json({ ok: false, error: 'nick' }, 400, origin);
    const state = await getDobro(env.KV);
    const taken = findDobroUserByName(state, nm.name);
    if (taken && taken.id !== body.id) {
      return json({ ok: false, error: 'nick_taken', errorText: 'Такое имя уже занято' }, 409, origin);
    }
    const rec = state.users[body.id] || { name: nm.name, points: 0, deedCount: 0, deeds: [], lastAt: 0 };
    rec.name = nm.name;
    state.users[body.id] = rec;
    for (const item of state.feed) {
      if (item.authorId === body.id) item.authorName = nm.name;
    }
    await putDobro(env.KV, state);
    return json({ ok: true, name: nm.name }, 200, origin);
  }
  if (request.method === 'POST' && path === '/dobro/deed') {
    const body = await request.json().catch(() => null);
    if (!body || !validId(body.id)) return json({ ok: false, error: 'id' }, 400, origin);
    const title = cleanDobroTitle(body.title);
    if (!title.ok) return json({ ok: false, error: 'title' }, 400, origin);
    const cat = resolveDobroCat(body.category);
    if (!cat) {
      return json({
        ok: false,
        error: 'category',
        errorText: 'Выберите категорию'
      }, 400, origin);
    }
    const pic = parseDobroPhoto(body.photo);
    if (!pic.ok) {
      return json({ ok: false, error: 'photo', errorText: pic.errorText || 'Нужно приложить фото' }, 400, origin);
    }
    const state = await getDobro(env.KV);
    const now = Date.now();
    let rec = state.users[body.id];
    if (!rec) {
      const nm = cleanDobroName(body.name);
      if (!nm.ok) return json({ ok: false, error: 'nick' }, 400, origin);
      const taken = findDobroUserByName(state, nm.name);
      if (taken && taken.id !== body.id) {
        return json({ ok: false, error: 'nick_taken', errorText: 'Такое имя уже занято — войдите в существующий аккаунт' }, 409, origin);
      }
      rec = { name: nm.name, points: 0, deedCount: 0, deeds: [], lastAt: 0 };
      state.users[body.id] = rec;
    } else if (body.name && !rec.name) {
      const nm = cleanDobroName(body.name);
      if (nm.ok) {
        const taken = findDobroUserByName(state, nm.name);
        if (taken && taken.id !== body.id) {
          return json({ ok: false, error: 'nick_taken', errorText: 'Такое имя уже занято — войдите в существующий аккаунт' }, 409, origin);
        }
        rec.name = nm.name;
      }
    }
    if (rec.lastAt && now - rec.lastAt < DOBRO_DEED_MS) {
      return json({ ok: false, error: 'rate' }, 429, origin);
    }
    const deedId = state.seq++;
    // Store compressed photo in its own KV key (keeps dobro:v1 under size limits)
    await putDobroPhotoBlob(env.KV, deedId, pic.photo);
    const deed = {
      id: deedId,
      title: title.title,
      category: cat.id,
      points: 0,
      awardPoints: cat.points,
      createdAt: new Date(now).toISOString(),
      hasPhoto: true,
      status: 'pending',
      reason: 'Проверяем фото…'
    };
    rec.deeds.unshift(deed);
    rec.lastAt = now;
    await pruneDobroPhotos(env.KV, state);
    await putDobro(env.KV, state);

    const userId = body.id;
    const runVerify = async () => {
      const result = await verifyDobroPhoto(env, {
        title: title.title,
        categoryLabel: cat.label,
        photo: pic.photo,
        base64: pic.base64,
        userId
      });
      const st = await getDobro(env.KV);
      const user = st.users[userId];
      if (!user || !Array.isArray(user.deeds)) return;
      const idx = user.deeds.findIndex((d) => d.id === deedId);
      if (idx < 0) return;
      const cur = user.deeds[idx];
      // Ensure photo blob still present for feed/history
      cur.hasPhoto = true;
      if (result.status === 'approved') {
        applyDobroApproval(st, userId, deedId, result.reason);
      } else {
        cur.status = 'rejected';
        cur.reason = result.reason;
        cur.points = 0;
      }
      await pruneDobroPhotos(env.KV, st);
      await putDobro(env.KV, st);
    };

    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(runVerify());
    else await runVerify();

    return json({
      ok: true,
      deed: {
        id: deed.id,
        title: deed.title,
        category: publicDobroCategory(deed.category),
        points: 0,
        createdAt: deed.createdAt,
        photoUrl: pic.photo || null,
        status: 'pending',
        reason: deed.reason
      }
    }, 201, origin);
  }
  // Recover deeds rejected only because AI check failed (infra/license), or status=error
  if (request.method === 'POST' && path === '/dobro/deed/recover') {
    const body = await request.json().catch(() => null);
    if (!body || !validId(body.id)) return json({ ok: false, error: 'id' }, 400, origin);
    const deedId = Number(body.deedId);
    if (!Number.isFinite(deedId)) return json({ ok: false, error: 'deed' }, 400, origin);
    const state = await getDobro(env.KV);
    const user = state.users[body.id];
    if (!user || !Array.isArray(user.deeds)) return json({ ok: false, error: 'deed' }, 404, origin);
    const cur = user.deeds.find((d) => d.id === deedId);
    if (!cur) return json({ ok: false, error: 'deed' }, 404, origin);
    const recoverable = cur.status === 'error'
      || (cur.status === 'rejected' && dobroIsVerifyInfraFail(cur.reason));
    if (!recoverable) {
      return json({
        ok: false,
        error: 'not_recoverable',
        errorText: 'Это дело отклонено по содержанию — его нельзя принять автоматически'
      }, 400, origin);
    }
    // Prefer re-check when photo still present (inline or KV); on AI fail → still approve
    let photoData = cur.photo || null;
    if (!photoData) photoData = await getDobroPhotoBlob(env.KV, deedId);
    if (photoData) {
      cur.hasPhoto = true;
      const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(photoData);
      const b64 = m ? m[1].replace(/\s+/g, '') : '';
      if (b64) {
        const cat = resolveDobroCat(cur.category) || { label: cur.category || '' };
        const result = await verifyDobroPhoto(env, {
          title: cur.title || '',
          categoryLabel: cat.label || '',
          photo: photoData,
          base64: b64,
          userId: body.id
        });
        if (result.status === 'rejected' && !result.failOpen) {
          cur.status = 'rejected';
          cur.reason = result.reason;
          cur.points = 0;
          await putDobro(env.KV, state);
          return json({
            ok: false,
            error: 'rejected',
            errorText: result.reason || 'Фото отклонено'
          }, 403, origin);
        }
        // Ensure blob exists for feed after approval
        await putDobroPhotoBlob(env.KV, deedId, photoData);
        applyDobroApproval(state, body.id, deedId, result.reason || 'Фото принято');
      } else {
        cur.hasPhoto = true;
        applyDobroApproval(state, body.id, deedId, 'Принято после сбоя проверки');
      }
    } else {
      applyDobroApproval(state, body.id, deedId, 'Принято после сбоя проверки');
    }
    await pruneDobroPhotos(env.KV, state);
    await putDobro(env.KV, state);
    const done = state.users[body.id].deeds.find((d) => d.id === deedId);
    return json({
      ok: true,
      deed: {
        id: done.id,
        title: done.title,
        category: publicDobroCategory(done.category),
        points: done.points || 0,
        createdAt: done.createdAt,
        photoUrl: await resolveDeedPhotoUrl(env.KV, done),
        status: done.status,
        reason: done.reason || ''
      }
    }, 200, origin);
  }

  if (request.method === 'POST' && path === '/dobro/push/subscribe') {
    if (!env.VAPID_PRIVATE_KEY || !DOBRO_VAPID_PUBLIC_KEY) {
      return json({ ok: false, error: 'push_disabled', errorText: 'Напоминания пока недоступны' }, 503, origin);
    }
    const body = await request.json().catch(() => null);
    if (!body || !validId(body.id)) return json({ ok: false, error: 'id' }, 400, origin);
    const state = await getDobro(env.KV);
    if (!state.users[body.id]) return json({ ok: false, error: 'auth', errorText: 'Аккаунт не найден' }, 404, origin);
    const norm = normalizePushSub(body);
    if (!norm) return json({ ok: false, error: 'subscription', errorText: 'Некорректная подписка' }, 400, origin);
    const subs = await readPushSubs(env.KV, body.id);
    const idx = subs.findIndex((s) => s.endpoint === norm.endpoint);
    let changed = false;
    if (idx >= 0) {
      if (subs[idx].p256dh !== norm.p256dh || subs[idx].auth !== norm.auth) {
        subs[idx] = { ...norm, updatedAt: Date.now() };
        changed = true;
      }
    } else {
      subs.push({ ...norm, updatedAt: Date.now() });
      changed = true;
    }
    if (changed) await writePushSubs(env.KV, body.id, subs);
    const users = await readPushUserIds(env.KV);
    if (!users.includes(body.id)) {
      users.push(body.id);
      await writePushUserIds(env.KV, users);
    }
    return json({ ok: true }, 200, origin);
  }

  if (request.method === 'POST' && path === '/dobro/push/unsubscribe') {
    const body = await request.json().catch(() => null);
    if (!body || !validId(body.id)) return json({ ok: false, error: 'id' }, 400, origin);
    const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint) || '';
    let subs = await readPushSubs(env.KV, body.id);
    const before = subs.length;
    if (endpoint) subs = subs.filter((s) => s.endpoint !== endpoint);
    else subs = [];
    if (subs.length !== before) await writePushSubs(env.KV, body.id, subs);
    if (!subs.length) {
      const users = (await readPushUserIds(env.KV)).filter((id) => id !== body.id);
      await writePushUserIds(env.KV, users);
    }
    return json({ ok: true }, 200, origin);
  }

  return json({ ok: false, error: 'not_found' }, 404, origin);
}

export default {
  async scheduled(event, env, ctx) {
    // Cron: 0 16 * * * → 16:00 UTC = 19:00 Europe/Moscow
    ctx.waitUntil(runDobroDailyPush(env).catch(() => {}));
  },
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'GET' && path === '/stats') {
        const now = Date.now();
        const [onlineMap, meta] = await Promise.all([
          getOnline(env.KV, now),
          readJson(env.KV, 'meta', { total: 0 })
        ]);
        return json({ online: countOnline(onlineMap, now), total: meta.total || 0 }, 200, origin);
      }

      if (request.method === 'GET' && path === '/top') {
        const limit = Math.min(TOP_N, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
        const playerId = url.searchParams.get('playerId') || '';
        const now = Date.now();
        const [ladder, onlineMap, meta] = await Promise.all([
          getLadder(env.KV),
          getOnline(env.KV, now),
          readJson(env.KV, 'meta', { total: 0 })
        ]);
        return json({
          list: publicList(ladder, limit, validId(playerId) ? playerId : ''),
          me: validId(playerId) ? findMe(ladder, playerId) : null,
          online: countOnline(onlineMap, now),
          total: meta.total || 0
        }, 200, origin);
      }

      if (request.method === 'GET' && path === '/me') {
        const playerId = url.searchParams.get('playerId') || '';
        if (!validId(playerId)) return json({ ok: false, error: 'playerId' }, 400, origin);
        const rec = await readJson(env.KV, 'p:' + playerId, null);
        return json(mePayload(rec), 200, origin);
      }

      if (request.method === 'POST' && path === '/ping') {
        const body = await request.json().catch(() => null);
        if (!body || !validId(body.playerId)) return json({ ok: false, error: 'playerId' }, 400, origin);
        const id = body.playerId;
        const now = Date.now();
        const [meta, rec] = await Promise.all([
          readJson(env.KV, 'meta', { total: 0 }),
          readJson(env.KV, 'p:' + id, null)
        ]);
        const online = await touchOnline(env.KV, id, now);
        const writes = [];
        if (!rec) {
          meta.total = (meta.total || 0) + 1;
          meta.updated = now;
          writes.push(env.KV.put('p:' + id, JSON.stringify({ first: now, lastPing: now, score: 0, nick: '', invited: 0, unclaimed: 0 })));
          writes.push(env.KV.put('meta', JSON.stringify(meta)));
        }
        if (body.refCode) writes.push(registerRefCode(env.KV, id, body.refCode));
        if (writes.length) await Promise.all(writes);
        return json({ ok: true, online: countOnline(online, now), total: meta.total || 0 }, 200, origin);
      }

      if (request.method === 'POST' && path === '/ref') {
        const body = await request.json().catch(() => null);
        if (!body || !validId(body.newPlayerId)) return json({ ok: false, error: 'playerId' }, 400, origin);
        if (!validRef(body.ref)) return json({ ok: false, error: 'ref' }, 400, origin);
        const newId = body.newPlayerId;
        const referrerId = await resolveRef(env.KV, body.ref);
        if (!referrerId) return json({ ok: false, error: 'ref' }, 400, origin);
        if (referrerId === newId) return json({ ok: false, error: 'self' }, 400, origin);

        const now = Date.now();
        const [newbie, referrer, meta] = await Promise.all([
          readJson(env.KV, 'p:' + newId, null),
          readJson(env.KV, 'p:' + referrerId, null),
          readJson(env.KV, 'meta', { total: 0 })
        ]);
        if (newbie) {
          const age = now - (newbie.first || now);
          const unused = !newbie.referredBy && !(newbie.score > 0) && !newbie.nick && age < 120000;
          if (!unused) return json({ ok: false, error: 'exists', already: true, gift: 0 }, 200, origin);
        }

        const newRec = Object.assign({}, newbie || {}, {
          first: (newbie && newbie.first) || now,
          lastPing: now,
          score: (newbie && newbie.score) || 0,
          nick: (newbie && newbie.nick) || '',
          referredBy: referrerId,
          invited: (newbie && newbie.invited) || 0,
          unclaimed: 0
        });
        const refRec = referrer || { first: now, lastPing: now, score: 0, nick: '', invited: 0, unclaimed: 0 };
        refRec.invited = (refRec.invited || 0) + 1;
        refRec.unclaimed = (refRec.unclaimed || 0) + 1;
        if (!Array.isArray(refRec.invitees)) refRec.invitees = [];
        if (refRec.invitees.length < 50) refRec.invitees.push(newId);
        const writes = [
          env.KV.put('p:' + newId, JSON.stringify(newRec)),
          env.KV.put('p:' + referrerId, JSON.stringify(refRec))
        ];
        if (!newbie) {
          meta.total = (meta.total || 0) + 1;
          meta.updated = now;
          writes.push(env.KV.put('meta', JSON.stringify(meta)));
        }
        await Promise.all(writes);
        return json({
          ok: true,
          newcomer: true,
          gift: REF_GIFT
        }, 200, origin);
      }

      if (request.method === 'POST' && path === '/claim') {
        const body = await request.json().catch(() => null);
        if (!body || !validId(body.playerId)) return json({ ok: false, error: 'playerId' }, 400, origin);
        const rec = await readJson(env.KV, 'p:' + body.playerId, null);
        if (!rec) return json({ ok: true, claimed: 0, chest: REF_CHEST, invitedCount: 0, bonusPct: 0 }, 200, origin);
        const n = Math.max(0, rec.unclaimed || 0);
        if (!n) {
          return json({
            ok: true, claimed: 0, chest: REF_CHEST,
            invitedCount: rec.invited || 0, bonusPct: bonusPct(rec.invited)
          }, 200, origin);
        }
        rec.unclaimed = 0;
        rec.claimed = (rec.claimed || 0) + n;
        await env.KV.put('p:' + body.playerId, JSON.stringify(rec));
        return json({
          ok: true,
          claimed: n,
          chest: REF_CHEST,
          invitedCount: rec.invited || 0,
          bonusPct: bonusPct(rec.invited)
        }, 200, origin);
      }

      if (request.method === 'POST' && path === '/nick') {
        const body = await request.json().catch(() => null);
        if (!body || !validId(body.playerId)) return json({ ok: false, error: 'playerId' }, 400, origin);
        const nickRes = cleanNick(body.nick || '');
        if (!nickRes.ok) return json({ ok: false, error: 'nick' }, 400, origin);
        const id = body.playerId;
        const now = Date.now();
        const [rec, ladder, onlineMap, meta] = await Promise.all([
          readJson(env.KV, 'p:' + id, null),
          getLadder(env.KV),
          getOnline(env.KV, now),
          readJson(env.KV, 'meta', { total: 0 })
        ]);
        if (rec && rec.nick === nickRes.nick) {
          return json({
            ok: true, nick: rec.nick, unchanged: true,
            list: publicList(ladder, TOP_N, id), me: findMe(ladder, id),
            online: countOnline(onlineMap, now), total: (meta && meta.total) || 0
          }, 200, origin);
        }
        if (rec && rec.lastNickAt && now - rec.lastNickAt < NICK_MIN_MS) {
          return json({ ok: false, error: 'rate', retry: NICK_MIN_MS - (now - rec.lastNickAt) }, 429, origin);
        }
        const first = !rec;
        const next = Object.assign({}, rec || {}, {
          first: rec && rec.first ? rec.first : now,
          lastPing: now,
          lastNickAt: now,
          nick: nickRes.nick,
          score: rec && rec.score ? rec.score : 0,
          invited: rec && rec.invited ? rec.invited : 0,
          unclaimed: rec && rec.unclaimed ? rec.unclaimed : 0
        });
        const i = ladder.findIndex((e) => e.id === id);
        const row = { id, nick: next.nick, score: next.score || 0 };
        if (i >= 0) ladder[i] = row; else ladder.push(row);
        sortLadder(ladder);
        if (ladder.length > 500) ladder.length = 500;
        const writes = [env.KV.put('p:' + id, JSON.stringify(next))];
        if (first) {
          meta.total = (meta.total || 0) + 1;
          meta.updated = now;
          writes.push(env.KV.put('meta', JSON.stringify(meta)));
        }
        writes.push(setLadder(env.KV, ladder, now, true));
        await Promise.all(writes);
        return json({
          ok: true,
          nick: next.nick,
          list: publicList(ladder, TOP_N, id),
          me: findMe(ladder, id),
          online: countOnline(onlineMap, now),
          total: meta.total || 0
        }, 200, origin);
      }

      if (request.method === 'POST' && path === '/score') {
        const body = await request.json().catch(() => null);
        if (!body || !validId(body.playerId)) return json({ ok: false, error: 'playerId' }, 400, origin);
        if (!validScore(body.score)) return json({ ok: false, error: 'score' }, 400, origin);
        const id = body.playerId;
        const now = Date.now();
        let score = Math.floor(body.score);
        const [rec, ladder, meta] = await Promise.all([
          readJson(env.KV, 'p:' + id, null),
          getLadder(env.KV),
          readJson(env.KV, 'meta', { total: 0 })
        ]);
        const online = await touchOnline(env.KV, id, now);
        let nickRes = cleanNick(body.nick || '');
        if (!nickRes.ok) {
          if (rec && rec.nick && String(body.nick || '') === rec.nick) nickRes = { ok: true, nick: rec.nick };
          else return json({ ok: false, error: 'nick' }, 400, origin);
        }
        const nickChanging = !!(nickRes.nick && rec && rec.nick && nickRes.nick !== rec.nick);
        const nickRateBlocked = nickChanging && rec.lastNickAt && now - rec.lastNickAt < NICK_MIN_MS;
        const effectiveNick = nickRateBlocked || !nickRes.ok ? ((rec && rec.nick) || nickRes.nick) : nickRes.nick;
        const prev = rec && rec.score > 0 ? rec.score : 0;
        if (prev > 0) {
          const minutes = Math.max((rec.lastScoreAt ? now - rec.lastScoreAt : SCORE_MIN_MS) / 60000, SCORE_MIN_MS / 60000);
          const cap = prev + Math.max(5e4, prev * 0.8) * minutes + 2e6 * minutes;
          if (score > cap) score = Math.floor(cap);
          if (score < prev) score = prev;
        }
        const improved = score > prev;
        const significant = improved && (score - prev >= Math.max(100, prev * 0.01) || !rec || !rec.lastScoreAt);
        const tooSoon = !!(rec && rec.lastScoreAt && now - rec.lastScoreAt < SCORE_MIN_MS - 2500);
        if (tooSoon || !improved) {
          if (nickChanging && !nickRateBlocked && !tooSoon) {
            rec.nick = nickRes.nick;
            rec.lastNickAt = now;
            const li = ladder.findIndex((e) => e.id === id);
            if (li >= 0) ladder[li].nick = rec.nick;
            await env.KV.put('p:' + id, JSON.stringify(rec));
            await setLadder(env.KV, ladder, now, false);
            return json({
              ok: true, nickOnly: true, score: rec.score || 0,
              list: publicList(ladder, TOP_N, id), me: findMe(ladder, id),
              online: countOnline(online, now), total: meta.total || 0
            }, 200, origin);
          }
          return json({
            ok: true, unchanged: !improved, rate: tooSoon,
            score: prev,
            list: publicList(ladder, TOP_N, id), me: findMe(ladder, id),
            online: countOnline(online, now), total: (meta && meta.total) || 0
          }, 200, origin);
        }
        if (!significant && rec && rec.lastScoreAt && now - rec.lastScoreAt < SCORE_MIN_MS) {
          return json({
            ok: true, unchanged: true, score: prev,
            list: publicList(ladder, TOP_N, id), me: findMe(ladder, id),
            online: countOnline(online, now), total: (meta && meta.total) || 0
          }, 200, origin);
        }
        const first = !rec;
        const next = Object.assign({}, rec || {}, {
          first: rec && rec.first ? rec.first : now,
          lastPing: now,
          lastScoreAt: now,
          nick: effectiveNick,
          score
        });
        if (nickChanging && !nickRateBlocked) next.lastNickAt = now;
        const i = ladder.findIndex((e) => e.id === id);
        const row = { id, nick: next.nick, score };
        if (i >= 0) ladder[i] = row; else ladder.push(row);
        sortLadder(ladder);
        if (ladder.length > 500) ladder.length = 500;
        if (first) {
          meta.total = (meta.total || 0) + 1;
          meta.updated = now;
        }
        const writes = [env.KV.put('p:' + id, JSON.stringify(next))];
        if (first) writes.push(env.KV.put('meta', JSON.stringify(meta)));
        if (body.refCode) writes.push(registerRefCode(env.KV, id, body.refCode));
        writes.push(setLadder(env.KV, ladder, now, false));
        await Promise.all(writes);
        return json({
          ok: true,
          score,
          list: publicList(ladder, TOP_N, id),
          me: findMe(ladder, id),
          online: countOnline(online, now),
          total: meta.total || 0
        }, 200, origin);
      }


      if (request.method === 'POST' && path === '/sync/issue') {
        const body = await request.json().catch(() => null);
        if (!body || !validId(body.playerId)) return json({ ok: false, error: 'playerId' }, 400, origin);
        if (!validSecret(body.syncKey)) return json({ ok: false, error: 'key' }, 400, origin);
        const id = body.playerId;
        const now = Date.now();
        let rec = await readJson(env.KV, 'p:' + id, null);
        if (!rec) {
          rec = { first: now, lastPing: now, score: 0, nick: '', invited: 0, unclaimed: 0 };
          const meta = await readJson(env.KV, 'meta', { total: 0 });
          meta.total = (meta.total || 0) + 1;
          meta.updated = now;
          // meta write happens below with the rest
          rec._newMeta = meta;
        }
        const keyHash = await shaHex(body.syncKey);
        if (rec.syncKeyHash && rec.syncKeyHash !== keyHash) return json({ ok: false, error: 'key' }, 403, origin);
        if (rec.lastSyncIssueAt && now - rec.lastSyncIssueAt < 5000) {
          return json({ ok: false, error: 'rate', retry: 5000 - (now - rec.lastSyncIssueAt) }, 429, origin);
        }
        const token = randToken(24);
        const tokenHash = await shaHex(token);
        const writes = [];
        if (rec.syncTokenHash) writes.push(env.KV.delete('s:' + rec.syncTokenHash));
        rec.syncKeyHash = keyHash;
        rec.syncTokenHash = tokenHash;
        rec.lastSyncIssueAt = now;
        rec.lastPing = now;
        const meta = rec._newMeta;
        delete rec._newMeta;
        writes.push(env.KV.put('s:' + tokenHash, id));
        writes.push(env.KV.put('p:' + id, JSON.stringify(rec)));
        if (meta) writes.push(env.KV.put('meta', JSON.stringify(meta)));
        const snapSave = sanitizeSave(body.save);
        if (snapSave) {
          snapSave.pid = id;
          const incAt = (typeof body.syncAt === 'number' && Number.isFinite(body.syncAt)) ? body.syncAt : now;
          writes.push(env.KV.put('sv:' + id, JSON.stringify({ save: snapSave, syncAt: incAt, updated: now })));
        }
        await Promise.all(writes);
        return json({ ok: true, token }, 200, origin);
      }

      if (request.method === 'GET' && path === '/sync/info') {
        const token = url.searchParams.get('token') || '';
        if (!validSecret(token)) return json({ ok: false, error: 'token' }, 400, origin);
        const tokenHash = await shaHex(token);
        const id = await env.KV.get('s:' + tokenHash);
        if (!id || !validId(id)) return json({ ok: false, error: 'token' }, 404, origin);
        const rec = await readJson(env.KV, 'p:' + id, null);
        const snap = await readJson(env.KV, 'sv:' + id, null);
        const nick = (snap && snap.save && snap.save.nick) || (rec && rec.nick) || 'Завхоз';
        const total = (snap && saveTotal(snap.save)) || (rec && rec.score) || 0;
        return json({ ok: true, nick, total }, 200, origin);
      }

      if (request.method === 'POST' && path === '/sync/pull') {
        const body = await request.json().catch(() => null);
        if (!body) return json({ ok: false, error: 'body' }, 400, origin);
        let id = '';
        if (validSecret(body.token)) {
          const tokenHash = await shaHex(body.token);
          id = await env.KV.get('s:' + tokenHash);
          if (!id || !validId(id)) return json({ ok: false, error: 'token' }, 404, origin);
        } else if (validId(body.playerId) && validSecret(body.syncKey)) {
          id = body.playerId;
          const rec = await readJson(env.KV, 'p:' + id, null);
          if (!rec || !rec.syncKeyHash) return json({ ok: false, error: 'key' }, 403, origin);
          const keyHash = await shaHex(body.syncKey);
          if (rec.syncKeyHash !== keyHash) return json({ ok: false, error: 'key' }, 403, origin);
        } else {
          return json({ ok: false, error: 'auth' }, 400, origin);
        }
        const rec = await readJson(env.KV, 'p:' + id, null);
        const snap = await readJson(env.KV, 'sv:' + id, null);
        if (!snap || !snap.save) return json({ ok: false, error: 'empty' }, 404, origin);
        const nick = (snap.save && snap.save.nick) || (rec && rec.nick) || 'Завхоз';
        return json({ ok: true, playerId: id, save: snap.save, syncAt: snap.syncAt || 0, nick }, 200, origin);
      }

      if (request.method === 'POST' && path === '/sync/push') {
        const body = await request.json().catch(() => null);
        if (!body || !validId(body.playerId)) return json({ ok: false, error: 'playerId' }, 400, origin);
        if (!validSecret(body.syncKey)) return json({ ok: false, error: 'key' }, 400, origin);
        const save = sanitizeSave(body.save);
        if (!save) return json({ ok: false, error: 'save' }, 400, origin);
        const id = body.playerId;
        const rec = await readJson(env.KV, 'p:' + id, null);
        if (!rec || !rec.syncKeyHash) return json({ ok: false, error: 'key' }, 403, origin);
        const keyHash = await shaHex(body.syncKey);
        if (rec.syncKeyHash !== keyHash) return json({ ok: false, error: 'key' }, 403, origin);
        const now = Date.now();
        const incAt = (typeof body.syncAt === 'number' && Number.isFinite(body.syncAt)) ? body.syncAt : now;
        const cur = await readJson(env.KV, 'sv:' + id, null);
        const fp = saveFingerprint(save);
        if (cur && (cur.fp === fp || saveFingerprint(cur.save) === fp)) {
          return json({ ok: true, unchanged: true, syncAt: cur.syncAt || 0 }, 200, origin);
        }
        const lastAt = (cur && cur.updated) || rec.lastSyncPushAt || 0;
        if (!body.force && lastAt && now - lastAt < SYNC_MIN_MS) {
          return json({ ok: true, rate: true, syncAt: (cur && cur.syncAt) || 0 }, 200, origin);
        }
        if (cur && !incomingWins(cur, incAt, save)) {
          return json({ ok: true, older: true, syncAt: cur.syncAt || 0, save: cur.save, playerId: id }, 200, origin);
        }
        save.pid = id;
        const snap = { save, syncAt: incAt, updated: now, fp };
        await env.KV.put('sv:' + id, JSON.stringify(snap));
        return json({ ok: true, syncAt: incAt }, 200, origin);
      }

      if (path === '/dobro' || path.startsWith('/dobro/')) {
        return await handleDobro(request, env, ctx, url, path, origin);
      }

      return json({ ok: false, error: 'not_found' }, 404, origin);
    } catch (err) {
      if (isQuotaErr(err)) return json({ ok: false, error: 'quota', retry: 60 * 60 * 1000 }, 503, origin);
      return json({ ok: false, error: 'server' }, 500, origin);
    }
  }
};
