/**
 * @deprecated Справочный stub. Актуальные /dobro/* маршруты — в server/worker.js.
 * Не подключайте этот файл: ИИ-проверка фото отключена, дело публикуется сразу.
 */

export async function handleDobro() {
  return new Response(JSON.stringify({
    ok: false,
    error: 'deprecated',
    errorText: 'Используйте server/worker.js — этот handler устарел'
  }), {
    status: 501,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
