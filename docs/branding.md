# Иконка uniq.

Текущая версия — [uniq-v2-master.png](../assets/icons/uniq-v2-master.png): надпись увеличена примерно на 10%, обычные иконки имеют скруглённые прозрачные углы. Для Apple touch и Android maskable подготовлены непрозрачные варианты, углы которых обрезает система. Все текущие ссылки используют имена `uniq-v2-*`, чтобы получить новый файл вместо старой копии из кеша.

Правка сделана встроенным imagegen по исходному мастеру. Промпт правки: увеличить существующее слово `uniq.` на 10%, сохранить шрифт и цвета, добавить скруглённые углы радиусом около 23% с прозрачностью снаружи, оставить буквы в центральной безопасной области диаметром 80%.

Исходная версия и её промпт сохранены ниже.

Выбран вариант №12: полное строчное название `uniq.` светлыми буквами с сиреневой точкой на тёмном фоне. Мастер создан встроенным imagegen по выбранному пользователем варианту; окончательные размеры подготовлены из одного мастера с качественным уменьшением.

- [PNG-мастер](../assets/icons/uniq-master.png).
- [512 × 512](../assets/icons/uniq-512.png) и [192 × 192](../assets/icons/uniq-192.png) для установки.
- [Maskable 512 × 512](../assets/icons/uniq-maskable-512.png) для Android: непрозрачный фон до краёв, надпись внутри центральной безопасной области.
- [Apple touch 180 × 180](../assets/icons/uniq-apple-touch-180.png).
- [Favicon 32 × 32](../assets/icons/uniq-favicon-32.png).

Форма углов установленного приложения задаётся операционной системой; в PNG нет прозрачных углов или внешней рамки. Новые URL используются в HTML, манифесте и service worker, включая push-уведомления. Идентификатор установленного приложения остаётся `/`.

Промпт для мастера:

> Extract and faithfully recreate ONLY the app icon design numbered 12 in the provided reference contact sheet (second row, sixth column, rightmost). User chose that exact design. Output ONE production-ready square app icon master, 1024x1024 or higher. Exact text: 'uniq.' ALL LOWERCASE u n i q followed by period, with thick clean rounded geometric sans-serif letters in warm white and ONLY the final period in soft lavender #BCA7EB. Match icon 12's typography, proportions, tight spacing and restrained look exactly. Charcoal near-black solid uniform background #17171B. Flat crisp artwork, no gradients, texture, highlights or shadows. IMPORTANT FOR REAL APP USE: the charcoal background fills the entire output square edge-to-edge, including all four corners; do NOT draw a rounded square silhouette, do NOT add transparent corners, outside margins, white canvas or a surrounding frame. The OS will round the corners itself. Center the full wordmark optically in the square. Full wordmark width about 66% of canvas, height about 25%; all letters and the lavender dot fit well within the central safe area of a circle of diameter 80% of the image so Android masks will not clip them. Do not change the selected design into a q symbol or monogram. No number 12, no labels, no additional words or elements.
