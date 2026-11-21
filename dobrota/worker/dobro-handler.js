/**
 * Drop-in /dobro/* handlers for zavhoz-board.
 * Live Worker already serves these routes; source was not in repo —
 * merge this module + verify.js into server/worker.js fetch().
 *
 * Usage sketch inside worker fetch():
 *   import { handleDobro } from './dobrota/worker/dobro-handler.js'; // or inline
 *   if (path.startsWith('/dobro')) return handleDobro(request, env, ctx, origin);
 */

import { verifyDeedPhoto, parsePhotoDataUrl } from './verify.js';

const CATS = {
  help: { id: 'help', label: 'Помощь', points: 15 },
  family: { id: 'family', label: 'Семья', points: 15 },
  care: { id: 'care', label: 'Забота', points: 15 },
  home: { id: 'home', label: 'Дом', points: 15 },
  street: { id: 'street', label: 'Улица', points: 15 },
  animals: { id: 'animals', label: 'Животные', points: 15 },
  nature: { id: 'nature', label: 'Природа', points: 15 },
  gift: { id: 'gift', label: 'Подарок', points: 10 },
  time: { id: 'time', label: 'Время', points: 20 },
  other: { id: 'other', label: 'Другое', points: 10 },
};
const CAT_ALIASES = { smile: 'gift', big: 'help', volunteer: 'time' };
function resolveCat(raw) {
  const key = CAT_ALIASES[raw] || raw;
  return CATS[key] || null;
}
function publicCategory(raw) {
  const cat = resolveCat(raw);
  return cat ? cat.id : (raw || 'other');
}

const USER_KEY = (id) => 'dobro:u:' + id;
const DEEDS_KEY = 'dobro:deeds:v1';
const BOARD_KEY = 'dobro:board:v1';

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': origin || '*',
      'access-control-allow-headers': 'content-type, cache-control',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
}

function cleanId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id) ? id.toLowerCase() : '';
}

function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, 40);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function loadDeeds(env) {
  try {
    return JSON.parse((await env.KV.get(DEEDS_KEY)) || '[]');
  } catch {
    return [];
  }
}

async function saveDeeds(env, deeds) {
  // keep last 400
  await env.KV.put(DEEDS_KEY, JSON.stringify(deeds.slice(-400)));
}

function publicDeed(d, viewerId) {
  return {
    id: d.id,
    title: d.title,
    category: publicCategory(d.category),
    points: d.status === 'approved' ? d.points : 0,
    createdAt: d.createdAt,
    photoUrl: d.photoUrl || null,
    status: d.status || 'approved',
    reason: d.reason || '',
    authorName: d.authorName,
    isYou: d.userId === viewerId,
  };
}

