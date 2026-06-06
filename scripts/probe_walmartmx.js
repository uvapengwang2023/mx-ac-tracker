#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import { chromium } from "playwright";
import { persistRunToSqliteV2 } from "./sqlite_store_v2.js";

const DEFAULT_BASE_URL =
  "https://www.walmart.com.mx/browse/linea-blanca/ventiladores-y-aires-acondicionados/aire-acondicionado/265699_265705_265708?page=1&affinityOverride=default";
const DEFAULT_OUTPUT_DIR = "data/walmartmx";
const DEFAULT_DB_PATH = "data/ac_price_monitor_mexico_v2.db";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_WAIT_FOR_MANUAL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PRODUCTS = 60;
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_ATTACH_WALMART_PAGE_TIMEOUT_MS = 15000;

const CHROME_BINARY_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
];

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeForKeywordMatch(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractLikelyMxMoneyToken(raw) {
  const text = normalizeWhitespace(raw);
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();
  for (const marker of ["precio actual", "precio ahora", "precio vigente"]) {
    const idx = lower.indexOf(marker);
    if (idx === -1) continue;
    const snippet = text.slice(idx, idx + 220);
    const m = snippet.match(/(?:mxn\s*)?\$\s*[0-9][0-9.,]*/i);
    if (m) return m[0];
  }

  const currency = text.match(/(?:mxn\s*)?\$\s*[0-9][0-9.,]*/i);
  if (currency) return currency[0];

  const numericOnly = text.match(/^[0-9][0-9,.-]*$/);
  return numericOnly ? text : null;
}

function parseMxMoney(raw) {
  const token = extractLikelyMxMoneyToken(raw);
  if (!token) {
    return null;
  }

  // Keep only digits and common separators. WalmartMX often uses:
  //   "$5,990.00"  (comma thousands, dot decimals)
  //   "$849.15"    (dot decimals)
  // But we also tolerate the inverse style: "5.990,00".
  const cleaned = token.replace(/[^0-9,.-]/g, "");
  if (!cleaned) {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: whichever appears last is the decimal separator.
    if (lastDot > lastComma) {
      // 5,990.00 -> 5990.00
      normalized = cleaned.replace(/,/g, "");
    } else {
      // 5.990,00 -> 5990.00
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    }
  } else if (lastComma !== -1) {
    const commaCount = (cleaned.match(/,/g) || []).length;
    if (commaCount > 1) {
      // 1,234,567 -> 1234567
      normalized = cleaned.replace(/,/g, "");
    } else {
      const [intPart, fracPart = ""] = cleaned.split(",");
      if (fracPart.length === 2) {
        // 5990,00 -> 5990.00
        normalized = `${intPart}.${fracPart}`;
      } else {
        // 5,990 -> 5990
        normalized = cleaned.replace(/,/g, "");
      }
    }
  } else if (lastDot !== -1) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      // 1.234.567 -> 1234567
      normalized = cleaned.replace(/\./g, "");
    } else {
      const [intPart, fracPart = ""] = cleaned.split(".");
      if (fracPart.length === 2) {
        // 5990.00 -> 5990.00
        normalized = cleaned;
      } else if (fracPart.length === 3 && intPart.length <= 3) {
        // 5.990 (thousands) -> 5990
        normalized = `${intPart}${fracPart}`;
      } else {
        normalized = cleaned.replace(/\./g, "");
      }
    }
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
}

