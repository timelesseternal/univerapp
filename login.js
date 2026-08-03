// POST /api/login  { login, password } -> { ok, session, blockMinutesRemaining }
//
// This is the ONLY place the student's password ever passes through this
// backend. It is forwarded once, straight to Platonus, over HTTPS, and is
// never written to a log, a database, a file, or anywhere else. Once the
// Platonus response comes back, the password variable simply falls out of
// scope at the end of this function.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const { login, password } = req.body || {};
  if (!login || !password) {
    res.status(400).json({ error: 'missing_credentials' });
    return;
  }

  let platonusResp;
  try {
    platonusResp = await fetch('https://platonus.kstu.kz/rest/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify({
        login,
        password,
        iin: null,
        icNumber: null,
        authForDeductedStudentsAndGraduates: 'false',
      }),
    });
  } catch (err) {
    res.status(502).json({ error: 'platonus_unreachable' });
    return;
  }

  let data;
  try {
    data = await platonusResp.json();
  } catch {
    res.status(502).json({ error: 'platonus_bad_response' });
    return;
  }

  if (data.login_status !== 'success') {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }

  // Collect the Set-Cookie headers Platonus sent back (plt_auth_cookie,
  // sessionid, plt_sid, ...) so we can replay them on every later request.
  const setCookie =
    typeof platonusResp.headers.getSetCookie === 'function'
      ? platonusResp.headers.getSetCookie()
      : platonusResp.headers.get('set-cookie')
      ? [platonusResp.headers.get('set-cookie')]
      : [];

  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');

  const session = { sid: data.sid, token: data.auth_token, cookie };
  const sessionToken = Buffer.from(JSON.stringify(session)).toString('base64');

  res.status(200).json({
    ok: true,
    session: sessionToken,
    blockMinutesRemaining: data.blockMinutesRemaining ?? 0,
  });
}
