// Auth helpers: code/PIN generation, hashing, timing-safe compare, host auth.
import crypto from 'node:crypto';

// timing-safe string compare (length-independent).
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  const len = Math.max(ba.length, bb.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ba.copy(pa);
  bb.copy(pb);
  const eq = crypto.timingSafeEqual(pa, pb);
  return eq && ba.length === bb.length;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
export function genCode() {
  const pick = (n) =>
    Array.from({ length: n }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  return `${pick(4)}-${pick(4)}`;
}

export function genPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

export function hashPin(pin, code) {
  // salt with code; sufficient for short-lived quiz PINs.
  return crypto.createHash('sha256').update(`${code}:${pin}`).digest('hex');
}

export function verifyPin(pin, code, hash) {
  return safeEqual(hashPin(pin, code), hash);
}

export function genPlayerId() {
  return `p_${crypto.randomBytes(8).toString('hex')}`;
}

// Host auth header format: "<code>:<pin>"
export function parseHostAuth(event) {
  const h =
    event.headers?.['x-host-auth'] || event.headers?.['X-Host-Auth'] || '';
  const idx = h.indexOf(':');
  if (idx < 0) return null;
  return { code: h.slice(0, idx), pin: h.slice(idx + 1) };
}
