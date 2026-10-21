import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { allowGet, queryInteger } from './_lib/request.js';

function examText(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('invalid_exam');
  return value.trim().slice(0, 1000);
}

function examDate(value) {
  if (!value || !queryInteger(value.year, 1900, 2200)
    || !queryInteger(value.month, 1, 12) || !queryInteger(value.day, 1, 31)) throw new Error('invalid_exam_date');
  const year = Number(value.year), month = Number(value.month), day = Number(value.day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('invalid_exam_date');
  // Platonus uses calendar months (1–12); avoid timezone conversion.
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

function examTime(value) {
  if (typeof value === 'number') {
    if (!queryInteger(value, 0, 23)) throw new Error('invalid_exam_time');
    return `${String(value).padStart(2, '0')}:00`;
  }
  return examText(value);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!allowGet(req, res)) return;
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: 'no_session' }); return; }
  try {
    // Matches /v7/#/schedule/studentView/exam. ID 0 selects the signed-in
    // student, as in Platonus's viewer; never use a client-supplied ID.
    const reply = await fetch('https://platonus.kstu.kz/rest/schedule/userSchedule/student/exam/initial/0/ru', {
      method: 'GET', headers: buildPlatonusHeaders(session), signal: AbortSignal.timeout(20000),
    });
    if (reply.status === 401 || reply.status === 403) { res.status(401).json({ error: 'session_expired' }); return; }
    if (!reply.ok) throw new Error('exams_unavailable');
    const data = await reply.json();
    if (!data || !Array.isArray(data.examSchedules) || data.examSchedules.length > 2000) throw new Error('invalid_exams');
    const exams = data.examSchedules.map(exam => {
      if (!exam || typeof exam.subjectName !== 'string' || !exam.subjectName.trim()) throw new Error('invalid_exam');
      return {
        subject: examText(exam.subjectName), date: examDate(exam.examDate), time: examTime(exam.examTime),
        room: [examText(exam.buildingName), examText(exam.auditoryName)].filter(Boolean).join(', '),
      };
    });
    res.status(200).json({ exams });
  } catch { res.status(502).json({ error: 'exams_unavailable' }); }
}
