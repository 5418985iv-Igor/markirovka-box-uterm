# Деплой «Ю-Терм. Маркировка» на VDS в Docker

Проект собран на Next.js (`output: "standalone"`) и подготовлен к запуску в Docker-контейнере.

## 1. Подготовка сервера (VDS)

На сервере должен быть установлен Docker Engine и Docker Compose v2:

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

## 2. Перенос проекта и настройка окружения

Скопируйте файлы проекта на VDS (через `git clone`, `scp` или `rsync`) и при необходимости создайте `.env`:

```bash
cp .env.example .env
```

При желании отредактируйте `.env`:
- `APP_PORT` — порт на хосте (по умолчанию `3000`).
- `APP_URL` — публичный HTTPS-адрес вашего домена (например, `https://mark.example.com`).

> Конфигурация Firebase клиента уже находится в `firebase-applet-config.json` и включается в сборку автоматически.

## 3. Сборка и запуск контейнера

```bash
docker compose up -d --build
```

Проверка статуса и логов:

```bash
docker compose ps
docker compose logs -f app
curl -i http://127.0.0.1:3000/api/health
```

Остановка и обновление после изменений:

```bash
docker compose down
docker compose up -d --build
```

## 4. Настройка HTTPS (обязательно для сканера камеры)

Браузеры на телефонах и ПК разрешают доступ к камере (`getUserMedia`) для сканирования Data Matrix **только по HTTPS** (кроме `localhost`). Для работы на VDS обязательно поставьте перед контейнером reverse proxy с SSL-сертификатом, привязав порт контейнера только к `127.0.0.1` (в `.env` или в `docker-compose.yml` заменить `"${APP_PORT:-3000}:3000"` на `"127.0.0.1:${APP_PORT:-3000}:3000"`).

### Вариант A: Caddy (автоматический HTTPS через Let's Encrypt)

```caddyfile
mark.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### Вариант B: Nginx + Certbot

```nginx
server {
    listen 80;
    server_name mark.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

После настройки Nginx выпустите сертификат:

```bash
sudo certbot --nginx -d mark.example.com
```

## 5. Firebase

Если в дальнейшем потребуется вход через сторонние провайдеры или ограничения по доменам, добавьте ваш домен `mark.example.com` в **Firebase Console → Authentication → Settings → Authorized domains**.
