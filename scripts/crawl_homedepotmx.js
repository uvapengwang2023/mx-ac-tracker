#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { request } from "playwright";
import { persistRunToSqliteV2 } from "./sqlite_store_v2.js";

// Home Depot Mexico category crawl (prices only).
// Approach: use the site's JSON API endpoints (HCL Commerce) with strict safety pacing.
//
// Safety posture:
// - Proxy required by default (to avoid exposing your IP and because the site is geo-restricted for some regions).
// - Low request volume (offset/limit pagination).
// - Immediate stop on likely anti-bot / blocked responses.

const DEFAULT_BASE_URL =
  "https://www.homedepot.com.mx/b/ventilacion-y-calefaccion/aire-acondicionado";
const DEFAULT_OUTPUT_DIR = "data/homedepotmx";
const DEFAULT_DB_PATH = "data/ac_price_monitor_mexico_v2.db";

const DEFAULT_PAGE_SIZE = 28;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 6000;

const DEFAULT_MIN_DELAY_MS = 2500;
const DEFAULT_MAX_DELAY_MS = 4500;
const DEFAULT_LONG_BREAK_EVERY_REQUESTS = 3;
const DEFAULT_LONG_BREAK_MIN_MS = 15000;
const DEFAULT_LONG_BREAK_MAX_MS = 25000;

// Observed stable context params (captured from an in-browser session).
// Keeping these makes the API return priced products; omitting them often yields empty price fields.
const HDMX_CONTEXT = {
  storeId: "10351",
  contractId: "4000000000000000003",
  langId: "-5",
  currency: "MXN",
  marketId: "21",
  stLocId: "12605",
  physicalStoreId: "8702",
  marketOnly: "true",
  extendedCatalog: "false",
  profileName: "HCL_V2_findProductsByCategoryWithPriceRangeSequenceTest",
  minPrice: "-1",
  maxPrice: "-1",
  selectedPageOffset: "0",
  orderBy: "0",
};

const SITE = "homedepotmx";
const BLOCK_STATUS_CODES = new Set([401, 403, 429, 503, 520, 521, 522, 525]);
const ANTIBOT_PATTERNS = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /cdn-cgi\/challenge-platform/i,
  /cloudflare ray id/i,
  /\bcf-ray\b/i,
  /\bcf-chl\b/i,
  /just a moment\.\.\./i,
  /attention required/i,
  /verify you are human/i,
  /access denied/i,
  /forbidden/i,
  /bot detection/i,
  /unusual traffic/i,
  /request unsuccessful/i,
];

class SafetyStopError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.name = "SafetyStopError";
    this.code = code || "SAFETY_STOP";
    this.status = status;
  }
}

