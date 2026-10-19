#!/usr/bin/env bash
# Consistent online backup of the PocketBase SQLite files. Run from cron/systemd timer as the service user.
#   0 * * * *  DATA=/var/lib/<name>/pb_data OUT=/var/backups/<name> /opt/<name>/backup.sh
# server.sh writes that cron line for each instance; the defaults below are for the default instance.
set -euo pipefail
# Start from / so a working directory the service user cannot read (for example someone's home folder)
# does not make find fail at the end and mark a good backup as failed.
cd /
DATA=${DATA:-/var/lib/round-table-net/pb_data}
OUT=${OUT:-/var/backups/round-table-net}
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$OUT"
stamp=$(date +%Y%m%d-%H%M%S)
tmp=$(mktemp -d "$OUT/.tmp.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
for db in data.db auxiliary.db; do
  [ -f "$DATA/$db" ] && sqlite3 "$DATA/$db" ".backup '$tmp/$db'"
done
[ -d "$DATA/storage" ] && cp -a "$DATA/storage" "$tmp/storage"
tar -C "$tmp" -czf "$OUT/pb-$stamp.tar.gz" .
chmod 600 "$OUT/pb-$stamp.tar.gz"
find "$OUT" -name 'pb-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup written: $OUT/pb-$stamp.tar.gz"
