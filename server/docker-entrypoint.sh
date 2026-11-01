#!/bin/sh
# Prepares the data directory, then drops root and runs the server as the unprivileged "node" user.
set -e
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/db" "$DATA_DIR/storage" "$DATA_DIR/tmp" "$DATA_DIR/cache" "$DATA_DIR/logs" "$DATA_DIR/avatars"
if [ "$(id -u)" = "0" ]; then
  # fix ownership only where needed (bind mounts created by root on the host)
  find "$DATA_DIR" ! -user node -exec chown node:node {} + 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
