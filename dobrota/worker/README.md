# Доброта — AI-проверка фото (Workers AI)

`/dobro/*` уже крутится на `https://zavhoz-board.sj-polomki.workers.dev`, но исходников этих маршрутов в `server/worker.js` нет. Здесь модули для вливания в Worker.

## Файлы

- `verify.js` — hash/anti-reuse, blank check, Workers AI vision
- `dobro-handler.js` — `GET /dobro/state`, `POST /dobro/deed`, `POST /dobro/nick`

## Wrangler binding

В `server/wrangler.jsonc` добавьте:

```jsonc
{
  "ai": { "binding": "AI" }
}
```

KV binding `KV` уже есть (`zavhoz-board`).

## Как влить в Worker

1. Скопируйте `verify.js` и `dobro-handler.js` рядом с `server/worker.js` (или импортируйте по пути).
2. В `fetch()` до игровых маршрутов:

```js
import { handleDobro } from './dobro-handler.js';
// ...
const path = new URL(request.url).pathname;
if (path.startsWith('/dobro')) {
  return handleDobro(request, env, ctx, request.headers.get('Origin') || '*');
}
```

3. Убедитесь, что сигнатура `fetch(request, env, ctx)` передаёт `ExecutionContext` (для `waitUntil`).

## Деплой (нужен вручную)

```bash
cd server
npx wrangler deploy
```

После деплоя фото обязательно; баллы начисляются только при `status: "approved"`. Пока дело `pending`, фронт показывает «проверяется…».

**Этот PR не деплоит Worker** — только код + фронт.
