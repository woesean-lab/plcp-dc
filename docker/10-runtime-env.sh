#!/bin/sh
set -eu

HTML_DIR="/usr/share/nginx/html"
ENV_JS="$HTML_DIR/env.js"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g; s/\n/\\n/g'
}

append_env() {
  key="$1"
  value="${2:-}"

  if [ -n "$value" ]; then
    printf 'window.__TOKENU_RUNTIME_ENV__.%s = "%s";\n' "$key" "$(json_escape "$value")" >> "$ENV_JS"
  fi
}

cat > "$ENV_JS" <<'EOF'
window.__TOKENU_RUNTIME_ENV__ = window.__TOKENU_RUNTIME_ENV__ || {};
EOF

append_env "VITE_ADMIN_USERNAME" "${VITE_ADMIN_USERNAME:-}"
append_env "VITE_ADMIN_PASSWORD" "${VITE_ADMIN_PASSWORD:-}"
append_env "VITE_TOKENU_API_BASE_URL" "${VITE_TOKENU_API_BASE_URL:-}"
append_env "VITE_TOKENU_OAUTH_API_BASE_URL" "${VITE_TOKENU_OAUTH_API_BASE_URL:-}"
