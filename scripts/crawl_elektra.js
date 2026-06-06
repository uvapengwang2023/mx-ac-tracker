#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { request } from "playwright";
import { persistRunToSqliteV2 } from "./sqlite_store_v2.js";

const DEFAULT_BASE_URL =
  "https://www.elektra.mx/linea-blanca/climatizacion-y-ventilacion/minisplits";
const DEFAULT_OUTPUT_DIR = "data/elektra";
const DEFAULT_DB_PATH = "data/ac_price_monitor_mexico_v2.db";
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MIN_DELAY_MS = 4000;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 6000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 1;
const DEFAULT_LONG_BREAK_EVERY_REQUESTS = 2;
const DEFAULT_LONG_BREAK_MIN_MS = 15000;
const DEFAULT_LONG_BREAK_MAX_MS = 35000;
const FALLBACK_MAX_PAGES = 30;
const DEFAULT_CATEGORY_PATH_FALLBACK = "/1371645/1371681/1371894/";

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
  /akamai/i,
  /imperva/i,
  /incapsula/i,
  /verify you are human/i,
  /access denied/i,
  /forbidden/i,
  /bot detection/i,
  /unusual traffic/i,
  /request unsuccessful/i,
];

class SafetyStopError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SafetyStopError";
    this.code = code || "SAFETY_STOP";
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

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    outputDir: DEFAULT_OUTPUT_DIR,
    dbPath: process.env.DB_PATH || DEFAULT_DB_PATH,
    saveToDb: true,
    categoryPath: "",
    discoverCategoryPath: false,
    pageSize: DEFAULT_PAGE_SIZE,
    maxPages: null,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    longBreakEveryRequests: DEFAULT_LONG_BREAK_EVERY_REQUESTS,
    longBreakMinMs: DEFAULT_LONG_BREAK_MIN_MS,
    longBreakMaxMs: DEFAULT_LONG_BREAK_MAX_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
    proxy: process.env.PROXY_URL || "",
    crawlDetails: false,
    maxDetailProducts: null,
    keepHistory: false,
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
    } else if (token === "--category-path" && next) {
      args.categoryPath = next;
      i += 1;
    } else if (token === "--discover-category-path") {
      args.discoverCategoryPath = true;
    } else if (token === "--page-size" && next) {
      args.pageSize = Number(next);
      i += 1;
    } else if (token === "--max-pages" && next) {
      args.maxPages = Number(next);
      i += 1;
    } else if (token === "--delay-ms" && next) {
      const fixedDelay = Number(next);
      args.minDelayMs = fixedDelay;
      args.maxDelayMs = fixedDelay;
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
    } else if (token === "--no-long-break") {
      args.longBreakEveryRequests = 0;
    } else if (token === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      i += 1;
    } else if (token === "--max-retries" && next) {
      args.maxRetries = Number(next);
      i += 1;
    } else if (token === "--backoff-base-ms" && next) {
      args.backoffBaseMs = Number(next);
      i += 1;
    } else if (token === "--max-consecutive-failures" && next) {
      args.maxConsecutiveFailures = Number(next);
      i += 1;
    } else if (token === "--crawl-details") {
      args.crawlDetails = true;
    } else if (token === "--max-detail-products" && next) {
      args.maxDetailProducts = Number(next);
      i += 1;
    } else if (token === "--keep-history") {
      args.keepHistory = true;
    } else if (token === "--proxy" && next) {
      throw new Error(
        "Security policy: CLI --proxy is disabled. Use PROXY_URL environment variable instead.",
      );
    }
  }

  if (!Number.isFinite(args.pageSize) || args.pageSize <= 0) {
    throw new Error("--page-size must be a positive number");
  }
  if (!args.saveToDb) {
    args.dbPath = "";
  }
  if (
    args.maxPages !== null &&
    (!Number.isFinite(args.maxPages) || args.maxPages <= 0)
  ) {
    throw new Error("--max-pages must be a positive number");
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
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
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
  if (!Number.isFinite(args.maxRetries) || args.maxRetries < 0) {
    throw new Error("--max-retries must be a non-negative number");
  }
  if (!Number.isFinite(args.backoffBaseMs) || args.backoffBaseMs <= 0) {
    throw new Error("--backoff-base-ms must be a positive number");
  }
  if (
    !Number.isFinite(args.maxConsecutiveFailures) ||
    args.maxConsecutiveFailures <= 0
  ) {
    throw new Error("--max-consecutive-failures must be a positive number");
  }
  if (
    args.maxDetailProducts !== null &&
    (!Number.isFinite(args.maxDetailProducts) || args.maxDetailProducts <= 0)
  ) {
    throw new Error("--max-detail-products must be a positive number");
  }

  return args;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function makeTimestamp(date) {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(
      date.getUTCDate(),
    )}` +
    `_${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(
      date.getUTCSeconds(),
    )}`
  );
}

function randomIntInclusive(min, max) {
  const minInt = Math.ceil(min);
  const maxInt = Math.floor(max);
  if (maxInt <= minInt) {
    return minInt;
  }
  return Math.floor(Math.random() * (maxInt - minInt + 1)) + minInt;
}

function computeBackoffMs(attempt, baseMs) {
  const exponential = baseMs * (2 ** attempt);
  const jitter = randomIntInclusive(500, 3000);
  return exponential + jitter;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseMxMoney(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const number = Number(raw);
  if (Number.isFinite(number)) {
    return number;
  }
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  return Number(digits);
}

function sanitizeCategoryPath(input) {
  const text = normalizeWhitespace(input);
  if (!text) {
    return "";
  }
  const stripped = text.replace(/^C:/i, "");
  const prefixed = stripped.startsWith("/") ? stripped : `/${stripped}`;
  return prefixed.endsWith("/") ? prefixed : `${prefixed}/`;
}

function parseResourcesHeader(value) {
  const text = String(value || "");
  const match = text.match(/(\d+)-(\d+)\/(\d+)/);
  if (!match) {
    return {
      from: null,
      to: null,
      total: null,
    };
  }
  return {
    from: Number(match[1]),
    to: Number(match[2]),
    total: Number(match[3]),
  };
}

function toAbsoluteUrl(baseOrigin, maybeUrl) {
  if (!maybeUrl) {
    return "";
  }
  try {
    return new URL(maybeUrl, baseOrigin).toString();
  } catch {
    return String(maybeUrl);
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows, headers) {
  const head = `${headers.join(",")}\n`;
  const body = rows
    .map((row) => headers.map((key) => csvEscape(row[key])).join(","))
    .join("\n");
  return body ? head + body + "\n" : head;
}

async function ensureDirs(paths) {
  await Promise.all(paths.map((dir) => fs.mkdir(dir, { recursive: true })));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath, fallbackValue) {
  if (!(await pathExists(filePath))) {
    return fallbackValue;
  }
  const data = await fs.readFile(filePath, "utf8");
  return JSON.parse(data);
}

async function appendPriceHistory(historyPath, rows) {
  const headers = [
    "site",
    "captured_at",
    "product_id",
    "sku_id",
    "name",
    "product_url",
    "seller_name",
    "sale_price_mxn",
    "original_price_mxn",
  ];

  const hasFile = await pathExists(historyPath);
  const csvChunk = toCsv(rows, headers);
  if (hasFile) {
    const withoutHeader = csvChunk.split("\n").slice(1).join("\n");
    if (withoutHeader.trim()) {
      await fs.appendFile(historyPath, withoutHeader, "utf8");
    }
    return;
  }
  await fs.writeFile(historyPath, csvChunk, "utf8");
}

function parseRobotsGroups(robotsText) {
  const groups = [];
  let currentAgents = [];
  let currentRules = [];

  const flushGroup = () => {
    if (!currentAgents.length) {
      return;
    }
    groups.push({
      agents: [...currentAgents],
      rules: [...currentRules],
    });
    currentAgents = [];
    currentRules = [];
  };

  for (const rawLine of String(robotsText).split(/\r?\n/)) {
    const lineWithoutComment = rawLine.split("#")[0].trim();
    if (!lineWithoutComment) {
      if (currentRules.length) {
        flushGroup();
      }
      continue;
    }

    const separatorIndex = lineWithoutComment.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }

    const key = lineWithoutComment.slice(0, separatorIndex).trim().toLowerCase();
    const value = lineWithoutComment.slice(separatorIndex + 1).trim();

    if (key === "user-agent") {
      if (currentRules.length) {
        flushGroup();
      }
      currentAgents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && currentAgents.length) {
      currentRules.push({
        type: key,
        pattern: value,
      });
    }
  }

  flushGroup();
  return groups;
}

function matchesRobotsPattern(target, rawPattern) {
  if (!rawPattern) {
    return false;
  }
  const pattern = String(rawPattern).trim();
  if (!pattern) {
    return false;
  }

  if (!pattern.includes("*") && !pattern.includes("$")) {
    return target.startsWith(pattern);
  }

  const hasEndAnchor = pattern.endsWith("$");
  const corePattern = hasEndAnchor ? pattern.slice(0, -1) : pattern;
  const escaped = corePattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  const wildcardExpanded = escaped.replace(/\*/g, ".*");
  const regexSource = hasEndAnchor
    ? `^${wildcardExpanded}$`
    : `^${wildcardExpanded}`;
  const regex = new RegExp(regexSource);
  return regex.test(target);
}

function evaluateRobotsPolicy(robotsText, targetPathWithQuery, crawlerAgent = "*") {
  const groups = parseRobotsGroups(robotsText);
  const agent = crawlerAgent.toLowerCase();

  const matchingGroups = groups.filter((group) =>
    group.agents.some((rawAgent) => rawAgent === "*" || rawAgent === agent),
  );
  if (!matchingGroups.length) {
    return {
      allowed: true,
      reason: "no_matching_group",
      matched_rule_type: null,
      matched_rule_pattern: null,
    };
  }

  matchingGroups.sort((left, right) => {
    const leftSpecificity = Math.max(
      ...left.agents.map((a) => (a === "*" ? 0 : a.length)),
    );
    const rightSpecificity = Math.max(
      ...right.agents.map((a) => (a === "*" ? 0 : a.length)),
    );
    return rightSpecificity - leftSpecificity;
  });

  const selectedGroup = matchingGroups[0];
  let bestMatch = null;

  for (const rule of selectedGroup.rules) {
    if (!rule.pattern) {
      continue;
    }
    if (!matchesRobotsPattern(targetPathWithQuery, rule.pattern)) {
      continue;
    }
    const ruleLength = rule.pattern.length;
    if (
      !bestMatch ||
      ruleLength > bestMatch.length ||
      (ruleLength === bestMatch.length && rule.type === "allow")
    ) {
      bestMatch = {
        type: rule.type,
        pattern: rule.pattern,
        length: ruleLength,
      };
    }
  }

  if (!bestMatch) {
    return {
      allowed: true,
      reason: "no_matching_rule",
      matched_rule_type: null,
      matched_rule_pattern: null,
    };
  }

  return {
    allowed: bestMatch.type === "allow",
    reason: bestMatch.type === "allow" ? "explicit_allow" : "explicit_disallow",
    matched_rule_type: bestMatch.type,
    matched_rule_pattern: bestMatch.pattern,
  };
}

function detectAntiBotSignals(text) {
  const signals = [];
  const payload = String(text || "").slice(0, 60000);
  for (const pattern of ANTIBOT_PATTERNS) {
    if (pattern.test(payload)) {
      signals.push(`pattern:${pattern}`);
    }
  }
  return Array.from(new Set(signals));
}

function isPrivateOrLocalProxyHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) {
    return true;
  }
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return true;
  }

  const ipv4Parts = host.split(".").map((part) => Number(part));
  const isIpv4 =
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);

  if (isIpv4) {
    const [a, b] = ipv4Parts;
    if (a === 10) {
      return true;
    }
    if (a === 127) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
  }

  if (host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }

  return false;
}

function isRetryableError(error) {
  if (error instanceof SafetyStopError) {
    return false;
  }

  if (error instanceof RequestError) {
    if (error.status && error.status >= 500) {
      return true;
    }
    return false;
  }

  const message = String(error?.message || "");
  const retryablePatterns = [
    /timeout/i,
    /socket hang up/i,
    /econnreset/i,
    /etimedout/i,
    /eai_again/i,
    /network is unreachable/i,
    /request context disposed/i,
  ];
  return retryablePatterns.some((pattern) => pattern.test(message));
}

function parseJsonStrict(text, context) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new RequestError(
      `${context}: invalid JSON payload (${error.message})`,
      "INVALID_JSON",
    );
  }
}

function buildProxyOptions(proxyUrl) {
  if (!proxyUrl) {
    return null;
  }

  let parsedProxy;
  try {
    parsedProxy = new URL(proxyUrl);
  } catch {
    throw new SafetyStopError("PROXY_URL is not a valid URL", "INVALID_PROXY");
  }

  return {
    server: `${parsedProxy.protocol}//${parsedProxy.host}`,
    username: parsedProxy.username || undefined,
    password: parsedProxy.password || undefined,
  };
}

