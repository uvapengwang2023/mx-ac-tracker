import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "data", "ac_price_monitor_mexico_v2.db");
const OUT_DIR = path.join(ROOT, "data", "daily_alerts");
const LATEST_OUT = path.join(OUT_DIR, "latest_alerts.json");

const DEFAULT_MIN_DELTA_MXN = 500;
const DEFAULT_MIN_DELTA_PCT = 5;
const DEFAULT_LIMIT = 80;

function parseArgs(argv) {
  const args = {
    dbPath: DB_PATH,
    date: null,
    minDeltaMxn: Number(process.env.DAILY_ALERT_MIN_DELTA_MXN || DEFAULT_MIN_DELTA_MXN),
    minDeltaPct: Number(process.env.DAILY_ALERT_MIN_DELTA_PCT || DEFAULT_MIN_DELTA_PCT),
    limit: Number(process.env.DAILY_ALERT_LIMIT || DEFAULT_LIMIT),
  };

  for (const arg of argv) {
    if (arg.startsWith("--db=")) args.dbPath = path.resolve(arg.slice("--db=".length));
    else if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
    else if (arg.startsWith("--min-delta-mxn=")) args.minDeltaMxn = Number(arg.slice("--min-delta-mxn=".length));
    else if (arg.startsWith("--min-delta-pct=")) args.minDeltaPct = Number(arg.slice("--min-delta-pct=".length));
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
  }

  if (!Number.isFinite(args.minDeltaMxn)) args.minDeltaMxn = DEFAULT_MIN_DELTA_MXN;
  if (!Number.isFinite(args.minDeltaPct)) args.minDeltaPct = DEFAULT_MIN_DELTA_PCT;
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = DEFAULT_LIMIT;
  return args;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toPlainRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function formatDeltaPct(oldPrice, newPrice) {
  if (!Number.isFinite(oldPrice) || oldPrice <= 0 || !Number.isFinite(newPrice)) {
    return null;
  }
  return round(((newPrice - oldPrice) / oldPrice) * 100, 1);
}

function severityForDelta(delta, deltaPct) {
  const absDelta = Math.abs(delta || 0);
  const absPct = Math.abs(deltaPct || 0);
  if (absDelta >= 2000 || absPct >= 15) {
    return "high";
  }
  if (absDelta >= 1000 || absPct >= 8) {
    return "medium";
  }
  return "low";
}

function normalizeFact(row, type, latestDate) {
  const oldPrice = Number(row.old_price);
  const newPrice = Number(row.new_price);
  const delta = Number.isFinite(oldPrice) && Number.isFinite(newPrice) ? newPrice - oldPrice : null;
  const deltaPct = Number.isFinite(delta) ? formatDeltaPct(oldPrice, newPrice) : null;
  return {
    type,
    severity: Number.isFinite(delta) ? severityForDelta(delta, deltaPct) : "medium",
    website: row.website,
    canonicalProductId: row.canonical_product_id,
    title: row.title || "(untitled)",
    brand: row.brand || "未知",
    link: row.link || null,
    image: row.image || null,
    oldPrice: Number.isFinite(oldPrice) ? oldPrice : null,
    newPrice: Number.isFinite(newPrice) ? newPrice : null,
    delta,
    deltaPct,
    previousDate: row.previous_date || null,
    latestDate,
    reason: buildReason(type, { delta, deltaPct, website: row.website, title: row.title }),
  };
}

function normalizePresence(row, type, latestDate) {
  const price = Number(row.price);
  return {
    type,
    severity: type === "removed_product" ? "medium" : "low",
    website: row.website,
    canonicalProductId: row.canonical_product_id,
    title: row.title || "(untitled)",
    brand: row.brand || "未知",
    link: row.link || null,
    image: row.image || null,
    price: Number.isFinite(price) ? price : null,
    previousDate: row.previous_date || null,
    latestDate,
    reason: buildReason(type, { website: row.website, title: row.title }),
  };
}

function buildReason(type, row) {
  if (type === "price_drop") {
    return `价格下降 ${Math.abs(row.deltaPct || 0)}%，建议检查是否为促销或跟价信号。`;
  }
  if (type === "price_increase") {
    return `价格上涨 ${Math.abs(row.deltaPct || 0)}%，建议观察是否为库存或促销结束。`;
  }
  if (type === "new_product") {
    return "最新抓取中首次出现，建议判断是否为新机型或重复 listing。";
  }
  if (type === "removed_product") {
    return "上一轮仍存在、最新抓取未出现，建议判断是否下架、缺货或页面暂时异常。";
  }
  return "需要人工复核。";
}

function significant(change, thresholds) {
  return (
    Math.abs(change.delta || 0) >= thresholds.minDeltaMxn ||
    Math.abs(change.deltaPct || 0) >= thresholds.minDeltaPct
  );
}

function emptyPayload({ status, reason, args }) {
  return {
    generatedAt: new Date().toISOString(),
    status,
    reason,
    latestDate: args.date,
    previousDate: null,
    thresholds: {
      minDeltaMxn: args.minDeltaMxn,
      minDeltaPct: args.minDeltaPct,
      limit: args.limit,
    },
    summary: {
      actionableAlerts: 0,
      priceDrops: 0,
      priceIncreases: 0,
      newProducts: 0,
      removedProducts: 0,
      coverageAlerts: 0,
    },
    siteCounts: [],
    priceDrops: [],
    priceIncreases: [],
    newProducts: [],
    removedProducts: [],
    coverageAlerts: [],
    dataQuality: [{ level: "warning", message: reason }],
  };
}

async function writePayload(payload) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(LATEST_OUT, JSON.stringify(payload, null, 2), "utf8");
  if (payload.latestDate) {
    await fs.writeFile(path.join(OUT_DIR, `alerts_${payload.latestDate}.json`), JSON.stringify(payload, null, 2), "utf8");
  }
}

