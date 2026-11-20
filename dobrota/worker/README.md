# Доброта — Worker (`/dobro/*`)

Актуальная реализация маршрутов — в `server/worker.js` (`handleDobro`).
Модули `verify.js` / `dobro-handler.js` — справочные; для деплоя правьте и деплойте `server/worker.js`.

## Auth / сессия (новые маршруты)

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/dobro/register` | `{id?, name, pin}` — создать аккаунт, PIN (4 цифры), уникальный ник |
| POST | `/dobro/login` | `{name, pin}` — войти в существующий |
| POST | `/dobro/set-pin` | `{id, pin, oldPin?}` — задать/сменить PIN |
| POST | `/dobro/sync/issue` | `{id}` — личная ссылка `?sync=` (TTL ~30 дней) |
| GET | `/dobro/sync/info` | `?token=` — превью имени по ссылке |
| POST | `/dobro/sync/claim` | `{token}` — получить `id` аккаунта |
| GET | `/dobro/state` | `me.hasPin`, `me.exists` |
| POST | `/dobro/nick` | отказ при занятом имени (`nick_taken`) |

Фронт хранит сессию в localStorage + cookie + IndexedDB и сначала восстанавливает её.

## Wrangler

В `server/wrangler.jsonc` нужен AI binding:

```jsonc
{
  "ai": { "binding": "AI" }
}
```

KV binding `KV` уже есть (`zavhoz-board`).

## Деплой (вручную)

```bash
cd server
npx wrangler deploy
```

**PR с фронтом не деплоит Worker** — после мержа задеплойте Worker сами, иначе login/register/sync на проде не заработают.
