// Cursor app identity: TypeScript mirror of identity.dev.js for local editing convenience.
// identity.ts imports ./identity.dev.js — keep both in sync.

import type { DevViewer } from "./identity.js";

export const DEV_VIEWER: DevViewer | null = {
  sub: "user:dev",
  email: "dev@example.com",
  name: "Участник",
  teamId: 1,
  teamRole: "admin",
};
