#!/bin/sh
set -e

# On first boot the mounted /app/output volume is empty — seed it with the demo
# program/project data baked into the image so the app opens with sample content.
# On later boots the volume already holds the user's saved work, so leave it alone.
if [ -z "$(ls -A /app/output 2>/dev/null)" ]; then
  echo "Seeding /app/output from baked-in demo data…"
  cp -a /app/output-seed/. /app/output/
fi

exec "$@"
