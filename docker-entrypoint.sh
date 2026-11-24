#!/bin/sh
# Railway mounts the volume root-owned. Fix ownership, then drop to the unprivileged `app` user.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R app:app "${DATA_DIR:-/data}"
  exec setpriv --reuid=app --regid=app --init-groups "$@"
fi
exec "$@"
