// GET /api/gpa   header: x-session: <token from /api/login>
//
// Platonus's own GPA endpoint conveniently returns studentID + studentName
// in the same response, so the frontend calls this first (right after
// login) to discover who it's talking to before asking for schedule/grades.

import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  try {
    const r = await fetch('https://platonus.kstu.kz/rest/integralGpa/selfStudentCard/ru', {
      headers: buildPlatonusHeaders(session),
    });
    if (r.status === 401 || r.status === 403) {
      res.status(401).json({ error: 'session_expired' });
      return;
    }
    const data = await r.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: 'platonus_unreachable' });
  }
}
