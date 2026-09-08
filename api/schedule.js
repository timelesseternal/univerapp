// GET /api/schedule?studentID=185082   header: x-session: <token>

import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const { studentID } = req.query;
  if (!studentID) {
    res.status(400).json({ error: 'missing_studentID' });
    return;
  }

  try {
    const r = await fetch(
      `https://platonus.kstu.kz/rest/schedule/userSchedule/student/calculate/${encodeURIComponent(studentID)}/ru`,
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
