// GET /api/schedule?studentID=185082[&year=2026&term=1&week=2]   header: x-session: <token>
//
// Platonus запрашивает расписание через POST с телом вида:
//   { studentTypeID, studyYear, term, statusID, disciplineStudyLanguageIds, week }
// Без явных studyYear/term/week Platonus иногда возвращает "правильную"
// структуру (дни/часы), но с пустыми списками пар — судя по всему, он
// выбирает какую-то неделю по умолчанию, которая не совпадает с реальной
// активной неделей. Поэтому: если параметры не пришли явно от фронта,
// сначала спрашиваем без них (получаем метаданные — какую неделю Platonus
// сам считает текущей: selectedStudyYear/selectedTerm/selectedWeek), а
// затем повторяем запрос уже с этими значениями явно.
import { getSessionFromRequest, buildPlatonusHeaders } from './_lib/platonus.js';

async function fetchPlatonusSchedule(studentID, session, overrides) {
  const body = {
    studentTypeID: 1,
    statusID: 1,
    disciplineStudyLanguageIds: [1, 2, 3],
    ...overrides,
  };

  const r = await fetch(
    `https://platonus.kstu.kz/rest/schedule/userSchedule/student/calculate/${encodeURIComponent(studentID)}/ru`,
    {
      method: 'POST',
      headers: buildPlatonusHeaders(session),
      body: JSON.stringify(body),
    }
  );

  const rawText = await r.text();
  return { status: r.status, rawText };
}

function hasAnyLesson(data) {
  const days = (data && data.timetable && data.timetable.days) || {};
  return Object.values(days).some(day => {
    const lessons = (day && day.lessons) || {};
    return Object.values(lessons).some(slot => Array.isArray(slot.lessons) && slot.lessons.length > 0);
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const { studentID, year, term, week } = req.query;
  if (!studentID) {
    res.status(400).json({ error: 'missing_studentID' });
    return;
  }

  const explicitOverrides = {};
  if (year) explicitOverrides.studyYear = Number(year);
  if (term) explicitOverrides.term = Number(term);
  if (week) explicitOverrides.week = Number(week);
  const hadExplicitParams = Object.keys(explicitOverrides).length > 0;

  let first;
  try {
    first = await fetchPlatonusSchedule(studentID, session, explicitOverrides);
  } catch (err) {
    res.status(502).json({ error: 'platonus_unreachable', detail: String(err && err.message || err) });
    return;
  }

  if (first.status === 401 || first.status === 403) {
    res.status(401).json({ error: 'session_expired' });
    return;
  }
  if (first.status < 200 || first.status >= 300) {
    res.status(502).json({
      error: 'platonus_bad_status',
      platonusStatus: first.status,
      detail: first.rawText.slice(0, 300),
    });
    return;
  }

  let firstData;
  try {
    firstData = JSON.parse(first.rawText);
  } catch (err) {
    res.status(502).json({ error: 'platonus_bad_json', detail: first.rawText.slice(0, 300) });
    return;
  }

  // Если фронт не задавал точные год/семестр/неделю сам, и в первом ответе
  // пар не нашлось — пробуем ещё раз, уже явно указав то, что Platonus сам
  // считает текущим (selectedStudyYear/selectedTerm/selectedWeek).
  if (!hadExplicitParams && !hasAnyLesson(firstData)) {
    const retryOverrides = {
      studyYear: firstData.selectedStudyYear ?? firstData.defaultSelectedStudyYear,
      term: firstData.selectedTerm ?? firstData.defaultSelectedTerm,
      week: firstData.selectedWeek ?? firstData.defaultSelectedWeek,
    };
    const hasRetryValues = retryOverrides.studyYear && retryOverrides.term && retryOverrides.week;

    if (hasRetryValues) {
      try {
        const second = await fetchPlatonusSchedule(studentID, session, retryOverrides);
        if (second.status >= 200 && second.status < 300) {
          const secondData = JSON.parse(second.rawText);
          res.status(200).json(secondData);
          return;
        }
      } catch (err) {
        // Игнорируем — просто вернём первый (пустой) ответ ниже.
      }
    }
  }

  res.status(200).json(firstData);
}