class RequestError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.name = "RequestError";
    this.code = code || "REQUEST_ERROR";
    this.status = status;
  }
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  const text = normalizeWhitespace(value);
  return text ? text : null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function randomIntInclusive(min, max) {
  const minInt = Math.ceil(min);
  const maxInt = Math.floor(max);
  if (maxInt <= minInt) {
    return minInt;
  }
  return Math.floor(Math.random() * (maxInt - minInt + 1)) + minInt;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeUrlForLog(urlString) {
  try {
    const url = new URL(urlString);
    const keys = Array.from(url.searchParams.keys()).sort();
    return {
      origin: url.origin,
      path: url.pathname,
      query_keys: keys,
    };
  } catch {
    return {
      origin: null,
      path: String(urlString || ""),
      query_keys: [],
    };
  }
}

async function ensureDirs(dirPaths) {
  await Promise.all(dirPaths.map((dir) => fs.mkdir(dir, { recursive: true })));
}

async function writeLatestOutputs({ outputRoot, runsDir, runSummary, products }) {
  const latestProductsPath = path.join(outputRoot, "latest_products.json");
  const latestRunPath = path.join(runsDir, "latest_run.json");

  await fs.writeFile(latestProductsPath, JSON.stringify(products || [], null, 2), "utf8");
  await fs.writeFile(latestRunPath, JSON.stringify(runSummary, null, 2), "utf8");

  return { latestProductsPath, latestRunPath };
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    outputDir: DEFAULT_OUTPUT_DIR,
    dbPath: process.env.DB_PATH || DEFAULT_DB_PATH,
    saveToDb: true,
    pageSize: DEFAULT_PAGE_SIZE,
    maxPages: null,
    maxProducts: 5000,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    longBreakEveryRequests: DEFAULT_LONG_BREAK_EVERY_REQUESTS,
    longBreakMinMs: DEFAULT_LONG_BREAK_MIN_MS,
    longBreakMaxMs: DEFAULT_LONG_BREAK_MAX_MS,
    proxy: process.env.PROXY_URL || "",
    allowDirectIp: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--base-url" && next) {
      args.baseUrl = next;
      i += 1;
    } else if (token === "--output-dir" && next) {
      args.outputDir = next;
      i += 1;
    } else if (token === "--db-path" && next) {
      args.dbPath = next;
      i += 1;
    } else if (token === "--no-db") {
      args.saveToDb = false;
    } else if (token === "--page-size" && next) {
      args.pageSize = Number(next);
      i += 1;
    } else if (token === "--max-pages" && next) {
      args.maxPages = Number(next);
      i += 1;
    } else if (token === "--max-products" && next) {
      args.maxProducts = Number(next);
      i += 1;
    } else if (token === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      i += 1;
    } else if (token === "--max-retries" && next) {
      args.maxRetries = Number(next);
      i += 1;
    } else if (token === "--backoff-base-ms" && next) {
      args.backoffBaseMs = Number(next);
      i += 1;
    } else if (token === "--min-delay-ms" && next) {
      args.minDelayMs = Number(next);
      i += 1;
    } else if (token === "--max-delay-ms" && next) {
      args.maxDelayMs = Number(next);
      i += 1;
    } else if (token === "--long-break-every" && next) {
      args.longBreakEveryRequests = Number(next);
      i += 1;
    } else if (token === "--long-break-min-ms" && next) {
      args.longBreakMinMs = Number(next);
      i += 1;
    } else if (token === "--long-break-max-ms" && next) {
      args.longBreakMaxMs = Number(next);
      i += 1;
    } else if (token === "--allow-direct-ip") {
      args.allowDirectIp = true;
    } else if (token === "--proxy" && next) {
      throw new Error(
        "Security policy: CLI --proxy is disabled. Use PROXY_URL environment variable instead.",
      );
    }
  }

  if (!args.saveToDb) {
    args.dbPath = "";
  }
  if (!Number.isFinite(args.pageSize) || args.pageSize <= 0) {
    throw new Error("--page-size must be a positive number");
  }
  if (args.maxPages !== null && (!Number.isFinite(args.maxPages) || args.maxPages <= 0)) {
    throw new Error("--max-pages must be a positive number");
  }
  if (!Number.isFinite(args.maxProducts) || args.maxProducts <= 0) {
    throw new Error("--max-products must be a positive number");
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  if (!Number.isFinite(args.maxRetries) || args.maxRetries < 0) {
    throw new Error("--max-retries must be >= 0");
  }
  if (!Number.isFinite(args.backoffBaseMs) || args.backoffBaseMs <= 0) {
    throw new Error("--backoff-base-ms must be a positive number");
  }
  if (!Number.isFinite(args.minDelayMs) || args.minDelayMs < 0) {
    throw new Error("--min-delay-ms must be a non-negative number");
  }
  if (!Number.isFinite(args.maxDelayMs) || args.maxDelayMs < 0) {
    throw new Error("--max-delay-ms must be a non-negative number");
  }
  if (args.maxDelayMs < args.minDelayMs) {
    throw new Error("--max-delay-ms must be >= --min-delay-ms");
  }
  if (!Number.isFinite(args.longBreakEveryRequests) || args.longBreakEveryRequests < 0) {
    throw new Error("--long-break-every must be a non-negative number");
  }
  if (!Number.isFinite(args.longBreakMinMs) || args.longBreakMinMs < 0) {
    throw new Error("--long-break-min-ms must be a non-negative number");
  }
  if (!Number.isFinite(args.longBreakMaxMs) || args.longBreakMaxMs < 0) {
    throw new Error("--long-break-max-ms must be a non-negative number");
  }
  if (args.longBreakMaxMs < args.longBreakMinMs) {
    throw new Error("--long-break-max-ms must be >= --long-break-min-ms");
  }

  return args;
}

