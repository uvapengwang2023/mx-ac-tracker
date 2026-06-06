#!/bin/zsh

set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

pause_if_interactive() {
  if [[ -t 0 ]]; then
    read -r "?Press Enter to close..."
  fi
}

create_env_from_prompt() {
  if [[ ! -t 0 ]]; then
    return 1
  fi

  echo "Proxy is required for safe mode."
  echo "Enter your proxy URL (example: http://username:password@host:port)"
  read -r "PROXY_INPUT?PROXY_URL: "

  if [[ -z "${PROXY_INPUT:-}" ]]; then
    return 1
  fi

  umask 077
  printf "PROXY_URL=%q\n" "$PROXY_INPUT" > .env.crawler
  chmod 600 .env.crawler
  return 0
}

if [[ ! -f ".env.crawler" ]]; then
  if ! create_env_from_prompt; then
    echo "Missing .env.crawler in: $SCRIPT_DIR"
    echo "Create this file with:"
    echo "PROXY_URL=http://username:password@host:port"
    pause_if_interactive
    exit 1
  fi
fi

set -a
source ".env.crawler"
set +a

if [[ -z "${PROXY_URL:-}" ]]; then
  if ! create_env_from_prompt; then
    echo "PROXY_URL is empty in .env.crawler"
    pause_if_interactive
    exit 1
  fi
  set -a
  source ".env.crawler"
  set +a
fi

echo "Running crawler..."
if npm run crawl:coppel; then
  echo "Crawl finished."
else
  CODE=$?
  echo "Crawl failed with exit code: $CODE"
  pause_if_interactive
  exit "$CODE"
fi

pause_if_interactive
