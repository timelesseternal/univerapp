import {readWebSession} from './security.js';
// Small shared helpers used by every /api/* route.
// Upstream credentials are authenticated and decrypted server-side from an HttpOnly cookie.

export function buildPlatonusHeaders(session) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Sid: session.sid,
    Token: session.token,
    Cookie: session.cookie,
  };
}

export function getSessionFromRequest(req) {
  return readWebSession(req);
}