function buildProxyOptions(proxyUrl) {
  if (!proxyUrl) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new SafetyStopError("PROXY_URL is not a valid URL", "INVALID_PROXY");
  }
  return {
    server: `${parsed.protocol}//${parsed.host}`,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}

function looksLikeAntibot(text) {
  const body = String(text || "");
  return ANTIBOT_PATTERNS.some((re) => re.test(body));
}

async function getJsonWithRetry(api, url, { label, timeoutMs, maxRetries, backoffBaseMs }) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await api.get(url, { timeout: timeoutMs });
      const status = res.status();
      const headers = res.headers();
      const contentType = headers["content-type"] || "";
      const bodyText = await res.text();

      if (BLOCK_STATUS_CODES.has(status)) {
        throw new SafetyStopError(
          `${label}: blocked with HTTP ${status}`,
          "BLOCKED_STATUS",
          status,
        );
      }

      if (!/application\/json/i.test(contentType)) {
        if (looksLikeAntibot(bodyText)) {
          throw new SafetyStopError(`${label}: anti-bot HTML detected`, "ANTIBOT_HTML", status);
        }
        throw new RequestError(
          `${label}: expected JSON but got content-type=${contentType || "unknown"}`,
          "UNEXPECTED_CONTENT_TYPE",
          status,
        );
      }

      let json;
      try {
        json = JSON.parse(bodyText);
      } catch (error) {
        throw new RequestError(`${label}: failed to parse JSON`, "JSON_PARSE_ERROR", status);
      }

      return { status, json };
    } catch (error) {
      if (error instanceof SafetyStopError) {
        throw error;
      }
      lastError = error;
      if (attempt >= maxRetries) {
        break;
      }
      const backoff = backoffBaseMs * 2 ** attempt + randomIntInclusive(0, 1200);
      await delay(backoff);
    }
  }
  throw lastError || new RequestError(`${label}: request failed`, "REQUEST_FAILED");
}

function deriveIdentifierFromBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("--base-url must be a valid URL");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  const marker = "/b/";
  const idx = pathname.indexOf(marker);
  const tail = idx >= 0 ? pathname.slice(idx + marker.length) : pathname.replace(/^\/+/, "");
  const identifier = tail.replace(/^\/+/, "");
  if (!identifier) {
    throw new Error("Failed to derive category identifier from --base-url");
  }
  return identifier;
}

function toAbsoluteProductUrl(hrefOrPath) {
  const href = normalizeText(hrefOrPath);
  if (!href) {
    return null;
  }
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  const clean = href.startsWith("/") ? href : `/${href}`;
  return `https://www.homedepot.com.mx${clean}`;
}

function toCdnImageUrl(pathOrUrl) {
  const value = normalizeText(pathOrUrl);
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const clean = value.replace(/^\/+/, "");
  return `https://cdn.homedepot.com.mx/${clean}`;
}

