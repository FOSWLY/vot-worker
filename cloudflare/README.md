# Cloudflare Worker

> [!NOTE]
> На момент написания инструкции, по неизвестной причине, запросы к cloudflare воркерам перестали проходить с российских айпи-адрессов. Рекомендую деплоить на Deno.

## Особенности

- Цена: бесплатно
- Запросы: 100.000/день

## Деплой

Видео инструкция: [**видео от mynovelhost**](https://raw.githubusercontent.com/mynovelhost/voice-over-translation/master/how_to_create_custom_worker.mp4)

Текстовая инструкция:
1. Зарегистрируйтесь в [Cloudflare Dashboard](https://dash.cloudflare.com) и войдите в панель управления
2. В большом левом меню выберите пункт "Workers & Pages"
3. Пройдите регистрацию в "Workers & Pages" выбрав Free тариф
4. Если вы всё сделаете верно, то вас перекинет на страницу, где вы сможете нажать на синюю кнопку "Create application"
5. На появившейся странице нажмите синюю кнопку "Create worker"
6. Введите желаемое название для поддомена и нажмите синюю кнопку "Deploy"
7. Если всё прошло успешно, то у вас будет на выбор две кнопки "Configure worker" и "Edit code", вам нужно выбрать "Edit code"
8. В открывшемся браузерном текстовом редакторе замените все содержимое файла worker.js на содержимое файла [CloudWorker.js](https://github.com/ilyhalight/voice-over-translation/blob/master/CloudWorker.js)
9. Сохраните код с помощью комбинации Ctrl+S и нажмите на синюю кнопку "Save and deploy"
10. Готово, теперь, вам осталось всего лишь поменять в коде "vot.toil-dump.workers.dev" на домен вашего воркера