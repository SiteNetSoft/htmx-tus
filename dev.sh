#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="node:22-alpine"

run() {
  podman run --rm -it \
    --userns=keep-id \
    -v "$PROJECT_DIR:/app:Z" \
    -w /app \
    "$IMAGE" \
    "$@"
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  install)
    run npm install "$@"
    ;;
  build)
    run npm run build "$@"
    ;;
  test)
    run npm test "$@"
    ;;
  test:watch)
    run npm run test:watch "$@"
    ;;
  dev)
    run npm run dev "$@"
    ;;
  lint)
    run npx eslint src/ "$@"
    ;;
  shell)
    run sh "$@"
    ;;
  npm)
    run npm "$@"
    ;;
  help)
    echo "Usage: ./dev.sh <command>"
    echo ""
    echo "Commands:"
    echo "  install       Install npm dependencies"
    echo "  build         Build dist/ bundles"
    echo "  test          Run tests once"
    echo "  test:watch    Run tests in watch mode"
    echo "  dev           Build in watch mode"
    echo "  lint          Run ESLint"
    echo "  shell         Open a shell in the container"
    echo "  npm <args>    Run arbitrary npm commands"
    ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run ./dev.sh help for usage"
    exit 1
    ;;
esac
