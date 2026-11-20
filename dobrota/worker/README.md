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
- `POST /dobro/deed/recover` — принять/перепроверить дела, отклонённые из‑за сбоя проверки.

## Auth / сессия

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/dobro/register` | создать аккаунт + PIN |
| POST | `/dobro/login` | вход по имени + PIN |
| POST | `/dobro/set-pin` | задать/сменить PIN |
| POST | `/dobro/sync/*` | личная ссылка `?sync=` |

## Деплой (вручную)

```bash
cd server
npx wrangler deploy
```

**PR не деплоит Worker** — задеплойте сами после мержа.
