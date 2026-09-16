// GET /api/umkd-file?fileTypeID=131&umkdid=4922   header: x-session: <token>
//                                                  (или ?session=<token> в query —
//                                                   см. пояснение ниже)
//
// Отдаёт сам PDF-файл УМКД, проксируя его через наш сервер с сессией
// пользователя. Обычные /api/* роуты берут сессию из заголовка x-session,
// но этот файл открывается через <iframe src="..."> внутри мини-аппы —
// а у iframe нет возможности выставить кастомный заголовок на запрос.
// Поэтому здесь ДОПОЛНИТЕЛЬНО разрешаем передать ту же сессию через query
// параметр ?session=... (тот же base64-токен, что и в x-session).
import { getSessionFromRequest, decodeSession, buildPlatonusHeaders } from './_lib/platonus.js';

export default async function handler(req, res) {
  const headerSession = getSessionFromRequest(req);
  const querySession = req.query.session ? decodeSession(String(req.query.session)) : null;
  const session = headerSession || querySession;

  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const { fileTypeID, umkdid } = req.query;
  if (!fileTypeID || !umkdid) {
    res.status(400).json({ error: 'missing_params' });
    return;
  }

  try {
    const r = await fetch(
      `https://platonus.kstu.kz/downloadPdfUmkd?fileTypeID=${encodeURIComponent(fileTypeID)}&umkdid=${encodeURIComponent(umkdid)}`,
      { headers: buildPlatonusHeaders(session) }
    );

    if (r.status === 401 || r.status === 403) {
      res.status(401).json({ error: 'session_expired' });
      return;
    }
    if (!r.ok) {
      res.status(502).json({ error: 'platonus_bad_status', platonusStatus: r.status });
      return;
    }

    const arrayBuffer = await r.arrayBuffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    // Именно inline, а не attachment — чтобы iframe показал PDF, а не скачал его.
    res.setHeader('Content-Disposition', 'inline; filename="umkd.pdf"');
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(502).json({ error: 'platonus_unreachable', detail: String(err && err.message || err) });
  }
}
