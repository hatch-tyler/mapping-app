#!/bin/bash
set -euo pipefail

# SSL setup script for Let's Encrypt
# Run this AFTER DNS A record is pointing to this server's IP
# Usage: ./ssl-setup.sh

APP_DIR="/opt/mapping-app"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"

# Source env for domain name
set -a
source "$APP_DIR/.env"
set +a

DOMAIN="${DOMAIN_NAME}"

if [ -z "$DOMAIN" ]; then
    echo "ERROR: DOMAIN_NAME not set in .env"
    exit 1
fi

echo "=== SSL Setup for $DOMAIN ==="
echo ""

# Check DNS resolution
echo "--- Checking DNS resolution ---"
RESOLVED_IP=$(dig +short "$DOMAIN" 2>/dev/null || true)
SERVER_IP=$(curl -sf https://ifconfig.me 2>/dev/null || curl -sf https://api.ipify.org 2>/dev/null || echo "unknown")

if [ -z "$RESOLVED_IP" ]; then
    echo "WARNING: $DOMAIN does not resolve to any IP address."
    echo "Make sure the DNS A record is configured and has propagated."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
elif [ "$RESOLVED_IP" != "$SERVER_IP" ]; then
    echo "WARNING: $DOMAIN resolves to $RESOLVED_IP but this server's IP is $SERVER_IP"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "  $DOMAIN -> $RESOLVED_IP (matches this server)"
fi

# Ensure nginx is running with HTTP config
echo ""
echo "--- Ensuring nginx is running ---"
docker compose -f "$COMPOSE_FILE" up -d nginx

# Request certificate
echo ""
echo "--- Requesting Let's Encrypt certificate ---"

# Read certbot email from .env or prompt
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
if [ -z "$CERTBOT_EMAIL" ]; then
    read -p "Enter email for Let's Encrypt notifications: " CERTBOT_EMAIL
fi

docker compose -f "$COMPOSE_FILE" run --rm certbot \
    certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$CERTBOT_EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

if [ $? -ne 0 ]; then
    echo "ERROR: Certificate acquisition failed."
    echo "Check that port 80 is accessible and DNS is correctly configured."
    exit 1
fi

echo ""
echo "--- Certificate obtained successfully ---"

# Read the upload size from .env
UPLOAD_MAX="${UPLOAD_MAX_SIZE_MB:-500}"

# Switch to SSL nginx configuration
echo ""
echo "--- Switching to SSL nginx configuration ---"
cat > "$APP_DIR/nginx/nginx-active.conf" << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size ${UPLOAD_MAX}m;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;

    root /usr/share/nginx/html;
    index index.html;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location /rest {
        proxy_pass http://backend:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /health {
        proxy_pass http://backend:8000;
        proxy_set_header Host \$host;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
NGINXEOF

# Reload nginx with SSL config
echo "--- Reloading nginx ---"
docker compose -f "$COMPOSE_FILE" exec nginx nginx -s reload

# Update CORS in backend to use HTTPS
echo ""
echo "--- Updating backend CORS for HTTPS ---"
docker compose -f "$COMPOSE_FILE" restart backend

echo ""
echo "=== SSL setup complete ==="
echo ""
echo "Your application is now available at:"
echo "  https://$DOMAIN"
echo "  https://$DOMAIN/api/docs"
echo ""
echo "Certificate auto-renewal is handled by the certbot container."
echo "Test with: curl -I https://$DOMAIN"
