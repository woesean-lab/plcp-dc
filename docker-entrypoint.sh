#!/bin/sh
set -eu

: "${VITE_ADMIN_PASSWORD:=change-me}"
: "${TOKENU_API_BASE:=https://dev.tokenu.net}"
: "${TOKENU_API_KEY:=}"

envsubst '${VITE_ADMIN_PASSWORD}' \
  < /usr/share/nginx/html/env.template.js \
  > /usr/share/nginx/html/env.js

envsubst '${TOKENU_API_BASE} ${TOKENU_API_KEY}' \
  < /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
