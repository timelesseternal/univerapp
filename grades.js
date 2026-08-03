// GET /api/grades?studentID=185082&year=2026&term=1   header: x-session: <token>

import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';

export default async function handler(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const { studentID, year, term } = req.query;
  if (!studentID || !year || !term) {
    res.status(400).json({ error: 'missing_params' });
    return;
  }

  try {
    const r = await fetch(
      `https://platonus.kstu.kz/journal/${encodeURIComponent(year)}/${encodeURIComponent(term)}/${encodeURIComponent(studentID)}`,
      { headers: buildPlatonusHeaders(session) }
    );
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
