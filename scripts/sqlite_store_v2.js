import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// V2 schema aligned to `ac_price_monitor_v2_*.db` in the ac-price-monitor project.
// Goal: daily price facts + stable canonical_product_id derived from site-specific SPK.

const MEXICO_CITY_TZ = "America/Mexico_City";

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

function ensureWebsiteName(site) {
  const s = String(site || "").trim().toLowerCase();
  if (!s) {
    return "Unknown";
  }
  if (s === "coppel") {
    return "Coppel";
  }
  if (s === "elektra") {
    return "Elektra";
  }
  if (s === "walmartmx" || s === "walmart") {
    return "WalmartMX";
  }
  if (s === "homedepotmx" || s === "homedepot") {
    return "HomeDepotMX";
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sha1Hex(value) {
  return crypto.createHash("sha1").update(String(value), "utf8").digest("hex");
}

function canonicalPidFromPidReadable(pidReadable) {
  // Keep consistent with ac-price-monitor v2: 16-char SHA1 prefix (hex).
  return sha1Hex(pidReadable).slice(0, 16);
}

function toSqliteUtcDatetime(isoOrDate) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const pad2 = (n) => String(n).padStart(2, "0");
  const pad3 = (n) => String(n).padStart(3, "0");
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}` +
    ` ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}.` +
    `${pad3(date.getUTCMilliseconds())}`
  );
}

function toDateInTimeZone(isoOrDate, timeZone) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

function toMexicoCityDate(isoOrDate) {
  return toDateInTimeZone(isoOrDate, MEXICO_CITY_TZ);
}

function pickFirst(row, keys) {
  for (const key of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, key) && row[key] !== "") {
      return row[key];
    }
  }
  return null;
}

function derivePrimaryProductKey(row) {
  const site = String(row?.site || "").toLowerCase();
  if (site === "elektra") {
    return normalizeText(pickFirst(row, ["sku_id", "product_id"]));
  }
  // coppel and others
  return normalizeText(pickFirst(row, ["product_id", "pdp_sku", "ldjson_sku"]));
}

function buildSourceProductKey(website, primaryKey) {
  if (!website || !primaryKey) {
    return null;
  }
  return `SPK::${website}::${primaryKey}`;
}

function extractDetailFields(row) {
  const rawSpecsJson = normalizeText(pickFirst(row, ["pdp_specs_json", "detail_specs_json"]));
  const rawSpecsText = normalizeText(pickFirst(row, ["pdp_description", "detail_description"]));
  if (!rawSpecsJson && !rawSpecsText) {
    return null;
  }

  // Keep structure simple: store the raw scraped JSON string if present.
  // extracted_specs_json can be populated by a later normalizer/matcher.
  return {
    raw_specs_json: rawSpecsJson,
    raw_specs_text: rawSpecsText,
    extracted_specs_json: rawSpecsJson,
  };
}

async function ensureDbDir(dbPath) {
  const dir = path.dirname(dbPath);
  await fs.mkdir(dir, { recursive: true });
}

function initSchemaV2(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  // Matches the schema discovered from `ac_price_monitor_v2_20260205.db`.
  db.exec(`
CREATE TABLE IF NOT EXISTS pid_alias_map (
  alias_pid VARCHAR(32) NOT NULL,
  canonical_pid VARCHAR(32) NOT NULL,
  reason TEXT,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (alias_pid)
);

CREATE TABLE IF NOT EXISTS product_master (
  canonical_product_id VARCHAR(32) NOT NULL,
  pid_readable TEXT NOT NULL,
  model_sig_norm VARCHAR(255) NOT NULL,
  model_sig_raw VARCHAR(255),
  btu INTEGER,
  voltage VARCHAR(20),
  mode VARCHAR(20),
  type VARCHAR(20),
  brand VARCHAR(100),
  title TEXT,
  image TEXT,
  created_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  PRIMARY KEY (canonical_product_id)
);

CREATE TABLE IF NOT EXISTS price_facts (
  id INTEGER NOT NULL,
  date DATE NOT NULL,
  website VARCHAR(100) NOT NULL,
  canonical_product_id VARCHAR(32) NOT NULL,
  price FLOAT NOT NULL,
  link TEXT,
  source_product_key VARCHAR(255) NOT NULL,
  scraped_at DATETIME,
  PRIMARY KEY (id),
  CONSTRAINT uq_price_facts_day_site_pid UNIQUE (date, website, canonical_product_id),
  FOREIGN KEY(canonical_product_id) REFERENCES product_master (canonical_product_id)
);

CREATE TABLE IF NOT EXISTS product_details (
  id INTEGER NOT NULL,
  website VARCHAR(100) NOT NULL,
  link TEXT NOT NULL,
  source_product_key VARCHAR(255),
  canonical_product_id VARCHAR(32),
  raw_specs_json TEXT,
  raw_specs_text TEXT,
  extracted_specs_json TEXT,
  scrape_date DATE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_product_details_site_link UNIQUE (website, link)
);

CREATE TABLE IF NOT EXISTS product_detail_master (
  canonical_product_id VARCHAR(32) NOT NULL,
  merged_specs_json TEXT,
  spec_description TEXT,
  spec_desc_images_480 TEXT,
  spec_desc_images_hd TEXT,
  spec_desc_images_meta TEXT,
  source_sites_json TEXT,
  conflicts_json TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (canonical_product_id),
  FOREIGN KEY(canonical_product_id) REFERENCES product_master (canonical_product_id)
);

