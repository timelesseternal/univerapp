import { createHash, randomBytes } from 'node:crypto';
import { getSessionFromRequest, buildPlatonusHeaders } from './platonus.js';
import { enrichStudentStudy, fetchStudyDetails } from './student-study.js';
import { waitUntil } from '@vercel/functions';

export const COOKIE_NAME = 'univer_chat_session';
const SESSION_SECONDS = 8 * 60 * 60;
export class ChatError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ChatError(503, 'chat_not_configured');
  try { if (new URL(url).protocol !== 'https:') throw new Error(); }
  catch { throw new ChatError(503, 'chat_not_configured'); }
  return { url, key };
}
export async function database(path, { method = 'POST', body, timeoutMs = 10000 } = {}) {
  const { url, key } = configuration();
  let response;
  try {
    response = await fetch(`${url}/rest/v1/${path}`, {
      method,
      // Supports the legacy service_role JWT and the new sb_secret_ keys.
      headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
        'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { throw new ChatError(503, 'chat_unavailable'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(data?.code)) throw new ChatError(503, 'chat_setup_required');
    if (data?.code === '42501') throw new ChatError(403, 'chat_forbidden');
    if (data?.message === 'chat_rate_limit') throw new ChatError(429, 'chat_rate_limit');
    if (['23503', '22023', '22P02', '23514'].includes(data?.code)) throw new ChatError(400, 'invalid_chat_request');
    throw new ChatError(503, 'chat_unavailable');
  }
  return data;
}
export const rpc = (name, body, options = {}) => database(`rpc/${name}`, { ...options, body });
export function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }
export function readToken(req) {
  const cookie = req.headers.cookie || '';
  const value = cookie.split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
export function setCookie(req, res, token, maxAge = SESSION_SECONDS) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/api/chat; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}
export function checkOrigin(req) {
  if (!req.headers.origin) return;
  try {
    if (new URL(req.headers.origin).host === req.headers.host) return;
  } catch { /* Reject malformed origins. */ }
  throw new ChatError(403, 'chat_forbidden');
}
export async function currentUser(req) {
  const token = readToken(req);
  if (!token) throw new ChatError(401, 'chat_session_expired');
  const rows = await database(`chat_sessions?select=user_id&token_hash=eq.${tokenHash(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`, { method: 'GET' });
  if (!rows?.[0]?.user_id) throw new ChatError(401, 'chat_session_expired');
  return rows[0].user_id;
}
export async function startSession(req, res, defer = waitUntil) {
  configuration();
  const session = getSessionFromRequest(req);
  if (!session) throw new ChatError(401, 'session_expired');
  const studyDetails = fetchStudyDetails(session);
  let response;
  try {
    response = await fetch('https://platonus.kstu.kz/rest/integralGpa/selfStudentCard/ru', {
      headers: buildPlatonusHeaders(session), signal: AbortSignal.timeout(8000),
    });
  } catch { throw new ChatError(502, 'platonus_unreachable'); }
  if ([401, 403].includes(response.status)) throw new ChatError(401, 'session_expired');
  if (!response.ok) throw new ChatError(502, 'platonus_unreachable');
  const student = await response.json().catch(() => null);
  const studentID = Number(student?.studentID);
  const name = typeof student?.studentName === 'string' ? student.studentName.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
  if (!Number.isSafeInteger(studentID) || studentID <= 0 || !name) throw new ChatError(502, 'invalid_student_profile');
  // Never accept a studentID or display name supplied by the browser.
  const token = randomBytes(32).toString('hex');
  const oldToken = readToken(req);
  const profile = await rpc('chat_bootstrap', { p_student_id: studentID, p_display_name: name,
    p_token_hash: tokenHash(token), p_previous_hash: oldToken ? tokenHash(oldToken) : null });
  // Academic fields come only from authenticated Platonus responses for this student.
  defer((async () => {
    try {
      const study = verifiedStudyProfile(await enrichStudentStudy(session, student, studyDetails));
      await rpc('chat_sync_student_profile', { p_user_id: profile.id, ...study });
    } catch { /* Profile refresh must not delay or prevent opening conversations. */ }
  })());
  setCookie(req, res, token);
  // Return the first inbox in the bootstrap response, avoiding another browser round trip.
  const conversations = await rpc('chat_inbox', { p_user_id: profile.id });
  return { profile, conversations };
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new ChatError(400, 'invalid_chat_request');
  return value;
}

export async function readPeerProfile(userID, conversationID) {
  try {
    return await rpc('chat_peer_profile', { p_user_id: userID, p_conversation_id: conversationID });
  } catch (error) {
    if (!(error instanceof ChatError) || error.code !== 'chat_setup_required') throw error;
    // An older database still has the base profile. Verify membership before
    // reading it; never accept the peer ID supplied by the browser.
    const conversations = await database(`chat_conversations?select=user_a,user_b&id=eq.${conversationID}&or=(user_a.eq.${userID},user_b.eq.${userID})&limit=1`, { method: 'GET' });
    const conversation = conversations?.[0];
    if (!conversation || ![conversation.user_a, conversation.user_b].includes(userID)) throw new ChatError(403, 'chat_forbidden');
    const peerID = uuid(conversation.user_a === userID ? conversation.user_b : conversation.user_a);
    const rows = await database(`chat_profiles?select=id,student_id,display_name&id=eq.${peerID}&limit=1`, { method: 'GET' });
    const peer = rows?.[0];
    if (!peer) throw new ChatError(404, 'chat_profile_not_found');
    return { id: peer.id, name: peer.display_name, studentID: peer.student_id,
      academicGpa: null, group: null, course: null, updatedAt: null, studyAvailable: false };
  }
}

// Refresh only the signed-in student's profile from a verified Platonus response.
// The GPA route also runs for existing chat sessions, unlike chat bootstrap.
export async function syncOwnStudyProfile(req, student) {
  if (!readToken(req)) return;
  const studentID = Number(student?.studentID);
  if (!Number.isSafeInteger(studentID) || studentID <= 0) return;
  const userID = await currentUser(req);
  const rows = await database(`chat_profiles?select=student_id,academic_gpa,study_group,study_course&id=eq.${uuid(userID)}&limit=1`, { method: 'GET' });
  const existing = rows?.[0];
  if (!existing || Number(existing.student_id) !== studentID) return;
  const fields = verifiedStudyProfile(student);
  // A transient transcript failure must not erase already verified details.
  fields.p_academic_gpa ??= existing.academic_gpa;
  fields.p_group ??= existing.study_group;
  fields.p_course ??= existing.study_course;
  await rpc('chat_sync_student_profile', { p_user_id: userID, ...fields });
}

export function verifiedStudyProfile(student) {
  const rawGpa = student.academicGpa;
  const gpa = rawGpa == null || String(rawGpa).trim() === '' ? NaN : Number(String(rawGpa).replace(',', '.'));
  let group = null, course = null;
  for (const candidate of [student.studentGroupName, student.groupName, student.academicGroupName,
    student.studyGroupName, student.group, student.studentGroup, student.studyGroup, student.academicGroup,
    student.studentInfo?.groupName, student.student?.groupName]) {
    const name = candidate && typeof candidate === 'object' ? candidate.name || candidate.groupName : candidate;
    if (typeof name === 'string' && name.trim()) { group = name.trim().slice(0,120); break; }
  }
  for (const value of [student.courseNumber, student.course, student.studyCourse, student.yearOfStudy,
    student.studentInfo?.course, student.student?.course]) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 1 && number <= 8) { course = number; break; }
  }
  return { p_academic_gpa: Number.isFinite(gpa) && gpa >= 0 && gpa <= 4 ? gpa : null, p_group: group, p_course: course };
}
