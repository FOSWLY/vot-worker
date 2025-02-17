# VOT Worker

## Особенности

1. Должен лучше справляться с высокой нагрузкой
2. Рассчитан на self-hosted

## Запуск сервера

### С помощью Docker

1. Установите Docker
2. Соберите образ

```bash
docker build -t "vot-worker" .
```

3. Запустите контейнер

```bash
docker run -p 7674:7674 vot-worker
```

### Ручная сборка и запуск

1. Установите [Rust 1.75+](https://www.rust-lang.org/learn/get-started)

   1.1. Для linux также установите:

```bash
# ubuntu / debian
sudo apt install build-essential pkg-config
```

2. (Опционально) Запуск для разработки:

   2.1. Установите `cargo watch`:

   ```bash
   cargo install cargo-watch
   ```

   2.2. Запустите live сервер:

   ```bash
   cargo watch -x run
   ```

3. Запуск для Production:

   3.1. Соберите:

   ```bash
   cargo build --release
   ```

   3.2. Запустите файл `vot-worker`:

   ```bash
   ./target/release/vot-worker
   ```
