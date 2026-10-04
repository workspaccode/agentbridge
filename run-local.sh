#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22 or newer, then run this script again.'
  exit 1
fi
exec node src/server.mjs
