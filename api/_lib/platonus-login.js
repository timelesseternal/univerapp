export class PlatonusLoginError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

// Shared by explicit login and device-authenticated renewal. Never log the body.
export async function loginToPlatonus(login, password) {
  let response;
  try {
    response = await fetch('https://platonus.kstu.kz/rest/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json, text/plain, */*' },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ login, password, iin: null, icNumber: null, authForDeductedStudentsAndGraduates: 'false' }),
    });
  } catch { throw new PlatonusLoginError(502, 'platonus_unreachable'); }
  if (!response.ok) {
    const denied = response.status === 401 || response.status === 403;
    throw new PlatonusLoginError(denied ? 401 : 502, denied ? 'invalid_credentials' : 'platonus_unreachable');
  }
  let data;
  try { data = await response.json(); }
  catch (error) {
    throw new PlatonusLoginError(502, ['TimeoutError', 'AbortError'].includes(error?.name) ? 'platonus_unreachable' : 'platonus_bad_response');
  }
  if (data?.login_status !== 'success') throw new PlatonusLoginError(401, 'invalid_credentials');
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie()
    : response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : [];
  const session = { sid: data.sid, token: data.auth_token, cookie: cookies.map(value => value.split(';')[0]).join('; ') };
  if (!session.sid || !session.token || !session.cookie) throw new PlatonusLoginError(502, 'platonus_bad_response');
  return { session, blockMinutesRemaining: data.blockMinutesRemaining ?? 0 };
}
