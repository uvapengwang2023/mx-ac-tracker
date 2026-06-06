import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;

function normalizeText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeBoolInt(value) {
  if (value === true) {
    return 1;
  }
  if (value === false) {
    return 0;
  }
  return null;
}

function pickFirst(row, keys) {
  for (const key of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, key) && row[key] !== "") {
      return row[key];
    }
  }
  return null;
}

async function ensureDbDir(dbPath) {
  const dir = path.dirname(dbPath);
  await fs.mkdir(dir, { recursive: true });
}

function initSchema(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO meta(key, value)
  VALUES('schema_version', '${SCHEMA_VERSION}')
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  base_url TEXT,
  total_products INTEGER,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_site_captured_at ON runs(site, captured_at);

CREATE TABLE IF NOT EXISTS products (
  site TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sku_id TEXT,
  name TEXT,
  brand TEXT,
  product_url TEXT,
  image_url TEXT,
  category_id TEXT,
  category_path TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  PRIMARY KEY (site, product_id)
);
CREATE INDEX IF NOT EXISTS idx_products_site_sku_id ON products(site, sku_id);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  site TEXT NOT NULL,
  product_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  seller_id TEXT,
  seller_name TEXT,
  sale_price_mxn REAL,
  original_price_mxn REAL,
  list_price_mxn REAL,
  is_available INTEGER,
  available_quantity INTEGER,
  installments_count INTEGER,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_unique_run_product ON price_snapshots(run_id, site, product_id);
CREATE INDEX IF NOT EXISTS idx_price_site_product_time ON price_snapshots(site, product_id, captured_at);
  `);
}

export async function persistRunToSqlite({ dbPath, runSummary, rows }) {
  if (!dbPath) {
    return {
      enabled: false,
      reason: "db_path_empty",
      run_id: null,
      products_upserted: 0,
      snapshots_inserted: 0,
    };
  }

  await ensureDbDir(dbPath);
  const db = new DatabaseSync(dbPath);

  try {
    initSchema(db);

    const site = normalizeText(runSummary?.site) || normalizeText(rows?.[0]?.site) || "unknown";
    const capturedAt = normalizeText(runSummary?.captured_at) || normalizeText(rows?.[0]?.captured_at);
    if (!capturedAt) {
      throw new Error("persistRunToSqlite: captured_at is required");
    }

    const upsertProduct = db.prepare(`
INSERT INTO products(
  site, product_id, sku_id, name, brand, product_url, image_url,
  category_id, category_path, first_seen_at, last_seen_at
) VALUES(?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(site, product_id) DO UPDATE SET
  sku_id=excluded.sku_id,
  name=excluded.name,
  brand=excluded.brand,
  product_url=excluded.product_url,
  image_url=excluded.image_url,
  category_id=excluded.category_id,
  category_path=excluded.category_path,
  last_seen_at=excluded.last_seen_at;
    `);

    const insertSnapshot = db.prepare(
      `INSERT INTO price_snapshots(
        run_id, site, product_id, captured_at, seller_id, seller_name,
        sale_price_mxn, original_price_mxn, list_price_mxn,
        is_available, available_quantity, installments_count
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    db.exec("BEGIN;");
    const insertRun = db.prepare(
      "INSERT INTO runs(site, captured_at, base_url, total_products, meta_json) VALUES(?,?,?,?,?)",
    );
    const runResult = insertRun.run(
      site,
      capturedAt,
      normalizeText(runSummary?.base_url),
      normalizeNumber(runSummary?.total_products),
      JSON.stringify(runSummary ?? {}),
    );
    const runId = runResult.lastInsertRowid;

    let productsUpserted = 0;
    let snapshotsInserted = 0;

    for (const row of rows || []) {
      const rowSite = normalizeText(row?.site) || site;
      const productId = normalizeText(row?.product_id);
      if (!productId) {
        continue;
      }

      const skuId = normalizeText(
        pickFirst(row, ["sku_id", "pdp_sku", "ldjson_sku"]),
      );
      const name = normalizeText(pickFirst(row, ["name", "pdp_name", "product_name"]));
      const brand = normalizeText(pickFirst(row, ["brand", "ldjson_brand_name"]));
      const productUrl = normalizeText(pickFirst(row, ["product_url"]));
      const imageUrl = normalizeText(pickFirst(row, ["image_url"]));
      const categoryId = normalizeText(pickFirst(row, ["category_id"]));
      const categoryPath = normalizeText(pickFirst(row, ["category_path"]));

      const rowCapturedAt = normalizeText(row?.captured_at) || capturedAt;

      upsertProduct.run(
        rowSite,
        productId,
        skuId,
        name,
        brand,
        productUrl,
        imageUrl,
        categoryId,
        categoryPath,
        rowCapturedAt,
        rowCapturedAt,
      );
      productsUpserted += 1;

      const sellerId = normalizeText(pickFirst(row, ["seller_id"]));
      const sellerName = normalizeText(
        pickFirst(row, ["seller_name", "pdp_sold_by"]),
      );
      const salePrice = normalizeNumber(pickFirst(row, ["sale_price_mxn"]));
      const originalPrice = normalizeNumber(pickFirst(row, ["original_price_mxn"]));
      const listPrice = normalizeNumber(pickFirst(row, ["list_price_mxn"]));
      const isAvailable = normalizeBoolInt(pickFirst(row, ["is_available"]));
      const availableQty = normalizeNumber(pickFirst(row, ["available_quantity"]));
      const installmentsCount = normalizeNumber(pickFirst(row, ["installments_count"]));

      insertSnapshot.run(
        runId,
        rowSite,
        productId,
        rowCapturedAt,
        sellerId,
        sellerName,
        salePrice,
        originalPrice,
        listPrice,
        isAvailable,
        availableQty,
        installmentsCount,
      );
      snapshotsInserted += 1;
    }

    db.exec("COMMIT;");

    return {
      enabled: true,
      reason: "ok",
      db_path: path.resolve(dbPath),
      run_id: runId,
      products_upserted: productsUpserted,
      snapshots_inserted: snapshotsInserted,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    db.close();
  }
}
