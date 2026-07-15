#!/bin/sh
set -eu

: "${VITE_ADMIN_PASSWORD:=change-me}"

envsubst '${VITE_ADMIN_PASSWORD}' \
  < /usr/share/nginx/html/env.template.js \
  > /usr/share/nginx/html/env.js

exec nginx -g 'daemon off;'
