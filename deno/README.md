# Deno Worker

## Особенности

- Цена: бесплатно
- Запросы: 1.000.000/месяц

## Запуск сервера

Ниже представлена инструкция по запуску сервера на своем компьютере или на VPS
сервере.

1. Установите [Deno Runtime](https://docs.deno.com/runtime/manual/):

   1.1. Команда для Windows:
   ```powershell
   irm https://deno.land/install.ps1 | iex
   ```
   1.2. Команда для macOS и Linux:
   ```bash
   curl -fsSL https://deno.land/x/install/install.sh | sh
   ```
2. Запустите сервер:
   ```bash
   deno run index.js
   ```
3. Разрешите серверу доступ к интернету

## Деплой на Deno Deploy

### С Github

1. Форкните этот репозиторий
2. Зайдите на [сайт](https://dash.deno.com/) и авторизуйтесь через Github
3. Создайте новый проект
4. Выберите пользователя и выберите форкнутый репозиторий
5. Запустите сервер

### С локального проекта

1. Установите [Deno Runtime](https://docs.deno.com/runtime/manual/):

   1.1. Команда для Windows:
   ```powershell
   irm https://deno.land/install.ps1 | iex
   ```
   1.2. Команда для macOS и Linux:
   ```bash
   curl -fsSL https://deno.land/x/install/install.sh | sh
   ```
2. Установите deployctl:

   ```bash
   deno install -A --no-check -r -f https://deno.land/x/deploy/deployctl.ts
   ```
3. Зайдите на [сайт](https://dash.deno.com/) и авторизуйтесь через Github
4. Создайте пустой новый проект
5. Зайдите в [настройки аккаунта](https://dash.deno.com/account#access-tokens) и
   создайте Access Token
6. Установите Access Token как переменную среды:

   6.1. Команда для Windows:
   ```powershell
   $env:DENO_DEPLOY_TOKEN = 'your_access_token_here'
   ```
   6.2. Команда для macOS и Linux:
   ```bash
   export DENO_DEPLOY_TOKEN=your_access_token_here
   ```
7. Поменяйте ВАШЕ_НАЗВАНИЕ_ПРОЕКТА на ваше название название проекта из Deno
   Deploy и пропишите эту команду:
   ```
   deployctl deploy --project=ВАШЕ_НАЗВАНИЕ_ПРОЕКТА --prod server.ts
   ```
