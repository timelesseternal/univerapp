// GET /api/schedule?studentID=185082[&year=2026&term=1&week=2]   authentication: HttpOnly session cookie
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
import { allowGet, queryInteger } from './_lib/request.js';

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
      signal: AbortSignal.timeout(12000),
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
    return Object.values(lessons).some(slot => Array.isArray(slot?.lessons) && slot.lessons.length > 0);
  });
}

// A JSON object alone is not proof of a successfully loaded (possibly empty) week.
function parseSchedule(rawText) {
  const data = JSON.parse(rawText);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!record(data) || !record(data.timetable) || !record(data.timetable.days)) throw new Error('invalid_schedule');
  if (data.lessonHours !== undefined && !Array.isArray(data.lessonHours)) throw new Error('invalid_schedule');
  for (const hour of data.lessonHours || []) {
    if (!record(hour) || hour.number == null || hour.displayNumber == null
      || typeof hour.start !== 'string' || typeof hour.finish !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(hour.start)
      || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(hour.finish)) throw new Error('invalid_schedule');
  }
  for (const day of Object.values(data.timetable.days)) {
    if (!record(day) || !record(day.lessons)) throw new Error('invalid_schedule');
    for (const slot of Object.values(day.lessons)) {
      if (!record(slot) || !Array.isArray(slot.lessons)) throw new Error('invalid_schedule');
      for (const lesson of slot.lessons) {
        if (!record(lesson) || lesson.number == null || typeof lesson.subjectName !== 'string'
          || !lesson.subjectName.trim() || (lesson.tutorName != null && typeof lesson.tutorName !== 'string')) {
          throw new Error('invalid_schedule');
        }
      }
    }
  }
  return data;
}

// Строгая проверка "значение реально пришло от Platonus", а не "значение
// истинно" — week (и, теоретически, term) может легально быть 0, а
// `0 && x` в JS ложно, из-за чего валидная неделя 0 раньше принималась за
// отсутствие метаданных.
function isDefinedNumber(value) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!allowGet(req, res)) return;

  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'no_session' });
    return;
  }

  const { studentID, year, term, week } = req.query || {};
  if (!queryInteger(studentID, 1)) {
    res.status(400).json({ error: 'missing_studentID' });
    return;
  }

  if ((year !== undefined && !queryInteger(year, 1900, 2200))
    || (term !== undefined && !queryInteger(term, 0, 12))
    || (week !== undefined && !queryInteger(week, 0, 60))) {
    res.status(400).json({ error: 'invalid_params' });
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
    res.status(502).json({ error: 'platonus_unreachable' });
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
    });
    return;
  }

  let firstData;
  try {
    firstData = parseSchedule(first.rawText);
  } catch (err) {
    res.status(502).json({ error: 'platonus_bad_json' });
    return;
  }

  // Если фронт не задавал точные год/семестр/неделю сам, и в первом ответе
  // пар не нашлось — пробуем ещё раз, уже явно указав то, что Platonus сам
  // считает текущим (selectedStudyYear/selectedTerm/selectedWeek).
  if (!hadExplicitParams && !hasAnyLesson(firstData)) {
    const rawSelectedWeek = firstData.selectedWeek ?? firstData.defaultSelectedWeek;
    const retryOverrides = {
      studyYear: firstData.selectedStudyYear ?? firstData.defaultSelectedStudyYear,
      term: firstData.selectedTerm ?? firstData.defaultSelectedTerm,
      // Platonus иногда присылает week: 0, хотя реальная нумерация недель
      // у него с 1 — такой недели просто не существует, и запрос с ней
      // тоже возвращает пустые пары. Подстраховываемся: 0 трактуем как 1.
      week: isDefinedNumber(rawSelectedWeek) ? Math.max(1, rawSelectedWeek) : rawSelectedWeek,
    };
    const hasRetryValues =
      isDefinedNumber(retryOverrides.studyYear) &&
      isDefinedNumber(retryOverrides.term) &&
      isDefinedNumber(retryOverrides.week);

    if (hasRetryValues) {
      let second;
      try {
        second = await fetchPlatonusSchedule(studentID, session, retryOverrides);
      } catch (err) {
        // An unconfirmed empty response must not replace a saved week.
        res.status(502).json({ error: 'platonus_unreachable' });
        return;
      }
      if (second.status === 401 || second.status === 403) {
        res.status(401).json({ error: 'session_expired' });
        return;
      }
      if (second.status < 200 || second.status >= 300) {
        res.status(502).json({ error: 'platonus_bad_status', platonusStatus: second.status });
        return;
      }
      let secondData;
      try {
        secondData = parseSchedule(second.rawText);
      }
      catch {
        res.status(502).json({ error: 'platonus_bad_json' });
        return;
      }
      secondData._debug = { retried: true, retryOverrides, rawSelectedWeek, secondHasLessons: hasAnyLesson(secondData) };
      res.status(200).json(secondData);
      return;
    }

    firstData._debug = {
      retried: false,
      reasonNotRetried: 'no_metadata_values',
      metaSelected: {
        studyYear: firstData.selectedStudyYear,
        term: firstData.selectedTerm,
        week: firstData.selectedWeek,
      },
    };
  } else {
    firstData._debug = {
      retried: false,
      reasonNotRetried: hadExplicitParams ? 'explicit_params_provided' : 'first_call_had_lessons',
      metaSelected: {
        studyYear: firstData.selectedStudyYear,
        term: firstData.selectedTerm,
        week: firstData.selectedWeek,
      },
    };
  }

  res.status(200).json(firstData);
}
