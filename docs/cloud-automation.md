# Cloud Automation For Mexico AC Competitor Tracking

This project can run the crawler stack in the cloud with GitHub Actions. The cloud job replaces the local habit of opening a VPN and double-clicking crawler scripts with a scheduled workflow that injects a proxy from GitHub Secrets.

## Recommended Setup

1. Push this project to a GitHub repository.
2. Add repository secrets:
   - `PROXY_URL`: proxy endpoint used by crawlers, for example `http://user:pass@host:port` or `socks5://host:port`.
   - `VPN_CHECK_URL`: optional health-check URL. Use a site that should only pass through the intended route, for example `https://www.homedepot.com.mx/`.
3. Open the repository's Actions tab.
4. Enable the workflow named `Cloud Daily Crawl`.
5. Run it manually once with `workflow_dispatch`.
6. After it succeeds, let the scheduled run continue daily.

## What Runs In The Cloud

The workflow runs:

```bash
npm ci
npx playwright install --with-deps chromium
npm run daily:crawl -- --sites=coppel,elektra,homedepotmx --strict-preflight
```

The daily wrapper then:

- checks target reachability through `PROXY_URL` when present;
- runs the selected crawlers in sequence;
- writes logs under `data/daily_crawls/`;
- rebuilds `web/competitor-intel-dashboard/data.js`;
- uploads run artifacts.

## Data Persistence

GitHub runners are temporary. The workflow preserves state in two ways:

- GitHub Actions cache stores the `data/` directory between runs so price history and change detection can continue.
- Workflow artifacts retain the latest crawl outputs and dashboard files for 30 days.

For a production-grade version, move persistence to a real store such as Supabase/Postgres, S3/R2, BigQuery, or a small VPS volume. GitHub Actions cache is good enough for a first automated loop, but it is not a permanent database.

## Publishing The Web Dashboard

The workflow can deploy `web/competitor-intel-dashboard` to GitHub Pages.

Options:

- Manual run: set `publish_pages` to `true`.
- Scheduled runs: set repository variable `PUBLISH_PAGES=true`.

You also need GitHub Pages enabled for the repository.

## WalmartMX

WalmartMX is excluded from the default cloud run because the current crawler may require manual verification. Keep Walmart as a manual or separate supervised job until the verification problem is solved in a compliant and stable way.

## Suggested First Cloud Closure

Close A01 in two phases:

1. Cloud MVP: run `coppel,elektra,homedepotmx` daily with `PROXY_URL`, artifact upload, and dashboard rebuild.
2. Production persistence: replace GitHub cache with a real database/object store, then publish the dashboard from that persistent source.

For a non-technical step-by-step test plan in Chinese, see:

- `05_20260606_GitHub云端运行测试操作手册.md`
