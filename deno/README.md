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
5. Выберите `deno/index.js` как "Entry point"

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
   deployctl deploy --project=ВАШЕ_НАЗВАНИЕ_ПРОЕКТА --prod deno/index.js
   ```

## Деплой на Render.com

1. Зайдите на [сайт](https://render.com/) и авторизуйтесь через Github
2. Создайте новый проект "Web Service"
3. Выберите "Build and deploy from a Git repository"
4. Введите ссылку на этот репозиторий или используйте свой форкнутый репозиторий
5. В "Root Directory" впишите `deno`
6. В "Build Command" введите `curl -fsSL https://deno.land/install.sh | sh`
7. В "Start command" введите `export PATH="$DENO_INSTALL/bin:$PATH" && deno run --allow-net index.js`
8. В "Instance Type" выберите тип `Free`
9. В "Environment Variables" в поле "NAME_OR_VARIABLE" введите `DENO_INSTALL`, а в поле "value" введите `/opt/render/project/.deno`
10. Нажмите "Create Web Service"