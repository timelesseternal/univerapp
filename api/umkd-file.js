// GET /api/umkd-file?fileTypeID=131&umkdid=4922   header: x-session: <token>
//                                                  (или ?session=<token> в query)
//
// Необязательные параметры:
//   download=1   — отдать файл как attachment (для кнопки «Поделиться» на телефоне)
//   name=<имя>   — имя файла при скачивании
//
// Отдаёт сам PDF-файл УМКД, проксируя его через наш сервер с сессией
// пользователя. Обычные /api/* роуты берут сессию из заголовка x-session,
// но ссылку для tg.downloadFile / внешнего браузера нельзя снабдить
// кастомным заголовком, поэтому дополнительно разрешаем ?session=...
// (тот же base64-токен, что и в x-session).
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
      { headers: buildPlatonusHeaders(session), signal: AbortSignal.timeout(20000) }
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

    // ?download=1 — файл должен скачаться (кнопка «Поделиться» на телефоне),
    // иначе отдаём inline, как раньше (просмотрщик в мини-аппе).
    const asDownload = String(req.query.download || '') === '1';
    if (asDownload) res.setHeader('Access-Control-Allow-Origin', 'https://web.telegram.org');
    const rawName = String(req.query.name || 'umkd.pdf');
    const safeName = rawName.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 150) || 'umkd.pdf';
    // Кириллицу в имени файла кодируем по RFC 5987
    const encodedName = encodeURIComponent(safeName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="umkd.pdf"; filename*=UTF-8''${encodedName}`
    );
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(502).json({ error: 'platonus_unreachable', detail: String(err && err.message || err) });
  }
}
