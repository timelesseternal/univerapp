// Small shared helpers used by every /api/* route.
// The "session" is never a Platonus password — it's a base64 bundle of
// { sid, token, cookie } handed back once at login time, after which the
// password itself is discarded server-side and never stored anywhere.

export function buildPlatonusHeaders(session) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Sid: session.sid,
    Token: session.token,
    Cookie: session.cookie,
  };
}

export function decodeSession(token) {
  if (!token) return null;
  try {
    const session = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (!session || !session.sid || !session.token || !session.cookie) return null;
    return session;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req) {
  const header = req.headers['x-session'];
  return decodeSession(Array.isArray(header) ? header[0] : header);
}
