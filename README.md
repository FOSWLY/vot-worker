# [FOSWLY] VOT Worker

VOT Worker - прокси-cервер, который служит для получения доступа к серверам перевода видео и субтитрам к видео из Yandex API

## 📖 Когда будет полезен VOT Worker?

Вам нужен VOT Worker, если:

1. У вас заблокированы сервера Яндекса
2. Вам нужно легко обойти CORS

## 🧩 Реализации

- [elysia](./elysia/) — сервер на [Elysia](https://elysiajs.com) (Bun)
- [axum](./axum/) — сервер на [Axum](https://github.com/tokio-rs/axum) (Rust)
- [cloudflare](./cloudflare/) — [Cloudflare Module Worker](https://developers.cloudflare.com/workers/)

## 📦 Хостинги

Ниже вы можете ознакомиться с несколькими хостингами на которые вы можете **бесплатно** задеплоить воркер

### Render.com

#### Особенности

- Сайт: [render.com](https://render.com)
- Цена: бесплатно
- Запросы: 750 часов активности (5 GB трафика)

### Cloudflare

> [!NOTE]
> Не работает с российскими айпи-адресами. Если для вас это важно, рекомендуется использовать любой другой хостинг, который доступен в России

#### Особенности

- Сайт: [cloudflare.com](https://cloudflare.com)
- Цена: бесплатно
- Запросы: 100.000/день

## 📡 Формат запросов (wire contract)

Одинаков для всех трёх реализаций. Маршруты принимают два эквивалентных формата:

1. Бинарный: `Content-Type: application/x-protobuf`,
   1. body — исходные protobuf bytes
   2. header `X-VOT-Headers` — заголовки запроса в формате `Base64(JSON.stringify(headers))`
2. JSON (fallback для старых клиентов): `Content-Type: application/json`,
   1. body `{"headers": {...}, "body": [...]}`

- Отсутствующий/некорректный `X-VOT-Headers` — `204 X-Yandex-Status: error-request`. Неизвестный `Content-Type` — `204 error-content`, malformed JSON — `400 Bad Request`
- `PUT /video-translation/fail-audio-js` остаётся только JSON

## 🧪 Тестирование

Сквозной smoke-тест (mock-server + worker):

```bash
cd mock-server
bun install
bun run smoke
```

Только один воркер: `bun run smoke -- --worker cloudflare` (также доступны
`elysia` и `axum`). Подробнее — [mock-server/smoke/README.md](./mock-server/smoke/README.md).