async function createRequestContext(args) {
  const proxy = buildProxyOptions(args.proxy);
  const options = {
    timeout: args.timeoutMs,
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "accept-language": "es-MX,es;q=0.9,en;q=0.8",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  };

  if (proxy) {
    options.proxy = proxy;
  }

  return request.newContext(options);
}

async function guardedGetText(api, url, timeoutMs, contextLabel) {
  const response = await api.get(url, { timeout: timeoutMs });
  const status = response.status();
  const headers = response.headers();
  const text = await response.text();

  if (BLOCK_STATUS_CODES.has(status)) {
    throw new SafetyStopError(
      `${contextLabel}: blocking status detected (${status}) at ${url}`,
      "BLOCKING_STATUS",
    );
  }

  if (status >= 500) {
    throw new RequestError(
      `${contextLabel}: upstream server error (${status}) at ${url}`,
      "UPSTREAM_5XX",
      status,
    );
  }

  if (status >= 400) {
    throw new RequestError(
      `${contextLabel}: request failed with status ${status} at ${url}`,
      "HTTP_ERROR",
      status,
    );
  }

  const antiSignals = detectAntiBotSignals(text);
  if (antiSignals.length) {
    throw new SafetyStopError(
      `${contextLabel}: anti-bot challenge detected (${antiSignals.join(", ")})`,
      "ANTIBOT_CHALLENGE",
    );
  }

  return {
    status,
    headers,
    text,
  };
}

