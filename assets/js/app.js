if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./assets/js/sw.js', { scope: '/' }).catch(err => console.log('SW error', err));
    }, { once: true });
  }

  const tg = window.Telegram ? window.Telegram.WebApp : null;

  // Панель управления Telegram в fullscreen-режиме (кнопка «Закрыть»,
  // шеврон для сворачивания, «•••») рисуется самим Telegram поверх
  // WebView и занимает собственную высоту, не входящую в обычные
  // safe-area инсеты устройства. Telegram сообщает эту высоту через
  // tg.safeAreaInset / tg.contentSafeAreaInset — прокидываем их в CSS
  // переменные, которые уже используются в отступах сверху.
  function applyTelegramSafeAreaInsets() {
    if (!tg) return;
    const safeTop = (tg.safeAreaInset && tg.safeAreaInset.top) || 0;
    const contentTop = (tg.contentSafeAreaInset && tg.contentSafeAreaInset.top) || 0;
    document.documentElement.style.setProperty('--tg-safe-area-top', safeTop + 'px');
    document.documentElement.style.setProperty('--tg-content-safe-area-top', contentTop + 'px');
  }

  if (tg) {
    tg.ready();
    tg.expand();
    // Иначе на некоторых устройствах свайп вниз по списку Telegram
    // распознаёт как жест "закрыть приложение" вместо прокрутки —
    // особенно заметно, когда контента больше, чем помещается на экране.
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    tg.onEvent('themeChanged', syncAppearanceFromSystem);
    tg.onEvent('viewportChanged', () => tg.expand());

    applyTelegramSafeAreaInsets();
    tg.onEvent('safeAreaChanged', applyTelegramSafeAreaInsets);
    tg.onEvent('contentSafeAreaChanged', applyTelegramSafeAreaInsets);
  }

  function haptic(style) {
    if (tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
      try { tg.HapticFeedback.impactOccurred(style || 'light'); } catch (e) { /* ignore */ }
    }
  }

  // ==================================================================
  // ============ ПЕРСИСТЕНТНОЕ ХРАНИЛИЩЕ (Telegram CloudStorage) ============
  // ==================================================================
  // CloudStorage переживает очистку кэша WebView и синхронизируется с аккаунтом
  // Telegram пользователя — в отличие от localStorage, который в некоторых
  // сценариях (особенно на iOS) может быть очищен системой. Вне Telegram
  // (например, при локальной разработке в обычном браузере) используем
  // localStorage как фолбэк.
  // Скрипт telegram-web-app.js создаёт window.Telegram.WebApp и в обычном
  // браузере, но CloudStorage там не работает (бросает ошибку или молчит).
  // Поэтому используем его только внутри настоящего Telegram (есть initData
  // и версия 6.9+), а везде остальное — localStorage.
  function useCloudStorage() {
    return !!(tg && tg.CloudStorage && tg.initData
      && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9'));
  }
  function lsSafe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }
  // Mirror only display data locally. Credentials remain in CloudStorage in Telegram.
  // Namespace by Telegram user so a shared WebView cannot reuse another user's cache.
  function localCacheKey(key) {
    const userID = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
    return `univer_cache_${userID || 'browser'}_${key}`;
  }
  function isDisplayCache(key) {
    return key === 'platonus_student' || key.endsWith('_cache') || key.startsWith('platonus_week_');
  }
  function csGetMany(keys) {
    const values = {};
    const missing = [];
    keys.forEach(key => {
      const local = isDisplayCache(key)
        ? lsSafe(() => localStorage.getItem(localCacheKey(key)), null) : null;
      if (local !== null) values[key] = local;
      else missing.push(key);
    });
    if (!missing.length) return Promise.resolve(values);
    if (!useCloudStorage()) {
      missing.forEach(key => { values[key] = lsSafe(() => localStorage.getItem(key), null); });
      return Promise.resolve(values);
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(values), 5000);
      try {
        tg.CloudStorage.getItems(missing, (err, result) => {
          clearTimeout(timer);
          if (!err && result) missing.forEach(key => {
            values[key] = result[key] || null;
            if (values[key] && isDisplayCache(key)) {
              lsSafe(() => localStorage.setItem(localCacheKey(key), values[key]));
            }
          });
          resolve(values);
        });
      } catch (e) { clearTimeout(timer); resolve(values); }
    });
  }
  function csGet(key) {
    return csGetMany([key]).then(values => values[key] || null);
  }
  function csSet(key, value) {
    if (isDisplayCache(key)) lsSafe(() => localStorage.setItem(localCacheKey(key), value));
    return new Promise((resolve) => {
      if (useCloudStorage()) {
        // Large journals and schedules still persist locally above.
        if (value.length > 4096) { resolve(); return; }
        const timer = setTimeout(resolve, 5000);
        try {
          tg.CloudStorage.setItem(key, value, () => { clearTimeout(timer); resolve(); });
          return;
        } catch (e) { clearTimeout(timer); }
        resolve();
        return;
      }
      lsSafe(() => localStorage.setItem(key, value));
      resolve();
    });
  }
  function csRemove(key) {
    lsSafe(() => localStorage.removeItem(localCacheKey(key)));
    return new Promise((resolve) => {
      if (useCloudStorage()) {
        const timer = setTimeout(resolve, 5000);
        try {
          tg.CloudStorage.removeItem(key, () => { clearTimeout(timer); resolve(); });
          return;
        } catch (e) { clearTimeout(timer); }
        resolve();
        return;
      }
      lsSafe(() => localStorage.removeItem(key));
      resolve();
    });
  }

  // ==================================================================
  // ============ PLATONUS AUTH + LIVE DATA ============
  // ==================================================================

  const API_BASE = ''; // тот же origin, что и эта страница после деплоя на Vercel

  let platonusSession = null;   // заполняется асинхронно в DOMContentLoaded из CloudStorage
  let platonusStudent = null;   // заполняется асинхронно в DOMContentLoaded из CloudStorage
  let liveScheduleWeekInfo = null;
  let liveJournalData = null;
  let liveUmkdData = null;
  let scheduleLoadFailed = false;  // не удалось загрузить расписание
  let userNavigatedWeek = false;   // пользователь уже листал недели стрелками
  let liveLoadInFlight = false;    // идёт загрузка свежих данных
  let authGeneration = 0;
  let authStorageWork = Promise.resolve();
  function ensureAuthGeneration(generation) {
    if (generation !== authGeneration) throw new Error('session_changed');
  }

  // ==================================================================
  // ============ КЭШ РАСПИСАНИЯ ПО НЕДЕЛЯМ ============
  // ==================================================================
  // Раньше каждое нажатие стрелки ←/→ недели заново шло в Platonus и
  // ждало ответ — отсюда тормоза при перелистывании. Теперь: если неделя
  // уже когда-либо открывалась (в этой сессии или в прошлый визит —
  // CloudStorage), показываем её МГНОВЕННО из кэша, а свежие данные всё
  // равно тихо подгружаем в фоне и подменяем экран, если пользователь
  // всё ещё смотрит именно эту неделю.
  const weekScheduleCache = {}; // in-memory: weekKey -> { schedule, lessonTimes, weekInfo }

  function normWeekInfo(w) {
    if (!w) return w;
    const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : v; };
    return { studyYear: n(w.studyYear), term: n(w.term), week: n(w.week) };
  }

  function weekCacheKey(studyYear, term, week) {
    const sid = (platonusStudent && platonusStudent.studentID) || 'anon';
    return `${sid}-${studyYear}-${term}-${week}`;
  }

  function cacheWeekEntry(entry) {
    if (!entry || !entry.weekInfo) return;
    const key = weekCacheKey(entry.weekInfo.studyYear, entry.weekInfo.term, entry.weekInfo.week);
    weekScheduleCache[key] = entry;

    // Если это «настоящая текущая» неделя, держим её снимок актуальным.
    // Иначе список пар показывал одно, а плашка «идёт пара / без пар» — другое.
    const ew = normWeekInfo(entry.weekInfo);
    if (trueCurrentWeekInfo
      && ew.studyYear === trueCurrentWeekInfo.studyYear
      && ew.term === trueCurrentWeekInfo.term
      && ew.week === trueCurrentWeekInfo.week) {
      trueCurrentSchedule = entry.schedule;
      trueCurrentLessonTimes = entry.lessonTimes;
      updateStatusBarAndLive();
    }

    // Совсем пустую неделю на диск не пишем — чтобы случайный пустой ответ не залип.
    const hasLessons = Object.values(entry.schedule || {}).some(d => Array.isArray(d) && d.length > 0);
    if (!hasLessons) return;

    csSet(`platonus_week_${key}`, JSON.stringify(entry)).catch(() => {
      // не критично — просто не сохранится между визитами, в памяти всё равно есть
    });
  }

  async function loadPersistedWeekEntry(key) {
    try {
      const raw = await csGet(`platonus_week_${key}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function applyWeekCacheEntry(entry) {
    SCHEDULE = entry.schedule;
    LESSON_TIMES = entry.lessonTimes;
    browsedWeekInfo = normWeekInfo(entry.weekInfo);
    liveScheduleWeekInfo = {
      selectedTerm: entry.weekInfo.term,
      selectedStudyYear: entry.weekInfo.studyYear,
      selectedWeek: entry.weekInfo.week,
    };
  }

  // Чисто парсинг ответа Platonus в { schedule, lessonTimes, weekInfo },
  // без побочных эффектов — можно безопасно вызывать в фоне, не трогая то,
  // что сейчас показано на экране.
  //
  // hadExplicitOverride: true, если мы САМИ явно запросили конкретные
  // year/term/week (навигация стрелками). В этом случае Platonus корректно
  // отражает запрошенное в selectedWeek — ему и доверяем.
  // Если же запрос был БЕЗ явных параметров (первая загрузка при открытии
  // приложения), Platonus иногда возвращает в selectedWeek что-то вроде
  // заглушки (например "1"), не совпадающую с реальной текущей неделей —
  // тогда надёжнее defaultSelectedWeek/activeWeekNumber, которые не зависят
  // от того, что было запрошено, и всегда указывают на настоящую текущую
  // учебную неделю.
  function buildScheduleEntryFromPlatonus(data, hadExplicitOverride, requested) {
    const lessonHourByNumber = {};
    (data.lessonHours || []).forEach(lh => { lessonHourByNumber[lh.number] = lh; });

    const lessonTimes = {};
    (data.lessonHours || []).forEach(lh => {
      lessonTimes[String(lh.displayNumber)] = {
        start: lh.start.slice(0, 5),
        end: lh.finish.slice(0, 5),
      };
    });

    const schedule = {};
    const days = (data.timetable && data.timetable.days) || {};
    Object.keys(days).forEach(dayKey => {
      const dayName = PLT_DAY_NAMES[dayKey];
      if (!dayName) return;
      const lessonsForDay = [];
      const lessonsObj = days[dayKey].lessons || {};
      Object.keys(lessonsObj).forEach(hourNumber => {
        const slot = lessonsObj[hourNumber];
        (slot.lessons || []).forEach(lesson => {
          const hourInfo = lessonHourByNumber[lesson.number];
          const displayNumber = hourInfo ? hourInfo.displayNumber : lesson.number;
          const typeLabel = PLT_GROUP_TYPE_LABEL[lesson.groupTypeShortName] || lesson.groupTypeFullName || '';
          // Числитель/знаменатель у Platonus и в этом приложении считаются
          // в обратном порядке, поэтому 1 и 2 намеренно меняются местами.
          // 0 ("каждую неделю") остаётся без изменений.
          const rawWeekNumber = lesson.weekNumber || 0;
          const normalizedWeekType =
            rawWeekNumber === 1 ? 2 :
            rawWeekNumber === 2 ? 1 :
            rawWeekNumber;
          lessonsForDay.push({
            'пара': String(displayNumber),
            'sub': `${lesson.subjectName}${typeLabel ? ' (' + typeLabel + ')' : ''}`,
            'teacher': (lesson.tutorName || '').trim(),
            'room': `${lesson.auditory || ''}`.trim(),
            'building': `${lesson.building || ''}`.trim(),
            'type': normalizedWeekType,
          });
        });
      });
      schedule[dayName] = lessonsForDay;
    });

    let resolvedWeek;
    let resolvedTerm;
    if (hadExplicitOverride) {
      resolvedWeek = (data.selectedWeek !== undefined && data.selectedWeek !== null) ? data.selectedWeek : data.defaultSelectedWeek;
      resolvedTerm = (data.selectedTerm !== undefined && data.selectedTerm !== null) ? data.selectedTerm : data.defaultSelectedTerm;
    } else {
      resolvedWeek = (data.defaultSelectedWeek !== undefined && data.defaultSelectedWeek !== null)
        ? data.defaultSelectedWeek
        : ((data.activeWeekNumber !== undefined && data.activeWeekNumber !== null) ? data.activeWeekNumber : data.selectedWeek);
      resolvedTerm = (data.defaultSelectedTerm !== undefined && data.defaultSelectedTerm !== null)
        ? data.defaultSelectedTerm
        : ((data.activeTermNumber !== undefined && data.activeTermNumber !== null) ? data.activeTermNumber : data.selectedTerm);
    }

    // Строка "5" + 1 в JS даёт "51", а не 6 — поэтому всё приводим к числам.
    const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : v; };
    let weekInfo = {
      studyYear: toNum(data.selectedStudyYear),
      term: toNum(resolvedTerm),
      week: toNum(resolvedWeek),
    };
    // Если мы сами явно запросили неделю, ключом кэша и подписью недели
    // служит именно запрошенная, а не то, что вернул Platonus.
    if (requested) {
      weekInfo = {
        studyYear: toNum(requested.studyYear),
        term: toNum(requested.term),
        week: toNum(requested.week),
      };
    }

    return { schedule, lessonTimes, weekInfo };
  }

  // ==================================================================
  // ============ КЭШ ДАННЫХ (stale-while-revalidate) ============
  // ==================================================================
  // Расписание/оценки/УМКД кладём в то же CloudStorage, что и сессию.
  // При открытии приложения сразу рисуем то, что есть в кэше (без пустого
  // экрана/спиннера), а запрос к Platonus всё равно уходит в фоне — как
  // только пришёл свежий ответ, тихо перерисовываем поверх. Так открытие
  // ощущается мгновенным, но данные не залипают надолго устаревшими.
  const META_CACHE_KEY = 'platonus_meta_cache';
  const JOURNAL_CACHE_KEY = 'platonus_journal_cache';
  const UMKD_CACHE_KEY = 'platonus_umkd_cache';

  async function loadCachedStudentData() {
    const values = await csGetMany([META_CACHE_KEY, JOURNAL_CACHE_KEY, UMKD_CACHE_KEY]);
    const metaRaw = values[META_CACHE_KEY];
    const journalRaw = values[JOURNAL_CACHE_KEY];
    const umkdRaw = values[UMKD_CACHE_KEY];

    let meta = null;
    if (metaRaw) {
      try { meta = JSON.parse(metaRaw); } catch (e) { meta = null; }
    }
    if (!meta) return null;

    // Если кэш сохранён до начала этой календарной недели, он мог остаться
    // от прошлой учебной недели — не показываем его как «текущую».
    const weekStartMs = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return d.getTime();
    })();
    meta.browsedWeekInfo = normWeekInfo(meta.browsedWeekInfo);
    meta.trueCurrentWeekInfo = normWeekInfo(meta.trueCurrentWeekInfo);
    if (!meta.cachedAt || meta.cachedAt < weekStartMs) {
      meta.browsedWeekInfo = null;
      meta.trueCurrentWeekInfo = null;
    }

    let journal = null;
    if (journalRaw) {
      try { journal = JSON.parse(journalRaw); } catch (e) { journal = null; }
    }

    let umkd = null;
    if (umkdRaw) {
      try { umkd = JSON.parse(umkdRaw); } catch (e) { umkd = null; }
    }

    // Само расписание не дублируем в этом блоке — оно уже лежит отдельными
    // маленькими ключами в по-недельном кэше (platonus_week_<year>-<term>-<week>),
    // просто достаём нужные недели оттуда.
    let scheduleEntry = null;
    let trueCurrentEntry = null;
    if (meta.browsedWeekInfo) {
      const key = weekCacheKey(meta.browsedWeekInfo.studyYear, meta.browsedWeekInfo.term, meta.browsedWeekInfo.week);
      scheduleEntry = weekScheduleCache[key] || await loadPersistedWeekEntry(key);
      if (scheduleEntry) weekScheduleCache[key] = scheduleEntry;
    }
    if (meta.trueCurrentWeekInfo) {
      const key = weekCacheKey(meta.trueCurrentWeekInfo.studyYear, meta.trueCurrentWeekInfo.term, meta.trueCurrentWeekInfo.week);
      trueCurrentEntry = weekScheduleCache[key] || await loadPersistedWeekEntry(key);
    }

    return { meta, journal, umkd, scheduleEntry, trueCurrentEntry };
  }

  function applyCachedStudentData(cache) {
    if (!cache || !cache.meta) return;
    const meta = cache.meta;

    if (meta.student) platonusStudent = meta.student;
    if (meta.scheduleWeekInfo) liveScheduleWeekInfo = meta.scheduleWeekInfo;
    if (meta.browsedWeekInfo) browsedWeekInfo = meta.browsedWeekInfo;
    if (meta.trueCurrentWeekInfo) trueCurrentWeekInfo = meta.trueCurrentWeekInfo;

    if (cache.journal !== undefined) liveJournalData = cache.journal;
    if (cache.umkd !== undefined) liveUmkdData = cache.umkd;

    if (cache.scheduleEntry && browsedWeekInfo) {
      SCHEDULE = cache.scheduleEntry.schedule;
      LESSON_TIMES = cache.scheduleEntry.lessonTimes;
      const key = weekCacheKey(browsedWeekInfo.studyYear, browsedWeekInfo.term, browsedWeekInfo.week);
      weekScheduleCache[key] = cache.scheduleEntry;
    }
    if (cache.trueCurrentEntry && trueCurrentWeekInfo) {
      trueCurrentSchedule = cache.trueCurrentEntry.schedule;
      trueCurrentLessonTimes = cache.trueCurrentEntry.lessonTimes;
      const key = weekCacheKey(trueCurrentWeekInfo.studyYear, trueCurrentWeekInfo.term, trueCurrentWeekInfo.week);
      weekScheduleCache[key] = cache.trueCurrentEntry;
    }

    updateWeekStepperUI();
  }

  async function saveCachedStudentData() {
    if (!platonusSession) return;
    const generation = authGeneration;
    // Разбито на несколько маленьких ключей вместо одного большого блока:
    // у Telegram CloudStorage жёсткий лимит в 4096 символов на значение,
    // а расписание+журнал+УМКД+дубликат "истинной текущей" недели в одном
    // JSON легко превышали этот лимит — csSet тихо падал, и кэш никогда
    // не сохранялся. Расписание отдельно уже кэшируется по неделям через
    // cacheWeekEntry(), поэтому здесь его не дублируем.
    const metaPayload = {
      student: platonusStudent,
      scheduleWeekInfo: liveScheduleWeekInfo,
      browsedWeekInfo: browsedWeekInfo,
      trueCurrentWeekInfo: trueCurrentWeekInfo,
      cachedAt: Date.now(),
    };

    try {
      await csSet(META_CACHE_KEY, JSON.stringify(metaPayload));
    } catch (e) {
      // не критично — просто не закэшируется в этот раз, попробуем в следующий
    }
    if (generation !== authGeneration) return;
    try {
      await csSet(JOURNAL_CACHE_KEY, JSON.stringify(liveJournalData ?? null));
    } catch (e) {
      // не критично
    }
    if (generation !== authGeneration) return;
    try {
      await csSet(UMKD_CACHE_KEY, JSON.stringify(liveUmkdData ?? null));
    } catch (e) {
      // не критично
    }
  }

  let loginHideTimer = null;
  function showLoginOverlay(show) {
    const el = document.getElementById('loginOverlay');
    clearTimeout(loginHideTimer);
    loginHideTimer = null;
    document.body.classList.toggle('login-screen', show);
    el.setAttribute('aria-hidden', String(!show));
    if (show) {
      el.style.display = 'flex';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
      loginHideTimer = setTimeout(() => {
        if (el.classList.contains('hidden')) el.style.display = 'none';
        loginHideTimer = null;
      }, 260);
      requestAnimationFrame(() => {
        initIndicatorsNoAnim();
        initTabIndicatorNoAnim();
      });
    }
  }

  function setLoginError(msg) {
    const el = document.getElementById('loginError');
    if (!msg) {
      el.classList.remove('visible');
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.classList.add('visible');
  }

  const EYE_ICON_OPEN = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_ICON_CLOSED = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

  function togglePasswordVisibility() {
    haptic('light');
    const input = document.getElementById('passwordInput');
    const btn = document.getElementById('passwordToggleBtn');
    const icon = document.getElementById('passwordEyeIcon');
    const nowVisible = input.type === 'password';
    input.type = nowVisible ? 'text' : 'password';
    icon.innerHTML = nowVisible ? EYE_ICON_CLOSED : EYE_ICON_OPEN;
    btn.classList.toggle('visible', nowVisible);
    btn.setAttribute('aria-label', nowVisible ? 'Скрыть пароль' : 'Показать пароль');
  }

  async function submitLogin() {
    const login = document.getElementById('loginInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const btn = document.getElementById('loginSubmitBtn');
    if (btn.disabled) return;
    const generation = authGeneration;
    let loginCompleted = false;
    setLoginError(null);

    if (!login || !password) {
      setLoginError('Введите логин и пароль.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Входим…';

    try {
      await authStorageWork;
      if (generation !== authGeneration) return;
      const resp = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const data = await resp.json();
      if (generation !== authGeneration) return;

      if (!resp.ok || !data.ok) {
        if (data.error === 'invalid_credentials') {
          setLoginError('Неверный логин или пароль.');
        } else if (data.error === 'platonus_unreachable') {
          setLoginError('Platonus сейчас недоступен. Попробуйте позже.');
        } else {
          setLoginError('Не удалось войти. Попробуйте ещё раз.');
        }
        btn.disabled = false;
        btn.textContent = 'Войти';
        return;
      }

      authGeneration++;
      loginCompleted = true;
      platonusSession = data.session;
      authStorageWork = Promise.all([
        csSet('platonus_session', platonusSession),
        csSet('platonus_login', login),
        csSet('platonus_password', password),
      ]);
      document.getElementById('passwordInput').value = '';

      showLoginOverlay(false);
      loadLiveStudentData(); // грузим в фоне, экран не блокируем
    } catch (err) {
      if (generation === authGeneration) setLoginError('Ошибка сети. Проверьте подключение и попробуйте снова.');
    } finally {
      if (generation === authGeneration || (loginCompleted && generation + 1 === authGeneration)) {
        btn.disabled = false;
        btn.textContent = 'Войти';
      }
    }
  }

  // Спрашиваем подтверждение перед выходом — используем нативный диалог
  // Telegram (выглядит как системный, а не как обычный alert), а вне
  // Telegram (или если showConfirm недоступен) — обычный confirm().
  function confirmLogout() {
    haptic('light');
    const message = 'Вы уверены, что хотите выйти из аккаунта?';
    if (tg && tg.showConfirm) {
      tg.showConfirm(message, (confirmed) => {
        if (confirmed) logout();
      });
    } else if (window.confirm(message)) {
      logout();
    }
  }

  function logout() {
    haptic('medium');
    authGeneration++;
    reloginInFlight = null;
    const keys = ['platonus_session', 'platonus_student', 'platonus_login', 'platonus_password',
      META_CACHE_KEY, JOURNAL_CACHE_KEY, UMKD_CACHE_KEY];
    // Clear display data immediately; finish earlier credential writes before deletion.
    keys.forEach(key => {
      lsSafe(() => localStorage.removeItem(localCacheKey(key)));
      if (!useCloudStorage()) lsSafe(() => localStorage.removeItem(key));
    });
    const chatLogout = window.univerChat ? window.univerChat.logout() : Promise.resolve();
    authStorageWork = Promise.all([
      authStorageWork.catch(() => {}).then(() => Promise.all(keys.map(csRemove))), chatLogout,
    ]);
    platonusSession = null;
    platonusStudent = null;
    liveJournalData = null;
    liveUmkdData = null;
    browsedWeekInfo = null;
    trueCurrentWeekInfo = null;
    trueCurrentSchedule = {};
    trueCurrentLessonTimes = {};
    SCHEDULE = {};
    LESSON_TIMES = {};
    liveScheduleWeekInfo = null;
    userNavigatedWeek = false;
    scheduleLoadFailed = false;
    liveLoadInFlight = false;
    weekStepBusy = false;
    selectedUmkdSubject = null;
    lastRenderedScreenKey = '';
    document.getElementById('cityModal').classList.remove('active');
    document.getElementById('accentModal').classList.remove('active');
    closeUmkdFile();
    document.querySelectorAll('.content-hidden').forEach(el => el.classList.remove('content-hidden'));
    document.getElementById('passwordInput').value = '';
    document.getElementById('passwordInput').type = 'password';
    document.getElementById('passwordToggleBtn').classList.remove('visible');
    document.getElementById('passwordToggleBtn').setAttribute('aria-label', 'Показать пароль');
    document.getElementById('passwordEyeIcon').innerHTML = EYE_ICON_OPEN;
    document.getElementById('loginSubmitBtn').disabled = false;
    document.getElementById('loginSubmitBtn').textContent = 'Войти';
    setLoginError(null);
    Object.keys(weekScheduleCache).forEach(k => delete weekScheduleCache[k]);
    switchSection('schedule');
    showLoginOverlay(true);
    updateWeekStepperUI();
  }

  let reloginInFlight = null;
  function silentRelogin() {
    if (!reloginInFlight) {
      const request = performSilentRelogin().finally(() => {
        if (reloginInFlight === request) reloginInFlight = null;
      });
      reloginInFlight = request;
    }
    return reloginInFlight;
  }
  async function performSilentRelogin() {
    const generation = authGeneration;
    await authStorageWork;
    if (generation !== authGeneration) return false;
    const credentials = await csGetMany(['platonus_login', 'platonus_password']);
    if (generation !== authGeneration) return false;
    const login = credentials.platonus_login;
    const password = credentials.platonus_password;
    if (!login || !password) return false;

    try {
      const resp = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      const data = await resp.json();
      if (generation !== authGeneration) return false;
      if (!resp.ok || !data.ok) return false;

      platonusSession = data.session;
      authStorageWork = csSet('platonus_session', platonusSession);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function platonusFetch(path) {
    if (!platonusSession) throw new Error('no_session');
    const generation = authGeneration;
    const requestSession = platonusSession;
    let resp = await fetch(`${API_BASE}${path}`, {
      headers: { 'x-session': requestSession },
      cache: 'no-store',
    });

    ensureAuthGeneration(generation);
    if (resp.status === 401) {
      const relogged = platonusSession !== requestSession || await silentRelogin();
      ensureAuthGeneration(generation);
      if (relogged) {
        resp = await fetch(`${API_BASE}${path}`, {
          headers: { 'x-session': platonusSession },
          cache: 'no-store',
        });
      } else {
        logout();
        throw new Error('session_expired');
      }
    }
    ensureAuthGeneration(generation);
    if (!resp.ok) {
      let detail = '';
      try {
        const body = await resp.json();
        detail = [body.error, body.platonusStatus, body.detail].filter(Boolean).join(' | ');
      } catch (e) {
        // тело не JSON или уже прочитано — оставляем detail пустым
      }
      throw new Error(detail ? `request_failed: ${detail}` : 'request_failed');
    }
    const data = await resp.json();
    ensureAuthGeneration(generation);
    return data;
  }

  const PLT_DAY_NAMES = { 1: 'Понедельник', 2: 'Вторник', 3: 'Среда', 4: 'Четверг', 5: 'Пятница', 6: 'Суббота' };
  const PLT_GROUP_TYPE_LABEL = { 'Л': 'Лекция', 'ЛЗ': 'Лаб. работа', 'СПЗ': 'Семинар', 'П': 'Практика' };

  function transformPlatonusSchedule(data, hadExplicitOverride, requested) {
    const entry = buildScheduleEntryFromPlatonus(data, hadExplicitOverride, requested);
    applyWeekCacheEntry(entry);
    cacheWeekEntry(entry);
  }

  // Раскладка показателей: 3 колонки × 2 строки
  //   Ср.тек.1 | Ср.тек.2 | Рейтинг
  //   РК 1     | РК 2     | Экз.
  function orderGradeMetrics(metrics) {
    const slots = [null, null, null, null, null, null];
    const extras = [];

    const slotFor = (name) => {
      const n = (name || '').toLowerCase().replace(/[\s.]/g, '');
      if (/^срт?е?к?.*1$/.test(n) && n.startsWith('ср')) return 0;
      if (/^срт?е?к?.*2$/.test(n) && n.startsWith('ср')) return 1;
      if (n.includes('рейтинг')) return 2;
      if (n.startsWith('рк') && n.endsWith('1')) return 3;
      if (n.startsWith('рк') && n.endsWith('2')) return 4;
      if (n.startsWith('экз')) return 5;
      if (n.startsWith('курс')) return 5;
      return -1;
    };

    // «Экз.» обрабатываем первым, чтобы он занял место раньше «Курс.р.»
    const sorted = [...metrics].sort((a, b) => {
      const isExam = (m) => (m.name || '').toLowerCase().startsWith('экз') ? 0 : 1;
      return isExam(a) - isExam(b);
    });

    sorted.forEach(m => {
      const idx = slotFor(m.name);
      if (idx !== -1 && slots[idx] === null) slots[idx] = m;
      else extras.push(m);
    });

    return { slots, extras };
  }

  // Строит HTML одной карточки оценки по предмету: кольцо-процент (как на
  // сайте Platonus, тем же цветом что прислал сервер) + сетка показателей
  // (Ср.тек./РК/Рейтинг/Экз. и т.п.) — компактно, без кода группы в
  // названии, чтобы не мешал глазу.
  function buildGradeCardHtml(subj, index) {
    const cleanTitle = (subj.subjectName || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || subj.subjectName || '';
    const percent = Math.max(0, Math.min(100, parseFloat(subj.centerMark) || 0));
    const ringColor = subj.color || 'var(--accent)';
    const r = 22;
    const circumference = 2 * Math.PI * r;
    const dash = (percent / 100) * circumference;

    const metrics = (subj.exams || []).filter(e => e && e.name);
    const { slots, extras } = orderGradeMetrics(metrics);

    const metricHtml = (e) => e
      ? `<div class="grade-metric">
           <span class="grade-metric-value">${e.mark ?? '—'}</span>
           <span class="grade-metric-label">${e.name}</span>
         </div>`
      : `<div class="grade-metric"></div>`; // пустая ячейка, чтобы колонки не съезжали

    const metricsHtml = slots.map(metricHtml).join('') + extras.map(metricHtml).join('');

    return `
      <div class="grade-card row-enter" style="animation-delay:${Math.min(index, 8) * 0.04}s;">
        <div class="grade-title">${cleanTitle}</div>
        <div class="grade-tutor">${subj.tutorList || ''}</div>
        <div class="grade-body">
          <div class="grade-ring-wrap">
            <svg viewBox="0 0 54 54">
              <circle class="grade-ring-bg" cx="27" cy="27" r="${r}"></circle>
              <circle class="grade-ring-fg" cx="27" cy="27" r="${r}" stroke="${ringColor}" stroke-dasharray="${dash} ${circumference}"></circle>
            </svg>
            <div class="grade-ring-value">${percent % 1 === 0 ? percent : percent.toFixed(1)}%</div>
          </div>
          <div class="grade-metrics-grid">${metricsHtml}</div>
        </div>
      </div>
    `;
  }

  function renderProfile(animate = true) {
    const container = document.getElementById('profileContainer');
    if (!platonusStudent) {
      swapContent(container, `
        <span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">Профиль</span>
        <div class="notice-panel">
          <div class="notice-title">Вы не вошли в аккаунт</div>
          <div class="notice-hint">Войдите с логином и паролем от Platonus, чтобы увидеть профиль.</div>
        </div>
      `, animate);
      return;
    }

    const s = platonusStudent;
    const initials = (s.studentName || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

    const html = `
      <span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">Профиль</span>
      <div class="profile-header">
        <div class="profile-avatar">${initials || '?'}</div>
        <div class="profile-header-info">
          <div class="profile-name">${s.studentName || 'Студент'}</div>
          <div class="profile-id">ID: ${s.studentID ?? '—'}</div>
        </div>
      </div>

      <div class="gpa-card">
        <div class="gpa-row"><span class="gpa-label">Академический GPA</span><span class="gpa-value accent">${s.academicGpa ?? '—'}</span></div>
        <div class="gpa-row"><span class="gpa-label">Научный GPA</span><span class="gpa-value">${s.scientificGpa ?? '—'}</span></div>
        <div class="gpa-row"><span class="gpa-label">Социальный GPA</span><span class="gpa-value">${s.socialGpa ?? '—'}</span></div>
        <div class="gpa-row"><span class="gpa-label">Интегральный GPA</span><span class="gpa-value">${s.integralGpa ?? '—'}</span></div>
      </div>

      <button class="profile-logout-btn" onclick="confirmLogout()">Выйти из аккаунта</button>
    `;

    swapContent(container, html, animate);
  }

  function renderGrades(animate = true) {
    const container = document.getElementById('gradesContainer');
    if (!platonusStudent) {
      swapContent(container, `
        <span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">Оценки</span>
        <div class="notice-panel">
          <div class="notice-title">Вы не вошли в аккаунт</div>
          <div class="notice-hint">Войдите с логином и паролем от Platonus, чтобы увидеть оценки.</div>
        </div>
      `, animate);
      return;
    }

    let html = `<span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">Оценки</span>`;

    if (liveJournalData && Array.isArray(liveJournalData)) {
      html += liveJournalData.map((subj, index) => buildGradeCardHtml(subj, index)).join('');
    } else {
      html += '<div class="notice-panel"><div class="notice-hint">Оценки по предметам загружаются…</div></div>';
    }

    swapContent(container, html, animate);
  }

  function renderCurrentSection() {
    if (currentSection === 'profile') renderProfile(false);
    else if (currentSection === 'grades') renderGrades(false);
    else if (currentSection === 'schedule') renderSchedule(false);
    else if (currentSection === 'umkd') renderUmkdSubjects(false);
  }

  function retryLiveLoad() {
    haptic('light');
    scheduleLoadFailed = false;
    renderSchedule(false);
    updateStatusBarAndLive();
    loadLiveStudentData();
  }

  // Оценки и УМКД не зависят друг от друга — грузим одновременно.
  // Если запрос не удался, возвращаем null, и старые (кэшированные) данные остаются.
  function fetchGradesAndUmkd(year, term) {
    const studentID = platonusStudent && platonusStudent.studentID;
    return Promise.all([
      studentID
        ? platonusFetch(`/api/grades?studentID=${studentID}&year=${year}&term=${term}`).catch(() => null)
        : Promise.resolve(null),
      platonusFetch(`/api/umkd?year=${year}&term=${term}`).catch(() => null),
    ]).then(([journal, umkd]) => ({ journal, umkd }));
  }

  async function loadLiveStudentData() {
    if (liveLoadInFlight) return;
    const generation = authGeneration;
    liveLoadInFlight = true;
    scheduleLoadFailed = false;

    try {
      // Если с прошлого раза известны студент и семестр, всё стартует сразу
      // и параллельно, а не по цепочке «профиль → расписание → оценки → УМКД».
      const cachedID = platonusStudent && platonusStudent.studentID;
      const ci = liveScheduleWeekInfo;
      const cachedKey = (ci && ci.selectedStudyYear && ci.selectedTerm)
        ? `${ci.selectedStudyYear}-${ci.selectedTerm}` : null;
      const earlyExtras = (cachedID && cachedKey)
        ? fetchGradesAndUmkd(ci.selectedStudyYear, ci.selectedTerm) : null;
      // Cached semester data can refresh grades/UMKD before a slow schedule returns.
      if (earlyExtras) earlyExtras.then(extras => {
        if (generation !== authGeneration) return;
        const info = liveScheduleWeekInfo;
        if (!info || `${info.selectedStudyYear}-${info.selectedTerm}` !== cachedKey) return;
        if (extras.journal) liveJournalData = extras.journal;
        if (extras.umkd) liveUmkdData = extras.umkd;
        if (currentSection === 'grades' || currentSection === 'umkd') renderCurrentSection();
        saveCachedStudentData();
      }).catch(() => {});

      const gpaPromise = platonusFetch('/api/gpa').then(gpa => {
        ensureAuthGeneration(generation);
        platonusStudent = gpa;
        csSet('platonus_student', JSON.stringify(gpa));
        if (currentSection === 'profile') renderProfile(false);
        return gpa;
      });
      const schedPromise = (cachedID ? Promise.resolve(cachedID) : gpaPromise.then(g => g.studentID))
        .then(id => {
          ensureAuthGeneration(generation);
          return platonusFetch(`/api/schedule?studentID=${id}`);
        });
      schedPromise.catch(() => {}); // чтобы не было «unhandled rejection», если профиль не загрузится

      // A slow profile refresh must not delay the schedule when studentID is cached.
      gpaPromise.catch(err => {
        if (generation === authGeneration && err.message !== 'session_expired') console.error('Failed to load GPA/profile', err);
      });

      // 2) Расписание — показываем сразу, не дожидаясь оценок и УМКД
      try {
        const schedule = await schedPromise;
        if (generation !== authGeneration) return;
        let entry = buildScheduleEntryFromPlatonus(schedule, false);

        // Без явной недели Platonus может вернуть расписание другой недели
        // (в selectedWeek бывает заглушка), хотя «текущей» назвал шестую.
        // Если данные не подтверждают друг друга, перезапрашиваем явно.
        const w = normWeekInfo(entry.weekInfo);
        const trusted = Number(schedule.selectedWeek) === w.week
          && Number(schedule.selectedTerm) === w.term
          && Number(schedule.selectedStudyYear) === w.studyYear;
        if (!trusted) {
          const explicit = await platonusFetch(
            `/api/schedule?studentID=${cachedID || platonusStudent.studentID}&year=${w.studyYear}&term=${w.term}&week=${w.week}`
          );
          if (generation !== authGeneration) return;
          entry = buildScheduleEntryFromPlatonus(explicit, true, w);
        }

        trueCurrentWeekInfo = { ...normWeekInfo(entry.weekInfo) };
        cacheWeekEntry(entry);

        // Это и есть «настоящая текущая» неделя (Platonus сам её выбрал).
        // Запоминаем отдельным снимком, он не затрётся при листании стрелками.
        trueCurrentSchedule = entry.schedule;
        trueCurrentLessonTimes = entry.lessonTimes;

        if (!userNavigatedWeek) {
          applyWeekCacheEntry(entry);
        } else {
          // Пользователь уже ушёл на другую неделю — экран не трогаем.
          liveScheduleWeekInfo = {
            selectedTerm: entry.weekInfo.term,
            selectedStudyYear: entry.weekInfo.studyYear,
            selectedWeek: entry.weekInfo.week,
          };
        }
      } catch (err) {
        if (generation !== authGeneration) return;
        console.error('Failed to load/parse schedule', err);
        if (!browsedWeekInfo) scheduleLoadFailed = true;
      }

      detectToday();
      updateStatusBarAndLive();
      updateWeekStepperUI();
      renderCurrentSection();
      saveCachedStudentData();

      // 3) Оценки и УМКД
      const info = liveScheduleWeekInfo;
      if (info && info.selectedStudyYear && info.selectedTerm) {
        const key = `${info.selectedStudyYear}-${info.selectedTerm}`;
        const extras = (earlyExtras && cachedKey === key)
          ? await earlyExtras
          : await fetchGradesAndUmkd(info.selectedStudyYear, info.selectedTerm);
        if (generation !== authGeneration) return;
        if (extras.journal) liveJournalData = extras.journal;
        if (extras.umkd) liveUmkdData = extras.umkd;
      } else {
        // Год/семестр не определились — пробуем УМКД с текущим годом как запасной вариант.
        const u = await platonusFetch(`/api/umkd?year=${new Date().getFullYear()}&term=1`).catch(() => null);
        if (generation !== authGeneration) return;
        if (u) liveUmkdData = u;
      }

      renderCurrentSection();
      saveCachedStudentData();
    } finally {
      if (generation === authGeneration) liveLoadInFlight = false;
    }
  }

  const CITY_COORDS = {
    'Актау':            { lat: 43.6481, lon: 51.1801 },
    'Актобе':           { lat: 50.2839, lon: 57.2094 },
    'Алматы':           { lat: 43.2220, lon: 76.8512 },
    'Астана':           { lat: 51.1605, lon: 71.4704 },
    'Атырау':           { lat: 47.1164, lon: 51.8792 },
    'Жезказган':        { lat: 47.7838, lon: 67.7128 },
    'Караганда':        { lat: 49.8047, lon: 73.1094 },
    'Кокшетау':         { lat: 53.2833, lon: 69.4167 },
    'Костанай':         { lat: 53.2144, lon: 63.6246 },
    'Конаев':           { lat: 43.8567, lon: 77.0667 },
    'Кызылорда':        { lat: 44.8479, lon: 65.4999 },
    'Павлодар':         { lat: 52.2873, lon: 76.9674 },
    'Петропавловск':    { lat: 54.8667, lon: 69.1500 },
    'Семей':            { lat: 50.4111, lon: 80.2275 },
    'Талдыкорган':      { lat: 45.0167, lon: 78.3667 },
    'Тараз':            { lat: 42.9000, lon: 71.3667 },
    'Туркестан':        { lat: 43.3000, lon: 68.2667 },
    'Уральск':          { lat: 51.2333, lon: 51.3667 },
    'Усть-Каменогорск': { lat: 49.9483, lon: 82.6275 },
    'Шымкент':          { lat: 42.3000, lon: 69.6000 },
    'Ұлытау':           { lat: 48.5667, lon: 67.0333 }
  };

  async function fetchWeather(location, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,weather_code`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error('bad status ' + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function weatherEmoji(code) {
    if (code === 0) return '☀';
    if (code >= 1 && code <= 3) return '⛅';
    if (code >= 45 && code <= 48) return '≈';
    if (code >= 51 && code <= 67) return '☂';
    if (code >= 71 && code <= 77) return '❄';
    if (code >= 80 && code <= 82) return '☔';
    if (code >= 95) return '⚡';
    return '—';
  }

  function weatherDescription(code) {
    const map = {
      0: 'Ясно', 1: 'Малооблачно', 2: 'Облачно с прояснениями', 3: 'Пасмурно',
      45: 'Туман', 48: 'Изморозь',
      51: 'Морось', 53: 'Морось', 55: 'Морось',
      61: 'Дождь', 63: 'Дождь', 65: 'Сильный дождь',
      71: 'Снег', 73: 'Снег', 75: 'Сильный снегопад',
      80: 'Ливень', 81: 'Ливень', 82: 'Сильный ливень',
      95: 'Гроза'
    };
    return map[code] || 'Погода';
  }

  async function fetchDayWeatherDetails(location, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('bad status ' + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  let dayOffWeatherCache = { city: null, data: null, timestamp: 0 };

  function renderDayOffWeatherHtml(data) {
    const target = document.getElementById('dayOffWeatherDetail');
    if (!target) return;
    const cur = data.current;
    const emoji = weatherEmoji(cur.weather_code);
    const desc = weatherDescription(cur.weather_code);
    const temp = Math.round(cur.temperature_2m);
    const feels = Math.round(cur.apparent_temperature);
    const humidity = Math.round(cur.relative_humidity_2m);
    const wind = Math.round(cur.wind_speed_10m);
    const hasDaily = data.daily && data.daily.temperature_2m_max && data.daily.temperature_2m_min;
    const tMax = hasDaily ? Math.round(data.daily.temperature_2m_max[0]) : null;
    const tMin = hasDaily ? Math.round(data.daily.temperature_2m_min[0]) : null;
    const rangeHtml = (tMax !== null && tMin !== null)
      ? `<span>${tMin > 0 ? '+' + tMin : tMin}° / ${tMax > 0 ? '+' + tMax : tMax}°</span>`
      : '';
    target.innerHTML = `
      <div class="day-off-weather-main">
        <span class="day-off-weather-emoji">${emoji}</span>
        <span class="day-off-weather-temp">${temp > 0 ? '+' + temp : temp}°C</span>
        <span class="day-off-weather-desc">${desc}</span>
      </div>
      <div class="day-off-weather-details">
        <span>ощущается как ${feels > 0 ? '+' + feels : feels}°</span>
        ${rangeHtml}
        <span>влажность ${humidity}%</span>
        <span>ветер ${wind} км/ч</span>
      </div>
    `;
  }

  async function fillDayOffWeather() {
    const el = document.getElementById('dayOffWeatherDetail');
    if (!el) return;
    let savedCity = localStorage.getItem('user_city');
    if (!savedCity || !CITY_COORDS[savedCity]) savedCity = 'Караганда';

    const cacheFresh = dayOffWeatherCache.city === savedCity
      && (Date.now() - dayOffWeatherCache.timestamp) < 5 * 60 * 1000;
    if (cacheFresh) {
      renderDayOffWeatherHtml(dayOffWeatherCache.data);
      return;
    }

    try {
      const data = await fetchDayWeatherDetails(CITY_COORDS[savedCity]);
      dayOffWeatherCache = { city: savedCity, data, timestamp: Date.now() };
      renderDayOffWeatherHtml(data);
    } catch (e) {
      const stillThere = document.getElementById('dayOffWeatherDetail');
      if (stillThere) stillThere.innerHTML = 'не удалось загрузить погоду';
    }
  }

  async function loadWeather(isRetry) {
    const weatherEl = document.getElementById('weatherWidget');
    let savedCity = localStorage.getItem('user_city');
    if (!savedCity || !CITY_COORDS[savedCity]) {
      savedCity = 'Караганда';
      localStorage.setItem('user_city', savedCity);
    }

    if (!isRetry) weatherEl.innerHTML = savedCity + ' · …';
    const location = CITY_COORDS[savedCity];

    try {
      const data = await fetchWeather(location);
      const temp = Math.round(data.current.temperature_2m);
      weatherEl.innerHTML = `${savedCity} · ${temp > 0 ? '+' + temp : temp}°`;
    } catch (e) {
      if (!isRetry) {
        setTimeout(() => loadWeather(true), 4000);
        weatherEl.innerHTML = savedCity + ' · …';
      } else {
        weatherEl.innerHTML = savedCity + ' · —°';
      }
    }
  }

  let pendingCity = 'Караганда';

  function renderCityList(filterText = '') {
    const list = document.getElementById('cityList');
    if (!list) return;
    const query = filterText.trim().toLowerCase();
    const names = Object.keys(CITY_COORDS).filter(name =>
      !query || name.toLowerCase().includes(query)
    );

    if (names.length === 0) {
      list.innerHTML = '<div class="city-list-empty">город не найден</div>';
      return;
    }

    list.innerHTML = names.map(name => `
      <div class="city-list-item${name === pendingCity ? ' selected' : ''}" onclick="selectCityListItem('${name.replace(/'/g, "\\'")}')">
        ${name}
      </div>
    `).join('');
  }

  function filterCityList(value) { renderCityList(value); }

  function selectCityListItem(name) {
    haptic('light');
    pendingCity = name;
    renderCityList(document.getElementById('citySearchInput').value);
  }

  // Блокировка прокрутки фона, пока открыто модальное окно — иначе на
  // мобильных (особенно в Telegram WebView) свайп внутри списка городов
  // прокручивает страницу ПОД модалкой, а не сам список.
  let bodyScrollLockY = 0;
  function lockBodyScroll() {
    bodyScrollLockY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${bodyScrollLockY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
  }
  function unlockBodyScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    window.scrollTo(0, bodyScrollLockY);
  }

  function openCityModal() {
    haptic('light');
    const modal = document.getElementById('cityModal');
    const searchInput = document.getElementById('citySearchInput');
    pendingCity = localStorage.getItem('user_city') || 'Караганда';
    searchInput.value = '';
    renderCityList('');
    modal.classList.add('active');
    lockBodyScroll();
  }

  function closeCityModal() {
    haptic('light');
    document.getElementById('cityModal').classList.remove('active');
    unlockBodyScroll();
  }

  function saveCityAndLoad() {
    if (pendingCity && CITY_COORDS[pendingCity]) {
      haptic('medium');
      localStorage.setItem('user_city', pendingCity);
      closeCityModal();
      loadWeather();
    }
  }

  const ACCENT_THEMES = [
    { id: 'default', name: 'Стандартный', hex: '#9EBAC4', text: '#20353C' },
    { id: 'lime', name: 'Лайм', hex: '#A3E635', text: '#1F2937' },
    { id: 'emerald', name: 'Изумруд', hex: '#065F46', text: '#FFFFFF' },
    { id: 'burgundy', name: 'Бургунди', hex: '#7F1D1D', text: '#FFFFFF' },
    { id: 'coral', name: 'Коралл', hex: '#FF7F50', text: '#FFFFFF' },
    { id: 'plum', name: 'Слива', hex: '#6D28D9', text: '#FFFFFF' },
    { id: 'terracotta', name: 'Терракота', hex: '#C2410C', text: '#FFFFFF' }
  ];
  const ACCENT_CSS_PROPS = ['--accent', '--accent-text', '--accent-rgb', '--highlight-border', '--highlight-bg', '--progress-bg', '--accent-tint-strong', '--accent-tint-soft', '--accent-day', '--accent-night', '--background-tint-rgb', '--flame-start', '--flame-end', '--flame-ink'];
  let currentAccentId = 'default';
  let pendingAccentId = 'default';
  let accentBeforePreview = 'default';

  function accentGradientText(r, g, b) {
    const luminance = channels => channels.map(value => {
      const srgb = value / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const start = luminance([r, g, b]);
    const end = luminance([r, g, b].map(value => Math.round(value + (255 - value) * 0.08)));
    const dark = luminance([23, 32, 39]);
    const darkContrast = (Math.min(start, end) + 0.05) / (dark + 0.05);
    const lightContrast = 1.05 / (Math.max(start, end) + 0.05);
    return darkContrast >= lightContrast ? '#172027' : '#FFFFFF';
  }

  function hexToRgbTriple(hex) {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  }

  function applyAccentTheme(id, persist = true) {
    const root = document.documentElement.style;
    if (id === 'default') {
      ACCENT_CSS_PROPS.forEach(prop => root.removeProperty(prop));
    } else {
      const theme = ACCENT_THEMES.find(t => t.id === id);
      if (!theme) return;
      const { r, g, b } = hexToRgbTriple(theme.hex);
      const rgbStr = `${r}, ${g}, ${b}`;
      const mix = (amount, target) => `rgb(${[r, g, b].map(value => Math.round(value + (target - value) * amount)).join(', ')})`;
      root.setProperty('--accent-day', mix(0.45, 0));
      root.setProperty('--accent-night', mix(0.55, 255));
      root.setProperty('--accent', 'var(--selected-accent)');
      root.setProperty('--accent-text', 'var(--selected-accent-text)');
      root.setProperty('--accent-rgb', rgbStr);
      root.setProperty('--background-tint-rgb', rgbStr);
      root.setProperty('--flame-start', theme.hex);
      root.setProperty('--flame-end', mix(0.08, 255));
      root.setProperty('--flame-ink', accentGradientText(r, g, b));
      root.setProperty('--highlight-border', 'var(--accent)');
      root.setProperty('--highlight-bg', `rgba(${rgbStr}, 0.08)`);
      root.setProperty('--progress-bg', `var(--line)`);
      root.setProperty('--accent-tint-strong', `rgba(${rgbStr}, 0.16)`);
      root.setProperty('--accent-tint-soft', `rgba(${rgbStr}, 0.06)`);
    }
    currentAccentId = id;
    if (persist) localStorage.setItem('user_accent', id);
  }

  function renderAccentSwatches() {
    const grid = document.getElementById('accentSwatchGrid');
    if (!grid) return;
    const colorThemes = ACCENT_THEMES.filter(t => t.id !== 'default');
    grid.innerHTML = colorThemes.map(t => `
      <button class="accent-swatch${t.id === pendingAccentId ? ' selected' : ''}" style="background:${t.hex}; color:${t.text};" onclick="selectAccentSwatch('${t.id}')">
        <span class="accent-swatch-check">✓</span>
        <span class="accent-swatch-label">${t.name}</span>
        <span class="accent-swatch-hex">${t.hex}</span>
      </button>
    `).join('');

    const defaultBtn = document.getElementById('accentDefaultBtn');
    if (defaultBtn) defaultBtn.classList.toggle('selected', pendingAccentId === 'default');
  }

  function selectAccentSwatch(id) {
    haptic('light');
    pendingAccentId = id;
    applyAccentTheme(id, false);
    renderAccentSwatches();
  }

  function saveAccentTheme() {
    haptic('medium');
    applyAccentTheme(pendingAccentId);
    accentBeforePreview = pendingAccentId;
    closeAccentModal();
  }

  function openAccentModal() {
    haptic('light');
    accentBeforePreview = currentAccentId;
    pendingAccentId = currentAccentId;
    renderAccentSwatches();
    document.getElementById('accentModal').classList.add('active');
    lockBodyScroll();
  }

  function closeAccentModal() {
    haptic('light');
    applyAccentTheme(accentBeforePreview, false);
    document.getElementById('accentModal').classList.remove('active');
    unlockBodyScroll();
  }

  function openPdf(title, url) {
    haptic('light');
    if (tg && tg.openLink) {
      tg.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  }

  function swapContent(container, html, animate = true, onInserted) {
    const generation = authGeneration;
    if (!animate) {
      container.innerHTML = html;
      if (onInserted) onInserted();
      return;
    }
    container.classList.add('content-hidden');
    setTimeout(() => {
      if (generation !== authGeneration) return;
      container.innerHTML = html;
      requestAnimationFrame(() => container.classList.remove('content-hidden'));
      if (onInserted) onInserted();
    }, 140);
  }

  function updateDayIndicator() {
    const activeBtn = document.querySelector('.day-btn.active');
    const indicator = document.getElementById('dayIndicator');
    const daysGrid = document.getElementById('daysGrid');
    if (activeBtn && indicator && daysGrid.style.display !== 'none') {
      indicator.style.width = activeBtn.offsetWidth + 'px';
      indicator.style.height = activeBtn.offsetHeight + 'px';
      indicator.style.transform = `translateX(${activeBtn.offsetLeft - 3}px)`;
      indicator.style.opacity = '1';
    } else if (indicator) {
      indicator.style.opacity = '0';
    }
  }

  function initIndicatorsNoAnim() {
    const dayIndicator = document.getElementById('dayIndicator');
    dayIndicator.style.transition = 'none';
    updateDayIndicator();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        dayIndicator.style.transition = '';
      });
    });
  }

  function updateTabIndicator() {
    const active = document.querySelector('.bottom-tab-btn.active');
    const ind = document.getElementById('tabIndicator');
    if (!active || !ind) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.height = active.offsetHeight + 'px';
    ind.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    ind.style.opacity = '1';
  }

  function initTabIndicatorNoAnim() {
    const ind = document.getElementById('tabIndicator');
    if (!ind) return;
    ind.style.transition = 'none';
    updateTabIndicator();
    requestAnimationFrame(() => requestAnimationFrame(() => { ind.style.transition = ''; }));
  }

  window.addEventListener('resize', () => {
    updateDayIndicator();
    updateTabIndicator();
  });

  let SCHEDULE = {};

  let LESSON_TIMES = {
    '1': { start: '09:00', end: '10:45' },
    '2': { start: '10:55', end: '12:40' },
    '3': { start: '13:10', end: '14:55' },
    '4': { start: '15:05', end: '16:50' },
    '5': { start: '17:00', end: '18:45' }
  };

  function getTime(paraNum) {
    const t = LESSON_TIMES[paraNum];
    return t ? `${t.start}–${t.end}` : 'время неизвестно';
  }

  function timeToMins(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function dayHasClasses(dayName) {
    return Array.isArray(SCHEDULE[dayName]) && SCHEDULE[dayName].length > 0;
  }

  const WEEKDAY_ORDER = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  // Platonus присылает корпус и номер аудитории отдельными полями
  // (building/auditory) — склеиваем их для отображения в одном месте.
  function formatRoomLabel(item) {
    if (!item) return '';
    const room = item.room || '';
    const building = item.building || '';
    if (building && room) return `${building}, ауд. ${room}`;
    if (building) return building;
    if (room) return `ауд. ${room}`;
    return '';
  }

  // Раньше эта подсказка бегала по календарю вперёд на несколько дней,
  // угадывая тип недели (числитель/знаменатель) через getWeekType(). Теперь
  // мы вообще не храним чужие недели локально — SCHEDULE содержит только ту
  // неделю, что реально запрошена у Platonus, поэтому подсказка ищет
  // ближайшую пару просто среди оставшихся дней ЭТОЙ ЖЕ загруженной недели.
  function getUpcomingHintInLoadedWeek(afterDayName) {
    const startIdx = WEEKDAY_ORDER.indexOf(afterDayName);
    for (let idx = startIdx + 1; idx < WEEKDAY_ORDER.length; idx++) {
      const dayName = WEEKDAY_ORDER[idx];
      const lessons = (SCHEDULE[dayName] || [])
        .slice()
        .sort((a, b) => parseInt(a.пара, 10) - parseInt(b.пара, 10));
      if (lessons.length > 0) {
        const first = lessons[0];
        const t = LESSON_TIMES[first.пара];
        const timeStr = t ? t.start : '?';
        const shortDay = getShortDayName(dayName) || dayName;
        return `<strong>${first.sub}</strong> — ${shortDay}, ${timeStr}, ${formatRoomLabel(first)}`;
      }
    }
    return 'на этой неделе пар больше нет — глянь следующую неделю стрелкой сверху';
  }

  function weatherSkeletonHtml() {
    return `
      <div class="weather-skeleton">
        <div class="weather-skeleton-row">
          <div class="weather-skeleton-block" style="width:60px; height:24px;"></div>
          <div class="weather-skeleton-block" style="width:90px; height:18px;"></div>
        </div>
        <div class="weather-skeleton-row">
          <div class="weather-skeleton-block" style="width:100px; height:12px;"></div>
          <div class="weather-skeleton-block" style="width:60px; height:12px;"></div>
        </div>
      </div>
    `;
  }

  function buildDayOffScreen(dayName, animateEntrance = true) {
    const hint = getUpcomingHintInLoadedWeek(dayName);
    const isActuallyToday = dayName === realTodayName && isViewingTrueCurrentWeek();
    const title = isActuallyToday ? 'Сегодня без пар' : `${dayName}: пар нет`;
    return `
      <div class="notice-panel">
        <span class="notice-eyebrow">выходной</span>
        <div class="notice-title">${title}</div>
        <div class="day-off-weather" id="dayOffWeatherDetail">${weatherSkeletonHtml()}</div>
        <div class="notice-divider"></div>
        <div class="notice-hint">
          <span class="notice-hint-label">ближайшая пара</span>
          ${hint}
        </div>
      </div>
    `;
  }

  function buildDayFinishedScreen(dayName, animateEntrance = true) {
    const hint = getUpcomingHintInLoadedWeek(dayName);
    return `
      <div class="notice-panel">
        <span class="notice-eyebrow">на сегодня всё</span>
        <div class="notice-title">${dayName}: пары закончились</div>
        <div class="day-off-weather" id="dayOffWeatherDetail">${weatherSkeletonHtml()}</div>
        <div class="notice-divider"></div>
        <div class="notice-hint">
          <span class="notice-hint-label">ближайшая пара</span>
          ${hint}
        </div>
      </div>
    `;
  }

  function getDayLastLessonEndMins(dayName) {
    const lessons = SCHEDULE[dayName] || [];
    let maxEnd = null;
    lessons.forEach(l => {
      const t = LESSON_TIMES[l.пара];
      if (t) {
        const endMins = timeToMins(t.end);
        if (maxEnd === null || endMins > maxEnd) maxEnd = endMins;
      }
    });
    return maxEnd;
  }

  let currentSection = 'schedule';
  let selectedDay = 'Понедельник';
  let selectedUmkdSubject = null;
  let realTodayName = 'Понедельник';

  // Неделя, которую пользователь сейчас просматривает (то, что реально
  // загружено в SCHEDULE прямо сейчас) — обновляется стрелками ←/→.
  let browsedWeekInfo = null; // { studyYear, term, week } — week как прислал Platonus
  // Настоящая текущая неделя по Platonus, зафиксированная один раз при
  // входе — по ней решаем, можно ли показывать "идёт пара сейчас" и когда
  // показывать кнопку "сегодня".
  let trueCurrentWeekInfo = null;
  let trueCurrentSchedule = {};
  let trueCurrentLessonTimes = {};

  function isViewingTrueCurrentWeek() {
    return !!(browsedWeekInfo && trueCurrentWeekInfo &&
      browsedWeekInfo.studyYear === trueCurrentWeekInfo.studyYear &&
      browsedWeekInfo.term === trueCurrentWeekInfo.term &&
      browsedWeekInfo.week === trueCurrentWeekInfo.week);
  }


  const DAY_NAMES_BY_INDEX = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  function detectToday(resetSelected = false) {
    realTodayName = DAY_NAMES_BY_INDEX[new Date().getDay()];
    if (resetSelected) selectedDay = realTodayName;

    const shortName = getShortDayName(realTodayName);
    if (shortName) {
      const todayBtnEl = document.getElementById(`btn-${shortName}`);
      if (todayBtnEl) todayBtnEl.classList.add('is-today');
    }
    updateWeekendBadge();
  }

  let weekendBadgeHideTimer = null;

  function updateWeekendBadge() {
    const badge = document.getElementById('weekendBadge');
    if (!badge) return;
    const hasOwnButton = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'].includes(realTodayName);
    const shouldShow = !hasOwnButton;

    if (weekendBadgeHideTimer) {
      clearTimeout(weekendBadgeHideTimer);
      weekendBadgeHideTimer = null;
    }

    if (shouldShow) {
      if (badge.style.display !== 'block') {
        badge.style.display = 'block';
        void badge.offsetWidth;
      }
      badge.classList.add('active');
      requestAnimationFrame(updateDayIndicator);
    } else {
      badge.classList.remove('active');
      weekendBadgeHideTimer = setTimeout(() => {
        badge.style.display = 'none';
        weekendBadgeHideTimer = null;
        updateDayIndicator();
      }, 220);
    }
  }

  function getShortDayName(fullDay) {
    const shortNames = {
      'Понедельник': 'ПН', 'Вторник': 'ВТ', 'Среда': 'СР', 'Четверг': 'ЧТ',
      'Пятница': 'ПТ', 'Суббота': 'СБ', 'Воскресенье': 'ВС'
    };
    return shortNames[fullDay] || null;
  }

  // В семестре Platonus обычно 15 недель (как в выпадающем списке "НЕДЕЛИ"
  // на самом сайте) — используем как верхнюю границу для стрелок.
  const MAX_TERM_WEEKS = 15;

  let weekStepBusy = false;

  // Показываем номер недели как есть — он уже 1-в-1 совпадает с тем, что
  // показывает выпадающий список "НЕДЕЛИ" на platonus.kstu.kz.
  function updateWeekStepperUI() {
    const label = document.getElementById('weekStepLabel');
    const prevBtn = document.getElementById('weekPrevBtn');
    const nextBtn = document.getElementById('weekNextBtn');
    if (!label) return;

    if (browsedWeekInfo && browsedWeekInfo.week !== undefined && browsedWeekInfo.week !== null) {
      const displayWeek = browsedWeekInfo.week;
      label.textContent = `Неделя ${displayWeek}`;
      label.classList.toggle('is-current', isViewingTrueCurrentWeek());
      if (prevBtn) prevBtn.disabled = weekStepBusy || displayWeek <= 1;
      if (nextBtn) nextBtn.disabled = weekStepBusy || displayWeek >= MAX_TERM_WEEKS;
    } else {
      label.textContent = 'Неделя —';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    }
  }

  // Тихо обновляет неделю в фоне (без спиннера): если пользователь всё ещё
  // смотрит именно эту неделю к моменту ответа — подменяет экран свежими
  // данными; если он уже успел уйти на другую неделю — просто обновляет кэш
  // про запас и ничего на экране не трогает.
  async function refreshWeekInBackground(studyYear, term, week) {
    const generation = authGeneration;
    try {
      const data = await platonusFetch(
        `/api/schedule?studentID=${platonusStudent.studentID}&year=${studyYear}&term=${term}&week=${week}`
      );
      if (generation !== authGeneration) return;
      const entry = buildScheduleEntryFromPlatonus(data, true, { studyYear, term, week });
      cacheWeekEntry(entry);

      const stillViewingThisWeek = browsedWeekInfo
        && browsedWeekInfo.studyYear === studyYear
        && browsedWeekInfo.term === term
        && browsedWeekInfo.week === week;

      if (stillViewingThisWeek) {
        applyWeekCacheEntry(entry);
        detectToday();
        updateStatusBarAndLive();
        updateWeekStepperUI();
        renderSchedule(false);
      }
      saveCachedStudentData();
    } catch (e) {
      // тихо игнорируем — у пользователя и так уже показана кэшированная неделя
    }
  }

  // Стрелки ←/→: сначала смотрим, нет ли этой недели уже в кэше (память,
  // затем CloudStorage) — если есть, показываем МГНОВЕННО без ожидания сети,
  // а свежую версию всё равно тихо подгружаем и подменяем в фоне. Сетевой
  // спиннер показываем, только если недели вообще нигде нет в кэше.
  async function stepWeek(delta) {
    if (weekStepBusy || !browsedWeekInfo || !platonusStudent) return;
    const generation = authGeneration;
    const nextWeekRaw = Number(browsedWeekInfo.week) + delta;
    if (nextWeekRaw < 1 || nextWeekRaw > MAX_TERM_WEEKS) return;

    haptic('light');
    userNavigatedWeek = true;
    const studyYear = browsedWeekInfo.studyYear;
    const term = browsedWeekInfo.term;
    const key = weekCacheKey(studyYear, term, nextWeekRaw);

    const memCached = weekScheduleCache[key];
    if (memCached) {
      applyWeekCacheEntry(memCached);
      detectToday();
      updateStatusBarAndLive();
      updateWeekStepperUI();
      renderSchedule();
      refreshWeekInBackground(studyYear, term, nextWeekRaw);
      return;
    }

    const persisted = await loadPersistedWeekEntry(key);
    if (generation !== authGeneration) return;
    if (persisted) {
      weekScheduleCache[key] = persisted;
      applyWeekCacheEntry(persisted);
      detectToday();
      updateStatusBarAndLive();
      updateWeekStepperUI();
      renderSchedule();
      refreshWeekInBackground(studyYear, term, nextWeekRaw);
      return;
    }

    weekStepBusy = true;
    updateWeekStepperUI();

    try {
      const data = await platonusFetch(
        `/api/schedule?studentID=${platonusStudent.studentID}&year=${studyYear}&term=${term}&week=${nextWeekRaw}`
      );
      if (generation !== authGeneration) return;
      transformPlatonusSchedule(data, true, { studyYear, term, week: nextWeekRaw });
      detectToday();
      updateStatusBarAndLive();
      renderSchedule();
      saveCachedStudentData();
    } catch (err) {
      console.error('Failed to load week', err);
    } finally {
      if (generation === authGeneration) {
        weekStepBusy = false;
        updateWeekStepperUI();
      }
    }
  }

  function updateStatusBarAndLive() {
    const statusText = document.getElementById('weekStatusText');
    const badgeEl = document.getElementById('liveLessonBadge');
    const todayBtn = document.getElementById('todayBtn');

    const viewingTrueCurrent = isViewingTrueCurrentWeek();
    const isTodaySelected = selectedDay === realTodayName && viewingTrueCurrent;
    todayBtn.style.display = isTodaySelected ? 'none' : 'flex';

    statusText.innerHTML = `<span class="masthead-eyebrow">${isTodaySelected ? 'Сегодня' : ''}</span><span class="masthead-headline">${selectedDay}</span>`;

    // "Идёт пара сейчас" всегда считаем по настоящей текущей неделе
    // (trueCurrentSchedule), а не по той, что сейчас просматривается
    // стрелками — иначе бейдж наврёт, если пользователь ушёл смотреть
    // другую неделю.
    if (!trueCurrentWeekInfo && platonusSession) {
      badgeEl.innerHTML = `<span class="live-dot"></span><span>${scheduleLoadFailed ? 'расписание недоступно' : 'загружаем расписание…'}</span>`;
      badgeEl.classList.remove('pulse-live');
      return;
    }

    // Когда открыта текущая неделя, плашка считается по ТЕМ ЖЕ данным, что и список
    // пар ниже (иначе они могут разойтись). На другой неделе берём снимок текущей.
    const liveSrc = isViewingTrueCurrentWeek()
      ? { schedule: SCHEDULE, times: LESSON_TIMES }
      : { schedule: trueCurrentSchedule, times: trueCurrentLessonTimes };
    const timeOf = (para) => liveSrc.times[para] || LESSON_TIMES[para];

    const todayLessons = liveSrc.schedule[realTodayName] || [];
    if (todayLessons.length === 0) {
      badgeEl.innerHTML = `<span class="live-dot"></span><span>сегодня без пар</span>`;
      badgeEl.classList.remove('pulse-live');
      return;
    }

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    let currentParaNum = null;
    let nextParaInfo = null;

    for (const item of todayLessons) {
      const t = timeOf(item.пара);
      if (!t) continue;
      const startMins = timeToMins(t.start);
      const endMins = timeToMins(t.end);

      if (currentMins >= startMins && currentMins <= endMins) {
        currentParaNum = item.пара;
        break;
      } else if (currentMins < startMins) {
        if (!nextParaInfo) nextParaInfo = { num: item.пара, start: t.start };
      }
    }

    if (currentParaNum) {
      const t = timeOf(currentParaNum);
      const endMins = timeToMins(t.end);
      const leftMins = endMins - currentMins;
      badgeEl.innerHTML = `<span class="live-dot"></span><span>идёт пара №${currentParaNum} — ещё ${leftMins} мин</span>`;
    } else if (nextParaInfo) {
      badgeEl.innerHTML = `<span class="live-dot"></span><span>далее — пара №${nextParaInfo.num} в ${nextParaInfo.start}</span>`;
    } else {
      badgeEl.innerHTML = `<span class="live-dot"></span><span>пары на сегодня закончены</span>`;
    }
    badgeEl.classList.toggle('pulse-live', !!currentParaNum);
  }

  function jumpToToday() {
    haptic('light');
    if (currentSection !== 'schedule') switchSection('schedule');
    if (trueCurrentWeekInfo && !isViewingTrueCurrentWeek()) {
      SCHEDULE = trueCurrentSchedule;
      LESSON_TIMES = trueCurrentLessonTimes;
      browsedWeekInfo = { ...trueCurrentWeekInfo };
      updateWeekStepperUI();
    }
    selectDay(realTodayName, null, true);
  }

  let lastStudySection = 'grades';
  function switchStudySection() { switchSection(lastStudySection); }

  function switchSection(section) {
    if (section === currentSection) return;
    haptic('light');
    currentSection = section;
    if (window.univerChat) window.univerChat.onSection(section);

    document.querySelectorAll('.bottom-tab-btn').forEach(btn => btn.classList.remove('active'));
    const studying = ['grades', 'umkd', 'exams'].includes(section);
    if (studying) lastStudySection = section;
    const activeBtn = document.getElementById(`section-${studying ? 'grades' : section}`);
    activeBtn.classList.add('active');
    document.querySelectorAll('[data-study-section]').forEach(button => {
      const active = button.dataset.studySection === section;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    updateTabIndicator();

    // Небольшой "bounce" залитой иконки при активации вкладки (как в TikTok).
    const filledIcon = activeBtn.querySelector('.icon-filled');
    if (filledIcon) {
      filledIcon.classList.remove('pop');
      // Форсируем reflow, чтобы анимация перезапустилась даже если класс
      // уже был на этом элементе (быстрые повторные переключения).
      void filledIcon.offsetWidth;
      filledIcon.classList.add('pop');
    }

    document.getElementById('sectionSchedule').style.display = section === 'schedule' ? 'block' : 'none';
    document.getElementById('sectionUmkd').style.display = section === 'umkd' ? 'block' : 'none';
    document.getElementById('sectionExams').style.display = section === 'exams' ? 'block' : 'none';
    document.getElementById('sectionGrades').style.display = section === 'grades' ? 'block' : 'none';
    document.getElementById('sectionProfile').style.display = section === 'profile' ? 'block' : 'none';
    document.getElementById('sectionChat').style.display = section === 'chat' ? 'block' : 'none';

    if (section === 'schedule') {
      renderSchedule(false);
      updateStatusBarAndLive();
      requestAnimationFrame(() => requestAnimationFrame(updateDayIndicator));
    } else if (section === 'umkd') {
      renderUmkdSubjects();
    } else if (section === 'exams') {
      renderExams();
    } else if (section === 'grades') {
      renderGrades();
    } else if (section === 'profile') {
      renderProfile();
    }
  }

  function selectDay(dayName, btnElement, force = false) {
    if (!force && dayName === selectedDay) return;
    if (!force) haptic('light');
    selectedDay = dayName;
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) {
      btnElement.classList.add('active');
    } else {
      const shortName = getShortDayName(dayName);
      const targetBtn = shortName ? document.getElementById(`btn-${shortName}`) : null;
      if (targetBtn) targetBtn.classList.add('active');
    }
    updateDayIndicator();
    renderSchedule();
    updateStatusBarAndLive();
  }

  let lastRenderedScreenKey = '';

  function renderSchedule(animate = true) {
    const container = document.getElementById('scheduleContainer');

    // Пока расписание не пришло, не показываем «пар нет» — это было бы неправдой.
    if (!browsedWeekInfo && platonusSession) {
      swapContent(container, `
        <div class="notice-panel">
          <div class="notice-title">${scheduleLoadFailed ? 'Не удалось загрузить расписание' : 'Загружаем расписание…'}</div>
          <div class="notice-hint">${scheduleLoadFailed
            ? '<button class="back-link" onclick="retryLiveLoad()">Повторить</button>'
            : 'Обычно это занимает несколько секунд.'}</div>
        </div>
      `, animate);
      return;
    }

    // Никакой фильтрации по числителю/знаменателю — SCHEDULE уже содержит
    // ровно то, что Platonus прислал для запрошенной недели.
    const lessons = (SCHEDULE[selectedDay] || [])
      .slice()
      .sort((a, b) => parseInt(a.пара, 10) - parseInt(b.пара, 10));

    const weekKey = browsedWeekInfo ? `${browsedWeekInfo.studyYear}-${browsedWeekInfo.term}-${browsedWeekInfo.week}` : 'no-week';
    const isViewingLiveToday = isViewingTrueCurrentWeek() && selectedDay === realTodayName;

    if (isViewingLiveToday && lessons.length > 0) {
      const lastEndMins = getDayLastLessonEndMins(selectedDay);
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      if (lastEndMins !== null && nowMins > lastEndMins + 30) {
        const screenKey = `${selectedDay}|${weekKey}|finished`;
        const animateEntrance = screenKey !== lastRenderedScreenKey;
        lastRenderedScreenKey = screenKey;
        const html = buildDayFinishedScreen(selectedDay, animateEntrance);
        swapContent(container, html, animate, fillDayOffWeather);
        return;
      }
    }

    if (lessons.length === 0) {
      const screenKey = `${selectedDay}|${weekKey}|off`;
      const animateEntrance = screenKey !== lastRenderedScreenKey;
      lastRenderedScreenKey = screenKey;
      const html = buildDayOffScreen(selectedDay, animateEntrance);
      swapContent(container, html, animate, fillDayOffWeather);
      return;
    }

    const screenKey = `${selectedDay}|${weekKey}|schedule`;
    const animateCardsEntrance = screenKey !== lastRenderedScreenKey;
    lastRenderedScreenKey = screenKey;

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    let activeParaNow = null;
    let progressPercent = 0;

    const showLiveProgress = isViewingLiveToday;
    if (showLiveProgress) {
      for (const item of lessons) {
        const t = LESSON_TIMES[item.пара];
        if (t) {
          const startMins = timeToMins(t.start);
          const endMins = timeToMins(t.end);
          if (currentMins >= startMins && currentMins <= endMins) {
            activeParaNow = item.пара;
            const totalDuration = endMins - startMins;
            const elapsed = currentMins - startMins;
            progressPercent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
            break;
          }
        }
      }
    }

    let rowsHtml = '';
    lessons.forEach((item, index) => {
      const isActive = (item.пара === activeParaNow);
      let rowClass = isActive ? 'list-row is-live' : 'list-row';
      let rowStyle = '';
      if (animateCardsEntrance) {
        rowClass += ' row-enter';
        rowStyle = ` style="animation-delay: ${Math.min(index, 6) * 0.05}s;"`;
      }

      let progressBarHtml = '';
      if (isActive) {
        progressBarHtml = `
          <div class="lesson-progress-container">
            <div class="lesson-progress-bar" style="width: ${progressPercent}%"></div>
          </div>
        `;
      }

      const t = LESSON_TIMES[item.пара];
      const startTime = t ? t.start : '?';
      const endTime = t ? t.end : '?';

      rowsHtml += `
        <div class="${rowClass}"${rowStyle}>
          ${isActive ? '<span class="lesson-live-aura" aria-hidden="true"></span><span class="lesson-live-orbit" aria-hidden="true"></span>' : ''}
          <div class="row-index">
            <span class="row-index-main">${startTime}</span>
            <span class="row-index-sub">${endTime}</span>
          </div>
          <div class="row-body">
            <div class="row-top">
              <span class="row-title">${item.sub}</span>
              ${isActive ? '<span class="live-tag"><span class="live-dot pulse-live-tag"></span>сейчас</span>' : ''}
            </div>
            <div class="row-meta">${item.teacher}</div>
            <div class="row-meta row-meta-room">${formatRoomLabel(item)}</div>
            ${progressBarHtml}
          </div>
        </div>
      `;
    });
    const html = `<div class="list-card">${rowsHtml}</div>`;
    swapContent(container, html, animate);
  }

  function renderUmkdSubjects(animate = true) {
    const container = document.getElementById('umkdContainer');

    if (!liveUmkdData || !Array.isArray(liveUmkdData.records) || liveUmkdData.records.length === 0) {
      swapContent(container, `
        <span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">УМКД</span>
        <div class="notice-panel">
          <div class="notice-title">Список пока пуст</div>
          <div class="notice-hint">Войдите в аккаунт, чтобы увидеть дисциплины текущего семестра.</div>
        </div>
      `, animate);
      return;
    }

    let itemsHtml = '';
    liveUmkdData.records.forEach((rec, index) => {
      itemsHtml += `
        <div class="umkd-subject-row row-enter" style="animation-delay:${Math.min(index, 8) * 0.04}s;" onclick="selectUmkdSubject(${index})">
          <span>${rec.subjectName}</span>
          <span class="umkd-arrow">›</span>
        </div>
      `;
    });

    swapContent(container, `
      <span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">УМКД</span>
      <div class="list-card">${itemsHtml}</div>
    `, animate);
  }

  // Стандартные типы документов УМКД в Platonus — те же 4 категории и те
  // же fileTypeID видны для любой дисциплины (проверено напрямую через
  // /rest/student/umkd/<id>/ru), поэтому просто фиксируем их здесь.
  const UMKD_FILE_TYPES = [
    { id: 131, label: 'Силлабус (рабочая учебная программа)' },
    { id: 133, label: 'Конспект лекций' },
    { id: 134, label: 'Планы семинарских/лабораторных занятий' },
    { id: 138, label: 'Материалы текущего/рубежного/итогового контроля' },
  ];

  let currentUmkdSubjectName = ''; // для имени файла при «Поделиться»

  function selectUmkdSubject(index) {
    haptic('light');
    const container = document.getElementById('umkdContainer');
    const rec = liveUmkdData && liveUmkdData.records ? liveUmkdData.records[index] : null;

    if (!rec) {
      renderUmkdSubjects();
      return;
    }

    currentUmkdSubjectName = rec.subjectName || '';

    let bodyHtml;
    if (rec.umkdID && rec.umkdID > 0) {
      bodyHtml = UMKD_FILE_TYPES.map(type => `
        <div class="umkd-item" onclick="openUmkdFile(${type.id}, ${rec.umkdID})">
          <span>${type.label}</span>
          <span class="umkd-arrow">PDF ›</span>
        </div>
      `).join('');
    } else {
      bodyHtml = '<div class="empty-state compact">файл ещё не сформирован в Platonus</div>';
    }

    swapContent(container, `
      <button class="back-link" onclick="renderUmkdSubjects()">‹ Назад к дисциплинам</button>
      <span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">УМКД</span>
      <div class="notice-title" style="margin-bottom:6px;">${rec.subjectName}</div>
      <div class="row-meta" style="margin-bottom:12px;">${rec.tutorName || ''}</div>
      <div class="list-card">${bodyHtml}</div>
    `, true);
  }

  // Раньше файл открывался через <iframe src="..."> — но встроенный
  // PDF-плагин внутри Telegram WebView часто показывает только первую
  // страницу и не даёт нормально листать/зумить. Вместо этого сами грузим
  // PDF.js (только когда реально открыли документ) и рисуем каждую
  // страницу отдельной картинкой в обычный прокручиваемый список —
  // работает одинаково надёжно везде, и обычный пинч-зум страницы
  // (см. setViewportZoomable) зумит уже сам отрендеренный документ.
  let pdfJsLoadPromise = null;
  function ensurePdfJsLoaded() {
    if (window.pdfjsLib) return Promise.resolve();
    if (pdfJsLoadPromise) return pdfJsLoadPromise;
    pdfJsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve();
      };
      script.onerror = () => reject(new Error('pdfjs_load_failed'));
      document.head.appendChild(script);
    });
    return pdfJsLoadPromise;
  }

  // Пока открыт просмотрщик PDF, разрешаем обычный пинч-зум страницы (в
  // остальном приложении зум специально выключен, чтобы не мешал тапам).
  function setViewportZoomable(zoomable) {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    meta.setAttribute('content', zoomable
      ? 'width=device-width, initial-scale=1.0, viewport-fit=cover'
      : 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  }

  // ==================================================================
  // ============ «ПОДЕЛИТЬСЯ» / СОХРАНИТЬ PDF ============
  // ==================================================================
  // Телефон: системное окно «Поделиться» (navigator.share с файлом).
  // Компьютер: диалог «Куда сохранить?» (showSaveFilePicker), а если
  // браузер его не умеет — обычное скачивание.
  let currentUmkdPdf = null; // { buffer, fileName } — последний открытый PDF
  let currentUmkdRef = null; // { fileTypeID, umkdid } — для ссылки на скачивание через сервер

  const SHARE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const DOWNLOAD_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 21h14"/></svg>';

  function isMobilePlatform() {
    const p = tg && tg.platform;
    if (p && p !== 'unknown') return ['ios', 'android', 'android_x'].includes(p);
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function buildUmkdFileName(fileTypeID) {
    const type = UMKD_FILE_TYPES.find(t => t.id === fileTypeID);
    const raw = [currentUmkdSubjectName, type ? type.label : 'УМКД'].filter(Boolean).join(' - ');
    const clean = raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    return (clean || 'umkd') + '.pdf';
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function shareUmkdFile() {
    haptic('light');
    if (!currentUmkdPdf) return;
    const { buffer, fileName } = currentUmkdPdf;
    const blob = new Blob([buffer], { type: 'application/pdf' });

    if (isMobilePlatform()) {
      const file = new File([blob], fileName, { type: 'application/pdf' });

      // 1) Системное «Поделиться», если WebView умеет отправлять файлы
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return; // человек сам закрыл окно
        }
      }

      // 2) Нативное окно Telegram для скачивания (нужна ссылка на сервер)
      if (currentUmkdRef) {
        const url = `${location.origin}${API_BASE}/api/umkd-file`
          + `?fileTypeID=${encodeURIComponent(currentUmkdRef.fileTypeID)}`
          + `&umkdid=${encodeURIComponent(currentUmkdRef.umkdid)}`
          + `&session=${encodeURIComponent(platonusSession)}`
          + `&download=1`
          + `&name=${encodeURIComponent(fileName)}`;

        if (tg && tg.downloadFile && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0')) {
          tg.downloadFile({ url, file_name: fileName });
          return;
        }
        // 3) Старый Telegram: откроем ссылку во внешнем браузере, он скачает файл
        if (tg && tg.openLink) {
          tg.openLink(url);
          return;
        }
      }
    } else if (window.showSaveFilePicker) {
      // Компьютер: диалог «Куда сохранить?»
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }

    // Запасной вариант: обычное скачивание
    downloadBlob(blob, fileName);
  }

  async function openUmkdFile(fileTypeID, umkdid) {
    haptic('light');
    if (!platonusSession) return;
    const generation = authGeneration;

    const overlay = document.getElementById('umkdFileOverlay');
    const frame = document.getElementById('umkdFileFrame');
    const shareBtn = document.getElementById('umkdShareBtn');
    frame.innerHTML = '<div class="umkd-file-status">Загрузка документа…</div>';
    overlay.classList.add('active');
    lockBodyScroll();
    setViewportZoomable(true);

    currentUmkdPdf = null;
    currentUmkdRef = { fileTypeID, umkdid };
    shareBtn.style.display = 'none';
    shareBtn.innerHTML = isMobilePlatform() ? SHARE_ICON : DOWNLOAD_ICON;

    try {
      await ensurePdfJsLoaded();
      ensureAuthGeneration(generation);
      const resp = await fetch(
        `${API_BASE}/api/umkd-file?fileTypeID=${encodeURIComponent(fileTypeID)}&umkdid=${encodeURIComponent(umkdid)}`,
        { headers: { 'x-session': platonusSession } }
      );
      if (!resp.ok) throw new Error('bad_status_' + resp.status);
      const arrayBuffer = await resp.arrayBuffer();
      ensureAuthGeneration(generation);

      // pdf.js забирает буфер себе, поэтому для «Поделиться» храним копию
      currentUmkdPdf = { buffer: arrayBuffer.slice(0), fileName: buildUmkdFileName(fileTypeID) };
      shareBtn.style.display = 'flex';

      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      ensureAuthGeneration(generation);
      frame.innerHTML = '';
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        ensureAuthGeneration(generation);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.className = 'umkd-pdf-page';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        frame.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
    } catch (err) {
      if (generation !== authGeneration) return;
      frame.innerHTML = '<div class="umkd-file-status">Не удалось загрузить документ. Попробуйте ещё раз.</div>';
    }
  }

  function closeUmkdFile() {
    haptic('light');
    const overlay = document.getElementById('umkdFileOverlay');
    const frame = document.getElementById('umkdFileFrame');
    overlay.classList.remove('active');
    frame.innerHTML = '';
    currentUmkdPdf = null;
    currentUmkdRef = null;
    document.getElementById('umkdShareBtn').style.display = 'none';
    unlockBodyScroll();
    setViewportZoomable(false);
  }


  function renderExams(animate = true) {
    const container = document.getElementById('examsContainer');
    if (!EXAMS_SCHEDULE || EXAMS_SCHEDULE.length === 0) {
      swapContent(container, `
        <span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">Экзамены</span>
        <div class="notice-panel">
          <div class="notice-title">Расписание экзаменов пока пусто</div>
          <div class="notice-hint">Как только сессия появится в системе, здесь будут даты, аудитории и преподаватели.</div>
        </div>
      `, animate);
      return;
    }

    const sorted = [...EXAMS_SCHEDULE].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    let rowsHtml = '';
    sorted.forEach((exam, index) => {
      rowsHtml += `
        <div class="list-row row-enter" style="animation-delay:${Math.min(index, 8) * 0.04}s;">
          <div class="row-index">
            <span class="row-index-main">${exam.date}</span>
            <span class="row-index-sub">${exam.time}</span>
          </div>
          <div class="row-body">
            <div class="row-top"><span class="row-title">${exam.subject}</span></div>
            <div class="row-meta">${exam.teacher || ''}<span class="meta-sep">·</span>ауд. ${exam.room || '—'}</div>
            <div class="row-tags"><span class="tag tag-fill">${exam.examType || 'Экзамен'}</span></div>
          </div>
        </div>
      `;
    });

    swapContent(container, `
      <span class="masthead-eyebrow" style="margin-bottom:10px; display:block;">Экзамены</span>
      <div class="list-card">${rowsHtml}</div>
    `, animate);
  }

  let EXAMS_SCHEDULE = [
    // { subject: 'Операционные системы', examType: 'Экзамен', date: '2026-01-12', time: '09:00', room: 'Гк423', teacher: 'Толымбекова Г. С.' },
  ];

  document.addEventListener('DOMContentLoaded', async () => {
    const generation = authGeneration;
    const savedPromise = csGetMany(['platonus_session', 'platonus_student']);

    const savedAccent = lsSafe(() => localStorage.getItem('user_accent'), null) || 'default';
    applyAccentTheme(savedAccent, false);
    detectToday(true);
    updateStatusBarAndLive();
    updateWeekStepperUI();
    selectDay(selectedDay, null, true);
    setTimeout(loadWeather, 1000);
    initIndicatorsNoAnim();
    initTabIndicatorNoAnim();

    if (document.fonts && document.fonts.ready) {
      const alignIndicators = () => {
        updateDayIndicator();
        updateTabIndicator();
      };
      document.fonts.ready.then(alignIndicators);
      document.fonts.addEventListener('loadingdone', alignIndicators);
    }

    const refreshLiveUI = () => {
      if (document.hidden || !platonusSession) return;
      detectToday();
      updateStatusBarAndLive();
      if (currentSection === 'schedule' && isViewingTrueCurrentWeek() && selectedDay === realTodayName && dayHasClasses(realTodayName)) {
        renderSchedule(false);
      }
    };
    setInterval(refreshLiveUI, 15000);
    document.addEventListener('visibilitychange', refreshLiveUI);
    window.dispatchEvent(new Event('univer-ready'));

    const saved = await savedPromise;
    if (generation !== authGeneration) return;
    platonusSession = saved.platonus_session || null;
    try { platonusStudent = JSON.parse(saved.platonus_student || 'null'); }
    catch (e) { platonusStudent = null; }

    if (platonusSession) {
      showLoginOverlay(false);
      document.getElementById('loginOverlay').style.display = 'none';

      // Сразу показываем то, что есть в кэше — без ожидания сети.
      const cachedData = await loadCachedStudentData();
      if (generation !== authGeneration) return;
      if (cachedData) {
        applyCachedStudentData(cachedData);
        detectToday(true);
        updateStatusBarAndLive();
        selectDay(selectedDay, null, true);
        if (currentSection === 'profile') {
          renderProfile(false);
        } else if (currentSection === 'grades') {
          renderGrades(false);
        } else if (currentSection === 'umkd') {
          renderUmkdSubjects(false);
        } else {
          renderSchedule(false);
        }
      }

      // Свежие данные всё равно грузим в фоне и тихо обновляем экран,
      // когда придёт ответ (см. конец loadLiveStudentData).
      loadLiveStudentData();
    } else {
      showLoginOverlay(true);
    }


  });
