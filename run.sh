#!/usr/bin/env bash
# One command for Codespaces / Mac / Linux: set up (first time) and start MediLink (fast mode).
# For live reload while editing code, run "pnpm dev" instead.
set -e
cd "$(dirname "$0")"
bash .devcontainer/setup.sh
pnpm start
