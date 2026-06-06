# Project Record

## Cloud Automation Validation Log

| Date | Platform | Run | Artifact | Sites | Proxy | Result | Products | Notes |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| 2026-06-06 | GitHub Actions | https://github.com/uvapengwang2023/mx-ac-tracker/actions/runs/27064477121 | https://github.com/uvapengwang2023/mx-ac-tracker/actions/runs/27064477121/artifacts/7455102690 | Coppel, Elektra, HomeDepotMX | None; direct cloud IP | Success | 792 | Preflight 200 OK for all three sites; dashboard `data.js` uploaded in artifact. See `06_20260606_GitHub云端三站点验证复盘.md`. |

## Daily Crawl + DB Load Log

| Date (Mexico City) | Recorded At | Coppel | Elektra | HomeDepotMX | WalmartMX | Total price_facts | DB Path | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2026-02-17 | 2026-02-17 17:38:34 -03 | 487 | 250 | 106 | 299 | 1142 | data/ac_price_monitor_mexico_v2.db | Full 4-site crawl completed; Walmart verification handled in browser. |
| 2026-02-17 | 2026-02-17 17:41:59 -03 | 487 | 250 | 106 | 299 | 1142 | data/ac_price_monitor_mexico_v2.db | Daily crawl completed (auto append) |
| 2026-02-18 | 2026-02-18 18:35:10 -03 | 489 | 249 | 124 | 309 | 1171 | data/ac_price_monitor_mexico_v2.db | Daily crawl completed (Walmart used ephemeral profile) |
| 2026-02-19 | 2026-02-19 13:32:53 -03 | 489 | 250 | 0 | 297 | 1036 | data/ac_price_monitor_mexico_v2.db | Daily crawl partial: HomeDepotMX blocked with HTTP 403 on direct IP |
| 2026-02-20 | 2026-02-20 19:06:28 -03 | 486 | 252 | 125 | 293 | 1156 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-02-21 | 2026-02-21 21:39:34 -03 | 483 | 255 | 125 | 293 | 1156 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-02-22 | 2026-02-22 18:02:08 -03 | 479 | 255 | 132 | 296 | 1162 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-02-23 | 2026-02-23 18:42:27 -03 | 483 | 252 | 123 | 298 | 1156 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-02-24 | 2026-02-24 17:18:25 -03 | 466 | 253 | 123 | 305 | 1147 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-02-25 | 2026-02-25 18:37:31 -03 | 472 | 253 | 125 | 302 | 1152 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-02-26 | 2026-02-26 17:43:54 -03 | 473 | 252 | 124 | 309 | 1158 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-02-28 | 2026-02-28 18:41:28 -03 | 471 | 254 | 122 | 316 | 1163 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-03-01 | 2026-03-01 19:16:22 -03 | 469 | 250 | 122 | 394 | 1235 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-03-02 | 2026-03-02 12:13:24 -03 | 467 | 248 | 121 | 301 | 1137 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-03-03 | 2026-03-03 13:06:12 -03 | 466 | 250 | 125 | 300 | 1141 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-03-04 | 2026-03-04 22:52:46 +08 | 482 | 255 | 130 | 311 | 1178 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-03-05 | 2026-03-05 22:33:03 +08 | 502 | 261 | 130 | 290 | 1183 | data/ac_price_monitor_mexico_v2.db | Automated append. |
| 2026-03-06 | 2026-03-06 22:26:51 +08 | 499 | 253 | 130 | 305 | 1187 | data/ac_price_monitor_mexico_v2.db | Automated append. |

## Run Summaries (latest captured_at)

- data/coppel/runs/latest_run.json -> 2026-03-06T13:36:16.132Z
- data/elektra/runs/latest_run.json -> 2026-03-06T13:43:27.554Z
- data/homedepotmx/runs/latest_run.json -> 2026-03-06T13:44:59.305Z
- data/walmartmx/runs/latest_run.json -> 2026-03-06T14:14:51.889Z
