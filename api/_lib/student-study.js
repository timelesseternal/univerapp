import { buildPlatonusHeaders } from './platonus.js';

// Read the student summary, not the course selector used to filter subjects.
export function parseStudySummary(html, studentID) {
  const inputs = html.match(/<input\b[^>]*>/gi) || [];
  const identity = inputs.find(tag => /\bname\s*=\s*["']studentID["']/i.test(tag));
  const id = identity?.match(/\bvalue\s*=\s*["'](\d+)["']/i)?.[1];
  if (!id || Number(id) !== Number(studentID)) return {};
  const course = html.match(/<span\b[^>]*>\s*Курс\s+([1-8])\s*<\/span>/i)?.[1];
  const group = html.match(/<span\b[^>]*>\s*(?:Учебная группа|Академическая группа)\s*:?\s*([^<]+)<\/span>/i)?.[1];
  const groupName = group?.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 120);
  return { ...(course ? { courseNumber: Number(course) } : {}), ...(groupName ? { studentGroupName: groupName } : {}) };
}

export async function fetchStudySummaryHtml(session) {
  try {
    const response = await fetch('https://platonus.kstu.kz/indcur', {
      headers: { ...buildPlatonusHeaders(session), Accept: 'text/html' },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? await response.text() : null;
  } catch { return null; }
}

export async function enrichStudentStudy(session, student, pendingHtml) {
  if (!Number.isSafeInteger(Number(student?.studentID)) || Number(student.studentID) <= 0) return student;
  const html = await (pendingHtml || fetchStudySummaryHtml(session));
  return html ? { ...student, ...parseStudySummary(html, student.studentID) } : student;
}
