#!/bin/bash
# Runs once, when the data directory is empty: creates the account the app signs
# in with, allowed to touch its own database and nothing else. The root account
# stays for backups and restores.
set -euo pipefail

mongo --quiet \
  -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin skycord <<EOJS
db.createUser({
  user: "$SKYCORD_DB_USER",
  pwd:  "$SKYCORD_DB_PASSWORD",
  roles: [{ role: "readWrite", db: "skycord" }],
})
EOJS
