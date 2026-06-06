# Mexico AC Price Tracker

This project tracks air-conditioner prices from multiple Mexico e-commerce sites and stores snapshots for change detection over time.

Current site crawlers:

- `Coppel` (`scripts/crawl_coppel.js`)
- `Elektra` (`scripts/crawl_elektra.js`)
- `HomeDepotMX` (`scripts/crawl_homedepotmx.js`) (proxy required for some regions)
- `WalmartMX` (`scripts/crawl_walmartmx.js`) (manual verification may be required)

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm run crawl:coppel
npm run crawl:elektra
npm run crawl:homedepotmx
npm run crawl:walmartmx
npm run probe:walmartmx
```

One-click run on macOS Finder:

1. Double-click `run_coppel.command` or `run_elektra.command` (daily price tracking).
1. Double-click `run_homedepotmx.command` (daily price tracking, proxy recommended/required).
1. For WalmartMX manual probe, double-click `run_walmartmx_probe.command`.
1. For WalmartMX full crawl (pagination + terminal confirmation gate), double-click `run_walmartmx.command`.
2. If you want to use a proxy, create `.env.crawler` next to the script with:
   `PROXY_URL=http://username:password@host:port`
3. If macOS blocks first run, right-click the `.command` file and choose `Open`.

WalmartMX probe uses a persistent Chrome profile by default at:
`data/walmartmx/chrome_profile` (to reduce repeated manual verification).
Delete that folder to reset the session, or run with `--ephemeral-profile` for a fresh profile.

WalmartMX full crawl supports pagination and has the same default persistent profile location.

To require explicit terminal confirmation before crawling starts (after you finish the on-screen verification):

```bash
npm run crawl:walmartmx -- --manual-confirm
```

In this mode, the crawler waits for your Enter key confirmation (or `q` to abort) before it proceeds.

Optional flags:

`Coppel`:

```bash
node scripts/crawl_coppel.js \
  --max-pages 3 \
  --max-detail-products 50 \
  --min-delay-ms 5000 \
  --max-delay-ms 9000 \
  --listing-long-break-every 2 \
  --detail-long-break-every 15 \
  --long-break-min-ms 15000 \
  --long-break-max-ms 35000 \
  --max-retries 2 \
  --backoff-base-ms 8000 \
  --timeout-ms 120000 \
  --base-url "https://www.coppel.com/ct/linea-blanca/aires-acondicionados/cat000416?pmNodeId=11404&prNodeId=11419&regionTelcel=9"
```

By default, the crawler runs in two stages:

1. PLP listing crawl (product list)
2. PDP detail crawl (each product detail page)

Use `--skip-details` if you only want listing data.
Use `--max-detail-products N` for limited detail sampling during debug.

`Elektra`:

```bash
node scripts/crawl_elektra.js \
  --max-pages 3 \
  --page-size 50 \
  --min-delay-ms 4000 \
  --max-delay-ms 8000 \
  --long-break-every 2 \
  --long-break-min-ms 15000 \
  --long-break-max-ms 35000 \
  --max-retries 2 \
  --backoff-base-ms 6000 \
  --timeout-ms 60000 \
  --base-url "https://www.elektra.mx/linea-blanca/climatizacion-y-ventilacion/minisplits"
```

Elektra defaults to `price-only` listing mode (for daily scheduled tracking).  
Use `--crawl-details` for one-time detail enrichment and `--max-detail-products N` to limit detail requests.
By default it uses a known VTEX category path and avoids fetching the listing HTML.  
If you change `--base-url` and need auto-discovery, add `--discover-category-path`.

Default behavior keeps only latest files (no timestamped history).  
If you want to keep historical snapshots/reports:

```bash
node scripts/crawl_coppel.js --keep-history
node scripts/crawl_elektra.js --keep-history
```

Optional: set proxy via environment variable (recommended if you want to avoid exposing your IP):

```bash
export PROXY_URL="http://username:password@host:port"
npm run crawl:coppel
npm run crawl:elektra
```

Passing proxy credentials through CLI flags is intentionally disabled to reduce shell history leakage.
If you don't set `PROXY_URL`, crawlers run with a direct connection (your IP will be visible to the target site).

## Output Files

`Coppel` outputs are under `data/coppel/`:

- `latest_products.json`: latest normalized full snapshot.
- `latest_products.csv`: latest normalized full snapshot (CSV).
- `reports/latest_price_changes.json`: diff between current and previous run.
- `reports/latest_price_changes.csv`: same diff in CSV.
- `runs/latest_run.json`: latest run summary.

`latest_products.*` now includes PDP detail fields such as:

- `pdp_sku`, `pdp_sold_by`
- `pdp_description`, `pdp_specs_json`
- `pdp_sale_price_mxn`, `pdp_original_price_mxn`
- `ldjson_brand_name`, `ldjson_offer_availability`

When `--keep-history` is enabled, additional timestamped files are created:

- `price_history.csv`
- `snapshots/products_YYYYMMDD_HHMMSS.json`
- `snapshots/products_YYYYMMDD_HHMMSS.csv`
- `reports/price_changes_YYYYMMDD_HHMMSS.json`
- `reports/price_changes_YYYYMMDD_HHMMSS.csv`
- `runs/run_YYYYMMDD_HHMMSS.json`

`Elektra` outputs are under `data/elektra/`:

- `latest_products.json`: latest normalized full snapshot.
- `latest_products.csv`: latest normalized full snapshot (CSV).
- `reports/latest_price_changes.json`: diff between current and previous run.
- `reports/latest_price_changes.csv`: same diff in CSV.
- `runs/latest_run.json`: latest run summary.

If `--crawl-details` is enabled, `latest_products.*` also includes optional fields:

- `detail_description`, `detail_specs_json`, `detail_specs_count`
- `detail_sale_price_mxn`, `detail_original_price_mxn`
- `detail_model`, `detail_gtin`, `detail_sellers_json`

When `--keep-history` is enabled, Elektra also writes:

- `snapshots/products_YYYYMMDD_HHMMSS.json`
- `snapshots/products_YYYYMMDD_HHMMSS.csv`
- `reports/price_changes_YYYYMMDD_HHMMSS.json`
- `reports/price_changes_YYYYMMDD_HHMMSS.csv`
- `runs/run_YYYYMMDD_HHMMSS.json`
- `price_history.csv`

`WalmartMX` probe outputs are under `data/walmartmx/`:

- `latest_products.json`: best-effort extracted products from the category page after manual verification.
- `runs/latest_run.json`: run summary including observed XHR/fetch endpoints (URL values sanitized to avoid leaking tokens).

WalmartMX currently requires manual verification ("Verifica tu identidad") and is not suitable for unattended daily crawling.

`HomeDepotMX` outputs are under `data/homedepotmx/`:

- `latest_products.json`: latest normalized product snapshot (prices only).
- `runs/latest_run.json`: latest run summary (API-based crawl).

HomeDepotMX crawl uses JSON API endpoints:

- Resolve category identifier -> `categoryId` via `/search/resources/api/v2/urls`
- Paginate products with prices via `/search/resources/api/v2/products` using `limit` + `offset`

Note: Some regions require a US proxy/IP to access the site. By default the crawler requires `PROXY_URL` unless you pass `--allow-direct-ip`.

## Change Types

`reports/latest_price_changes.*` includes:

- `price_changed`: product existed before and at least one price changed.
- `new_product`: product not present in the previous snapshot.
- `removed_product`: product existed previously but is missing now.

## Price Field Semantics

- `sale_price_mxn`: current effective listing price (this should always be the primary tracked price).
- `original_price_mxn`: original/strikethrough price, only present when a discount is shown.
- For non-discounted products, `original_price_mxn` is expected to be empty (`null` in JSON).

## Database (SQLite, v2)

By default, each crawl also upserts data into:

- `data/ac_price_monitor_mexico_v2.db`

Schema is aligned to `ac_price_monitor_v2_*.db`:

- `product_master`: stable `canonical_product_id` (SHA1-16) derived from a site-specific `source_product_key` (SPK).
- `price_facts`: one row per day per website per canonical product (`UNIQUE(date, website, canonical_product_id)`).
- `product_details`: only written when PDP detail crawl is enabled (low-frequency enrichment).

Important semantics:

- `price_facts.date` uses **Mexico City local date** (`America/Mexico_City`) derived from `captured_at`.
- Daily tracking should use `price_facts.price` (mapped from `sale_price_mxn`).

Override DB path:

```bash
export DB_PATH="data/ac_price_monitor_mexico_v2.db"
node scripts/crawl_elektra.js --db-path "data/ac_price_monitor_mexico_v2.db"
```

Disable DB writes:

```bash
node scripts/crawl_coppel.js --no-db
node scripts/crawl_elektra.js --no-db
```

## Schedule (example)

Run once every day at 08:00:

```bash
crontab -e
```

Add:

```cron
0 8 * * * cd "/Users/luke2026/AI project/墨西哥电商数据-空调" && { [ -f ./.env.crawler ] && . ./.env.crawler; } && /usr/bin/env npm run crawl:coppel -- --skip-details >> cron.log 2>&1
15 8 * * * cd "/Users/luke2026/AI project/墨西哥电商数据-空调" && { [ -f ./.env.crawler ] && . ./.env.crawler; } && /usr/bin/env npm run crawl:elektra >> cron.log 2>&1
```

## Notes

- This crawler uses Playwright because plain HTTP requests are often blocked by anti-bot protections.
- Elektra crawler uses the VTEX catalog API endpoint to reduce page-render load and lower anti-bot risk.
- Keep request frequency conservative and respect the website's terms and policies.
- Security-first mode aborts immediately on robots disallow, anti-bot challenge signals, or blocking HTTP statuses.
- Store `PROXY_URL` in a protected env file (e.g. `.env.crawler` with `chmod 600`) instead of shell history.