function buildCoverageAlerts(siteCounts, previousDate, latestDate) {
  return siteCounts
    .filter((site) => site.previousCount > 0)
    .map((site) => {
      const dropPct = ((site.previousCount - site.latestCount) / site.previousCount) * 100;
      return {
        type: "coverage_drop",
        severity: site.latestCount === 0 || dropPct >= 50 ? "high" : "medium",
        website: site.website,
        previousDate,
        latestDate,
        previousCount: site.previousCount,
        latestCount: site.latestCount,
        deltaCount: site.latestCount - site.previousCount,
        deltaPct: round(-dropPct, 1),
        reason:
          site.latestCount === 0
            ? "最新抓取该站点商品数为 0，优先检查是否被拦截或页面结构变化。"
            : `最新商品数比上一轮少 ${round(dropPct, 1)}%，建议检查是否抓取不完整。`,
      };
    })
    .filter((site) => site.latestCount === 0 || site.latestCount < site.previousCount * 0.7);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const thresholds = {
    minDeltaMxn: args.minDeltaMxn,
    minDeltaPct: args.minDeltaPct,
    limit: args.limit,
  };

  try {
    await fs.access(args.dbPath);
  } catch {
    const payload = emptyPayload({
      status: "missing_database",
      reason: `SQLite database not found: ${path.relative(ROOT, args.dbPath)}`,
      args,
    });
    await writePayload(payload);
    console.log(`Wrote ${path.relative(ROOT, LATEST_OUT)} (${payload.status})`);
    return;
  }

  const db = new DatabaseSync(args.dbPath, { readOnly: true });
  try {
    const dates = toPlainRows(
      db.prepare("SELECT date, COUNT(*) AS facts FROM price_facts GROUP BY date ORDER BY date ASC").all(),
    );
    if (!dates.length) {
      const payload = emptyPayload({ status: "empty_database", reason: "price_facts has no rows", args });
      await writePayload(payload);
      console.log(`Wrote ${path.relative(ROOT, LATEST_OUT)} (${payload.status})`);
      return;
    }

    const latestDate = args.date || dates.at(-1).date;
    const previousDate = dates.filter((row) => row.date < latestDate).at(-1)?.date || null;
    const latestSites = toPlainRows(
      db.prepare(
        "SELECT website, COUNT(*) AS latest_count FROM price_facts WHERE date = ? GROUP BY website ORDER BY website",
      ).all(latestDate),
    );
    const siteNames = latestSites.map((row) => row.website);
    const previousCounts = previousDate
      ? toPlainRows(
          db.prepare(
            "SELECT website, COUNT(*) AS previous_count FROM price_facts WHERE date = ? GROUP BY website ORDER BY website",
          ).all(previousDate),
        )
      : [];
    const previousCountBySite = new Map(previousCounts.map((row) => [row.website, Number(row.previous_count)]));
    const siteCounts = latestSites.map((row) => ({
      website: row.website,
      latestCount: Number(row.latest_count),
      previousCount: previousCountBySite.get(row.website) || 0,
    }));

    const movementRows = toPlainRows(
      db
        .prepare(
          `
WITH latest AS (
  SELECT * FROM price_facts WHERE date = ?
),
previous_key AS (
  SELECT website, canonical_product_id, MAX(date) AS previous_date
  FROM price_facts
  WHERE date < ?
  GROUP BY website, canonical_product_id
),
previous AS (
  SELECT pf.*
  FROM price_facts pf
  JOIN previous_key pk
    ON pk.website = pf.website
   AND pk.canonical_product_id = pf.canonical_product_id
   AND pk.previous_date = pf.date
)
SELECT
  l.website,
  l.canonical_product_id,
  pm.title,
  pm.brand,
  pm.image,
  l.link,
  p.price AS old_price,
  l.price AS new_price,
  p.date AS previous_date
FROM latest l
JOIN previous p
  ON p.website = l.website
 AND p.canonical_product_id = l.canonical_product_id
LEFT JOIN product_master pm
  ON pm.canonical_product_id = l.canonical_product_id
WHERE l.price IS NOT NULL
  AND p.price IS NOT NULL
  AND l.price != p.price
ORDER BY ABS(l.price - p.price) DESC
          `,
        )
        .all(latestDate, latestDate),
    );

    const movements = movementRows.map((row) => {
      const oldPrice = Number(row.old_price);
      const newPrice = Number(row.new_price);
      const delta = newPrice - oldPrice;
      const deltaPct = formatDeltaPct(oldPrice, newPrice);
      return { ...row, old_price: oldPrice, new_price: newPrice, delta, deltaPct };
    });

    const significantMovements = movements.filter((row) => significant(row, thresholds));
    const priceDrops = significantMovements
      .filter((row) => row.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, args.limit)
      .map((row) => normalizeFact(row, "price_drop", latestDate));
    const priceIncreases = significantMovements
      .filter((row) => row.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, args.limit)
      .map((row) => normalizeFact(row, "price_increase", latestDate));

    const newProducts = toPlainRows(
      db
        .prepare(
          `
SELECT
  l.website,
  l.canonical_product_id,
  pm.title,
  pm.brand,
  pm.image,
  l.link,
  l.price
FROM price_facts l
LEFT JOIN product_master pm
  ON pm.canonical_product_id = l.canonical_product_id
WHERE l.date = ?
  AND NOT EXISTS (
    SELECT 1
    FROM price_facts p
    WHERE p.website = l.website
      AND p.canonical_product_id = l.canonical_product_id
      AND p.date < ?
  )
ORDER BY l.website, l.price DESC
LIMIT ?
          `,
        )
        .all(latestDate, latestDate, args.limit),
    ).map((row) => normalizePresence(row, "new_product", latestDate));

    const removedProducts = previousDate && siteNames.length
      ? toPlainRows(
          db
            .prepare(
              `
SELECT
  p.website,
  p.canonical_product_id,
  pm.title,
  pm.brand,
  pm.image,
  p.link,
  p.price,
  p.date AS previous_date
FROM price_facts p
LEFT JOIN product_master pm
  ON pm.canonical_product_id = p.canonical_product_id
WHERE p.date = ?
  AND p.website IN (${siteNames.map(() => "?").join(",")})
  AND NOT EXISTS (
    SELECT 1
    FROM price_facts l
    WHERE l.date = ?
      AND l.website = p.website
      AND l.canonical_product_id = p.canonical_product_id
  )
ORDER BY p.website, p.price DESC
LIMIT ?
              `,
            )
            .all(previousDate, ...siteNames, latestDate, args.limit),
        ).map((row) => normalizePresence(row, "removed_product", latestDate))
      : [];

    const coverageAlerts = buildCoverageAlerts(siteCounts, previousDate, latestDate);
    const actionableAlerts =
      priceDrops.length + priceIncreases.length + newProducts.length + removedProducts.length + coverageAlerts.length;

    const payload = {
      generatedAt: new Date().toISOString(),
      status: "success",
      latestDate,
      previousDate,
      thresholds,
      summary: {
        actionableAlerts,
        priceDrops: priceDrops.length,
        priceIncreases: priceIncreases.length,
        newProducts: newProducts.length,
        removedProducts: removedProducts.length,
        coverageAlerts: coverageAlerts.length,
      },
      siteCounts,
      priceDrops,
      priceIncreases,
      newProducts,
      removedProducts,
      coverageAlerts,
      dataQuality: [
        previousDate
          ? {
              level: "info",
              message: `价格变化对比最新日期 ${latestDate} 与每个 SKU 上一次出现日期；上新/下架对比 ${previousDate} 与 ${latestDate}。`,
            }
          : {
              level: "warning",
              message: "数据库只有一个抓取日期，暂时只能识别最新商品池，不能判断价格变化或下架。",
            },
      ],
    };

    await writePayload(payload);
    console.log(`Wrote ${path.relative(ROOT, LATEST_OUT)}`);
    console.log(
      `Alerts: ${actionableAlerts}; drops: ${priceDrops.length}; increases: ${priceIncreases.length}; new: ${newProducts.length}; removed: ${removedProducts.length}`,
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
