// GET /api/gpa   authentication: HttpOnly session cookie
//
// Platonus's own GPA endpoint conveniently returns studentID + studentName
// in the same response, so the frontend calls this first (right after
// login) to discover who it's talking to before asking for schedule/grades.

import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { enrichStudentStudy, fetchStudyDetails } from './_lib/student-study.js';
import { syncOwnStudyProfile, restoreVerifiedStudyProfile } from './_lib/chat.js';
import { waitUntil } from '@vercel/functions';
import { allowGet, queryInteger } from './_lib/request.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!allowGet(req, res)) return;
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  try {
    const summary = req.query?.summary === '1';
    const studyDetails = summary ? null : fetchStudyDetails(session);
    const r = await fetch('https://platonus.kstu.kz/rest/integralGpa/selfStudentCard/ru', {
      headers: buildPlatonusHeaders(session),
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 401 || r.status === 403) {
      res.status(401).json({ error: 'session_expired' });
      return;
    }
    if (!r.ok) { res.status(502).json({ error: 'platonus_unreachable' }); return; }
    const data = await r.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || !queryInteger(data.studentID, 1)) {
      res.status(502).json({ error: 'invalid_student' });
      return;
    }
    if (summary) {
      res.status(200).json(data);
      return;
    }
    const student = await restoreVerifiedStudyProfile(await enrichStudentStudy(session, data, studyDetails));
    res.status(200).json(student);
    waitUntil(syncOwnStudyProfile(req, student).catch(() => {}));
  } catch (err) {
    res.status(502).json({ error: 'platonus_unreachable' });
  }
}