function pickAttachmentUrl(item) {
  const urls = item?.["attachments.url"] ?? item?.attachments?.url ?? null;
  if (Array.isArray(urls) && urls.length > 0) {
    // Prefer medium JPG if present.
    const preferred =
      urls.find((u) => /-m\.(jpg|jpeg|png)$/i.test(String(u))) ||
      urls.find((u) => /\.(jpg|jpeg|png)$/i.test(String(u))) ||
      urls[0];
    return String(preferred || "");
  }
  if (typeof urls === "string") {
    return urls;
  }
  const thumb = item?.thumbnailRaw || item?.thumbnail || "";
  return typeof thumb === "string" ? thumb : "";
}

function extractPrice(item) {
  const storeKey = `x_prices.${HDMX_CONTEXT.physicalStoreId}.mxn`;
  const direct = parseNumber(item?.[storeKey]);

  const priceArr = Array.isArray(item?.price) ? item.price : [];
  const display = parseNumber(priceArr.find((p) => p?.usage === "Display")?.value);
  const offer = parseNumber(priceArr.find((p) => p?.usage === "Offer")?.value);

  const sale = direct ?? offer ?? display;
  const original = display && sale && display > sale ? display : null;

  return { sale_price_mxn: sale, original_price_mxn: original };
}

function buildUrlsApiUrl(identifier) {
  const url = new URL("https://www.homedepot.com.mx/search/resources/api/v2/urls");
  url.searchParams.set("storeId", HDMX_CONTEXT.storeId);
  url.searchParams.set("identifier", identifier);
  return url.toString();
}