function isAcRelatedWalmartProduct(row) {
  const haystack = normalizeForKeywordMatch(`${row?.name || ""} ${row?.product_url || ""}`);
  if (!haystack) return false;

  const isAc =
    /\bminisplit\b/.test(haystack) ||
    /\bmini\s*-?\s*split\b/.test(haystack) ||
    /\baire\s*-?\s*acondicionado\b/.test(haystack) ||
    /\baires\s*-?\s*acondicionados\b/.test(haystack);
  if (!isAc) return false;

  if (
    /\bventilador(?:es)?\b/.test(haystack) ||
    /\benfriador(?:es)?\s+de\s+aire\b/.test(haystack) ||
    /\bclimatizador(?:es)?\b/.test(haystack) ||
    /\bpurificador(?:es)?\b/.test(haystack) ||
    /\bhumidificador(?:es)?\b/.test(haystack) ||
    /\bdeshumidificador(?:es)?\b/.test(haystack) ||
    /\bcalefactor(?:es)?\b/.test(haystack) ||
    /\bcalentador(?:es)?\b/.test(haystack) ||
    /\bradiador(?:es)?\b/.test(haystack) ||
    /\bextractor(?:es)?\b/.test(haystack)
  ) {
    return false;
  }

  if (
    /\bcontrol\s+remoto\b/.test(haystack) ||
    /\bfiltro(?:s)?\b/.test(haystack) ||
    /\brefaccion(?:es)?\b/.test(haystack) ||
    /\brepuesto(?:s)?\b/.test(haystack) ||
    /\bmanguera(?:s)?\b/.test(haystack) ||
    /\btuberia(?:s)?\b/.test(haystack) ||
    /\bsoporte(?:s)?\b/.test(haystack) ||
    /\bcobertor(?:es)?\b/.test(haystack) ||
    /\bprotector(?:es)?\b/.test(haystack) ||
    /\blimpiador(?:es)?\b/.test(haystack) ||
    /\brefrigerante(?:s)?\b/.test(haystack) ||
    /\bgas\b/.test(haystack)
  ) {
    return false;
  }

  return true;
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
      path: urlString,
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
    acOnlyFilter: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxWaitForManualMs: DEFAULT_MAX_WAIT_FOR_MANUAL_MS,
    maxProducts: DEFAULT_MAX_PRODUCTS,
    proxy: process.env.PROXY_URL || "",
    allowDirectIp: false,
    // Default: use a real Chrome instance (CDP attach) to reduce false positives in anti-bot.
    useCdpChrome: true,
    chromeBinary: process.env.CHROME_BIN || "",
    // Default: persistent profile to reduce repeated manual verification.
    // Override with --chrome-user-data-dir or use --ephemeral-profile for a fresh profile each run.
    chromeUserDataDir: process.env.CHROME_USER_DATA_DIR || "",
    ephemeralProfile: false,
    cdpPort: DEFAULT_CDP_PORT,
    attachWalmartPageTimeoutMs: DEFAULT_ATTACH_WALMART_PAGE_TIMEOUT_MS,
    screenshotOnFail: true,
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
    } else if (token === "--no-ac-filter") {
      args.acOnlyFilter = false;
    } else if (token === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      i += 1;
    } else if (token === "--max-wait-manual-ms" && next) {
      args.maxWaitForManualMs = Number(next);
      i += 1;
    } else if (token === "--max-products" && next) {
      args.maxProducts = Number(next);
      i += 1;
    } else if (token === "--no-cdp") {
      args.useCdpChrome = false;
    } else if (token === "--chrome-bin" && next) {
      args.chromeBinary = next;
      i += 1;
    } else if (token === "--chrome-user-data-dir" && next) {
      args.chromeUserDataDir = next;
      i += 1;
    } else if (token === "--ephemeral-profile") {
      args.ephemeralProfile = true;
    } else if (token === "--cdp-port" && next) {
      args.cdpPort = Number(next);
      i += 1;
    } else if (token === "--attach-timeout-ms" && next) {
      args.attachWalmartPageTimeoutMs = Number(next);
      i += 1;
    } else if (token === "--no-screenshot-on-fail") {
      args.screenshotOnFail = false;
    } else if (token === "--allow-direct-ip") {
      args.allowDirectIp = true;
    } else if (token === "--proxy" && next) {
      throw new Error(
        "Security policy: CLI --proxy is disabled. Use PROXY_URL environment variable instead.",
      );
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  if (!Number.isFinite(args.maxWaitForManualMs) || args.maxWaitForManualMs <= 0) {
    throw new Error("--max-wait-manual-ms must be a positive number");
  }
  if (!Number.isFinite(args.maxProducts) || args.maxProducts <= 0) {
    throw new Error("--max-products must be a positive number");
  }
  if (!Number.isFinite(args.cdpPort) || args.cdpPort <= 0) {
    throw new Error("--cdp-port must be a positive number");
  }
  if (
    !Number.isFinite(args.attachWalmartPageTimeoutMs) ||
    args.attachWalmartPageTimeoutMs <= 0
  ) {
    throw new Error("--attach-timeout-ms must be a positive number");
  }
  if (!args.saveToDb) {
    args.dbPath = "";
  }

  if (args.useCdpChrome) {
    if (args.ephemeralProfile) {
      args.chromeUserDataDir = "";
    } else if (!args.chromeUserDataDir) {
      // Keep the profile under outputDir by default so it stays contained under data/.
      args.chromeUserDataDir = path.join(args.outputDir, "chrome_profile");
    }
  }

  return args;
}

