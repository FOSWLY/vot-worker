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
- Запросы: 750 часов активности (100 GB трафика)

### Cloudflare

> [!NOTE]
> Не работает с российскими айпи-адресами. Если для вас это важно, рекомендуется использовать любой другой хостинг, который доступен в России

#### Особенности

- Сайт: [cloudflare.com](https://cloudflare.com)
- Цена: бесплатно
- Запросы: 100.000/день

## 🧪 Тестирование

Сквозной smoke-тест (mock-server + worker):

```bash
cd mock-server
bun install
bun run smoke
```

Только один воркер: `bun run smoke -- --worker cloudflare` (также доступны
`elysia` и `axum`). Подробнее — [mock-server/smoke/README.md](./mock-server/smoke/README.md).