function buildCategoryProductsApiUrl({ categoryId, limit, offset }) {
  const url = new URL("https://www.homedepot.com.mx/search/resources/api/v2/products");
  url.searchParams.set("storeId", HDMX_CONTEXT.storeId);
  url.searchParams.set("categoryId", String(categoryId));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  // Context params required for priced results.
  url.searchParams.set("contractId", HDMX_CONTEXT.contractId);
  url.searchParams.set("currency", HDMX_CONTEXT.currency);
  url.searchParams.set("langId", HDMX_CONTEXT.langId);
  url.searchParams.set("marketId", HDMX_CONTEXT.marketId);
  url.searchParams.set("stLocId", HDMX_CONTEXT.stLocId);
  url.searchParams.set("extendedCatalog", HDMX_CONTEXT.extendedCatalog);
  url.searchParams.set("marketOnly", HDMX_CONTEXT.marketOnly);
  url.searchParams.set("physicalStoreId", HDMX_CONTEXT.physicalStoreId);
  url.searchParams.set("profileName", HDMX_CONTEXT.profileName);
  url.searchParams.set("minPrice", HDMX_CONTEXT.minPrice);
  url.searchParams.set("maxPrice", HDMX_CONTEXT.maxPrice);
  url.searchParams.set("selectedPageOffset", HDMX_CONTEXT.selectedPageOffset);
  url.searchParams.set("orderBy", HDMX_CONTEXT.orderBy);

  return url.toString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.proxy && !args.allowDirectIp) {
    console.error(
      "Safety policy: PROXY_URL is required for HomeDepotMX crawl by default (to avoid exposing your IP). Use --allow-direct-ip if you accept the risk.",
    );
    process.exitCode = 2;
    return;
  }

  const now = new Date();
  const capturedAt = now.toISOString();
  const outputRoot = path.resolve(args.outputDir);
  const runsDir = path.join(outputRoot, "runs");
  await ensureDirs([outputRoot, runsDir]);

  const runSummary = {
    site: SITE,
    mode: "crawl",
    captured_at: capturedAt,
    base_url: sanitizeUrlForLog(args.baseUrl),
    final_url: null,
    category: {
      identifier: null,
      category_id: null,
    },
    api: {
      urls_endpoint: sanitizeUrlForLog("https://www.homedepot.com.mx/search/resources/api/v2/urls"),
      products_endpoint: sanitizeUrlForLog(
        "https://www.homedepot.com.mx/search/resources/api/v2/products",
      ),
      context: {
        storeId: HDMX_CONTEXT.storeId,
        marketId: HDMX_CONTEXT.marketId,
        physicalStoreId: HDMX_CONTEXT.physicalStoreId,
        profileName: HDMX_CONTEXT.profileName,
      },
    },
    pagination: {
      page_size: args.pageSize,
      total_reported: null,
      pages_planned: null,
      pages_fetched: 0,
      stop_reason: null,
    },
    database: {
      enabled: args.saveToDb,
      reason: "not_run",
      db_path: args.dbPath ? path.resolve(args.dbPath) : null,
      date_mx: null,
      products_upserted: 0,
      price_facts_upserted: 0,
      product_details_upserted: 0,
    },
    safety: {
      proxy_required: true,
      proxy_enabled: Boolean(args.proxy),
      direct_ip_allowed: Boolean(args.allowDirectIp),
      pacing: {
        min_delay_ms: args.minDelayMs,
        max_delay_ms: args.maxDelayMs,
        long_break_every_requests: args.longBreakEveryRequests,
        long_break_min_ms: args.longBreakMinMs,
        long_break_max_ms: args.longBreakMaxMs,
      },
    },
    products_extracted: 0,
    pages: [],
    output: {
      latest_products_json: path.join(outputRoot, "latest_products.json"),
      latest_run_json: path.join(runsDir, "latest_run.json"),
    },
    notes:
      "HomeDepotMX crawl uses JSON API endpoints (urls + products) and does not crawl PDP details.",
  };

  const products = [];
  const seen = new Set();
  let requestCount = 0;

  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  const proxy = buildProxyOptions(args.proxy);
  const api = await request.newContext({
    userAgent,
    extraHTTPHeaders: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: args.baseUrl,
    },
    proxy: proxy || undefined,
  });

  try {
    const identifier = deriveIdentifierFromBaseUrl(args.baseUrl);
    runSummary.category.identifier = identifier;

    const urlsApiUrl = buildUrlsApiUrl(identifier);
    const urlsResult = await getJsonWithRetry(api, urlsApiUrl, {
      label: "urls_api",
      timeoutMs: args.timeoutMs,
      maxRetries: args.maxRetries,
      backoffBaseMs: args.backoffBaseMs,
    });
    requestCount += 1;

    const contents = Array.isArray(urlsResult.json?.contents) ? urlsResult.json.contents : [];
    const categoryToken = contents.find((c) => (c?.tokenName || "") === "CategoryToken") || contents[0];
    const categoryId = normalizeText(categoryToken?.tokenValue);
    const pageType = normalizeText(categoryToken?.page?.type);

    if (!categoryId) {
      throw new SafetyStopError("urls_api: missing category tokenValue", "MISSING_CATEGORY_ID");
    }
    if (pageType && pageType !== "ProductListPage") {
      throw new SafetyStopError(
        `urls_api: expected ProductListPage but got ${pageType}`,
        "UNEXPECTED_PAGE_TYPE",
      );
    }

    runSummary.category.category_id = categoryId;

    // Crawl paginated products.
    let totalReported = null;
    let plannedPages = null;

    for (let pageIndex = 0; pageIndex < 10000; pageIndex += 1) {
      const offset = pageIndex * args.pageSize;
      const productsApiUrl = buildCategoryProductsApiUrl({
        categoryId,
        limit: args.pageSize,
        offset,
      });

      const result = await getJsonWithRetry(api, productsApiUrl, {
        label: `products_api(offset=${offset})`,
        timeoutMs: args.timeoutMs,
        maxRetries: args.maxRetries,
        backoffBaseMs: args.backoffBaseMs,
      });
      requestCount += 1;

      const total = parseNumber(result.json?.total);
      if (totalReported === null && total !== null) {
        totalReported = total;
        plannedPages = Math.max(1, Math.ceil(totalReported / args.pageSize));
        runSummary.pagination.total_reported = totalReported;
        runSummary.pagination.pages_planned = plannedPages;
      }

      const items = Array.isArray(result.json?.contents) ? result.json.contents : [];
      let added = 0;

      for (const item of items) {
        const productId = normalizeText(item?.partNumber);
        if (!productId) {
          continue;
        }
        if (seen.has(productId)) {
          continue;
        }

        const name = normalizeWhitespace(item?.name);
        const brand = normalizeText(item?.manufacturer);
        const href = item?.seo?.href || item?.seo?.url || null;
        const productUrl = toAbsoluteProductUrl(href);
        const attachment = pickAttachmentUrl(item);
        const imageUrl = toCdnImageUrl(attachment);
        const price = extractPrice(item);

        products.push({
          site: SITE,
          captured_at: capturedAt,
          product_id: productId,
          name: name || productId,
          brand,
          product_url: productUrl,
          image_url: imageUrl,
          sale_price_mxn: price.sale_price_mxn,
          original_price_mxn: price.original_price_mxn,
        });
        seen.add(productId);
        added += 1;

        if (products.length >= args.maxProducts) {
          break;
        }
      }

      runSummary.pagination.pages_fetched = pageIndex + 1;
      runSummary.products_extracted = products.length;
      runSummary.pages.push({
        index: pageIndex + 1,
        offset,
        items_returned: items.length,
        items_new: added,
        total_unique_products: products.length,
      });

      await writeLatestOutputs({ outputRoot, runsDir, runSummary, products });

      if (products.length >= args.maxProducts) {
        runSummary.pagination.stop_reason = "max_products_reached";
        break;
      }

      if (args.maxPages !== null && pageIndex + 1 >= args.maxPages) {
        runSummary.pagination.stop_reason = "max_pages_reached";
        break;
      }

      // Stop when we hit the end.
      if (items.length === 0) {
        runSummary.pagination.stop_reason = "empty_page";
        break;
      }
      if (totalReported !== null && products.length >= totalReported) {
        runSummary.pagination.stop_reason = "completed";
        break;
      }
      if (plannedPages !== null && pageIndex + 1 >= plannedPages) {
        runSummary.pagination.stop_reason = "completed";
        break;
      }

      // Between-request pacing (safety-first).
      const shortDelay = randomIntInclusive(args.minDelayMs, args.maxDelayMs);
      await delay(shortDelay);

      if (args.longBreakEveryRequests > 0 && requestCount % args.longBreakEveryRequests === 0) {
        const longDelay = randomIntInclusive(args.longBreakMinMs, args.longBreakMaxMs);
        await delay(longDelay);
      }
    }

    runSummary.final_url = runSummary.base_url;

    if (args.saveToDb && products.length > 0) {
      const dbResult = await persistRunToSqliteV2({
        dbPath: args.dbPath,
        runSummary,
        rows: products,
      });
      runSummary.database = dbResult;
    } else {
      runSummary.database = {
        enabled: args.saveToDb,
        reason: args.saveToDb ? "no_products" : "db_disabled",
        db_path: args.dbPath ? path.resolve(args.dbPath) : null,
        date_mx: null,
        products_upserted: 0,
        price_facts_upserted: 0,
        product_details_upserted: 0,
      };
    }

    await writeLatestOutputs({ outputRoot, runsDir, runSummary, products });
    console.log("HomeDepotMX crawl finished.");
    console.log(`Unique products extracted: ${products.length}`);
  } catch (error) {
    runSummary.failure = {
      reason: error?.code || error?.name || "unknown_error",
      message: normalizeWhitespace(error?.message || String(error)),
      status: error?.status || null,
    };
    runSummary.final_url = runSummary.final_url || runSummary.base_url;
    await writeLatestOutputs({ outputRoot, runsDir, runSummary, products });
    console.error("HomeDepotMX crawl failed.");
    console.error(error);
    process.exitCode = error instanceof SafetyStopError ? 4 : 1;
  } finally {
    try {
      await api.dispose();
    } catch {
      // ignore
    }
  }
}

main();

