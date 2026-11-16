import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { allowGet, queryInteger } from './_lib/request.js';

function formatError(reason, field, value) {
  let shape = value === null ? 'NULL' : Array.isArray(value) ? 'ARRAY' : typeof value === 'object' ? 'OBJECT' : typeof value === 'undefined' ? 'MISSING' : typeof value === 'number' ? 'NUMBER' : typeof value === 'string' ? 'STRING' : 'BOOLEAN';
  // Report only short mark tokens or bounded numeric sentinels, never names,
  // credentials, full upstream replies or arbitrary text.
  if (field === 'MARK' && typeof value === 'string' && value.trim().length <= 4) {
    shape += '_' + [...value.trim()].map(char => 'U' + char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join('_');
  }
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 110) {
    shape += '_' + String(value).replace('-', 'NEG').replace('.', 'DOT');
  }
  return Object.assign(new Error(reason), { diagnostic: `GD_FORMAT_${field}_${shape}` });
}
function text(value, field = 'TEXT') {
  if (value == null) return '';
  if (typeof value !== 'string') throw formatError('invalid_details', field, value);
  return value.trim().slice(0, 500);
}
function dateValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw formatError('invalid_date', 'DATE', value);
  if (!queryInteger(value.Year, 1900, 2200)) throw formatError('invalid_date', 'YEAR', value.Year);
  if (!queryInteger(value.Month, 1, 12)) throw formatError('invalid_date', 'MONTH', value.Month);
  if (!queryInteger(value.Day, 1, 31)) throw formatError('invalid_date', 'DAY', value.Day);
  const year = Number(value.Year), month = Number(value.Month), day = Number(value.Day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw formatError('invalid_date', 'CALENDAR_DATE', value);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function markMap(value, error) {
  // Empty collections can be serialized as null, {} or [] by different journal views.
  if (value == null || Array.isArray(value) && value.length === 0) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw formatError(error, error === 'invalid_month' ? 'MONTH_MARKS' : 'MARKS', value);
  return value;
}
function markValue(value) {
  if (typeof value === 'string' && /^\d{1,3}(?:[.,]\d+)?$/.test(value.trim())) value = Number(value.trim().replace(',', '.'));
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw formatError('invalid_mark', 'MARK', value);
  return value;
}
export function normalizeGradeDetails(data) {
  if (!Array.isArray(data) || data.length > 100) throw formatError('invalid_details', 'ROOT', data);
  return data.map(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) throw formatError('invalid_group', 'GROUP', group);
    if (!queryInteger(group.Id, 1)) throw formatError('invalid_group', 'GROUP_ID', group.Id);
    if (!text(group.Name, 'GROUP_NAME')) throw formatError('invalid_group', 'GROUP_NAME', group.Name);
    if (!Object.hasOwn(group, 'Marks')) throw formatError('invalid_marks', 'MARKS', undefined);
    const marks = [];
    for (const month of Object.values(markMap(group.Marks, 'invalid_marks'))) {
      if (month == null) continue;
      if (typeof month !== 'object' || Array.isArray(month) || !Object.hasOwn(month, 'Marks')) throw formatError('invalid_month', 'MONTH_ENTRY', month);
      for (const day of Object.values(markMap(month.Marks, 'invalid_month'))) {
        if (day == null) continue;
        if (!Array.isArray(day)) throw formatError('invalid_day', 'DAY_ENTRIES', day);
        for (const point of day) {
          if (!point || point.Mark == null || typeof point.Mark === 'string' && point.Mark.trim() === '') continue;
          const date = dateValue(point.MarkDate);
          // Cyrillic «н» and Platonus' -1 sentinel are attendance, never numeric grades.
          marks.push(point.Mark === -1 || typeof point.Mark === 'string' && /^(?:н|-1)$/i.test(point.Mark.trim())
            ? { mark: null, status: 'absent', date }
            : { mark: markValue(point.Mark), date });
          if (marks.length > 2000) throw formatError('too_many_marks', 'LIMIT', undefined);
        }
      }
    }
    marks.sort((a, b) => a.date.localeCompare(b.date));
    return { id: Number(group.Id), name: text(group.Name), tutor: text(group.TutorFullName, 'TUTOR'), marks };
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
  } catch (error) {
    const formatErrors = ['invalid_details','invalid_group','invalid_marks','invalid_month','invalid_day','invalid_mark','invalid_date','too_many_marks'];
    const detail = ['TimeoutError','AbortError'].includes(error?.name) ? 'GD_TIMEOUT'
      : ['identity_unavailable','invalid_identity'].includes(error?.message) ? 'GD_PROFILE'
      : error instanceof SyntaxError ? 'GD_FORMAT_JSON'
      : formatErrors.includes(error?.message) ? error.diagnostic || 'GD_FORMAT' : 'GD_UPSTREAM';
    res.status(502).json({ error: 'grade_details_unavailable', detail });
  }
}
