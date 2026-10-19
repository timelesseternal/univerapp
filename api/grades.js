// GET /api/grades?studentID=185082&year=2026&term=1   authentication: HttpOnly session cookie

import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { allowGet, queryInteger } from './_lib/request.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!allowGet(req, res)) return;
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const { studentID, year, term } = req.query || {};
  if (!queryInteger(studentID, 1) || !queryInteger(year, 1900, 2200) || !queryInteger(term, 0, 12)) {
    res.status(400).json({ error: 'missing_params' });
    return;
  }

  try {
    const r = await fetch(
      `https://platonus.kstu.kz/journal/${encodeURIComponent(year)}/${encodeURIComponent(term)}/${encodeURIComponent(studentID)}`,
      { headers: buildPlatonusHeaders(session), signal: AbortSignal.timeout(12000) }
    );
    if (r.status === 401 || r.status === 403) {
      res.status(401).json({ error: 'session_expired' });
      return;
    }
    if (!r.ok) {
      res.status(502).json({ error: 'platonus_unreachable' });
      return;
    }
    const data = await r.json();
    if (!Array.isArray(data)) {
      res.status(502).json({ error: 'invalid_journal' });
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: 'platonus_unreachable' });
  }
}