async function guardedGetJson(api, url, timeoutMs, contextLabel) {
  const payload = await guardedGetText(api, url, timeoutMs, contextLabel);
  const contentType = String(payload.headers["content-type"] || "").toLowerCase();
  const trimmed = payload.text.trim();

  if (
    contentType.includes("text/html") ||
    trimmed.startsWith("<!DOCTYPE html") ||
    trimmed.startsWith("<html")
  ) {
    throw new SafetyStopError(
      `${contextLabel}: expected JSON but received HTML/challenge payload`,
      "UNEXPECTED_HTML_PAYLOAD",
    );
  }

  const json = parseJsonStrict(payload.text, contextLabel);
  return {
    ...payload,
    json,
  };
}

function buildCategorySearchUrl(baseOrigin, categoryPath, from, to) {
  const url = new URL("/api/catalog_system/pub/products/search", baseOrigin);
  url.searchParams.set("fq", `C:${categoryPath}`);
  url.searchParams.set("_from", String(from));
  url.searchParams.set("_to", String(to));
  return url.toString();
}

function buildSkuSearchUrl(baseOrigin, skuId) {
  const url = new URL("/api/catalog_system/pub/products/search", baseOrigin);
  url.searchParams.set("fq", `skuId:${skuId}`);
  return url.toString();
}

function pickBestSeller(product) {
  const sku = product?.items?.[0];
  const sellers = Array.isArray(sku?.sellers) ? sku.sellers : [];

  const priced = sellers
    .map((seller) => {
      const offer = seller?.commertialOffer || {};
      const price = Number(offer.Price);
      const listPrice = Number(offer.ListPrice);
      const isAvailable = offer.IsAvailable;
      const availableQuantity = Number(offer.AvailableQuantity);
      const installments = Array.isArray(offer.Installments)
        ? offer.Installments.length
        : 0;

      return {
        seller,
        offer,
        price: Number.isFinite(price) ? price : null,
        listPrice: Number.isFinite(listPrice) ? listPrice : null,
        isAvailable,
        availableQuantity: Number.isFinite(availableQuantity)
          ? availableQuantity
          : null,
        installmentsCount: installments,
      };
    })
    .filter((entry) => entry.price !== null && entry.price > 0);

  if (!priced.length) {
    return null;
  }

  const availablePriced = priced.filter((entry) => entry.isAvailable !== false);
  const pool = availablePriced.length ? availablePriced : priced;

  const defaultSeller = pool.find((entry) => entry.seller?.sellerDefault === true);
  if (defaultSeller) {
    return defaultSeller;
  }

  pool.sort((a, b) => a.price - b.price);
  return pool[0];
}

