import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { TRANSCRIPT_FILTERS } from './_lib/student-study.js';
import { normalizeTranscript } from './_lib/academic-documents.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method && req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: 'no_session' }); return; }
  try {
    // ID 0 is Platonus's own transcript; never accept a requested student ID.
    const response = await fetch('https://platonus.kstu.kz/rest/transcript/load/ru/0', {
      method: 'POST', headers: buildPlatonusHeaders(session), body: JSON.stringify(TRANSCRIPT_FILTERS), signal: AbortSignal.timeout(12000),
    });
    if ([401, 403].includes(response.status)) { res.status(401).json({ error: 'session_expired' }); return; }
    if (!response.ok) throw new Error('transcript_unavailable');
    res.status(200).json(normalizeTranscript(await response.json()));
  } catch { res.status(502).json({ error: 'transcript_unavailable' }); }
}
