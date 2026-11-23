// Cursor app identity: the simulated viewer for local development. Yours to edit.
// While neither CURSOR_APP_ID nor VERCEL is set, a request without the identity header
// reads as this viewer, with simulated: true and an empty token.

export const DEV_VIEWER = {
  sub: "user:dev",
  email: "dev@example.com",
  name: "Участник",
  teamId: 1,
  teamRole: "admin",
};
