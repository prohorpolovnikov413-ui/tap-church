/**
 * AI photo verification for Доброта deeds.
 * Merge into zavhoz-board Worker and call from POST /dobro/deed.
 *
 * Requires Wrangler binding:
 *   "ai": { "binding": "AI" }
 * Model: @cf/meta/llama-3.2-11b-vision-instruct (Workers AI free tier)
 */

export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const PHOTO_HASH_PREFIX = 'dobro:phash:';

const MAX_PHOTO_CHARS = 900_000;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** @param {string} dataUrl */
export function parsePhotoDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return { ok: false, error: 'photo', errorText: 'Нужно приложить фото доброго дела' };
  }
  if (dataUrl.length > MAX_PHOTO_CHARS) {
    return { ok: false, error: 'photo', errorText: 'Фото слишком большое' };
  }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m || !ALLOWED.has(m[1])) {
    return { ok: false, error: 'photo', errorText: 'Можно только JPEG, PNG или WebP' };
  }
  const b64 = m[2].replace(/\s+/g, '');
  if (b64.length < 64) {
    return { ok: false, error: 'photo', errorText: 'Фото повреждено или пустое' };
  }
  return { ok: true, mime: m[1], base64: b64, dataUrl: `data:${m[1]};base64,${b64}` };
}

/** @param {string} base64 */
export async function sha256Hex(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dig = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cheap blank / near-blank check on decoded JPEG/PNG bytes sample. */
export function looksBlankOrTiny(base64) {
  const bin = atob(base64);
  if (bin.length < 1200) return true;
  let sum = 0;
  let sumSq = 0;
  const step = Math.max(1, Math.floor(bin.length / 400));
  let n = 0;
  for (let i = 0; i < bin.length; i += step) {
    const v = bin.charCodeAt(i);
    sum += v;
    sumSq += v * v;
    n++;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return variance < 18;
}

function extractJson(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildPrompt(title, categoryLabel) {
  return [
    'Ты мягкий модератор приложения «Доброта». Не доказывай дело — только отсеки недопустимый контент.',
    `Текст дела: «${title}». Категория: «${categoryLabel}».`,
    'По умолчанию одобряй почти любое фото доброго дела. Не отклоняй за недоказанность, сток, скриншот или слабую связь с текстом.',
    'Отклоняй только: 18+/обнажёнка/эротика; сигареты/вейпы/курение; алкоголь; наркотики; насилие/кровь/оружие; неприличные жесты.',
    'Если сомневаешься — одобряй. reason при отказе — понятная фраза по-русски.',
    'Ответь ТОЛЬКО JSON без markdown: {"approved":true|false,"reason":"кратко по-русски (до 120 символов)"}',
  ].join('\n');
}

/**
 * @param {{ AI: any, KV: KVNamespace }} env
 * @param {{ title: string, categoryLabel: string, photoDataUrl: string, userId: string }} input
 * @returns {Promise<{ status: 'approved'|'rejected', reason: string, hash: string }>}
 */
export async function verifyDeedPhoto(env, input) {
  const parsed = parsePhotoDataUrl(input.photoDataUrl);
  if (!parsed.ok) {
    return { status: 'rejected', reason: parsed.errorText, hash: '' };
  }

  const hash = await sha256Hex(parsed.base64);
  const hashKey = PHOTO_HASH_PREFIX + hash;
  const used = await env.KV.get(hashKey);
  if (used && used !== input.userId) {
    return {
      status: 'rejected',
      reason: 'Это фото уже использовали раньше',
      hash,
    };
  }
  if (used === input.userId) {
    return {
      status: 'rejected',
      reason: 'Вы уже отправляли это же фото',
      hash,
    };
  }

  if (looksBlankOrTiny(parsed.base64)) {
    return { status: 'rejected', reason: 'Фото пустое или слишком маленькое', hash };
  }

  if (!env.AI || typeof env.AI.run !== 'function') {
    return {
      status: 'rejected',
      reason: 'Проверка фото временно недоступна (нет AI binding)',
      hash,
    };
  }

  let modelText = '';
  try {
    const result = await env.AI.run(VISION_MODEL, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(input.title, input.categoryLabel) },
            { type: 'image_url', image_url: { url: parsed.dataUrl } },
          ],
        },
      ],
      max_tokens: 200,
    });
    modelText =
      (typeof result === 'string' && result) ||
      result?.response ||
      result?.description ||
      result?.result ||
      (Array.isArray(result?.content) ? result.content.map((c) => c.text || '').join(' ') : '') ||
      JSON.stringify(result);
  } catch (err) {
    // Fallback prompt shape used by some Workers AI vision models
    try {
      const result = await env.AI.run(VISION_MODEL, {
        prompt: buildPrompt(input.title, input.categoryLabel),
        image: [...Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0))],
        max_tokens: 200,
      });
      modelText =
        (typeof result === 'string' && result) ||
        result?.response ||
        result?.description ||
        JSON.stringify(result);
    } catch {
      return {
        status: 'rejected',
        reason: 'Не удалось проверить фото. Попробуйте ещё раз',
        hash,
      };
    }
  }

  const parsedJson = extractJson(String(modelText));
  const approved = !(parsedJson && parsedJson.approved === false);
  let reason = String((parsedJson && parsedJson.reason) || '').trim().slice(0, 140);
  if (!reason) {
    reason = approved
      ? 'Фото принято'
      : 'На фото есть недопустимый контент — загрузите другой снимок';
  }

  if (approved) {
    await env.KV.put(hashKey, input.userId, { expirationTtl: 60 * 60 * 24 * 180 });
  }

  return { status: approved ? 'approved' : 'rejected', reason, hash };
}
