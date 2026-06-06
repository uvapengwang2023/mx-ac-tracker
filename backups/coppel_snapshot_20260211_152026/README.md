# Mexico AC Price Tracker

This project currently tracks air-conditioner listing prices from Coppel (Mexico) and stores snapshots for change detection over time.

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm run crawl:coppel
```

One-click run on macOS Finder:

1. Double-click `run_coppel.command`.
2. On first run, enter `PROXY_URL` when prompted (it auto-saves to `.env.crawler` with restricted permissions).
3. If macOS blocks first run, right-click `run_coppel.command` and choose `Open`.

Optional flags:

```bash
node scripts/crawl_coppel.js \
  --max-pages 3 \
  --max-detail-products 50 \
  --min-delay-ms 5000 \
  --max-delay-ms 9000 \
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

Default behavior keeps only latest files (no timestamped history).  
If you want to keep historical snapshots/reports:

```bash
node scripts/crawl_coppel.js --keep-history
```

Set proxy via environment variable (required by default):

```bash
export PROXY_URL="http://username:password@host:port"
npm run crawl:coppel
```

Passing proxy credentials through CLI flags is intentionally disabled to reduce shell history leakage.
For IP safety, localhost/private-network proxy endpoints are blocked by policy.

## Output Files

All outputs are under `data/coppel/`:

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

## Change Types

`reports/latest_price_changes.*` includes:

- `price_changed`: product existed before and at least one price changed.
- `new_product`: product not present in the previous snapshot.
- `removed_product`: product existed previously but is missing now.

## Price Field Semantics

- `sale_price_mxn`: current effective listing price (this should always be the primary tracked price).
- `original_price_mxn`: original/strikethrough price, only present when a discount is shown.
- For non-discounted products, `original_price_mxn` is expected to be empty (`null` in JSON).

## Schedule (example)

Run once every day at 08:00:

```bash
crontab -e
```

Add:

```cron
0 8 * * * cd "/Users/luke2026/AI project/墨西哥电商数据-空调" && . ./.env.crawler && /usr/bin/env npm run crawl:coppel >> cron.log 2>&1
```

## Notes

- This crawler uses Playwright because plain HTTP requests are often blocked by anti-bot protections.
- Keep request frequency conservative and respect the website's terms and policies.
- Security-first mode aborts immediately on robots disallow, anti-bot challenge signals, or blocking HTTP statuses.
- Store `PROXY_URL` in a protected env file (e.g. `.env.crawler` with `chmod 600`) instead of shell history.
