#!/usr/bin/env bash
# One command for Codespaces / Mac / Linux: set up (first time) and start MediLink.
set -e
cd "$(dirname "$0")"
bash .devcontainer/setup.sh
pnpm dev
