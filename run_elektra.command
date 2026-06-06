#!/bin/zsh

set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

pause_if_interactive() {
  if [[ -t 0 ]]; then
    read -r "?Press Enter to close..."
  fi
}

# Optional: load environment variables (e.g., PROXY_URL) if present.
if [[ -f ".env.crawler" ]]; then
  set -a
  source ".env.crawler"
  set +a
fi

echo "Running Elektra crawler..."
if npm run crawl:elektra; then
  echo "Crawl finished."
else
  CODE=$?
  echo "Crawl failed with exit code: $CODE"
  pause_if_interactive
  exit "$CODE"
fi

pause_if_interactive
