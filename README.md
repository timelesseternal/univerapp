# Univer KSTU

Telegram Mini App и веб-приложение для студентов: вход через Platonus, расписание, оценки, GPA, учебные материалы и личные сообщения.

## Структура

```text
univerapp/
├── index.html                # Главная страница
├── assets/                   # Ресурсы интерфейса
│   ├── css/                  # Оформление, шрифты и анимации
│   ├── js/                   # Логика интерфейса и service worker
│   ├── fonts/                # Manrope и лицензия
│   └── media/                # Видео фона
├── api/                      # Обработчики Vercel
│   └── _lib/                 # Platonus, чат и Telegram
├── supabase/migrations/      # SQL-миграции по порядку: 001 → 002 → 003
├── tests/
│   ├── ui/                   # Интерфейс и браузерная логика
│   ├── api/                  # Серверные запросы и уведомления
│   └── database/             # SQL и контроль доступа
├── scripts/                  # Проверка структуры и ресурсов
├── docs/                     # Документация
├── package.json              # Команды и зависимости
├── package-lock.json         # Зафиксированные версии зависимостей
├── vercel.json               # Настройки размещения
└── .env.example              # Пример переменных без секретов
```

## Проверка

Нужен Node.js. Из папки проекта:

```sh
npm ci
npm run check
npm test
```

`check` проверяет синтаксис JavaScript и пути к ресурсам. `test` запускает все группы тестов, включая SQL в PostgreSQL через PGlite.

## Документация

- [Размещение на Vercel](docs/deployment.md)
- [Подключение чата и профилей](docs/chat-setup.md)
- [Уведомления Telegram](docs/telegram-notifications.md)
- [Структура и особенности расписания](docs/architecture.md)
- [Разработка, кеш и проверки](docs/development.md)
- [Переписки и профили](docs/messaging.md)
- [Сессии и хранение данных](docs/security.md)

Настройки сервиса хранятся в переменных окружения Vercel. Список — в [.env.example](.env.example).
