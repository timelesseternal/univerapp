import { buildPlatonusHeaders } from './platonus.js';

export const TRANSCRIPT_FILTERS = { courseNumber: [], includeMoveOrder: false,
  includeSubjectAcademicDifference: false, includeSubjectAdditional: false,
  includeSubjectCodes: false, includeSubjectUnderStudy: true, languageID: 0,
  printVersionID: 0, showAchievements: false, showAllRecords: false,
  showDeletedRecords: false, showFxRetakesWithMarker: true,
  showRetakeSubjectsWithStar: true, showRetakenRecords: true,
  showRewritableDisciplines: false, showViolations: false, splitByDegrees: false,
  term: -1, transcriptLoadDegreeID: 0 };

export function parseTranscriptStudy(data, studentID) {
  const student = data?.student;
  if (!Number.isSafeInteger(Number(studentID)) || Number(studentID) <= 0 ||
      Number(student?.personID) !== Number(studentID)) return {};
  const group = typeof student.groupName === 'string' ? student.groupName.trim().slice(0, 120) : '';
  const course = Number(student.courseNumber);
  return {
    ...(group ? { studentGroupName: group } : {}),
    ...(Number.isInteger(course) && course >= 1 && course <= 8 ? { courseNumber: course } : {}),
  };
}

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

export async function fetchStudyDetails(session) {
  try {
    const response = await fetch('https://platonus.kstu.kz/rest/transcript/load/ru/0', {
      method: 'POST', headers: buildPlatonusHeaders(session),
      body: JSON.stringify(TRANSCRIPT_FILTERS),
      signal: AbortSignal.timeout(5000),
    });
    if ([401, 403].includes(response.status)) return null;
    if (response.ok) {
      const data = await response.json();
      if (data?.student?.personID) {
        const { personID, groupName, courseNumber } = data.student;
        return { transcript: { student: { personID, groupName, courseNumber } } };
      }
    }
  } catch { /* Fall back to the authenticated study plan when unavailable. */ }
  return fetchStudySummaryHtml(session);
}

export async function enrichStudentStudy(session, student, pendingDetails) {
  if (!Number.isSafeInteger(Number(student?.studentID)) || Number(student.studentID) <= 0) return student;
  const details = await (pendingDetails || fetchStudyDetails(session));
  if (!details) return student;
  const fields = typeof details === 'string' ? parseStudySummary(details, student.studentID)
    : parseTranscriptStudy(details.transcript, student.studentID);
  return { ...student, ...fields };
}
