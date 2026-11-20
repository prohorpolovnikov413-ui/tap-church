/**
 * @deprecated ИИ-проверка фото отключена.
 * Актуальный /dobro/deed — в server/worker.js (фото опционально, без Workers AI).
 */
export function parsePhotoDataUrl() {
  return { ok: false, error: 'photo', errorText: 'Модуль verify.js устарел — используйте server/worker.js' };
}

export async function verifyDeedPhoto() {
  return { status: 'approved', reason: '', hash: '' };
}