function deriveOriginalPrice(salePrice, listPrice) {
  if (!Number.isFinite(salePrice) || !Number.isFinite(listPrice)) {
    return null;
  }
  if (listPrice > salePrice) {
    return listPrice;
  }
  return null;
}

function normalizeListingRecord({
  product,
  capturedAt,
  baseOrigin,
  batchFrom,
  batchTo,
  positionInBatch,
  listingApiUrl,
  categoryPath,
  responseStatus,
}) {
  const sku = product?.items?.[0] || {};
  const bestSeller = pickBestSeller(product);
  const offer = bestSeller?.offer || {};
  const salePrice = bestSeller?.price ?? null;
  const listPrice = bestSeller?.listPrice ?? null;
  const originalPrice = deriveOriginalPrice(salePrice, listPrice);

  const firstImage = Array.isArray(sku.images) && sku.images.length
    ? sku.images[0]?.imageUrl || ""
    : "";

  return {
    site: "elektra",
    captured_at: capturedAt,
    product_id: String(product?.productId || sku?.itemId || ""),
    sku_id: String(sku?.itemId || ""),
    name: normalizeWhitespace(product?.productName || sku?.name || ""),
    brand: normalizeWhitespace(product?.brand || ""),
    product_url: toAbsoluteUrl(baseOrigin, product?.link || ""),
    image_url: toAbsoluteUrl(baseOrigin, firstImage),
    seller_id: String(bestSeller?.seller?.sellerId || ""),
    seller_name: normalizeWhitespace(bestSeller?.seller?.sellerName || ""),
    seller_default: Boolean(bestSeller?.seller?.sellerDefault),
    sale_price_mxn: salePrice,
    original_price_mxn: originalPrice,
    list_price_mxn: Number.isFinite(listPrice) ? listPrice : null,
    price_without_discount_mxn: parseMxMoney(offer?.PriceWithoutDiscount),
    is_available: bestSeller?.isAvailable ?? null,
    available_quantity: bestSeller?.availableQuantity ?? null,
    installments_count: bestSeller?.installmentsCount ?? 0,
    category_id: String(product?.categoryId || ""),
    category_path: categoryPath,
    categories_ids: Array.isArray(product?.categoriesIds)
      ? product.categoriesIds.join(" | ")
      : "",
    listing_from: batchFrom,
    listing_to: batchTo,
    position_global: batchFrom + positionInBatch + 1,
    listing_api_url: listingApiUrl,
    source_status_code: responseStatus,
    detail_status: "skipped",
    detail_error_code: "",
    detail_error_message: "",
    detail_collected_at: "",
    detail_description: "",
    detail_specs_json: "",
    detail_specs_count: 0,
    detail_model: "",
    detail_gtin: "",
    detail_ean: "",
    detail_sale_price_mxn: null,
    detail_original_price_mxn: null,
    detail_sellers_json: "",
  };
}

function buildSpecsObject(product) {
  const specs = {};
  const keys = Array.isArray(product?.allSpecifications)
    ? product.allSpecifications
    : [];

  for (const key of keys) {
    if (!key) {
      continue;
    }
    const raw = product[key];
    if (raw === null || raw === undefined) {
      continue;
    }
    let normalizedValue = "";
    if (Array.isArray(raw)) {
      normalizedValue = raw.map((x) => normalizeWhitespace(x)).filter(Boolean).join(" | ");
    } else {
      normalizedValue = normalizeWhitespace(raw);
    }
    if (!normalizedValue) {
      continue;
    }
    specs[String(key)] = normalizedValue;
  }

  return specs;
}

function parseFirstSkuFromListingHtml(html) {
  const text = String(html || "");
  const scripts = Array.from(
    text.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ).map((match) => match[1]);

  for (const rawScript of scripts) {
    const raw = rawScript.trim();
    if (!raw) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== "object") {
        continue;
      }
      if (Array.isArray(node["@graph"])) {
        queue.push(...node["@graph"]);
      }
      if (node["@type"] !== "ItemList") {
        continue;
      }
      const list = Array.isArray(node.itemListElement) ? node.itemListElement : [];
      for (const entry of list) {
        const item = entry?.item || {};
        const sku = normalizeWhitespace(item?.sku || item?.mpn || "");
        if (sku) {
          return sku;
        }
        const id = normalizeWhitespace(item?.["@id"] || "");
        const idMatch = id.match(/-(\d+)(?:\/p|$)/i);
        if (idMatch) {
          return idMatch[1];
        }
      }
    }
  }

  return "";
}

function pickDeepestCategoryPath(paths) {
  if (!Array.isArray(paths) || !paths.length) {
    return "";
  }

  const candidates = paths
    .map((value) => sanitizeCategoryPath(value))
    .filter((value) => /^\/(\d+\/)+$/.test(value));

  if (!candidates.length) {
    return "";
  }

  candidates.sort((left, right) => {
    const leftDepth = left.split("/").filter(Boolean).length;
    const rightDepth = right.split("/").filter(Boolean).length;
    return rightDepth - leftDepth;
  });

  return candidates[0];
}

async function discoverCategoryPath(api, baseUrl, baseOrigin, timeoutMs) {
  const listingResponse = await guardedGetText(
    api,
    baseUrl,
    timeoutMs,
    "category_discovery_listing",
  );
  const firstSku = parseFirstSkuFromListingHtml(listingResponse.text);

  if (!firstSku) {
    return {
      categoryPath: "",
      source: "listing_html_missing_sku",
      firstSku: "",
    };
  }

  const skuUrl = buildSkuSearchUrl(baseOrigin, firstSku);
  const skuResponse = await guardedGetJson(
    api,
    skuUrl,
    timeoutMs,
    "category_discovery_sku",
  );

  const product = Array.isArray(skuResponse.json) ? skuResponse.json[0] : null;
  const categoryPath = pickDeepestCategoryPath(product?.categoriesIds || []);

  return {
    categoryPath,
    source: categoryPath ? "sku_categories_ids" : "sku_missing_categories_ids",
    firstSku,
  };
}