function recomputeBoard(deeds) {
  const map = new Map();
  for (const d of deeds) {
    if (d.status !== 'approved') continue;
    const cur = map.get(d.userId) || {
      userId: d.userId,
      name: d.authorName,
      totalPoints: 0,
      deedCount: 0,
    };
    cur.name = d.authorName || cur.name;
    cur.totalPoints += d.points || 0;
    cur.deedCount += 1;
    map.set(d.userId, cur);
  }
  return [...map.values()]
    .sort((a, b) => b.totalPoints - a.totalPoints || b.deedCount - a.deedCount || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 30)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * @param {Request} request
 * @param {{ KV: KVNamespace, AI?: any }} env
 * @param {ExecutionContext} ctx
 * @param {string} origin
 */
export async function handleDobro(request, env, ctx, origin) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return json({}, 204, origin);
  }

  if (request.method === 'GET' && path === '/dobro/state') {
    const id = cleanId(url.searchParams.get('id') || '');
    if (!id) return json({ ok: false, error: 'id' }, 400, origin);
    const profile = JSON.parse((await env.KV.get(USER_KEY(id))) || '{}');
    const deeds = await loadDeeds(env);
    const mine = deeds.filter((d) => d.userId === id).slice(-50).reverse();
    const board = recomputeBoard(deeds).map((e) => ({
      ...e,
      isYou: e.userId === id,
    }));
    const meEntry = board.find((e) => e.isYou);
    const feed = deeds
      .filter((d) => d.status === 'approved' && d.photoUrl)
      .slice(-24)
      .reverse()
      .map((d) => publicDeed(d, id));
    return json(
      {
        ok: true,
        me: {
          name: profile.name || '',
          totalPoints: meEntry ? meEntry.totalPoints : 0,
          deedCount: meEntry ? meEntry.deedCount : mine.filter((d) => d.status === 'approved').length,
        },
        board,
        feed,
        deeds: mine.map((d) => publicDeed(d, id)),
      },
      200,
      origin,
    );
  }

  if (request.method === 'POST' && path === '/dobro/nick') {
    const body = await readJson(request);
    const id = cleanId(body?.id || '');
    const name = cleanName(body?.name || '');
    if (!id) return json({ ok: false, error: 'id' }, 400, origin);
    if (name.length < 2) return json({ ok: false, error: 'nick', errorText: 'Имя: минимум 2 символа' }, 400, origin);
    await env.KV.put(USER_KEY(id), JSON.stringify({ name, updatedAt: Date.now() }));
    const deeds = await loadDeeds(env);
    let changed = false;
    for (const d of deeds) {
      if (d.userId === id && d.authorName !== name) {
        d.authorName = name;
        changed = true;
      }
    }
    if (changed) await saveDeeds(env, deeds);
    return json({ ok: true, name }, 200, origin);
  }

  if (request.method === 'POST' && path === '/dobro/deed') {
    const body = await readJson(request);
    const id = cleanId(body?.id || '');
    const name = cleanName(body?.name || '') || 'Участник';
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 160) : '';
    const category = typeof body?.category === 'string' ? body.category : '';
    const cat = resolveCat(category);
    if (!id) return json({ ok: false, error: 'id' }, 400, origin);
    if (title.length < 3) return json({ ok: false, error: 'title', errorText: 'Опишите дело чуть подробнее' }, 400, origin);
    if (!cat) return json({ ok: false, error: 'category', errorText: 'Выберите категорию' }, 400, origin);

    const photoCheck = parsePhotoDataUrl(body?.photo);
    if (!photoCheck.ok) {
      return json({ ok: false, error: photoCheck.error, errorText: photoCheck.errorText }, 400, origin);
    }

    await env.KV.put(USER_KEY(id), JSON.stringify({ name, updatedAt: Date.now() }));

    const deedId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const pending = {
      id: deedId,
      userId: id,
      authorName: name,
      title,
      category: cat.id,
      points: cat.points,
      photoUrl: photoCheck.dataUrl,
      status: 'pending',
      reason: 'Проверяем фото…',
      createdAt,
    };

    const deeds = await loadDeeds(env);
    deeds.push(pending);
    await saveDeeds(env, deeds);

    const runVerify = async () => {
      const result = await verifyDeedPhoto(env, {
        title,
        categoryLabel: cat.label,
        photoDataUrl: photoCheck.dataUrl,
        userId: id,
      });
      const all = await loadDeeds(env);
      const idx = all.findIndex((d) => d.id === deedId);
      if (idx < 0) return;
      all[idx].status = result.status;
      all[idx].reason = result.reason;
      if (result.status !== 'approved') {
        all[idx].points = 0;
      } else {
        all[idx].points = cat.points;
      }
      // drop huge photo from rejected to save KV? keep for appeal UI — keep
      await saveDeeds(env, all);
      await env.KV.put(BOARD_KEY, JSON.stringify(recomputeBoard(all)));
    };

    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(runVerify());
    else await runVerify();

    return json(
      {
        ok: true,
        deed: publicDeed(pending, id),
      },
      201,
      origin,
    );
  }

  return json({ ok: false, error: 'not_found' }, 404, origin);
}
