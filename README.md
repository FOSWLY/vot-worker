# [FOSWLY] VOT Worker

VOT Worker - прокси-cервер, который служит для получения доступа к серверам перевода видео и субтитрам к видео из Яндекс API.

## 📖 Когда будет полезен VOT Worker?

1. Если у вас заблокированы сервера Яндекса
2. Если вы используете "cloudflare" версию расширения [voice-over-translation](https://github.com/ilyhalight/voice-over-translation)

## 📦 Хостинги

Ниже вы можете ознакомиться с несколькими хостингами на которые вы можете задеплоить воркер

### Deno

#### Особенности

- Сайт: [deno.com](https://deno.com)
- Цена: бесплатно
- Запросы: 1.000.000/месяц

### Render.com

#### Особенности

- Сайт: [render.com](https://render.com)
- Цена: бесплатно
- Запросы: 750 часов активности (100 GB трафика)

### Cloudflare

> [!NOTE]
> На момент написания инструкции, по неизвестной причине, запросы к cloudflare воркерам перестали проходить с российских айпи-адрессов. Рекомендую деплоить на Deno.

#### Особенности

- Сайт: [cloudflare.com](https://cloudflare.com)
- Цена: бесплатно
- Запросы: 100.000/день