async function fetchRobotsDecision(api, baseUrl, categoryApiPathWithQuery, timeoutMs) {
  const base = new URL(baseUrl);
  const robotsUrl = `${base.origin}/robots.txt`;
  const robotsResponse = await guardedGetText(api, robotsUrl, timeoutMs, "robots");
  const robotsText = robotsResponse.text;

  if (!robotsText || !robotsText.trim()) {
    throw new SafetyStopError("robots.txt empty or unreadable", "ROBOTS_UNAVAILABLE");
  }

  if (/<html|<body|<script/i.test(robotsText)) {
    throw new SafetyStopError(
      "robots.txt returned unexpected HTML/challenge payload",
      "ROBOTS_UNAVAILABLE",
    );
  }

  const listingTarget = `${base.pathname}${base.search}`;
  const listingDecision = evaluateRobotsPolicy(
    robotsText,
    listingTarget,
    "mx-ac-tracker",
  );
  const apiDecision = evaluateRobotsPolicy(
    robotsText,
    categoryApiPathWithQuery,
    "mx-ac-tracker",
  );

  if (!listingDecision.allowed) {
    throw new SafetyStopError(
      `robots policy disallows listing path (pattern=${listingDecision.matched_rule_pattern || "unknown"})`,
      "ROBOTS_DISALLOW",
    );
  }

  if (!apiDecision.allowed) {
    throw new SafetyStopError(
      `robots policy disallows API path (pattern=${apiDecision.matched_rule_pattern || "unknown"})`,
      "ROBOTS_DISALLOW",
    );
  }

  return {
    checked: true,
    robots_url: robotsUrl,
    listing_path: listingTarget,
    listing_decision: listingDecision,
    api_path: categoryApiPathWithQuery,
    api_decision: apiDecision,
  };
}

