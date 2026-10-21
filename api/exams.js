import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { allowGet, queryInteger } from './_lib/request.js';

function examText(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('invalid_exam');
  return value.trim().slice(0, 1000);
}

// Same authenticated, person-scoped request as ShowExamScheduleController.
// Source: Platonus ExamScheduleFactory.personExams and examSchedule/show.html.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!allowGet(req, res)) return;
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: 'no_session' }); return; }
  try {
    const exams = [], pages = new Set();
    const signal = AbortSignal.timeout(20000);
    for (let partNumber = 0; partNumber < 20; partNumber++) {
      const reply = await fetch('https://platonus.kstu.kz/rest/exam_schedule/personExams/ru', {
        method: 'POST', headers: buildPlatonusHeaders(session), signal,
        body: JSON.stringify({ type: 1, partNumber, countInPart: 100 }),
      });
      if (reply.status === 401 || reply.status === 403) {
        res.status(401).json({ error: 'session_expired' }); return;
      }
      if (!reply.ok) throw new Error('exams_unavailable');
      const data = await reply.json();
      if (!data || !Array.isArray(data.examList) || !queryInteger(data.total, 0, 2000)) throw new Error('invalid_exams');
      const fingerprint = JSON.stringify(data.examList);
      if (pages.has(fingerprint) && data.examList.length) throw new Error('repeated_page');
      pages.add(fingerprint);
      for (const exam of data.examList) {
        if (!exam || typeof exam.subject !== 'string' || !exam.subject.trim()) throw new Error('invalid_exam');
        exams.push({ subject: examText(exam.subject), date: examText(exam.date), time: examText(exam.time), room: examText(exam.auditoryName) });
      }
      if (exams.length >= Number(data.total)) { res.status(200).json({ exams }); return; }
      if (!data.examList.length) throw new Error('incomplete_exams');
    }
    throw new Error('too_many_pages');
  } catch { res.status(502).json({ error: 'exams_unavailable' }); }
}
