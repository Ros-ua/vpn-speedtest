#!/bin/sh
# Прогон всех проб локально. Один раз перед этим:
#   npm ci && npx playwright install chromium
set -e
cd "$(dirname "$0")"
npm test
