const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_CHARS = 900_000;

export type ParsedPhoto = {
  dataUrl: string;
  mime: string;
};

/** Accepts a browser data URL: data:image/(jpeg|png|webp);base64,... */
export function parsePhotoDataUrl(value: unknown): ParsedPhoto | { error: string } | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    return { error: "Фото в неверном формате" };
  }
  if (value.length > MAX_CHARS) {
    return { error: "Фото слишком большое — сделай снимок поменьше" };
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(
    value,
  );
  if (!match) {
    return { error: "Можно только JPEG, PNG или WebP" };
  }

  const mime = match[1];
  if (!ALLOWED.has(mime)) {
    return { error: "Можно только JPEG, PNG или WebP" };
  }

  const base64 = match[2].replace(/\s+/g, "");
  if (base64.length < 32) {
    return { error: "Фото повреждено" };
  }

  return { dataUrl: `data:${mime};base64,${base64}`, mime };
}