function compareSnapshots(previousRows, currentRows) {
  const prevMap = new Map(previousRows.map((row) => [row.product_id, row]));
  const currMap = new Map(currentRows.map((row) => [row.product_id, row]));

  const priceChanges = [];
  const newProducts = [];
  const removedProducts = [];

  for (const row of currentRows) {
    const prev = prevMap.get(row.product_id);
    if (!prev) {
      newProducts.push(row);
      continue;
    }

    const saleChanged = prev.sale_price_mxn !== row.sale_price_mxn;
    const originalChanged = prev.original_price_mxn !== row.original_price_mxn;

    if (saleChanged || originalChanged) {
      priceChanges.push({
        change_type: "price_changed",
        product_id: row.product_id,
        sku_id: row.sku_id,
        name: row.name,
        product_url: row.product_url,
        seller_name: row.seller_name,
        old_sale_price_mxn: prev.sale_price_mxn,
        new_sale_price_mxn: row.sale_price_mxn,
        delta_sale_price_mxn:
          row.sale_price_mxn !== null && prev.sale_price_mxn !== null
            ? row.sale_price_mxn - prev.sale_price_mxn
            : null,
        old_original_price_mxn: prev.original_price_mxn,
        new_original_price_mxn: row.original_price_mxn,
        delta_original_price_mxn:
          row.original_price_mxn !== null && prev.original_price_mxn !== null
            ? row.original_price_mxn - prev.original_price_mxn
            : null,
      });
    }
  }

  for (const row of currentRows) {
    if (!prevMap.has(row.product_id)) {
      priceChanges.push({
        change_type: "new_product",
        product_id: row.product_id,
        sku_id: row.sku_id,
        name: row.name,
        product_url: row.product_url,
        seller_name: row.seller_name,
        old_sale_price_mxn: null,
        new_sale_price_mxn: row.sale_price_mxn,
        delta_sale_price_mxn: null,
        old_original_price_mxn: null,
        new_original_price_mxn: row.original_price_mxn,
        delta_original_price_mxn: null,
      });
    }
  }

  for (const row of previousRows) {
    if (!currMap.has(row.product_id)) {
      removedProducts.push(row);
      priceChanges.push({
        change_type: "removed_product",
        product_id: row.product_id,
        sku_id: row.sku_id,
        name: row.name,
        product_url: row.product_url,
        seller_name: row.seller_name,
        old_sale_price_mxn: row.sale_price_mxn,
        new_sale_price_mxn: null,
        delta_sale_price_mxn: null,
        old_original_price_mxn: row.original_price_mxn,
        new_original_price_mxn: null,
        delta_original_price_mxn: null,
      });
    }
  }

  return { priceChanges, newProducts, removedProducts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const capturedAt = now.toISOString();
  const timestamp = makeTimestamp(now);

  const outputRoot = path.resolve(args.outputDir);
  const snapshotsDir = path.join(outputRoot, "snapshots");
  const reportsDir = path.join(outputRoot, "reports");
  const runsDir = path.join(outputRoot, "runs");

  const dirs = [outputRoot, reportsDir, runsDir];
  if (args.keepHistory) {
    dirs.push(snapshotsDir);
  }
  await ensureDirs(dirs);

  let baseOrigin;
  try {
    baseOrigin = new URL(args.baseUrl).origin;
  } catch {
    throw new Error("--base-url must be a valid absolute URL");
  }

  const api = await createRequestContext(args);

  let robotsCheck = {
    checked: false,
    robots_url: null,
    listing_path: null,
    listing_decision: null,
    api_path: null,
    api_decision: null,
  };
  let safetyStopReason = null;
  let discoveredCategoryPath = "";
  let categoryPathSource = "cli";

  const allRows = [];
  const seenProductIds = new Set();
  let totalCount = null;
  let pagesToVisit = args.maxPages !== null ? args.maxPages : FALLBACK_MAX_PAGES;
  let pageRequests = 0;
  let consecutiveFailures = 0;

  const detailStats = {
    enabled: args.crawlDetails,
    target_products: 0,
    crawled_products: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    max_detail_products: args.maxDetailProducts,
  };

  try {
    const cliCategoryPath = sanitizeCategoryPath(args.categoryPath);

    if (cliCategoryPath) {
      discoveredCategoryPath = cliCategoryPath;
      categoryPathSource = "cli";
    } else if (args.discoverCategoryPath) {
      const discovered = await discoverCategoryPath(
        api,
        args.baseUrl,
        baseOrigin,
        args.timeoutMs,
      );
      discoveredCategoryPath = discovered.categoryPath;
      categoryPathSource = discovered.source;
    } else {
      discoveredCategoryPath = DEFAULT_CATEGORY_PATH_FALLBACK;
      categoryPathSource = "fallback_constant";
    }

    if (!discoveredCategoryPath) {
      discoveredCategoryPath = DEFAULT_CATEGORY_PATH_FALLBACK;
      categoryPathSource = "fallback_constant";
    }

    const robotsProbePath = `/api/catalog_system/pub/products/search?fq=C:${discoveredCategoryPath}&_from=0&_to=0`;
    robotsCheck = await fetchRobotsDecision(
      api,
      args.baseUrl,
      robotsProbePath,
      args.timeoutMs,
    );

    for (let pageNumber = 0; pageNumber < pagesToVisit; pageNumber += 1) {
      const from = pageNumber * args.pageSize;
      const to = from + args.pageSize - 1;
      const batchUrl = buildCategorySearchUrl(baseOrigin, discoveredCategoryPath, from, to);

      let batchResponse = null;
      let lastError = null;

      for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
        try {
          batchResponse = await guardedGetJson(
            api,
            batchUrl,
            args.timeoutMs,
            `listing_batch_${pageNumber + 1}`,
          );
          lastError = null;
          consecutiveFailures = 0;
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof SafetyStopError) {
            throw error;
          }

          if (!isRetryableError(error) || attempt >= args.maxRetries) {
            consecutiveFailures += 1;
            break;
          }

          const backoffMs = computeBackoffMs(attempt, args.backoffBaseMs);
          await delay(backoffMs);
        }
      }

      if (!batchResponse) {
        if (consecutiveFailures >= args.maxConsecutiveFailures) {
          throw new SafetyStopError(
            `consecutive listing failures reached safety threshold (${args.maxConsecutiveFailures}): ${
              lastError?.message || "unknown error"
            }`,
            "FAILURE_CIRCUIT_OPEN",
          );
        }
        throw lastError || new RequestError("listing batch failed", "LISTING_BATCH_FAILED");
      }

      pageRequests += 1;

      if (!Array.isArray(batchResponse.json)) {
        throw new RequestError(
          `listing_batch_${pageNumber + 1}: unexpected payload type`,
          "UNEXPECTED_PAYLOAD",
        );
      }

      const resources = parseResourcesHeader(batchResponse.headers.resources);
      if (totalCount === null && Number.isFinite(resources.total)) {
        totalCount = resources.total;
        if (args.maxPages === null) {
          pagesToVisit = Math.min(
            Math.ceil(totalCount / args.pageSize),
            FALLBACK_MAX_PAGES,
          );
        }
      }

      if (!batchResponse.json.length) {
        break;
      }

      for (let index = 0; index < batchResponse.json.length; index += 1) {
        const product = batchResponse.json[index];
        const row = normalizeListingRecord({
          product,
          capturedAt,
          baseOrigin,
          batchFrom: from,
          batchTo: to,
          positionInBatch: index,
          listingApiUrl: batchUrl,
          categoryPath: discoveredCategoryPath,
          responseStatus: batchResponse.status,
        });

        if (!row.product_id) {
          continue;
        }
        if (seenProductIds.has(row.product_id)) {
          continue;
        }

        seenProductIds.add(row.product_id);
        allRows.push(row);
      }

      if ((pageNumber + 1) < pagesToVisit) {
        const shouldLongBreak =
          args.longBreakEveryRequests > 0 &&
          pageRequests > 0 &&
          pageRequests % args.longBreakEveryRequests === 0;
        const pauseMs = shouldLongBreak
          ? randomIntInclusive(args.longBreakMinMs, args.longBreakMaxMs)
          : randomIntInclusive(args.minDelayMs, args.maxDelayMs);
        await delay(pauseMs);
      }
    }

    if (args.crawlDetails && allRows.length > 0) {
      const rowsForDetail =
        args.maxDetailProducts !== null
          ? allRows.slice(0, args.maxDetailProducts)
          : allRows;

      detailStats.target_products = rowsForDetail.length;
      detailStats.skipped = allRows.length - rowsForDetail.length;

      let detailConsecutiveFailures = 0;

      for (let index = 0; index < rowsForDetail.length; index += 1) {
        const row = rowsForDetail[index];

        if (!row.sku_id) {
          row.detail_status = "error";
          row.detail_error_code = "MISSING_SKU";
          row.detail_error_message = "missing sku_id";
          detailStats.failed += 1;
          detailStats.crawled_products += 1;
          continue;
        }

        const skuUrl = buildSkuSearchUrl(baseOrigin, row.sku_id);
        let detailResponse = null;
        let lastError = null;

        for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
          try {
            detailResponse = await guardedGetJson(
              api,
              skuUrl,
              args.timeoutMs,
              `detail_sku_${row.sku_id}`,
            );
            lastError = null;
            detailConsecutiveFailures = 0;
            break;
          } catch (error) {
            lastError = error;
            if (error instanceof SafetyStopError) {
              throw error;
            }

            if (!isRetryableError(error) || attempt >= args.maxRetries) {
              detailConsecutiveFailures += 1;
              break;
            }

            const backoffMs = computeBackoffMs(attempt, args.backoffBaseMs);
            await delay(backoffMs);
          }
        }

        if (!detailResponse) {
          row.detail_status = "error";
          row.detail_error_code = lastError?.code || "DETAIL_ERROR";
          row.detail_error_message = normalizeWhitespace(
            lastError?.message || "unknown detail error",
          );
          detailStats.failed += 1;
          detailStats.crawled_products += 1;

          if (detailConsecutiveFailures >= args.maxConsecutiveFailures) {
            throw new SafetyStopError(
              `consecutive detail failures reached safety threshold (${args.maxConsecutiveFailures}): ${
                row.detail_error_message
              }`,
              "DETAIL_FAILURE_CIRCUIT_OPEN",
            );
          }
        } else {
          const product = Array.isArray(detailResponse.json)
            ? detailResponse.json[0]
            : null;

          if (!product) {
            row.detail_status = "error";
            row.detail_error_code = "DETAIL_EMPTY";
            row.detail_error_message = "empty detail payload";
            detailStats.failed += 1;
            detailStats.crawled_products += 1;
          } else {
            const specsObject = buildSpecsObject(product);
            const detailSeller = pickBestSeller(product);
            const detailSale = detailSeller?.price ?? null;
            const detailList = detailSeller?.listPrice ?? null;

            const sku = product?.items?.[0] || {};
            const sellersSummary = Array.isArray(sku.sellers)
              ? sku.sellers.map((seller) => {
                  const offer = seller?.commertialOffer || {};
                  return {
                    seller_id: seller?.sellerId || "",
                    seller_name: seller?.sellerName || "",
                    seller_default: Boolean(seller?.sellerDefault),
                    price: parseMxMoney(offer?.Price),
                    list_price: parseMxMoney(offer?.ListPrice),
                    is_available: offer?.IsAvailable ?? null,
                    available_quantity: parseMxMoney(offer?.AvailableQuantity),
                  };
                })
              : [];

            row.detail_status = "ok";
            row.detail_error_code = "";
            row.detail_error_message = "";
            row.detail_collected_at = capturedAt;
            row.detail_description = normalizeWhitespace(product?.description || "");
            row.detail_specs_json = JSON.stringify(specsObject);
            row.detail_specs_count = Object.keys(specsObject).length;
            row.detail_model = normalizeWhitespace(product?.Modelo || product?.model || "");
            row.detail_gtin = normalizeWhitespace(sku?.ean || "");
            row.detail_ean = normalizeWhitespace(sku?.ean || "");
            row.detail_sale_price_mxn = detailSale;
            row.detail_original_price_mxn = deriveOriginalPrice(detailSale, detailList);
            row.detail_sellers_json = JSON.stringify(sellersSummary);

            detailStats.success += 1;
            detailStats.crawled_products += 1;
          }
        }

        if ((index + 1) < rowsForDetail.length) {
          const detailDelayMs = randomIntInclusive(args.minDelayMs, args.maxDelayMs);
          await delay(detailDelayMs);
        }
      }

      if (rowsForDetail.length < allRows.length) {
        for (const skippedRow of allRows.slice(rowsForDetail.length)) {
          skippedRow.detail_status = "skipped";
          skippedRow.detail_error_code = "";
          skippedRow.detail_error_message = "";
        }
      }
    } else {
      detailStats.target_products = 0;
      detailStats.skipped = allRows.length;
      for (const row of allRows) {
        row.detail_status = "skipped";
        row.detail_error_code = "";
        row.detail_error_message = "";
      }
    }
  } catch (error) {
    safetyStopReason = {
      code: error?.code || "UNCLASSIFIED_ERROR",
      message: String(error?.message || error),
    };
    throw error;
  } finally {
    await api.dispose();
  }

  const latestJsonPath = path.join(outputRoot, "latest_products.json");
  const latestCsvPath = path.join(outputRoot, "latest_products.csv");
  const snapshotJsonPath = path.join(snapshotsDir, `products_${timestamp}.json`);
  const snapshotCsvPath = path.join(snapshotsDir, `products_${timestamp}.csv`);
  const historyCsvPath = path.join(outputRoot, "price_history.csv");
  const changesJsonPath = path.join(reportsDir, `price_changes_${timestamp}.json`);
  const changesCsvPath = path.join(reportsDir, `price_changes_${timestamp}.csv`);
  const latestChangesJsonPath = path.join(reportsDir, "latest_price_changes.json");
  const latestChangesCsvPath = path.join(reportsDir, "latest_price_changes.csv");
  const latestRunPath = path.join(runsDir, "latest_run.json");
  const runPath = path.join(runsDir, `run_${timestamp}.json`);

  const previousRows = await readJsonIfExists(latestJsonPath, []);
  const { priceChanges, newProducts, removedProducts } = compareSnapshots(
    previousRows,
    allRows,
  );

  const productHeaders = [
    "site",
    "captured_at",
    "product_id",
    "sku_id",
    "name",
    "brand",
    "product_url",
    "image_url",
    "seller_id",
    "seller_name",
    "seller_default",
    "sale_price_mxn",
    "original_price_mxn",
    "list_price_mxn",
    "price_without_discount_mxn",
    "is_available",
    "available_quantity",
    "installments_count",
    "category_id",
    "category_path",
    "categories_ids",
    "listing_from",
    "listing_to",
    "position_global",
    "listing_api_url",
    "source_status_code",
    "detail_status",
    "detail_error_code",
    "detail_error_message",
    "detail_collected_at",
    "detail_description",
    "detail_specs_json",
    "detail_specs_count",
    "detail_model",
    "detail_gtin",
    "detail_ean",
    "detail_sale_price_mxn",
    "detail_original_price_mxn",
    "detail_sellers_json",
  ];

  const changeHeaders = [
    "change_type",
    "product_id",
    "sku_id",
    "name",
    "product_url",
    "seller_name",
    "old_sale_price_mxn",
    "new_sale_price_mxn",
    "delta_sale_price_mxn",
    "old_original_price_mxn",
    "new_original_price_mxn",
    "delta_original_price_mxn",
  ];

  const writeTasks = [
    fs.writeFile(latestJsonPath, JSON.stringify(allRows, null, 2), "utf8"),
    fs.writeFile(latestCsvPath, toCsv(allRows, productHeaders), "utf8"),
    fs.writeFile(latestChangesJsonPath, JSON.stringify(priceChanges, null, 2), "utf8"),
    fs.writeFile(latestChangesCsvPath, toCsv(priceChanges, changeHeaders), "utf8"),
  ];

  if (args.keepHistory) {
    writeTasks.push(
      fs.writeFile(snapshotJsonPath, JSON.stringify(allRows, null, 2), "utf8"),
      fs.writeFile(snapshotCsvPath, toCsv(allRows, productHeaders), "utf8"),
      fs.writeFile(changesJsonPath, JSON.stringify(priceChanges, null, 2), "utf8"),
      fs.writeFile(changesCsvPath, toCsv(priceChanges, changeHeaders), "utf8"),
    );
  }

  await Promise.all(writeTasks);

  if (args.keepHistory) {
    await appendPriceHistory(historyCsvPath, allRows);
  }

  const runSummary = {
    site: "elektra",
    captured_at: capturedAt,
    base_url: args.baseUrl,
    category_path: discoveredCategoryPath,
    category_path_source: categoryPathSource,
    total_products: allRows.length,
    total_count_reported_by_site: totalCount,
    listing_requests_made: pageRequests,
    max_pages_requested: args.maxPages !== null ? args.maxPages : pagesToVisit,
    page_size: args.pageSize,
    price_changes: priceChanges.filter((x) => x.change_type === "price_changed").length,
    new_products: newProducts.length,
    removed_products: removedProducts.length,
    output_root: outputRoot,
    files: {
      latest_json: latestJsonPath,
      latest_csv: latestCsvPath,
      latest_changes_json: latestChangesJsonPath,
      latest_changes_csv: latestChangesCsvPath,
    },
    database: {
      enabled: args.saveToDb,
      db_path: args.dbPath ? path.resolve(args.dbPath) : null,
      products_upserted: 0,
      price_facts_upserted: 0,
      product_details_upserted: 0,
    },
    keep_history: args.keepHistory,
    detail: {
      enabled: args.crawlDetails,
      max_detail_products: args.maxDetailProducts,
      target_products: detailStats.target_products,
      crawled_products: detailStats.crawled_products,
      success: detailStats.success,
      failed: detailStats.failed,
      skipped: detailStats.skipped,
    },
    safety: {
      proxy_required: false,
      proxy_enabled: Boolean(args.proxy),
      direct_ip_allowed: true,
      robots_check: robotsCheck,
      max_retries: args.maxRetries,
      min_delay_ms: args.minDelayMs,
      max_delay_ms: args.maxDelayMs,
      long_break_every_requests: args.longBreakEveryRequests,
      long_break_min_ms: args.longBreakMinMs,
      long_break_max_ms: args.longBreakMaxMs,
      backoff_base_ms: args.backoffBaseMs,
      max_consecutive_failures: args.maxConsecutiveFailures,
      safety_stop_reason: safetyStopReason,
      block_status_codes: Array.from(BLOCK_STATUS_CODES),
    },
  };

  if (args.saveToDb) {
    const dbResult = await persistRunToSqliteV2({
      dbPath: args.dbPath,
      runSummary,
      rows: allRows,
    });
    runSummary.database = dbResult;
  }

  const runWriteTasks = [
    fs.writeFile(latestRunPath, JSON.stringify(runSummary, null, 2), "utf8"),
  ];
  if (args.keepHistory) {
    runWriteTasks.push(fs.writeFile(runPath, JSON.stringify(runSummary, null, 2), "utf8"));
  }
  await Promise.all(runWriteTasks);

  console.log("Elektra crawl finished.");
  console.log(`Captured at: ${capturedAt}`);
  console.log(`Category path: ${discoveredCategoryPath} (${categoryPathSource})`);
  console.log(`Products collected: ${allRows.length}`);
  if (totalCount !== null) {
    console.log(`Site reported total count: ${totalCount}`);
  }
  console.log(
    `Price changes: ${priceChanges.filter((x) => x.change_type === "price_changed").length}`,
  );
  console.log(`New products: ${newProducts.length}`);
  console.log(`Removed products: ${removedProducts.length}`);
  console.log(
    `Detail crawl: enabled=${detailStats.enabled}, target=${detailStats.target_products}, success=${detailStats.success}, failed=${detailStats.failed}, skipped=${detailStats.skipped}`,
  );
  console.log(`Latest snapshot: ${latestJsonPath}`);
  console.log(`Latest changes: ${latestChangesCsvPath}`);
  if (args.keepHistory) {
    console.log("History mode: enabled");
  } else {
    console.log("History mode: disabled (latest files only)");
  }
}

main().catch((error) => {
  console.error("Elektra crawl failed.");
  console.error(error);
  process.exitCode = 1;
});