function findChromeBinary(overridePath) {
  if (overridePath) {
    return overridePath;
  }
  for (const candidate of CHROME_BINARY_CANDIDATES) {
    try {
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return "";
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickFreePort(startPort, tries = 20) {
  for (let offset = 0; offset < tries; offset += 1) {
    const port = startPort + offset;
    // eslint-disable-next-line no-await-in-loop
    const ok = await canListen(port);
    if (ok) {
      return port;
    }
  }
  throw new Error(`No free port found starting from ${startPort}`);
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const status = res.statusCode || 0;
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status} at ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(2000, () => {
      req.destroy(new Error(`timeout at ${url}`));
    });
  });
}

async function waitForCdpReady(port, timeoutMs) {
  const start = Date.now();
  const endpoint = `http://127.0.0.1:${port}`;
  while (Date.now() - start < timeoutMs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await httpGetJson(`${endpoint}/json/version`);
      return endpoint;
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await delay(250);
    }
  }
  throw new Error(`CDP endpoint not ready after ${timeoutMs}ms (port=${port})`);
}

function buildChromeProxyArg(proxyUrl) {
  if (!proxyUrl) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error("PROXY_URL is not a valid URL");
  }
  // Chrome accepts formats like:
  //   --proxy-server="socks5://127.0.0.1:7891"
  //   --proxy-server="http://127.0.0.1:7890"
  // Note: If proxy auth is required, prefer an upstream local proxy that handles auth.
  return `--proxy-server=${parsed.protocol}//${parsed.host}`;
}

async function launchChromeForProbe(args) {
  const chromeBin = findChromeBinary(args.chromeBinary);
  if (!chromeBin) {
    throw new Error(
      "Chrome binary not found. Set CHROME_BIN or use --chrome-bin to specify it.",
    );
  }

  const port = await pickFreePort(args.cdpPort);
  const userDataDir = args.chromeUserDataDir
    ? path.resolve(args.chromeUserDataDir)
    : await fs.mkdtemp(path.join(os.tmpdir(), "wmx_chrome_profile_"));

  if (args.chromeUserDataDir) {
    await fs.mkdir(userDataDir, { recursive: true, mode: 0o700 });
    try {
      await fs.chmod(userDataDir, 0o700);
    } catch {
      // ignore chmod failures (e.g., filesystem restrictions)
    }
  }

  const proxyArg = buildChromeProxyArg(args.proxy);

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "--window-size=1440,2200",
    ...(proxyArg ? [proxyArg] : []),
    args.baseUrl,
  ];

  const child = spawn(chromeBin, chromeArgs, {
    stdio: "ignore",
    detached: false,
  });

  const endpoint = await waitForCdpReady(port, 15000);
  return { child, endpoint, port, userDataDir };
}

