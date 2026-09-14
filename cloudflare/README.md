# Cloudflare Worker

> [!NOTE]
>
> > Не работает с российскими айпи-адресами. Если для вас это важно, рекомендуется использовать любой другой хостинг, который доступен в России

## Особенности

- Цена: бесплатно
- Запросы: 100.000/день

## Деплой

1. Зарегистрируйтесь в [Cloudflare Dashboard](https://dash.cloudflare.com) и войдите в панель управления
2. В большом левом меню выберите пункт "Workers & Pages"
3. Пройдите регистрацию в "Workers & Pages" выбрав Free тариф
4. Если вы всё сделаете верно, то вас перекинет на страницу, где вы сможете нажать на синюю кнопку "Create application"
5. На появившейся странице нажмите синюю кнопку "Create worker"
6. Введите желаемое название для поддомена и нажмите синюю кнопку "Deploy"
7. Если всё прошло успешно, то у вас будет на выбор две кнопки "Configure worker" и "Edit code", вам нужно выбрать "Edit code"
8. В открывшемся браузерном текстовом редакторе замените все содержимое файла worker.js на содержимое файла [CloudflareWorker.js](https://github.com/FOSWLY/vot-worker/blob/main/cloudflare/CloudflareWorker.js)
9. Сохраните код с помощью комбинации Ctrl+S и нажмите на синюю кнопку "Save and deploy"

## Локальное тестирование

Самый простой способ — прогнать воркер сквозным smoke-тестом (mock-server + Cloudflare, порт `8787`):

```bash
# из директории mock-server
bun install
bun run smoke -- --worker cloudflare
```

Для ручного запуска dev-сервера нужен Node.js (вместе с ним ставится `npx`)
Из директории `cloudflare`:

```bash
npx --yes wrangler dev --local
```

По умолчанию protobuf и fail-audio-js маршруты идут в `https://api.browser.yandex.ru`. Другой upstream задаётся переменной окружения воркера `env.YANDEX_API_URL` — например, для локального `mock-server`:

```bash
npx --yes wrangler dev --local --var YANDEX_API_URL:http://127.0.0.1:3001
```

Для проверки через smoke-тест адрес mock-server скрипт подставляет сам тем же
`--var YANDEX_API_URL:http://127.0.0.1:3001`.
