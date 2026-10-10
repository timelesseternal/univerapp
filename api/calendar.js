import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { parseAcademicCalendar } from './_lib/academic-documents.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method && req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: 'no_session' }); return; }
  try {
    const headers = buildPlatonusHeaders(session);
    const [identity, page] = await Promise.all([
      fetch('https://platonus.kstu.kz/rest/integralGpa/selfStudentCard/ru', { headers, signal: AbortSignal.timeout(12000) }),
      fetch('https://platonus.kstu.kz/calendarview', { headers: { ...headers, Accept: 'text/html' }, signal: AbortSignal.timeout(12000) }),
    ]);
    if ([identity.status, page.status].some(s => s === 401 || s === 403) || /\/(?:login|auth)(?:[/?]|$)/i.test(page.url || '')) {
      res.status(401).json({ error: 'session_expired' }); return;
    }
    if (!identity.ok || !page.ok) throw new Error('calendar_unavailable');
    const studentID = Number((await identity.json()).studentID);
    if (!Number.isSafeInteger(studentID) || studentID <= 0) throw new Error('invalid_identity');
    res.status(200).json({ studentID, ...parseAcademicCalendar(await page.text()) });
  } catch { res.status(502).json({ error: 'calendar_unavailable' }); }
}
