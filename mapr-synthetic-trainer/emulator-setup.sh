#!/usr/bin/env bash
# Starts the local Firestore Emulator for the synthetic trainer.
# Local, in memory, free; everything is erased when it stops.
# Never points at landmark-hunters-284ab: the project id below is local-only.
#
#   bash emulator-setup.sh            # start it (leave this terminal open)
#   # second terminal:
#   export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
#   npm run train                     # or: npm start (dashboard + training)
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v firebase >/dev/null 2>&1; then
  echo "Installing firebase-tools (one time)…"
  npm install -g firebase-tools
fi
if ! command -v java >/dev/null 2>&1; then
  echo "The Firestore Emulator needs Java 11+. Install a JDK first (macOS: brew install openjdk)." >&2
  exit 1
fi
exec firebase emulators:start --only firestore --project landmark-hunters-emulator --config firebase.json
