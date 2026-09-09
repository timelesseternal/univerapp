// GET /api/schedule?studentID=185082   header: x-session: <token>
import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const { studentID } = req.query;
  if (!studentID) {
    res.status(400).json({ error: 'missing_studentID' });
    return;
  }

  let r;
  try {
    r = await fetch(
      `https://platonus.kstu.kz/rest/schedule/userSchedule/student/calculate/${encodeURIComponent(studentID)}/ru`,
      { headers: buildPlatonusHeaders(session) }
    );
  } catch (err) {
    // Сеть до Platonus не поднялась вообще (таймаут, DNS и т.п.)
    res.status(502).json({ error: 'platonus_unreachable', detail: String(err && err.message || err) });
    return;
  }

  if (r.status === 401 || r.status === 403) {
    res.status(401).json({ error: 'session_expired' });
    return;
  }

  // Читаем тело как текст один раз, чтобы можно было и распарсить,
  // и — если парсинг не удастся — вернуть сырой текст для отладки.
  const rawText = await r.text();

  if (!r.ok) {
    // Platonus ответил не 200 (и не 401/403) — например 400/404/500.
    // Отдаём код и начало тела, чтобы понять причину со стороны клиента.
    res.status(502).json({
      error: 'platonus_bad_status',
      platonusStatus: r.status,
      detail: rawText.slice(0, 300),
    });
    return;
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    // Platonus ответил 200, но тело не JSON (бывает при редиректах на HTML-страницу логина и т.п.)
    res.status(502).json({
      error: 'platonus_bad_json',
      detail: rawText.slice(0, 300),
    });
    return;
  }

  res.status(200).json(data);
}
