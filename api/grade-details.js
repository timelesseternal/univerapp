import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { allowGet, queryInteger } from './_lib/request.js';

function text(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('invalid_details');
  return value.trim().slice(0, 500);
}
function dateValue(value) {
  if (!value || !queryInteger(value.Year, 1900, 2200) || !queryInteger(value.Month, 1, 12)
    || !queryInteger(value.Day, 1, 31)) throw new Error('invalid_date');
  const year = Number(value.Year), month = Number(value.Month), day = Number(value.Day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('invalid_date');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function normalizeGradeDetails(data) {
  if (!Array.isArray(data) || data.length > 100) throw new Error('invalid_details');
  return data.map(group => {
    if (!group || !queryInteger(group.Id, 1) || !text(group.Name)) throw new Error('invalid_group');
    if (!Object.hasOwn(group, 'Marks') || (group.Marks !== null
      && (typeof group.Marks !== 'object' || Array.isArray(group.Marks)))) throw new Error('invalid_marks');
    const marks = [];
    for (const month of Object.values(group.Marks || {})) {
      if (!month?.Marks || typeof month.Marks !== 'object' || Array.isArray(month.Marks)) throw new Error('invalid_month');
      for (const day of Object.values(month.Marks)) {
        if (!Array.isArray(day)) throw new Error('invalid_day');
        for (const point of day) {
          if (!point || point.Mark == null || point.Mark === '') continue;
          if (typeof point.Mark !== 'number' || !Number.isFinite(point.Mark) || point.Mark < 0 || point.Mark > 100) throw new Error('invalid_mark');
          marks.push({ mark: point.Mark, date: dateValue(point.MarkDate) });
          if (marks.length > 2000) throw new Error('too_many_marks');
        }
      }
    }
    marks.sort((a, b) => a.date.localeCompare(b.date));
    return { id: Number(group.Id), name: text(group.Name), tutor: text(group.TutorFullName), marks };
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!allowGet(req, res)) return;
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: 'no_session' }); return; }
  const { year, term, subjectID, queryID } = req.query || {};
  if (!queryInteger(year, 1900, 2200) || !queryInteger(term, 0, 12) || !queryInteger(subjectID, 1)
    || (queryID !== undefined && !queryInteger(queryID, 1))) {
    res.status(400).json({ error: 'invalid_params' }); return;
  }
  try {
    const options = { headers: buildPlatonusHeaders(session), signal: AbortSignal.timeout(20000) };
    const identity = await fetch('https://platonus.kstu.kz/rest/integralGpa/selfStudentCard/ru', options);
    if ([401, 403].includes(identity.status)) { res.status(401).json({ error: 'session_expired' }); return; }
    if (!identity.ok) throw new Error('identity_unavailable');
    const studentID = (await identity.json())?.studentID;
    if (!queryInteger(studentID, 1)) throw new Error('invalid_identity');
    const suffix = queryID === undefined ? '' : `?queryID=${Number(queryID)}`;
    const reply = await fetch(`https://platonus.kstu.kz/subject/${Number(year)}/${Number(term)}/${Number(subjectID)}/${Number(studentID)}${suffix}`, options);
    if ([401, 403].includes(reply.status)) { res.status(401).json({ error: 'session_expired' }); return; }
    if (!reply.ok) throw new Error('details_unavailable');
    res.status(200).json({ groups: normalizeGradeDetails(await reply.json()) });
  } catch { res.status(502).json({ error: 'grade_details_unavailable' }); }
}
