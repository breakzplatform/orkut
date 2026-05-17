#!/bin/sh
set -e

# The app reads .env, supporters.json, cursor.txt and labels.db relative to the
# working directory. Run from /data so all mutable/secret state lives on the volume.
cd /data

if [ ! -f .env ]; then
  echo "FATAL: /data/.env missing (DID + SIGNING_KEY)." >&2
  exit 1
fi

if [ ! -f supporters.json ]; then
  echo "WARN: /data/supporters.json missing — supporters will get the random path." >&2
fi

# cursor.txt empty == start the firehose from now (same semantics as cleaner.sh).
[ -f cursor.txt ] || : > cursor.txt

exec /app/node_modules/.bin/tsx /app/src/main.ts
