#!/bin/sh
set -e

# Railway (and most volume mounts) attach persistent volumes owned by root,
# which shadows the build-time `chown -R app:app /app` on /app/data. Fix
# ownership as root here, then drop to the unprivileged app user before
# running the real command.
chown -R app:app /app/data

exec su-exec app "$@"
