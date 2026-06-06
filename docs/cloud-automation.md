# Cloud Automation For Mexico AC Competitor Tracking

This project can run the crawler stack in the cloud with GitHub Actions. The cloud job replaces the local habit of opening a VPN and double-clicking crawler scripts with a scheduled workflow. It can run by direct GitHub cloud IP first, and can inject a proxy from GitHub Secrets when a site starts blocking direct access.

## Recommended Setup

1. Push this project to a GitHub repository.
2. Optional repository secrets:
   - `PROXY_URL`: proxy endpoint used by crawlers when direct cloud IP is blocked, for example `http://user:pass@host:port` or `socks5://host:port`.
   - `VPN_CHECK_URL`: optional health-check URL. Use a site that should only pass through the intended route, for example `https://www.homedepot.com.mx/`.
3. Open the repository's Actions tab.
4. Enable the workflow named `Cloud Daily Crawl`.
5. Run it manually once with `workflow_dispatch`.
6. After it succeeds, let the scheduled run continue daily.

The current workflow defaults to direct GitHub cloud IP access when no `PROXY_URL` is configured. If a site starts blocking GitHub's cloud IPs, add `PROXY_URL` and keep the same workflow.

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
- writes/updates the SQLite database at `data/ac_price_monitor_mexico_v2.db`;
- builds daily alerts at `data/daily_alerts/latest_alerts.json`;
- writes logs under `data/daily_crawls/`;
- rebuilds `web/competitor-intel-dashboard/data.js`;
- uploads run artifacts.

## Data Persistence

GitHub runners are temporary. The workflow preserves state in two ways:

- GitHub Actions cache stores the `data/` directory between runs so price history and change detection can continue.
- Workflow artifacts retain the latest crawl outputs and dashboard files for 30 days.

Artifacts include:

- `data/ac_price_monitor_mexico_v2.db`
- `data/ac_price_monitor_mexico_v2.db-*` when SQLite WAL sidecar files exist
- `data/daily_alerts/**`
- latest per-site product snapshots and run summaries
- `web/competitor-intel-dashboard/**`

For a production-grade version, move persistence to a real store such as Supabase/Postgres, S3/R2, BigQuery, or a small VPS volume. GitHub Actions cache is good enough for a first automated loop, but it is not a permanent database.

## Daily Alerts

After the crawlers finish, `npm run alerts:build` compares the latest SQLite `price_facts` against historical rows and writes:

```text
data/daily_alerts/latest_alerts.json
```

The alert file includes:

- significant price drops;
- significant price increases;
- products first seen on the latest crawl date;
- products seen on the previous crawl date but missing on the latest crawl date;
- crawl coverage warnings when a site's product count drops sharply.

Default alert thresholds are `MXN 500` or `5%`. They can be tuned with:

```text
DAILY_ALERT_MIN_DELTA_MXN
DAILY_ALERT_MIN_DELTA_PCT
DAILY_ALERT_LIMIT
```

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

## Validation Record

The first complete three-site cloud validation succeeded on 2026-06-06:

- Run: https://github.com/uvapengwang2023/mx-ac-tracker/actions/runs/27064477121
- Artifact: https://github.com/uvapengwang2023/mx-ac-tracker/actions/runs/27064477121/artifacts/7455102690
- Sites: Coppel, Elektra, HomeDepotMX
- Direct cloud IP: worked without `PROXY_URL`
- Products: Coppel 434, Elektra 220, HomeDepotMX 138, total 792

For the Chinese retrospective and operating notes, see:

- `06_20260606_GitHub云端三站点验证复盘.md`