CREATE TABLE IF NOT EXISTS raw_unmatched (
  id INTEGER NOT NULL,
  website VARCHAR(100),
  name TEXT,
  price FLOAT,
  link TEXT,
  image TEXT,
  btu INTEGER,
  brand VARCHAR(100),
  energy_efficiency VARCHAR(100),
  scrape_date DATE,
  reason TEXT,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id)
);
  `);
}

export async function persistRunToSqliteV2({ dbPath, runSummary, rows }) {
  if (!dbPath) {
    return {
      enabled: false,
      reason: "db_path_empty",
      products_upserted: 0,
      price_facts_upserted: 0,
      product_details_upserted: 0,
    };
  }

  await ensureDbDir(dbPath);
  const db = new DatabaseSync(dbPath);

  try {
    initSchemaV2(db);

    const capturedAt =
      normalizeText(runSummary?.captured_at) || normalizeText(rows?.[0]?.captured_at);
    if (!capturedAt) {
      throw new Error("persistRunToSqliteV2: captured_at is required");
    }
    const scrapeDateMx = toMexicoCityDate(capturedAt);
    if (!scrapeDateMx) {
      throw new Error("persistRunToSqliteV2: failed to derive Mexico City date");
    }
    const scrapedAtUtc = toSqliteUtcDatetime(capturedAt) || toSqliteUtcDatetime(new Date());
    const nowUtc = toSqliteUtcDatetime(new Date()) || scrapedAtUtc;

    const upsertProduct = db.prepare(`
INSERT INTO product_master(
  canonical_product_id, pid_readable, model_sig_norm, model_sig_raw, btu, voltage, mode, type,
  brand, title, image, created_at, last_seen_at
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(canonical_product_id) DO UPDATE SET
  pid_readable=excluded.pid_readable,
  model_sig_norm=excluded.model_sig_norm,
  model_sig_raw=excluded.model_sig_raw,
  btu=COALESCE(excluded.btu, product_master.btu),
  voltage=COALESCE(excluded.voltage, product_master.voltage),
  mode=COALESCE(excluded.mode, product_master.mode),
  type=COALESCE(excluded.type, product_master.type),
  brand=COALESCE(excluded.brand, product_master.brand),
  title=COALESCE(excluded.title, product_master.title),
  image=COALESCE(excluded.image, product_master.image),
  last_seen_at=excluded.last_seen_at;
    `);

    const upsertPriceFact = db.prepare(`
INSERT INTO price_facts(
  date, website, canonical_product_id, price, link, source_product_key, scraped_at
) VALUES(?,?,?,?,?,?,?)
ON CONFLICT(date, website, canonical_product_id) DO UPDATE SET
  price=excluded.price,
  link=excluded.link,
  source_product_key=excluded.source_product_key,
  scraped_at=excluded.scraped_at;
    `);

    const upsertDetail = db.prepare(`
INSERT INTO product_details(
  website, link, source_product_key, canonical_product_id,
  raw_specs_json, raw_specs_text, extracted_specs_json,
  scrape_date, created_at, updated_at
) VALUES(?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(website, link) DO UPDATE SET
  source_product_key=COALESCE(product_details.source_product_key, excluded.source_product_key),
  canonical_product_id=COALESCE(product_details.canonical_product_id, excluded.canonical_product_id),
  raw_specs_json=COALESCE(excluded.raw_specs_json, product_details.raw_specs_json),
  raw_specs_text=COALESCE(excluded.raw_specs_text, product_details.raw_specs_text),
  extracted_specs_json=COALESCE(excluded.extracted_specs_json, product_details.extracted_specs_json),
  scrape_date=COALESCE(excluded.scrape_date, product_details.scrape_date),
  updated_at=excluded.updated_at;
    `);

    db.exec("BEGIN;");

    let productsUpserted = 0;
    let priceFactsUpserted = 0;
    let detailsUpserted = 0;

    for (const row of rows || []) {
      const website = ensureWebsiteName(row?.site);
      const primaryKey = derivePrimaryProductKey(row);
      if (!primaryKey) {
        continue;
      }

      const sourceProductKey = buildSourceProductKey(website, primaryKey);
      const pidReadable = `PID::SPK::${website}::${primaryKey}`;
      const canonicalProductId = canonicalPidFromPidReadable(pidReadable);
      const modelSigNorm = `SPK::${website}::${primaryKey}`;

      const title = normalizeText(pickFirst(row, ["pdp_name", "name", "product_name"]));
      const brand = normalizeText(pickFirst(row, ["brand", "ldjson_brand_name"]));
      const link = normalizeText(pickFirst(row, ["product_url", "link"]));
      const image = normalizeText(pickFirst(row, ["image_url", "image"]));

      upsertProduct.run(
        canonicalProductId,
        pidReadable,
        modelSigNorm,
        null,
        null,
        null,
        null,
        null,
        brand,
        title,
        image,
        scrapedAtUtc,
        scrapedAtUtc,
      );
      productsUpserted += 1;

      const price = normalizeNumber(pickFirst(row, ["sale_price_mxn", "price", "pdp_sale_price_mxn"]));
      if (price !== null && price > 0) {
        upsertPriceFact.run(
          scrapeDateMx,
          website,
          canonicalProductId,
          price,
          link,
          sourceProductKey,
          scrapedAtUtc,
        );
        priceFactsUpserted += 1;
      }

      const detail = extractDetailFields(row);
      if (detail && link) {
        upsertDetail.run(
          website,
          link,
          sourceProductKey,
          canonicalProductId,
          detail.raw_specs_json,
          detail.raw_specs_text,
          detail.extracted_specs_json,
          scrapeDateMx,
          nowUtc,
          nowUtc,
        );
        detailsUpserted += 1;
      }
    }

    db.exec("COMMIT;");

    return {
      enabled: true,
      reason: "ok",
      db_path: path.resolve(dbPath),
      date_mx: scrapeDateMx,
      products_upserted: productsUpserted,
      price_facts_upserted: priceFactsUpserted,
      product_details_upserted: detailsUpserted,
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