async function waitForWalmartPage(context, baseUrl, timeoutMs) {
  let host = "walmart.com.mx";
  try {
    host = new URL(baseUrl).host;
  } catch {
    // ignore invalid baseUrl
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pages = context.pages();
    for (const candidate of pages) {
      const url = candidate.url();
      if (!url || url === "about:blank") {
        continue;
      }
      try {
        if (new URL(url).host === host) {
          return candidate;
        }
      } catch {
        // ignore URL parse errors
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(250);
  }

  const fallback =
    context.pages().find((p) => p.url() && p.url() !== "about:blank") ||
    context.pages()[0];
  if (fallback) {
    return fallback;
  }
  return context.newPage();
}

async function isBlocked(page) {
  const url = page.url();
  if (url.includes("/blocked")) {
    return true;
  }
  let title = "";
  try {
    title = await page.title();
  } catch {
    title = "";
  }
  if (/verifica tu identidad/i.test(title)) {
    return true;
  }
  try {
    const hasText = await page
      .locator("text=/Verifica tu identidad/i")
      .first()
      .isVisible({ timeout: 1000 });
    return hasText;
  } catch {
    return false;
  }
}

async function waitForManualPass(page, timeoutMs) {
  const start = Date.now();
  let lastLogAt = 0;
  while (Date.now() - start < timeoutMs) {
    const blocked = await isBlocked(page);
    if (!blocked) {
      return { passed: true, waited_ms: Date.now() - start };
    }
    if (Date.now() - lastLogAt > 8000) {
      lastLogAt = Date.now();
      console.log(
        [
          "Detected Walmart verification page.",
          "Manual steps (based on the on-screen UI):",
          '1) Click the small person icon to the LEFT of the big button.',
          "2) Wait ~15 seconds.",
          '3) Click the big button labeled \"Mantén presionado\" once (no long-press).',
        ].join("\n"),
      );
    }
    await delay(1000);
  }
  return { passed: false, waited_ms: Date.now() - start };
}

async function extractProductsFromDom(page, maxProducts, capturedAt) {
  const results = await page.evaluate(({ maxProducts }) => {
    const seen = new Set();
    const rows = [];

    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const toAbs = (href) => {
      try {
        return new URL(href, window.location.href).toString();
      } catch {
        return href;
      }
    };

    const parseMoney = (raw) => {
      const cleaned = String(raw || "").replace(/[^0-9,.-]/g, "");
      if (!cleaned) return null;
      const lastComma = cleaned.lastIndexOf(",");
      const lastDot = cleaned.lastIndexOf(".");
      let normalized = cleaned;
      if (lastComma !== -1 && lastDot !== -1) {
        normalized = lastDot > lastComma ? cleaned.replace(/,/g, "") : cleaned.replace(/\./g, "").replace(",", ".");
      } else if (lastComma !== -1) {
        const parts = cleaned.split(",");
        normalized = parts.length === 2 && parts[1].length === 2 ? `${parts[0]}.${parts[1]}` : cleaned.replace(/,/g, "");
      } else if (lastDot !== -1) {
        const parts = cleaned.split(".");
        normalized = parts.length === 2 && parts[1].length === 2 ? cleaned : cleaned.replace(/\./g, "");
      }
      const num = Number(normalized);
      return Number.isFinite(num) ? num : null;
    };

    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (!href.includes("/ip/")) {
        continue;
      }
      const abs = toAbs(href);
      let parsed = null;
      try {
        parsed = new URL(abs);
      } catch {
        parsed = null;
      }
      if (!parsed) {
        continue;
      }
      // Ignore tracking redirect URLs like /wapcrs/track?...&/ip/...
      if (!/walmart\.com\.mx$/i.test(parsed.hostname)) {
        continue;
      }
      if (!parsed.pathname.startsWith("/ip/")) {
        continue;
      }
      const absIp = parsed.toString();
      if (seen.has(absIp)) {
        continue;
      }

      const card =
        a.closest("article") ||
        a.closest("[data-automation-id]") ||
        a.closest("li") ||
        a.closest("div");

      const cardText = normalize(card ? card.textContent : a.textContent);
      const name =
        normalize(a.textContent) ||
        normalize(a.getAttribute("aria-label")) ||
        cardText;

      let priceRaw = "";
      if (cardText) {
        const m = cardText.match(/\$\s?[0-9][0-9.,]*/);
        if (m) {
          priceRaw = m[0];
        }
      }

      let imageUrl = "";
      const img = card ? card.querySelector("img") : null;
      if (img) {
        imageUrl = img.getAttribute("src") || img.getAttribute("data-src") || "";
      }

      let productId = "";
      try {
        const parts = parsed.pathname.split("/").filter(Boolean);
        productId = parts.length ? parts[parts.length - 1] : "";
        if (!/^[0-9]{8,20}$/.test(productId)) {
          productId = "";
        }
      } catch {
        productId = "";
      }

      rows.push({
        product_url: absIp,
        product_id: productId,
        name,
        sale_price_raw: priceRaw,
        sale_price_mxn: parseMoney(priceRaw),
        image_url: imageUrl,
      });
      seen.add(absIp);

      if (rows.length >= maxProducts) {
        break;
      }
    }

    return rows;
  }, { maxProducts });

  // normalize
  return results.map((row) => ({
    site: "walmartmx",
    captured_at: capturedAt,
    product_id: normalizeWhitespace(row.product_id),
    name: normalizeWhitespace(row.name),
    product_url: normalizeWhitespace(row.product_url),
    image_url: normalizeWhitespace(row.image_url),
    sale_price_raw: normalizeWhitespace(row.sale_price_raw),
    sale_price_mxn: parseMxMoney(row.sale_price_raw),
  }));
}

function dedupeApiObservations(observations, limit = 80) {
  const map = new Map();
  for (const obs of observations) {
    const key = `${obs.origin || ""}${obs.path || ""}|${(obs.query_keys || []).join(",")}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...obs, count: 1 });
    } else {
      prev.count += 1;
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.proxy && !args.allowDirectIp) {
    console.error(
      "Safety policy: PROXY_URL is required for WalmartMX probe by default (to avoid exposing your IP). Use --allow-direct-ip if you accept the risk.",
    );
    process.exitCode = 2;
    return;
  }

  const now = new Date();
  const capturedAt = now.toISOString();
  const outputRoot = path.resolve(args.outputDir);
  const runsDir = path.join(outputRoot, "runs");

  await ensureDirs([outputRoot, runsDir]);

  let chromeProcess = null;
  let tempChromeProfileDir = "";
  let browser = null;
  let context = null;
  let page = null;

  try {
    if (args.useCdpChrome) {
      const chrome = await launchChromeForProbe(args);
      chromeProcess = chrome.child;
      // Only remove the profile dir if we created it automatically.
      if (!args.chromeUserDataDir) {
        tempChromeProfileDir = chrome.userDataDir;
      }
      if (args.chromeUserDataDir) {
        console.log(`Using persistent Chrome profile: ${path.resolve(args.chromeUserDataDir)}`);
      } else {
        console.log(`Using temporary Chrome profile: ${chrome.userDataDir}`);
      }
      browser = await chromium.connectOverCDP(chrome.endpoint);
      context = browser.contexts()[0] || (await browser.newContext());
      page = await waitForWalmartPage(
        context,
        args.baseUrl,
        args.attachWalmartPageTimeoutMs,
      );
      page.setDefaultTimeout(args.timeoutMs);
    } else {
      const launchOptions = {
        headless: false,
      };
      if (args.proxy) {
        let parsedProxy;
        try {
          parsedProxy = new URL(args.proxy);
        } catch {
          throw new Error("PROXY_URL is not a valid URL");
        }
        launchOptions.proxy = {
          server: `${parsedProxy.protocol}//${parsedProxy.host}`,
          username: parsedProxy.username || undefined,
          password: parsedProxy.password || undefined,
        };
      }
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext({
        locale: "es-MX",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        viewport: { width: 1440, height: 2200 },
      });
      page = await context.newPage();
      page.setDefaultTimeout(args.timeoutMs);
    }

    const apiObservations = [];
    page.on("response", (response) => {
      try {
        const req = response.request();
        const type = req.resourceType();
        if (type !== "xhr" && type !== "fetch") {
          return;
        }
        const url = response.url();
        const status = response.status();
        const headers = response.headers();
        const contentType = headers["content-type"] || "";
        apiObservations.push({
          ...sanitizeUrlForLog(url),
          status,
          resource_type: type,
          content_type: contentType,
        });
      } catch {
        // ignore response hook failures
      }
    });

    if (!args.useCdpChrome) {
      console.log("Opening Walmart Mexico category page (manual verification mode)...");
      await page.goto(args.baseUrl, { waitUntil: "domcontentloaded" });
    } else {
      console.log("Manual verification mode: interact with the Chrome window if prompted.");
      console.log(
        "Tip: If the correct Walmart tab is not focused, click it. If Chrome did not load the URL, paste it and load.",
      );
      console.log(`Category URL: ${args.baseUrl}`);
      console.log(`Attached page URL: ${page.url()}`);
    }

    const blockedBefore = await isBlocked(page).catch(() => null);

    const manual = await waitForManualPass(page, args.maxWaitForManualMs);
    const blockedAfter = await isBlocked(page);

    if (!manual.passed || blockedAfter) {
      const finalUrl = page.url();
      const title = await page.title().catch(() => "");

      console.error("Probe did not pass verification within the allowed time.");
      console.error(`Final URL: ${finalUrl}`);

      const runSummary = {
        site: "walmartmx",
        captured_at: capturedAt,
        base_url: sanitizeUrlForLog(args.baseUrl),
        final_url: sanitizeUrlForLog(finalUrl),
        manual_verification: {
          blocked_before: Boolean(blockedBefore),
          passed: false,
          waited_ms: manual.waited_ms,
        },
        failure: {
          reason: "verification_not_passed",
          title: normalizeWhitespace(title),
        },
        database: {
          enabled: args.saveToDb,
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
        },
        observed_api_endpoints: dedupeApiObservations(apiObservations, 100),
        products_extracted: 0,
        output: {
          latest_products_json: path.join(outputRoot, "latest_products.json"),
          latest_run_json: path.join(runsDir, "latest_run.json"),
          latest_blocked_png: args.screenshotOnFail
            ? path.join(outputRoot, "latest_blocked.png")
            : null,
        },
        notes:
          "This is a manual-verification probe only. It does not attempt to bypass anti-bot challenges automatically.",
      };

      if (args.screenshotOnFail) {
        try {
          await page.screenshot({
            path: path.join(outputRoot, "latest_blocked.png"),
            fullPage: true,
          });
        } catch {
          // ignore screenshot failures
        }
      }

      await writeLatestOutputs({
        outputRoot,
        runsDir,
        runSummary,
        products: [],
      });

      process.exitCode = 3;
      return;
    }

    // Give the page a bit of time to load XHR data after manual pass.
    await delay(randomIntInclusive(1500, 3000));

    // Extract products (best-effort heuristics).
    let products = [];
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('a[href*=\"/ip/\"]').length > 0,
        null,
        { timeout: args.timeoutMs },
      );
      products = await extractProductsFromDom(page, args.maxProducts, capturedAt);
    } catch {
      products = [];
    }

    const filteredOut = args.acOnlyFilter
      ? products.filter((p) => !isAcRelatedWalmartProduct(p)).length
      : 0;
    if (args.acOnlyFilter) {
      products = products.filter((p) => isAcRelatedWalmartProduct(p));
    }

    const runSummary = {
      site: "walmartmx",
      captured_at: capturedAt,
      base_url: sanitizeUrlForLog(args.baseUrl),
      final_url: sanitizeUrlForLog(page.url()),
      manual_verification: {
        blocked_before: Boolean(blockedBefore),
        passed: manual.passed,
        waited_ms: manual.waited_ms,
      },
      database: {
        enabled: args.saveToDb,
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
      },
      observed_api_endpoints: dedupeApiObservations(apiObservations, 100),
      products_extracted: products.length,
      filters: {
        ac_only: {
          enabled: Boolean(args.acOnlyFilter),
          kept: products.length,
          filtered_out: filteredOut,
        },
      },
      output: {
        latest_products_json: path.join(outputRoot, "latest_products.json"),
        latest_run_json: path.join(runsDir, "latest_run.json"),
      },
      notes:
        "This is a manual-verification probe only. It does not attempt to bypass anti-bot challenges automatically.",
    };

    if (args.saveToDb && products.length > 0) {
      const dbResult = await persistRunToSqliteV2({
        dbPath: args.dbPath,
        runSummary,
        rows: products,
      });
      runSummary.database = dbResult;
    }

    const { latestProductsPath, latestRunPath } = await writeLatestOutputs({
      outputRoot,
      runsDir,
      runSummary,
      products,
    });

    console.log("WalmartMX probe finished.");
    console.log(`Products extracted: ${products.length}`);
    console.log(`Run summary: ${latestRunPath}`);
    console.log(`Products JSON: ${latestProductsPath}`);
  } finally {
    try {
      if (context) {
        await context.close();
      }
    } catch {
      // ignore
    }
    try {
      if (browser) {
        await browser.close();
      }
    } catch {
      // ignore
    }
    if (chromeProcess) {
      try {
        chromeProcess.kill();
      } catch {
        // ignore
      }
    }
    if (tempChromeProfileDir) {
      try {
        await fs.rm(tempChromeProfileDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

main().catch((error) => {
  console.error("WalmartMX probe failed.");
  console.error(error);
  process.exitCode = 1;
});
