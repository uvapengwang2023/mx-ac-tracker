# Project Record

## Stage Retrospectives

| Date | Topic | Document | Notes |
| --- | --- | --- | --- |
| 2026-06-06 | A03 business gate clarification | `10_20260606_A03竞品池自动分层第一版记录.md` | Clarifies that A03 is a technical prototype for now. Formal competitor grouping is paused until A02 product series and series price ladders are completed. |
| 2026-06-06 | A03 competitor candidate pool first version | `10_20260606_A03竞品池自动分层第一版记录.md` | Starts Prime-centered competitor candidate grouping, writes JSON/CSV and SQLite tables, connects the dashboard, and adds cloud artifact coverage. |
| 2026-06-06 | Competitor analysis automation, cloud crawl, SKU normalization, sample audit | `09_20260606_竞品分析自动化阶段总复盘与经验.md` | Consolidates A01 cloud automation, A02 SKU normalization, GitHub Actions validation, data persistence, dashboard, manual-vs-AI responsibilities, lessons learned, risks, and next steps. |

## Competitor Candidate Pool Progress Log

| Date | Area | Progress | Validation | Related Files |
| --- | --- | --- | --- | --- |
| 2026-06-06 | A03 business gates | Clarified that A03 should not be used as a formal competitor pool until A02 product series and series price ladders are completed. Formal horizontal comparison must first satisfy hard gates: same product type, same or equivalent cooling capacity, same cooling mode, same voltage, and preferably same inverter/on-off class. Price, brand, series, and platform are second-layer ranking/explanation fields. | Updated A03 record, planning checklist, total retrospective, dashboard checklist, and page copy to mark A03 as a technical prototype waiting for A02 series work. | `04_20260606_竞品分析AI自动化执行清单.md`; `09_20260606_竞品分析自动化阶段总复盘与经验.md`; `10_20260606_A03竞品池自动分层第一版记录.md`; `scripts/build_competitor_dashboard_data.js`; `web/competitor-intel-dashboard/index.html` |
| 2026-06-06 | A03 first candidate pool | Built the first Prime-centered competitor candidate pool. The system scores candidate relationships by product type, capacity, voltage, inverter/on-off, cooling mode, price closeness, brand, and series signal. Output is intentionally a reviewable candidate pool, not a final competitor list. | Ran `npm run competitors:build` and `npm run dashboard:build`; latest output has 27 Prime target SKU, 318 candidate relationships, 171 direct candidates, 145 close candidates, and 2 benchmark references. | `scripts/build_competitor_candidates.js`; `data/competitor_candidates/latest_competitor_candidates.json`; `web/competitor-intel-dashboard/`; `10_20260606_A03竞品池自动分层第一版记录.md` |

## SKU Normalization Progress Log

| Date | Area | Progress | Validation | Related Files |
| --- | --- | --- | --- | --- |
| 2026-06-06 | Product series inference | Confirmed that model codes can imply product series. Prime `EMPRC182-B` should keep `B -> Bright family` as a low-confidence model-based inference, even when `Bright` is absent from the title. The key principle is to preserve the inference source and confidence instead of discarding useful model-code signals. | Re-ran `npm run sku:normalize`; sample output for `EMPRC182-B` is `productSeries=Bright family`, `seriesSource=model_family_rule`, `seriesType=model_family`, `seriesConfidence=low`, `reviewFlags=series_is_model_family`. Rebuilt dashboard data with `npm run dashboard:build`. | `scripts/build_normalized_sku_fields.js`; `07_20260606_SKU标准字段与产品系列抽取复盘.md`; `08_20260606_SKU标准字段30样本复核报告.md`; `09_20260606_竞品分析自动化阶段总复盘与经验.md` |

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
