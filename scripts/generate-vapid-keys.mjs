#!/usr/bin/env node
/**
 * Generate VAPID key pair for Доброта Web Push (WebCrypto, no deps).
 *
 * Usage:
 *   node scripts/generate-vapid-keys.mjs
 *
 * Then:
 * 1. Paste PUBLIC into:
 *    - dobrota/app.js          → VAPID_PUBLIC_KEY
 *    - server/worker.js        → DOBRO_VAPID_PUBLIC_KEY
 * 2. Set Worker secrets (do not commit):
 *    wrangler secret put VAPID_PRIVATE_KEY   # paste the JWK JSON line
 *    wrangler secret put VAPID_SUBJECT       # e.g. mailto:you@example.com
 */
import { webcrypto } from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const { privateKey, publicKey } = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);
const rawPub = new Uint8Array(await webcrypto.subtle.exportKey('raw', publicKey));
const publicB64 = b64url(rawPub);
const privateJwk = JSON.stringify({
  kty: jwk.kty,
  crv: jwk.crv,
  d: jwk.d,
  x: jwk.x,
  y: jwk.y
});

console.log('=== VAPID public key (paste into client + worker constants) ===');
console.log(publicB64);
console.log('');
console.log('=== VAPID_PRIVATE_KEY secret (full JWK JSON string) ===');
console.log(privateJwk);
console.log('');
console.log('=== Alternative: bare d only (also accepted by Worker) ===');
console.log(jwk.d);
console.log('');
console.log('=== VAPID_SUBJECT example ===');
console.log('mailto:you@example.com');
console.log('');
console.log('Cron (already in server/wrangler.jsonc): 0 16 * * *');
