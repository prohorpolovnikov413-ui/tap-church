import {
  getIdentity,
  requireIdentity,
  type VerifiedIdentity,
} from "../../cursor/identity";

export { getIdentity, requireIdentity };
export type { VerifiedIdentity };

export function displayNameFromIdentity(identity: VerifiedIdentity): string {
  if (identity.kind === "key") {
    return identity.name.trim() || "Сервисный доступ";
  }
  const name = identity.name.trim();
  if (name) return name;
  const email = identity.email.trim();
  if (email) return email.split("@")[0] || "Участник";
  return "Участник";
}

export const privateHeaders = {
  "cache-control": "private, no-store",
} as const;
