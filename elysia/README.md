# VOT Worker

## Особенности

Рассчитан только на self-hosted, но при желание можно попытаться поставить на Render.com

## Запуск сервера

### С помощью Docker

1. Установите Docker
2. Соберите образ

```bash
docker build -t "vot-worker" .
```

3. Запустите контейнер

```bash
docker run -p 3001:3001 vot-worker
```

### Вручную

1. Установите Bun
2. Установите зависимости с помощью команды

```bash
bun install
```

3. Запустите сервер

```bash
bun start
```
