// GET /api/umkd-file?fileTypeID=131&umkdid=4922   authentication: HttpOnly session cookie
// PDF download authenticated only by HttpOnly cookie; never accept credentials in URLs.
import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';
import { allowGet, queryInteger } from './_lib/request.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!allowGet(req, res)) return;
  const session = getSessionFromRequest(req);

  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const { fileTypeID, umkdid } = req.query || {};
  if (!queryInteger(fileTypeID, 1) || !queryInteger(umkdid, 1)) {
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
    const pdf = Buffer.from(arrayBuffer);
    if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      res.status(502).json({ error: 'invalid_pdf' });
      return;
    }

    // ?download=1 — файл должен скачаться (кнопка «Поделиться» на телефоне),
    // иначе отдаём inline, как раньше (просмотрщик в мини-аппе).
    const asDownload = String(req.query.download || '') === '1';
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
    res.status(200).send(pdf);
  } catch (err) {
    res.status(502).json({ error: 'platonus_unreachable' });
  }
}
