#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const DEFAULT_BASE_URL =
  "https://www.coppel.com/ct/linea-blanca/aires-acondicionados/cat000416?pmNodeId=11404&prNodeId=11419&regionTelcel=9";
const DEFAULT_PAGE_SIZE = 24;
const DEFAULT_MIN_DELAY_MS = 5000;
const DEFAULT_MAX_DELAY_MS = 9000;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 8000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 1;
const FALLBACK_MAX_PAGES = 50;
const BLOCK_STATUS_CODES = new Set([401, 403, 429, 503, 520, 521, 522, 525]);
const ANTIBOT_PATTERNS = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /cloudflare/i,
  /akamai/i,
  /verify you are human/i,
  /access denied/i,
  /forbidden/i,
  /bot detection/i,
  /unusual traffic/i,
  /deny/i,
];

class SafetyStopError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SafetyStopError";
    this.code = code || "SAFETY_STOP";
  }
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    outputDir: "data/coppel",
    maxPages: null,
    maxDetailProducts: null,
    pageSize: DEFAULT_PAGE_SIZE,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
    headful: false,
    proxy: process.env.PROXY_URL || "",
    crawlDetails: true,
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
    } else if (token === "--max-pages" && next) {
      args.maxPages = Number(next);
      i += 1;
    } else if (token === "--max-detail-products" && next) {
      args.maxDetailProducts = Number(next);
      i += 1;
    } else if (token === "--page-size" && next) {
      args.pageSize = Number(next);
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
    } else if (token === "--proxy" && next) {
      throw new Error(
        "Security policy: CLI --proxy is disabled. Use PROXY_URL environment variable instead.",
      );
    } else if (token === "--headful") {
      args.headful = true;
    } else if (token === "--skip-details") {
      args.crawlDetails = false;
    } else if (token === "--keep-history") {
      args.keepHistory = true;
    }
  }

  if (!Number.isFinite(args.pageSize) || args.pageSize <= 0) {
    throw new Error("--page-size must be a positive number");
  }
  if (
    args.maxPages !== null &&
    (!Number.isFinite(args.maxPages) || args.maxPages <= 0)
  ) {
    throw new Error("--max-pages must be a positive number");
  }
  if (
    args.maxDetailProducts !== null &&
    (!Number.isFinite(args.maxDetailProducts) || args.maxDetailProducts <= 0)
  ) {
    throw new Error("--max-detail-products must be a positive number");
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

function parseMxMoney(raw) {
  if (!raw) {
    return null;
  }
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  return Number(digits);
}

function parseResultCount(raw) {
  if (!raw) {
    return null;
  }
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  return Number(digits);
}

function extractProductId(url) {
  if (!url) {
    return null;
  }
  const match = url.match(/-(pm|mkp)-(\d+)(?:$|[/?#])/i);
  if (match) {
    return `${match[1].toLowerCase()}-${match[2]}`;
  }
  return url.replace(/^https?:\/\//i, "").replace(/[/?#]+/g, "_");
}

function buildPageUrl(baseUrl, beginIndex) {
  const url = new URL(baseUrl);
  if (beginIndex > 0) {
    url.searchParams.set("beginIndex", String(beginIndex));
  } else {
    url.searchParams.delete("beginIndex");
  }
  return url.toString();
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

function matchesRobotsPattern(pathname, rawPattern) {
  if (!rawPattern) {
    return false;
  }
  const pattern = String(rawPattern).trim();
  if (!pattern) {
    return false;
  }

  if (!pattern.includes("*") && !pattern.includes("$")) {
    return pathname.startsWith(pattern);
  }

  const hasEndAnchor = pattern.endsWith("$");
  const corePattern = hasEndAnchor ? pattern.slice(0, -1) : pattern;
  const escaped = corePattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  const wildcardExpanded = escaped.replace(/\*/g, ".*");
  const regexSource = hasEndAnchor
    ? `^${wildcardExpanded}$`
    : `^${wildcardExpanded}`;
  const regex = new RegExp(regexSource);
  return regex.test(pathname);
}

function evaluateRobotsPolicy(robotsText, targetPathname, crawlerAgent = "*") {
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
    if (!matchesRobotsPattern(targetPathname, rule.pattern)) {
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

function isRetryableError(error) {
  if (error instanceof SafetyStopError) {
    return false;
  }
  const message = String(error?.message || "");
  const retryablePatterns = [
    /timeout/i,
    /net::err_/i,
    /navigation failed/i,
    /socket hang up/i,
    /target closed/i,
    /econnreset/i,
    /etimedout/i,
  ];
  return retryablePatterns.some((pattern) => pattern.test(message));
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseSkuFromText(value) {
  const text = normalizeWhitespace(value);
  if (!text) {
    return "";
  }
  const match =
    text.match(/SKU\)\s*:\s*([A-Za-z0-9-]+)/i) ||
    text.match(/SKU\s*:\s*([A-Za-z0-9-]+)/i) ||
    text.match(/(\d{4,})/);
  return match ? match[1] : "";
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

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
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

async function dismissLocationModal(page) {
  const labelOrder = ["No, cambiar", "Sí", "Aceptar", "Entendido"];

  for (const label of labelOrder) {
    const button = page.getByRole("button", { name: label }).first();
    if (await button.count()) {
      try {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(400);
        return;
      } catch {
        continue;
      }
    }
  }

  const closeButton = page
    .locator("button[aria-label='Cerrar'], button:has-text('Cerrar')")
    .first();
  if (await closeButton.count()) {
    try {
      await closeButton.click({ timeout: 1200 });
      await page.waitForTimeout(400);
    } catch {
      // Ignore close failures and continue scraping.
    }
  }
}

async function detectAntiBotSignals(page) {
  const signals = [];
  const title = (await page.title().catch(() => "")) || "";
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const combined = `${title}\n${bodyText}`.slice(0, 40000);

  for (const pattern of ANTIBOT_PATTERNS) {
    if (pattern.test(combined)) {
      signals.push(`pattern:${pattern}`);
    }
  }

  const captchaIframes = await page
    .locator(
      "iframe[src*='captcha'], iframe[src*='recaptcha'], iframe[src*='hcaptcha']",
    )
    .count()
    .catch(() => 0);
  if (captchaIframes > 0) {
    signals.push("captcha_iframe");
  }

  const challengeForms = await page
    .locator(
      "input[name*='captcha'], #challenge-form, form[action*='challenge']",
    )
    .count()
    .catch(() => 0);
  if (challengeForms > 0) {
    signals.push("challenge_form");
  }

  return Array.from(new Set(signals));
}

async function fetchRobotsDecision(context, baseUrl, timeoutMs) {
  const base = new URL(baseUrl);
  const robotsUrl = `${base.origin}/robots.txt`;
  const page = await context.newPage();

  try {
    const response = await page.goto(robotsUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const status = response ? response.status() : null;
    if (!status || status >= 400) {
      throw new SafetyStopError(
        `robots.txt unavailable (status=${status ?? "unknown"})`,
        "ROBOTS_UNAVAILABLE",
      );
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!bodyText || !bodyText.trim()) {
      throw new SafetyStopError(
        "robots.txt empty or unreadable",
        "ROBOTS_UNAVAILABLE",
      );
    }

    if (/<html|<body|<script/i.test(bodyText)) {
      throw new SafetyStopError(
        "robots.txt returned unexpected HTML/challenge payload",
        "ROBOTS_UNAVAILABLE",
      );
    }

    const decision = evaluateRobotsPolicy(bodyText, base.pathname, "mx-ac-tracker");
    return {
      robots_url: robotsUrl,
      status,
      ...decision,
    };
  } finally {
    await page.close();
  }
}

async function readJsonIfExists(filePath, fallbackValue) {
  if (!(await pathExists(filePath))) {
    return fallbackValue;
  }
  const data = await fs.readFile(filePath, "utf8");
  return JSON.parse(data);
}

function normalizeRecord(raw, capturedAt, pageUrl, index, beginIndex, baseOrigin) {
  const href = raw.href ? new URL(raw.href, baseOrigin).toString() : "";
  const productId = extractProductId(href);

  return {
    site: "coppel",
    captured_at: capturedAt,
    product_id: productId || "",
    name: raw.name || "",
    product_url: href,
    sale_price_raw: raw.sale_price_raw || "",
    sale_price_mxn: parseMxMoney(raw.sale_price_raw),
    original_price_raw: raw.original_price_raw || "",
    original_price_mxn: parseMxMoney(raw.original_price_raw),
    payment_plan: raw.payment_plan || "",
    badges: Array.isArray(raw.badges) ? raw.badges.join(" | ") : "",
    page_begin_index: beginIndex,
    position_in_page: index + 1,
    listing_url: pageUrl,
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
        name: row.name,
        product_url: row.product_url,
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
        name: row.name,
        product_url: row.product_url,
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
        name: row.name,
        product_url: row.product_url,
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

async function appendPriceHistory(historyPath, rows) {
  const headers = [
    "site",
    "captured_at",
    "product_id",
    "name",
    "product_url",
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

async function scrapePage(page, pageUrl, timeoutMs) {
  const response = await page.goto(pageUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  const status = response ? response.status() : null;
  if (status && BLOCK_STATUS_CODES.has(status)) {
    throw new SafetyStopError(
      `blocking status detected (${status}) at ${pageUrl}`,
      "BLOCKING_STATUS",
    );
  }

  await page.waitForTimeout(3500);
  await dismissLocationModal(page);

  const antiBotSignals = await detectAntiBotSignals(page);
  if (antiBotSignals.length) {
    throw new SafetyStopError(
      `anti-bot challenge detected at ${pageUrl}: ${antiBotSignals.join(", ")}`,
      "ANTIBOT_CHALLENGE",
    );
  }

  await page.waitForSelector("[data-testid='product_total_count']", {
    timeout: timeoutMs,
  });
  await page.waitForSelector("[data-testid='product-0']", { timeout: timeoutMs });

  const data = await page.evaluate(() => {
    const totalCountText =
      document.querySelector("[data-testid='product_total_count']")
        ?.textContent || "";

    const cardNodes = Array.from(
      document.querySelectorAll("[data-testid^='product-']"),
    ).filter((node) =>
      /^product-\d+$/.test(node.getAttribute("data-testid") || ""),
    );

    const items = cardNodes.map((card) => {
      const href =
        card.querySelector("a[href*='/pdp/']")?.getAttribute("href") || "";
      const name =
        card.querySelector("[data-testid='product_mosaico_name']")
          ?.textContent || "";
      const discountedPrice =
        card.querySelector("[data-testid='product_mosaico_discounted_price']")
          ?.textContent || "";
      const basePrice =
        card.querySelector("[data-testid='product_mosaico_price']")
          ?.textContent || "";
      const hasDiscount = Boolean(discountedPrice.trim());
      const salePrice = hasDiscount ? discountedPrice : basePrice;
      const originalPrice = hasDiscount ? basePrice : "";
      const paymentPlan =
        card.querySelector("[data-testid='product_mosaico_paymentPlan']")
          ?.textContent || "";
      const badges = Array.from(
        card.querySelectorAll("[data-testid='product_list_badges'] span"),
      )
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);

      return {
        href: href.trim(),
        name: name.trim(),
        sale_price_raw: salePrice.trim(),
        original_price_raw: originalPrice.trim(),
        payment_plan: paymentPlan.trim(),
        badges,
      };
    });

    return { totalCountText, items };
  });

  return { ...data, status };
}

async function scrapeProductDetail(page, productUrl, timeoutMs) {
  const response = await page.goto(productUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  const status = response ? response.status() : null;
  if (status && BLOCK_STATUS_CODES.has(status)) {
    throw new SafetyStopError(
      `blocking status detected (${status}) at detail ${productUrl}`,
      "BLOCKING_STATUS",
    );
  }

  await page.waitForTimeout(3500);
  await dismissLocationModal(page);

  const antiBotSignals = await detectAntiBotSignals(page);
  if (antiBotSignals.length) {
    throw new SafetyStopError(
      `anti-bot challenge detected at detail ${productUrl}: ${antiBotSignals.join(", ")}`,
      "ANTIBOT_CHALLENGE",
    );
  }

  await page.waitForSelector(
    "[data-testid='pdp_product_name'], [data-testid='pdp_product_sku'], h1",
    { timeout: timeoutMs },
  );

  const data = await page.evaluate(() => {
    const norm = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const unique = (values) => Array.from(new Set(values.filter(Boolean)));
    const fromSelector = (selector) =>
      unique(
        Array.from(document.querySelectorAll(selector))
          .map((el) => norm(el.textContent || ""))
          .filter(Boolean),
      );
    const firstText = (selector) => {
      const list = fromSelector(selector);
      return list.length ? list[0] : "";
    };

    const descriptionText = (() => {
      const headings = Array.from(document.querySelectorAll("h1,h2,h3"));
      const target = headings.find((h) => norm(h.textContent) === "Descripción");
      if (!target) {
        return "";
      }
      let cursor = target.nextElementSibling;
      while (cursor) {
        const text = norm(cursor.innerText || cursor.textContent || "");
        if (text && text !== "Especificaciones") {
          return text;
        }
        if (/^Especificaciones$/i.test(text)) {
          break;
        }
        cursor = cursor.nextElementSibling;
      }
      return "";
    })();

    const specPairs = [];
    const specRows = Array.from(
      document.querySelectorAll(
        "[data-testid='characteristicsTable'] tr, [data-testid='characteristics-table-container'] tr",
      ),
    );
    for (const row of specRows) {
      const cells = Array.from(row.querySelectorAll("th,td"))
        .map((cell) => norm(cell.textContent || ""))
        .filter(Boolean);
      if (cells.length >= 2) {
        specPairs.push([cells[0], cells.slice(1).join(" | ")]);
      }
    }

    const dedupedSpecPairs = [];
    const seenSpec = new Set();
    for (const [key, value] of specPairs) {
      const sig = `${key}::${value}`;
      if (seenSpec.has(sig)) {
        continue;
      }
      seenSpec.add(sig);
      dedupedSpecPairs.push([key, value]);
    }

    const ldProducts = [];
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      const raw = script.textContent || "";
      if (!raw.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (queue.length) {
          const item = queue.shift();
          if (!item || typeof item !== "object") {
            continue;
          }
          if (Array.isArray(item["@graph"])) {
            queue.push(...item["@graph"]);
          }
          const type = item["@type"];
          if (
            type === "Product" ||
            (Array.isArray(type) && type.includes("Product"))
          ) {
            ldProducts.push(item);
          }
        }
      } catch {
        continue;
      }
    }
    const ldProduct = ldProducts.length ? ldProducts[0] : null;

    const discountedRaw = firstText("[data-testid='pdp_discounted_price']");
    const baseRaw = firstText("[data-testid='pdp_price']");
    const hasDiscount = Boolean(discountedRaw);
    const saleRaw = hasDiscount ? discountedRaw : baseRaw;
    const originalRaw = hasDiscount ? baseRaw : "";

    return {
      product_name: firstText("[data-testid='pdp_product_name']") || norm(document.querySelector("h1")?.textContent || ""),
      sku_text: firstText("[data-testid='pdp_product_sku']"),
      sold_by: firstText("[data-testid='pdp_product_sold_by']"),
      cash_price_label: firstText("[data-testid='pdp_cash_price_label']"),
      payment_plan: firstText("[data-testid='pdp_payment_plan']"),
      weekly_plan: firstText("[data-testid='pdp_weekly_plan']"),
      savings_text: firstText("[data-testid='pdp_savings_percentage']"),
      shipping_delivery: firstText("[data-testid='pdp_delivery']"),
      shipping_instruction: firstText("[data-testid='pdp_shipping_instruction']"),
      about_bullets: unique(
        Array.from(
          document.querySelectorAll("[data-testid='pdp_about_product_details'] li"),
        ).map((li) => norm(li.textContent || "")),
      ),
      description_text: descriptionText,
      spec_pairs: dedupedSpecPairs,
      pdp_sale_price_raw: saleRaw,
      pdp_original_price_raw: originalRaw,
      ldjson_product_name: norm(ldProduct?.name || ""),
      ldjson_brand_name: norm(ldProduct?.brand?.name || ""),
      ldjson_description: norm(ldProduct?.description || ""),
      ldjson_sku: norm(ldProduct?.sku || ""),
      ldjson_offer_price: norm(ldProduct?.offers?.price || ""),
      ldjson_offer_currency: norm(ldProduct?.offers?.priceCurrency || ""),
      ldjson_offer_availability: norm(ldProduct?.offers?.availability || ""),
    };
  });

  return { ...data, status };
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

  if (!args.proxy) {
    throw new SafetyStopError(
      "Proxy is required in safe mode. Set PROXY_URL in environment variables.",
      "PROXY_REQUIRED",
    );
  }

  const launchOptions = {
    headless: !args.headful,
  };
  if (args.proxy) {
    let parsedProxy;
    try {
      parsedProxy = new URL(args.proxy);
    } catch {
      throw new SafetyStopError("PROXY_URL is not a valid URL", "INVALID_PROXY");
    }
    if (isPrivateOrLocalProxyHost(parsedProxy.hostname)) {
      throw new SafetyStopError(
        "PROXY_URL points to localhost/private network. Use an external proxy endpoint for IP safety.",
        "UNSAFE_PROXY_HOST",
      );
    }
    launchOptions.proxy = {
      server: `${parsedProxy.protocol}//${parsedProxy.host}`,
      username: parsedProxy.username || undefined,
      password: parsedProxy.password || undefined,
    };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    locale: "es-MX",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 2200 },
  });
  const page = await context.newPage();
  let robotsCheck = {
    checked: false,
    allowed: null,
    reason: "not_checked",
    robots_url: null,
    matched_rule_type: null,
    matched_rule_pattern: null,
  };
  let safetyStopReason = null;
  let consecutiveFailures = 0;

  const allRows = [];
  const seenProductIds = new Set();
  let totalCount = null;
  let pagesToVisit =
    args.maxPages !== null ? args.maxPages : FALLBACK_MAX_PAGES;
  const baseOrigin = new URL(args.baseUrl).origin;
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
    const decision = await fetchRobotsDecision(
      context,
      args.baseUrl,
      args.timeoutMs,
    );
    robotsCheck = {
      checked: true,
      allowed: decision.allowed,
      reason: decision.reason,
      robots_url: decision.robots_url,
      matched_rule_type: decision.matched_rule_type,
      matched_rule_pattern: decision.matched_rule_pattern,
    };
    if (!decision.allowed) {
      throw new SafetyStopError(
        `robots policy disallows crawl path (pattern=${decision.matched_rule_pattern || "unknown"})`,
        "ROBOTS_DISALLOW",
      );
    }

    for (let pageNumber = 0; pageNumber < pagesToVisit; pageNumber += 1) {
      const beginIndex = pageNumber * args.pageSize;
      const pageUrl = buildPageUrl(args.baseUrl, beginIndex);
      let pageData = null;
      let lastError = null;

      for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
        try {
          pageData = await scrapePage(page, pageUrl, args.timeoutMs);
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
          await page.waitForTimeout(backoffMs);
        }
      }

      if (!pageData) {
        if (consecutiveFailures >= args.maxConsecutiveFailures) {
          throw new SafetyStopError(
            `consecutive page failures reached safety threshold (${args.maxConsecutiveFailures}): ${
              lastError?.message || "unknown error"
            }`,
            "FAILURE_CIRCUIT_OPEN",
          );
        }
        throw lastError || new Error("page scrape failed");
      }

      const pageTotalCount = parseResultCount(pageData.totalCountText);
      if (totalCount === null && pageTotalCount !== null) {
        totalCount = pageTotalCount;
        if (args.maxPages === null) {
          pagesToVisit = Math.min(
            Math.ceil(totalCount / args.pageSize),
            FALLBACK_MAX_PAGES,
          );
        }
      }

      if (!pageData.items.length) {
        break;
      }

      pageData.items.forEach((raw, index) => {
        const row = normalizeRecord(
          raw,
          capturedAt,
          pageUrl,
          index,
          beginIndex,
          baseOrigin,
        );

        if (!row.product_id) {
          return;
        }
        if (seenProductIds.has(row.product_id)) {
          return;
        }

        seenProductIds.add(row.product_id);
        allRows.push(row);
      });

      if ((pageNumber + 1) < pagesToVisit) {
        const jitterDelayMs = randomIntInclusive(
          args.minDelayMs,
          args.maxDelayMs,
        );
        await page.waitForTimeout(jitterDelayMs);
      }
    }

    if (args.crawlDetails && allRows.length > 0) {
      const detailPage = await context.newPage();
      let detailConsecutiveFailures = 0;
      const rowsForDetail =
        args.maxDetailProducts !== null
          ? allRows.slice(0, args.maxDetailProducts)
          : allRows;

      detailStats.target_products = rowsForDetail.length;
      detailStats.skipped = allRows.length - rowsForDetail.length;

      for (let index = 0; index < rowsForDetail.length; index += 1) {
        const row = rowsForDetail[index];
        if (!row.product_url) {
          row.detail_status = "error";
          row.detail_error_code = "MISSING_PRODUCT_URL";
          row.detail_error_message = "missing product URL";
          detailStats.failed += 1;
          detailStats.crawled_products += 1;
          continue;
        }
        let detailData = null;
        let lastError = null;

        for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
          try {
            detailData = await scrapeProductDetail(
              detailPage,
              row.product_url,
              args.timeoutMs,
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
            await detailPage.waitForTimeout(backoffMs);
          }
        }

        if (!detailData) {
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
          const specsObject = {};
          for (const [key, value] of detailData.spec_pairs || []) {
            if (!key || Object.prototype.hasOwnProperty.call(specsObject, key)) {
              continue;
            }
            specsObject[key] = value;
          }

          row.detail_status = "ok";
          row.detail_error_code = "";
          row.detail_error_message = "";
          row.detail_collected_at = capturedAt;
          row.pdp_name = detailData.product_name || "";
          row.pdp_sku = parseSkuFromText(detailData.sku_text) || detailData.ldjson_sku || "";
          row.pdp_sku_text = detailData.sku_text || "";
          row.pdp_sold_by = detailData.sold_by || "";
          row.pdp_cash_price_label = detailData.cash_price_label || "";
          row.pdp_payment_plan = detailData.payment_plan || "";
          row.pdp_weekly_plan = detailData.weekly_plan || "";
          row.pdp_savings_text = detailData.savings_text || "";
          row.pdp_shipping_delivery = detailData.shipping_delivery || "";
          row.pdp_shipping_instruction = detailData.shipping_instruction || "";
          row.pdp_about_bullets = Array.isArray(detailData.about_bullets)
            ? detailData.about_bullets.join(" | ")
            : "";
          row.pdp_description = detailData.description_text || "";
          row.pdp_specs_json = JSON.stringify(specsObject);
          row.pdp_specs_count = Object.keys(specsObject).length;
          row.pdp_sale_price_raw = detailData.pdp_sale_price_raw || "";
          row.pdp_sale_price_mxn = parseMxMoney(detailData.pdp_sale_price_raw);
          row.pdp_original_price_raw = detailData.pdp_original_price_raw || "";
          row.pdp_original_price_mxn = parseMxMoney(
            detailData.pdp_original_price_raw,
          );
          row.ldjson_product_name = detailData.ldjson_product_name || "";
          row.ldjson_brand_name = detailData.ldjson_brand_name || "";
          row.ldjson_description = detailData.ldjson_description || "";
          row.ldjson_offer_price_mxn = parseMxMoney(detailData.ldjson_offer_price);
          row.ldjson_offer_currency = detailData.ldjson_offer_currency || "";
          row.ldjson_offer_availability =
            detailData.ldjson_offer_availability || "";

          detailStats.success += 1;
          detailStats.crawled_products += 1;
        }

        if ((index + 1) < rowsForDetail.length) {
          const detailDelayMs = randomIntInclusive(
            args.minDelayMs,
            args.maxDelayMs,
          );
          await detailPage.waitForTimeout(detailDelayMs);
        }
      }

      if (rowsForDetail.length < allRows.length) {
        for (const skippedRow of allRows.slice(rowsForDetail.length)) {
          skippedRow.detail_status = "skipped";
          skippedRow.detail_error_code = "";
          skippedRow.detail_error_message = "";
        }
      }

      await detailPage.close();
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
    await context.close();
    await browser.close();
  }

  const latestJsonPath = path.join(outputRoot, "latest_products.json");
  const latestCsvPath = path.join(outputRoot, "latest_products.csv");
  const snapshotJsonPath = path.join(
    snapshotsDir,
    `products_${timestamp}.json`,
  );
  const snapshotCsvPath = path.join(
    snapshotsDir,
    `products_${timestamp}.csv`,
  );
  const historyCsvPath = path.join(outputRoot, "price_history.csv");
  const changesJsonPath = path.join(
    reportsDir,
    `price_changes_${timestamp}.json`,
  );
  const changesCsvPath = path.join(
    reportsDir,
    `price_changes_${timestamp}.csv`,
  );
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
    "name",
    "product_url",
    "sale_price_raw",
    "sale_price_mxn",
    "original_price_raw",
    "original_price_mxn",
    "payment_plan",
    "badges",
    "page_begin_index",
    "position_in_page",
    "listing_url",
    "detail_status",
    "detail_error_code",
    "detail_error_message",
    "detail_collected_at",
    "pdp_name",
    "pdp_sku",
    "pdp_sku_text",
    "pdp_sold_by",
    "pdp_sale_price_raw",
    "pdp_sale_price_mxn",
    "pdp_original_price_raw",
    "pdp_original_price_mxn",
    "pdp_cash_price_label",
    "pdp_payment_plan",
    "pdp_weekly_plan",
    "pdp_savings_text",
    "pdp_shipping_delivery",
    "pdp_shipping_instruction",
    "pdp_about_bullets",
    "pdp_description",
    "pdp_specs_json",
    "pdp_specs_count",
    "ldjson_product_name",
    "ldjson_brand_name",
    "ldjson_description",
    "ldjson_offer_price_mxn",
    "ldjson_offer_currency",
    "ldjson_offer_availability",
  ];
  const changeHeaders = [
    "change_type",
    "product_id",
    "name",
    "product_url",
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
    fs.writeFile(
      latestChangesJsonPath,
      JSON.stringify(priceChanges, null, 2),
      "utf8",
    ),
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
    captured_at: capturedAt,
    base_url: args.baseUrl,
    total_products: allRows.length,
    total_count_reported_by_site: totalCount,
    pages_requested:
      allRows.length > 0 ? Math.ceil(allRows.length / args.pageSize) : 0,
    max_pages_requested:
      args.maxPages !== null ? args.maxPages : pagesToVisit,
    price_changes: priceChanges.filter((x) => x.change_type === "price_changed")
      .length,
    new_products: newProducts.length,
    removed_products: removedProducts.length,
    output_root: outputRoot,
    files: {
      latest_json: latestJsonPath,
      latest_csv: latestCsvPath,
      latest_changes_json: latestChangesJsonPath,
      latest_changes_csv: latestChangesCsvPath,
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
      proxy_required: true,
      proxy_enabled: Boolean(args.proxy),
      direct_ip_allowed: false,
      robots_check: robotsCheck,
      max_retries: args.maxRetries,
      min_delay_ms: args.minDelayMs,
      max_delay_ms: args.maxDelayMs,
      backoff_base_ms: args.backoffBaseMs,
      max_consecutive_failures: args.maxConsecutiveFailures,
      safety_stop_reason: safetyStopReason,
    },
  };

  const runWriteTasks = [
    fs.writeFile(latestRunPath, JSON.stringify(runSummary, null, 2), "utf8"),
  ];
  if (args.keepHistory) {
    runWriteTasks.push(fs.writeFile(runPath, JSON.stringify(runSummary, null, 2), "utf8"));
  }
  await Promise.all(runWriteTasks);

  console.log("Coppel crawl finished.");
  console.log(`Captured at: ${capturedAt}`);
  console.log(`Products collected: ${allRows.length}`);
  if (totalCount !== null) {
    console.log(`Site reported total count: ${totalCount}`);
  }
  console.log(
    `Price changes: ${
      priceChanges.filter((x) => x.change_type === "price_changed").length
    }`,
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
  console.error("Coppel crawl failed.");
  console.error(error);
  process.exitCode = 1;
});
