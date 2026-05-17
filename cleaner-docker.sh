#!/bin/bash
# Docker replacement for the old PM2 cleaner.sh.
# Same behavior: zero the firehose cursor and restart the app daily.
# Install on the home lab host crontab, e.g.:
#   0 4 * * * /path/to/orkut/cleaner-docker.sh >> /var/log/orkut-cleaner.log 2>&1
set -e
cd "$(dirname "$0")"
: > ./data/cursor.txt
docker compose restart orkut
