# Доброта — Worker (`/dobro/*`)

Актуальная реализация — в `server/worker.js` (`handleDobro`).
Модули `verify.js` / `dobro-handler.js` — справочные; деплойте `server/worker.js`.

## ИИ-проверка фото (мягкая)

`POST /dobro/deed` вызывает Workers AI vision с мягким промптом:
- по умолчанию принимает обычные фото добрых дел;
- отклоняет только: 18+/эротика, курение/вейп, алкоголь, наркотики, насилие/кровь/оружие, неприличные жесты;
- при неясном ответе модели — одобрение;
- формат: `prompt` + `image` data URI; при ошибке лицензии Meta — `prompt:"agree"` и повтор; fallback `@cf/llava-hf/llava-1.5-7b-hf`;
- если AI недоступен — **fail-open** (дело принимается);
- `POST /dobro/deed/recover` — принять/перепроверить дела, отклонённые из‑за сбоя проверки;
- фото хранятся отдельно: `dobro:photo:{deedId}` (сжатый data URL, TTL ~180д); лента подтягивает blob; `dobro:v1` не раздувается; при вытеснении из ленты (>50) ключ фото удаляется.

## Auth / сессия

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/dobro/register` | создать аккаунт + PIN |
| POST | `/dobro/login` | вход по имени + PIN |
| POST | `/dobro/set-pin` | задать/сменить PIN |
| POST | `/dobro/sync/*` | личная ссылка `?sync=` |

## Нужды

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/dobro/need` | опубликовать нужду (текст, опц. фото/контакт) |
| POST | `/dobro/need/pray` | 🙏 один раз → +5 очков / серия |
| POST | `/dobro/need/help` | «Помочь»: контакт или отклик автору → +5 один раз |
| POST | `/dobro/need/resolve` | автор: «Решено» |
| POST | `/dobro/need/delete` | автор: удалить |

Лимиты: как у дел (`DOBRO_DEED_MS`), макс. 5 открытых нужд на пользователя, текст 3–160, BAD-фильтр. KV: нужды в `dobro:v1` (`needs[]`), фото в `dobro:photo:{id}`. `GET /dobro/ping` → `needs: true`. Клиент скрывает UI, если ping без `needs`.

## Web Push (ежедневно 19:00 MSK)

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/dobro/push/subscribe` | сохранить PushSubscription |
| POST | `/dobro/push/unsubscribe` | удалить подписку |
| cron | `0 16 * * *` | 16:00 UTC = 19:00 Europe/Moscow |

Секреты Worker (не коммитить):
- `VAPID_PRIVATE_KEY` — JWK JSON `{"kty":"EC","crv":"P-256","d":"...","x":"...","y":"..."}` или голый base64url `d`
- `VAPID_SUBJECT` — например `mailto:you@example.com`

Публичный ключ (base64url, uncompressed P-256) вписать в:
- `server/worker.js` → `DOBRO_VAPID_PUBLIC_KEY`
- `dobrota/app.js` → `VAPID_PUBLIC_KEY`

KV: `dobro:push:users` (индекс id), `dobro:push:u:{id}` (подписки). Мёртвые endpoint’ы (404/410) удаляются. Пишет в KV только при изменении.

## Деплой (вручную)

```bash
cd server
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler deploy
```

**PR не деплоит Worker** — задеплойте сами после мержа.
