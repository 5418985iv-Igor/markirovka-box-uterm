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

## 4. Настройка HTTPS и отключение HTTP/3 (QUIC) для iPhone и мобильных сетей

Браузеры на телефонах и ПК разрешают доступ к камере (`getUserMedia`) для сканирования Data Matrix **только по HTTPS** (кроме `localhost`). Для работы на VDS обязательно поставьте перед контейнером reverse proxy с SSL-сертификатом, привязав порт контейнера только к `127.0.0.1` (в `docker-compose.yml` заменить `"${APP_PORT:-3000}:3000"` на `"127.0.0.1:${APP_PORT:-3000}:3000"`).

> **Важно:** HTTP/3 (QUIC / UDP 443) на части мобильных операторов и некоторых моделях iPhone вызывает зависание загрузки статики/CSS на белом экране. Ниже приведены конфигурации с **принудительным TCP (HTTP/1.1 и HTTP/2)** и очисткой `Alt-Svc`.

### Вариант A: Caddy (без HTTP/3 / QUIC)

```caddyfile
{
    servers {
        protocols h1 h2
    }
}

markirovka.u-term.ru {
    header Alt-Svc "clear"
    reverse_proxy 127.0.0.1:3000 {
        header_down -Alt-Svc
    }
}
```

### Вариант B: Nginx + Certbot (рекомендуется для мобильных сетей)

```nginx
server {
    listen 80;
    server_name markirovka.u-term.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name markirovka.u-term.ru;

    ssl_certificate /etc/letsencrypt/live/markirovka.u-term.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/markirovka.u-term.ru/privkey.pem;

    # Уменьшенный TLS-буфер (4k вместо 16k) помогает прохождению пакетов через мобильные туннели с низким MTU
    ssl_buffer_size 4k;

    # Отключаем переключение браузера на HTTP/3 (QUIC)
    proxy_hide_header Alt-Svc;
    add_header Alt-Svc "clear" always;

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
        proxy_buffer_size 16k;
        proxy_buffers 4 16k;
    }
}
```

После настройки Nginx выпустите сертификат:

```bash
sudo certbot --nginx -d markirovka.u-term.ru
```

## 5. Настройка сети на VDS (MTU, ICMP и порт 443/UDP)

Если `/api/health` открывается, а основная страница висит на белом экране у конкретного мобильного оператора на iPhone — чаще всего теряются пакеты больше 1280–1420 байт (HTML/CSS/TLS) или трафик уходит в заблокированный UDP 443.

1. **Включите `tcp_mtu_probing` на VDS** (чтобы ядро автоматически подбирало размер пакета при потерях ICMP):

```bash
cat <<'EOF' | sudo tee /etc/sysctl.d/99-mtu-probing.conf
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_base_mss = 1024
EOF
sudo sysctl --system
```

2. **Не блокируйте ICMP и закройте `443/udp` (QUIC):**
   - В файрволе (UFW / iptables / панели хостера) **разрешите ICMP** (в частности `Packet Too Big` / `fragmentation-needed`), иначе Path MTU Discovery не работает.
   - Закройте входящий `443/udp` (оставьте открытым только `443/tcp`).

```bash
sudo ufw allow 443/tcp
sudo ufw deny 443/udp
```

3. **Если проблема сохраняется в туннелях оператора — включите TCP MSS clamping:**

```bash
sudo iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
```

4. **Если перед VDS используется Cloudflare (проксированное облако):**
   - Выключите **HTTP/3 (with QUIC)**, **0-RTT Connection Resumption** и **Encrypted Client Hello (ECH)** в настройках Cloudflare (Network / SSL/TLS), либо переключите DNS-запись в режим **DNS only** (серое облачко) напрямую на VDS.
   - Убедитесь, что в DNS нет записи `AAAA`, если IPv6 на VDS не настроен.

## 6. Firebase

Если в дальнейшем потребуется вход через сторонние провайдеры или ограничения по доменам, добавьте ваш домен `markirovka.u-term.ru` в **Firebase Console → Authentication → Settings → Authorized domains**.

