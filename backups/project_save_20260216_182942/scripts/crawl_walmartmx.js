#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { persistRunToSqliteV2 } from "./sqlite_store_v2.js";

// Walmart Mexico category crawl (prices only).
// Safety-first: proxy required by default + manual verification support.

const DEFAULT_BASE_URL =
  "https://www.walmart.com.mx/browse/linea-blanca/ventiladores-y-aires-acondicionados/aire-acondicionado/265699_265705_265708?page=1&affinityOverride=default";
const DEFAULT_OUTPUT_DIR = "data/walmartmx";
const DEFAULT_DB_PATH = "data/ac_price_monitor_mexico_v2.db";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_WAIT_FOR_MANUAL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PRODUCTS = 5000;
// User-confirmed total pages for the current WalmartMX category is 23; keep a safer default.
const DEFAULT_MAX_PAGES = 23;
const DEFAULT_MIN_PAGE_DELAY_MS = 2500;
const DEFAULT_MAX_PAGE_DELAY_MS = 4500;
const DEFAULT_LONG_BREAK_EVERY = 3;
const DEFAULT_LONG_BREAK_MIN_MS = 15000;
const DEFAULT_LONG_BREAK_MAX_MS = 25000;
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_ATTACH_WALMART_PAGE_TIMEOUT_MS = 15000;
const MEXICO_CITY_TZ = "America/Mexico_City";

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

  // Prefer the "precio actual" fragment if present to avoid concatenating
  // multiple prices + installment counts (a common WalmartMX UI pattern).
  const lower = text.toLowerCase();
  for (const marker of ["precio actual", "precio ahora", "precio vigente"]) {
    const idx = lower.indexOf(marker);
    if (idx === -1) {
      continue;
    }
    const snippet = text.slice(idx, idx + 220);
    const m = snippet.match(/(?:mxn\s*)?\$\s*[0-9][0-9.,]*/i);
    if (m) {
      return m[0];
    }
  }

  // Fallback: first currency token.
  const currency = text.match(/(?:mxn\s*)?\$\s*[0-9][0-9.,]*/i);
  if (currency) {
    return currency[0];
  }

  // Last resort: allow raw numeric (e.g. meta[itemprop=price] content="5990.00").
  const numericOnly = text.match(/^[0-9][0-9,.-]*$/);
  return numericOnly ? text : null;
}

function parseMxMoney(raw) {
  const token = extractLikelyMxMoneyToken(raw);
  if (!token) {
    return null;
  }

  const cleaned = token.replace(/[^0-9,.-]/g, "");
  if (!cleaned) {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma !== -1 && lastDot !== -1) {
    normalized =
      lastDot > lastComma ? cleaned.replace(/,/g, "") : cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastComma !== -1) {
    const commaCount = (cleaned.match(/,/g) || []).length;
    if (commaCount > 1) {
      normalized = cleaned.replace(/,/g, "");
    } else {
      const [intPart, fracPart = ""] = cleaned.split(",");
      normalized = fracPart.length === 2 ? `${intPart}.${fracPart}` : cleaned.replace(/,/g, "");
    }
  } else if (lastDot !== -1) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      normalized = cleaned.replace(/\./g, "");
    } else {
      const [intPart, fracPart = ""] = cleaned.split(".");
      if (fracPart.length === 2) normalized = cleaned;
      else if (fracPart.length === 3 && intPart.length <= 3) normalized = `${intPart}${fracPart}`;
      else normalized = cleaned.replace(/\./g, "");
    }
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function isAcRelatedWalmartProduct(row) {
  const haystack = normalizeForKeywordMatch(`${row?.name || ""} ${row?.product_url || ""}`);
  if (!haystack) {
    return false;
  }

  const hasMinisplit = /\bminisplit\b/.test(haystack) || /\bmini\s*-?\s*split\b/.test(haystack);
  const hasAireAcond =
    /\baire\s*-?\s*acondicionado\b/.test(haystack) || /\baires\s*-?\s*acondicionados\b/.test(haystack);

  // Must mention an AC concept at least once.
  if (!hasMinisplit && !hasAireAcond) {
    return false;
  }

  // Hard-exclude evaporative coolers / "air coolers" (not real AC units).
  if (
    /\benfriador(?:es)?\s+de\s+aire\b/.test(haystack) ||
    /\bclimatizador(?:es)?\b/.test(haystack) ||
    /\baire\s+lavado\b/.test(haystack) ||
    /\bevaporativ[oa]s?\b/.test(haystack) ||
    /\bcooler\b/.test(haystack)
  ) {
    return false;
  }

  const hasBtu = /\bbtu\b/.test(haystack);
  const hasTon =
    /\btonelada(?:s)?\b/.test(haystack) || /\b\d+(?:\.\d+)?\s*ton\b/.test(haystack);
  const hasInverter = /\binverter\b/.test(haystack);
  const hasSeer = /\bseer\b/.test(haystack);
  const hasPortable = /\bportatil\b/.test(haystack);
  const hasWindow = /\bventana\b/.test(haystack);
  const hasSplitWord = /\bsplit\b/.test(haystack);

  // Strong signals that this is an actual AC unit (vs accessories or generic devices mentioning AC).
  const strongUnit =
    hasMinisplit ||
    hasBtu ||
    hasTon ||
    hasInverter ||
    hasSeer ||
    (hasAireAcond && (hasPortable || hasWindow || hasSplitWord));

  // Accessories / parts: exclude unless the title also looks like a full unit (BTU/ton/inverter/seer).
  const hasAccessory =
    /\bcontrol\s+remoto\b/.test(haystack) ||
    /\brefaccion(?:es)?\b/.test(haystack) ||
    /\brepuesto(?:s)?\b/.test(haystack) ||
    /\bmanguera(?:s)?\b/.test(haystack) ||
    /\bmanguera\s+de\s+escape\b/.test(haystack) ||
    /\btuberia(?:s)?\b/.test(haystack) ||
    /\bsoporte(?:s)?\b/.test(haystack) ||
    /\bcobertor(?:es)?\b/.test(haystack) ||
    /\bprotector(?:es)?\b/.test(haystack) ||
    /\blimpiador(?:es)?\b/.test(haystack) ||
    /\bplaca\s+de\s+ventana\b/.test(haystack) ||
    /\bkit\s+de\s+ventilacion\b/.test(haystack);
  if (hasAccessory && !hasBtu && !hasTon && !hasInverter && !hasSeer) {
    return false;
  }

  // Fan/purifier/humidity keywords appear frequently in portable-AC marketing; only exclude if the
  // listing does not have strong unit signals.
  if (
    (/\bventilador(?:es)?\b/.test(haystack) ||
      /\bpurificador(?:es)?\b/.test(haystack) ||
      /\bhumidificador(?:es)?\b/.test(haystack) ||
      /\bdeshumidificador(?:es)?\b/.test(haystack)) &&
    !strongUnit
  ) {
    return false;
  }

  // Heaters are not AC units unless there are also strong AC signals.
  if (
    (/\bcalefactor(?:es)?\b/.test(haystack) ||
      /\bcalentador(?:es)?\b/.test(haystack) ||
      /\bradiador(?:es)?\b/.test(haystack) ||
      /\bextractor(?:es)?\b/.test(haystack)) &&
    !strongUnit
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

function sha1Hex(value) {
  return crypto.createHash("sha1").update(String(value), "utf8").digest("hex");
}

function canonicalPidFromPidReadable(pidReadable) {
  // Keep consistent with sqlite_store_v2.js: 16-char SHA1 prefix (hex).
  return sha1Hex(pidReadable).slice(0, 16);
}

function canonicalProductIdForWalmartMx(productId) {
  const primaryKey = normalizeWhitespace(productId);
  if (!primaryKey) {
    return "";
  }
  const pidReadable = `PID::SPK::WalmartMX::${primaryKey}`;
  return canonicalPidFromPidReadable(pidReadable);
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

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[\",\n]/.test(text)) {
    return `"${text.replace(/\"/g, "\"\"")}"`;
  }
  return text;
}

function buildWalmartMxPriceFactsForPreview({ products, capturedAt }) {
  const dateMx = toMexicoCityDate(capturedAt) || "";
  const facts = [];
  for (const p of products || []) {
    const price = Number(p?.sale_price_mxn);
    if (!Number.isFinite(price) || price <= 0) {
      continue;
    }
    facts.push({
      date: dateMx,
      price_mxn: price,
      title: normalizeWhitespace(p?.name),
      link: normalizeWhitespace(p?.product_url),
      canonical_product_id: canonicalProductIdForWalmartMx(p?.product_id),
    });
  }

  const prices = facts.map((r) => r.price_mxn);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;

  return {
    dateMx,
    rows: facts.length,
    min,
    max,
    facts,
  };
}

function buildPricePreviewHtml({ dateMx, rows, min, max, generatedAt, dbPath, facts }) {
  const titleDate = dateMx || "unknown-date";
  const dbRel = dbPath ? path.relative(process.cwd(), dbPath) : "";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WalmartMX Price Facts (${titleDate})</title>
  <style>
    :root {
      --bg: #0b1220;
      --panel: rgba(255,255,255,0.06);
      --panel2: rgba(255,255,255,0.09);
      --text: rgba(255,255,255,0.92);
      --muted: rgba(255,255,255,0.62);
      --accent: #39d98a;
      --border: rgba(255,255,255,0.14);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    }
    body {
      margin: 0;
      font-family: var(--sans);
      background: radial-gradient(1200px 800px at 15% 20%, rgba(57,217,138,0.12), transparent 55%),
                  radial-gradient(900px 650px at 85% 30%, rgba(74,144,226,0.12), transparent 60%),
                  var(--bg);
      color: var(--text);
    }
    .wrap {
      max-width: 1100px;
      margin: 28px auto;
      padding: 0 16px 48px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 18px;
      margin: 0;
      letter-spacing: 0.2px;
    }
    .meta {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .pill {
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255,255,255,0.04);
    }
    .controls {
      display: flex;
      gap: 10px;
      align-items: center;
      margin: 14px 0;
    }
    input[type="search"] {
      flex: 1;
      min-width: 240px;
      border-radius: 12px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.05);
      color: var(--text);
      outline: none;
    }
    input[type="search"]::placeholder { color: rgba(255,255,255,0.45); }
    .hint { color: var(--muted); font-size: 12px; }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      overflow: hidden;
      border-radius: 14px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.28);
    }
    thead th {
      font-family: var(--mono);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: rgba(255,255,255,0.75);
      background: rgba(255,255,255,0.07);
      border-bottom: 1px solid var(--border);
      padding: 12px 10px;
      cursor: pointer;
      user-select: none;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    tbody td {
      padding: 12px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.09);
      background: rgba(255,255,255,0.03);
      vertical-align: top;
      font-size: 13px;
      line-height: 1.28;
    }
    tbody tr:nth-child(even) td { background: rgba(255,255,255,0.045); }
    tbody tr:hover td { background: rgba(57,217,138,0.08); }
    a { color: rgba(57,217,138,0.92); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .right { text-align: right; }
    .nowrap { white-space: nowrap; }
    .status {
      margin-top: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>WalmartMX: Price Facts (solo aire acondicionado)</h1>
      <div class="meta">
        <span class="pill">date_mx=${String(dateMx || "")}</span>
        <span class="pill">rows=${String(rows ?? 0)}</span>
        <span class="pill">min=${min === null ? "" : String(min)}</span>
        <span class="pill">max=${max === null ? "" : String(max)}</span>
        <span class="pill">generated_at=${String(generatedAt || "")}</span>
      </div>
    </header>

    <div class="controls">
      <input id="q" type="search" placeholder="Buscar por titulo o URL..." autocomplete="off" />
      <div class="hint">Tip: 点击表头可排序</div>
    </div>

    <table id="tbl">
      <thead>
        <tr>
          <th data-key="price_mxn" class="right nowrap">Precio (MXN)</th>
          <th data-key="title">Titulo</th>
          <th data-key="link">Link</th>
          <th data-key="canonical_product_id" class="nowrap">PID</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>

    <div class="status">
      <div id="statusLeft"></div>
      <div class="small">${dbRel ? `Source: ${dbRel}` : ""}</div>
    </div>
  </div>

  <script id="data" type="application/json">${JSON.stringify(facts || [])}</script>
  <script>
    const DATA = JSON.parse(document.getElementById('data').textContent);

    const tbody = document.querySelector('#tbl tbody');
    const q = document.querySelector('#q');
    const statusLeft = document.querySelector('#statusLeft');

    let sortKey = 'price_mxn';
    let sortDir = 'asc';

    const money = (n) => {
      const num = Number(n);
      if (!Number.isFinite(num)) return '';
      return num.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    };

    const esc = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;');

    const getVal = (row, key) => row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : '';

    function render() {
      const needle = (q.value || '').trim().toLowerCase();
      let filtered = DATA;
      if (needle) {
        filtered = DATA.filter(r => {
          const t = String(r.title || '').toLowerCase();
          const u = String(r.link || '').toLowerCase();
          return t.includes(needle) || u.includes(needle);
        });
      }

      const dir = sortDir === 'asc' ? 1 : -1;
      const sorted = filtered.slice().sort((a, b) => {
        const va = getVal(a, sortKey);
        const vb = getVal(b, sortKey);
        if (sortKey === 'price_mxn') return (Number(va) - Number(vb)) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });

      tbody.innerHTML = '';
      for (const r of sorted) {
        const tr = document.createElement('tr');
        const pid = esc(r.canonical_product_id || '');
        const link = esc(r.link || '');
        const title = esc(r.title || '');
        const price = r.price_mxn;
        tr.innerHTML = \`
          <td class=\"right nowrap\">\${money(price)}</td>
          <td>\${title}</td>
          <td class=\"nowrap\"><a href=\"\${link}\" target=\"_blank\" rel=\"noreferrer\">\${link}</a></td>
          <td class=\"nowrap\"><span style=\"font-family: var(--mono); font-size: 12px; color: rgba(255,255,255,0.75);\">\${pid}</span></td>
        \`;
        tbody.appendChild(tr);
      }

      statusLeft.textContent = \`Showing \${sorted.length} / \${DATA.length}\`;
    }

    q.addEventListener('input', () => render());
    document.querySelectorAll('thead th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-key');
        if (!key) return;
        if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = key; sortDir = key === 'price_mxn' ? 'asc' : 'asc'; }
        render();
      });
    });

    render();
  </script>
</body>
</html>
`;
}

async function writeLatestPriceOutputs({ outputRoot, runSummary, products }) {
  const latestCsvPath = path.join(outputRoot, "latest_price_facts.csv");
  const latestHtmlPath = path.join(outputRoot, "latest_price_preview.html");

  const capturedAt = runSummary?.captured_at || new Date().toISOString();
  const { dateMx, rows, min, max, facts } = buildWalmartMxPriceFactsForPreview({
    products,
    capturedAt,
  });
  const generatedAt = new Date().toISOString();
  const dbPath = runSummary?.database?.db_path || "";

  const csvLines = ["date,price_mxn,title,link,canonical_product_id"];
  for (const r of facts) {
    csvLines.push(
      [
        escapeCsv(r.date),
        escapeCsv(r.price_mxn),
        escapeCsv(r.title),
        escapeCsv(r.link),
        escapeCsv(r.canonical_product_id),
      ].join(","),
    );
  }

  const html = buildPricePreviewHtml({
    dateMx,
    rows,
    min,
    max,
    generatedAt,
    dbPath,
    facts,
  });

  await fs.writeFile(latestCsvPath, `${csvLines.join("\n")}\n`, "utf8");
  await fs.writeFile(latestHtmlPath, html, "utf8");

  return { latestCsvPath, latestHtmlPath };
}

async function writeLatestOutputs({ outputRoot, runsDir, runSummary, products }) {
  const latestProductsPath = path.join(outputRoot, "latest_products.json");
  const latestRunPath = path.join(runsDir, "latest_run.json");

  await fs.writeFile(latestProductsPath, JSON.stringify(products || [], null, 2), "utf8");
  await fs.writeFile(latestRunPath, JSON.stringify(runSummary, null, 2), "utf8");

  const priceOutputs = await writeLatestPriceOutputs({ outputRoot, runSummary, products });

  return {
    latestProductsPath,
    latestRunPath,
    ...priceOutputs,
  };
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
    maxPages: DEFAULT_MAX_PAGES,
    minPageDelayMs: DEFAULT_MIN_PAGE_DELAY_MS,
    maxPageDelayMs: DEFAULT_MAX_PAGE_DELAY_MS,
    longBreakEvery: DEFAULT_LONG_BREAK_EVERY,
    longBreakMinMs: DEFAULT_LONG_BREAK_MIN_MS,
    longBreakMaxMs: DEFAULT_LONG_BREAK_MAX_MS,
    manualConfirm: false,
    proxy: process.env.PROXY_URL || "",
    allowDirectIp: false,
    useCdpChrome: true,
    chromeBinary: process.env.CHROME_BIN || "",
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
    } else if (token === "--max-pages" && next) {
      args.maxPages = Number(next);
      i += 1;
    } else if (token === "--min-page-delay-ms" && next) {
      args.minPageDelayMs = Number(next);
      i += 1;
    } else if (token === "--max-page-delay-ms" && next) {
      args.maxPageDelayMs = Number(next);
      i += 1;
    } else if (token === "--long-break-every" && next) {
      args.longBreakEvery = Number(next);
      i += 1;
    } else if (token === "--long-break-min-ms" && next) {
      args.longBreakMinMs = Number(next);
      i += 1;
    } else if (token === "--long-break-max-ms" && next) {
      args.longBreakMaxMs = Number(next);
      i += 1;
    } else if (token === "--manual-confirm") {
      args.manualConfirm = true;
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
  if (!Number.isFinite(args.maxPages) || args.maxPages <= 0) {
    throw new Error("--max-pages must be a positive number");
  }
  if (!Number.isFinite(args.minPageDelayMs) || args.minPageDelayMs < 0) {
    throw new Error("--min-page-delay-ms must be a non-negative number");
  }
  if (!Number.isFinite(args.maxPageDelayMs) || args.maxPageDelayMs < 0) {
    throw new Error("--max-page-delay-ms must be a non-negative number");
  }
  if (args.maxPageDelayMs < args.minPageDelayMs) {
    throw new Error("--max-page-delay-ms must be >= --min-page-delay-ms");
  }
  if (!Number.isFinite(args.longBreakEvery) || args.longBreakEvery < 0) {
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
  return `--proxy-server=${parsed.protocol}//${parsed.host}`;
}

async function launchChromeForCrawl(args) {
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
      // ignore chmod failures
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

async function promptWithTimeout(rl, prompt, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { timedOut: true, answer: "" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const answer = await rl.question(prompt, { signal: controller.signal });
    return { timedOut: false, answer };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { timedOut: true, answer: "" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForManualConfirmThenPass(page, timeoutMs) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(
      "Manual confirm requested, but no interactive TTY is available; falling back to automatic wait mode.",
    );
    const auto = await waitForManualPass(page, timeoutMs);
    return {
      ...auto,
      mode: "manual_confirm_fallback_auto",
      reason: auto.passed ? null : "fallback_auto_failed",
      user_aborted: false,
    };
  }

  const start = Date.now();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("Manual confirmation gate enabled.");
    console.log("Complete Walmart verification in Chrome, then press Enter here to continue.");
    console.log("Type q and press Enter to abort this run.");

    while (Date.now() - start < timeoutMs) {
      const elapsedMs = Date.now() - start;
      const remainingMs = timeoutMs - elapsedMs;
      const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
      const prompt = `Press Enter after verification (q to quit, ${remainingSec}s left): `;
      const { timedOut, answer } = await promptWithTimeout(rl, prompt, remainingMs);

      if (timedOut) {
        return {
          passed: false,
          waited_ms: Date.now() - start,
          mode: "manual_confirm",
          reason: "timeout",
          user_aborted: false,
        };
      }

      const normalized = String(answer || "").trim().toLowerCase();
      if (normalized === "q" || normalized === "quit" || normalized === "exit") {
        return {
          passed: false,
          waited_ms: Date.now() - start,
          mode: "manual_confirm",
          reason: "user_aborted",
          user_aborted: true,
        };
      }

      const blocked = await isBlocked(page);
      if (!blocked) {
        return {
          passed: true,
          waited_ms: Date.now() - start,
          mode: "manual_confirm",
          reason: null,
          user_aborted: false,
        };
      }

      console.log("Still on verification page. Please complete the challenge in Chrome and try again.");
    }
  } finally {
    rl.close();
  }

  return {
    passed: false,
    waited_ms: Date.now() - start,
    mode: "manual_confirm",
    reason: "timeout",
    user_aborted: false,
  };
}

async function getFirstProductIdFromDom(page) {
  try {
    const href = await page.locator('a[href*=\"/ip/\"]').first().getAttribute("href");
    if (!href) {
      return null;
    }
    const abs = new URL(href, page.url()).toString();
    const parts = new URL(abs).pathname.split("/").filter(Boolean);
    const id = parts.length ? parts[parts.length - 1] : "";
    return /^[0-9]{8,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function extractProductsFromDom(page, maxProducts, capturedAt) {
  const results = await page.evaluate(({ maxProducts }) => {
    const seen = new Set();
    const rows = [];

    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
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
        normalized =
          lastDot > lastComma
            ? cleaned.replace(/,/g, "")
            : cleaned.replace(/\./g, "").replace(",", ".");
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

    const pickCard = (anchor) => {
      const candidates = [
        anchor.closest("article"),
        anchor.closest("[data-automation-id]"),
        anchor.closest("li"),
        anchor.closest("div"),
      ].filter(Boolean);

      if (candidates.length === 0) {
        return null;
      }

      // Heuristic: prefer containers that include a currency sign and more content.
      let best = candidates[0];
      let bestScore = -1;
      for (const c of candidates) {
        const text = normalize(c.textContent);
        const hasCurrency = /\$|mxn/i.test(text);
        const score = (hasCurrency ? 2000 : 0) + Math.min(text.length, 3000);
        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      }
      return best;
    };

    const extractPrice = (card) => {
      const candidates = [];
      const addCandidate = (raw, source, contextText) => {
        const text = normalize(raw);
        if (!text) return;
        const value = parseMoney(text);
        if (value === null || value <= 0) return;

        const ctx = normalize(contextText);
        let score = 0;
        if (source === "meta_itemprop_price") score += 100;
        if (source === "itemprop_price") score += 95;
        if (source === "data_automation_price") score += 85;
        if (source === "data_testid_price") score += 80;
        if (source === "aria_label_price") score += 70;
        if (source === "text_match") score += 50;

        if (/\$|mxn/i.test(text)) score += 10;
        if (ctx && /(mes|mensual|quincenal|semanal|semana|pago|pagos)/i.test(ctx)) score -= 35;
        if (ctx && /(antes|precio regular|regular)/i.test(ctx)) score -= 10;

        candidates.push({ raw: text, value, score, source });
      };

      if (!card) {
        return { raw: "", value: null };
      }

      // Microdata / meta price (often the most reliable).
      const metaPrice =
        card.querySelector('meta[itemprop=\"price\"][content]') ||
        card.querySelector('meta[itemprop=\"price\"]');
      if (metaPrice) {
        addCandidate(metaPrice.getAttribute("content"), "meta_itemprop_price", "meta[itemprop=price]");
      }

      const itemPrice = card.querySelector('[itemprop=\"price\"]');
      if (itemPrice) {
        addCandidate(
          itemPrice.getAttribute("content") || itemPrice.textContent,
          "itemprop_price",
          itemPrice.parentElement ? itemPrice.parentElement.textContent : itemPrice.textContent,
        );
      }

      // Common Walmart-style attributes.
      for (const el of Array.from(
        card.querySelectorAll('[data-automation-id*=\"price\" i]'),
      ).slice(0, 6)) {
        addCandidate(el.textContent, "data_automation_price", el.parentElement?.textContent || "");
        addCandidate(el.getAttribute("aria-label"), "aria_label_price", el.parentElement?.textContent || "");
      }
      for (const el of Array.from(
        card.querySelectorAll('[data-testid*=\"price\" i]'),
      ).slice(0, 6)) {
        addCandidate(el.textContent, "data_testid_price", el.parentElement?.textContent || "");
        addCandidate(el.getAttribute("aria-label"), "aria_label_price", el.parentElement?.textContent || "");
      }

      // Aria-label price (sometimes text is not in textContent).
      for (const el of Array.from(
        card.querySelectorAll('[aria-label*=\"$\"] , [aria-label*=\"MXN\" i], [aria-label*=\"precio\" i]'),
      ).slice(0, 6)) {
        addCandidate(el.getAttribute("aria-label"), "aria_label_price", el.parentElement?.textContent || "");
      }

      // Fallback: search within card text.
      const cardText = normalize(card.textContent);
      if (cardText) {
        const matches = cardText.match(/\$\s?[0-9][0-9.,]*/g) || [];
        for (const m of matches.slice(0, 4)) {
          addCandidate(m, "text_match", cardText);
        }
      }

      if (candidates.length === 0) {
        return { raw: "", value: null };
      }

      candidates.sort((a, b) => b.score - a.score || a.value - b.value);
      const best = candidates[0];
      return { raw: best.raw, value: best.value };
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

      const card = pickCard(a);

      const cardText = normalize(card ? card.textContent : a.textContent);
      const name =
        normalize(a.textContent) ||
        normalize(a.getAttribute("aria-label")) ||
        cardText;

      const price = extractPrice(card);
      const priceRaw = price.raw || "";

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
        sale_price_mxn: price.value,
        image_url: imageUrl,
      });
      seen.add(absIp);

      if (rows.length >= maxProducts) {
        break;
      }
    }

    return rows;
  }, { maxProducts });

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

async function tryClickLoadMore(page) {
  const btn = page
    .locator(
      [
        'button:has-text("Mostrar más")',
        'button:has-text("Ver más")',
        'button:has-text("Cargar más")',
        'button:has-text("Más resultados")',
      ].join(", "),
    )
    .first();
  const visible = await btn.isVisible({ timeout: 800 }).catch(() => false);
  if (!visible) {
    return false;
  }
  const before = await page.locator('a[href*=\"/ip/\"]').count();
  await btn.click({ timeout: 3000 });
  try {
    await page.waitForFunction(
      (prev) => document.querySelectorAll('a[href*=\"/ip/\"]').length > prev,
      before,
      { timeout: 15000 },
    );
    return true;
  } catch {
    return false;
  }
}

function isListingUrl(urlString, baseUrlString) {
  try {
    const url = new URL(urlString);
    const base = new URL(baseUrlString);
    if (url.origin !== base.origin) {
      return false;
    }
    if (url.pathname.startsWith("/ip/")) {
      return false;
    }

    const baseSegs = base.pathname.split("/").filter(Boolean);
    const urlSegs = url.pathname.split("/").filter(Boolean);
    if (baseSegs.length < 2 || urlSegs.length < 2) {
      return false;
    }

    // WalmartMX may redirect between similar browse paths (e.g. changing one middle segment).
    // We treat any browse URL that ends with the same last 2 segments as the same listing.
    const baseTail2 = baseSegs.slice(-2).join("/");
    const urlTail2 = urlSegs.slice(-2).join("/");
    if (baseTail2 && urlTail2 === baseTail2) {
      return true;
    }

    // Extra fallback: match by category id segment.
    const categoryId = baseSegs[baseSegs.length - 1];
    return Boolean(categoryId && urlSegs.includes(categoryId));
  } catch {
    return false;
  }
}

function readNumericQueryParam(url, keys) {
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (!value) {
      continue;
    }
    const n = Number(String(value).trim());
    if (Number.isFinite(n) && n > 0) {
      return { key, value: n };
    }
  }
  return null;
}

function getListingPageParam(urlString) {
  try {
    const url = new URL(urlString);
    return (
      readNumericQueryParam(url, ["page", "p", "pagina", "pageNumber", "page_number"])?.value || null
    );
  } catch {
    return null;
  }
}

function buildListingUrlForPage(baseUrl, pageNumber) {
  const url = new URL(baseUrl);
  url.searchParams.set("page", String(pageNumber));
  if (!url.searchParams.get("affinityOverride")) {
    url.searchParams.set("affinityOverride", "default");
  }
  return url.toString();
}

async function ensureOnExpectedListingPage(page, { baseUrl, targetUrl, expectedPage, timeoutMs }) {
  const preUrl = page.url();
  const prePage = getListingPageParam(preUrl);
  if (isListingUrl(preUrl, baseUrl) && prePage === expectedPage) {
    return {
      ok: true,
      navigated: false,
      expected_page: expectedPage,
      before_url: preUrl,
      after_url: preUrl,
      before_page: prePage,
      after_page: prePage,
      attempts: 0,
    };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    } catch (error) {
      lastError = String(error?.message || error);
      // ERR_ABORTED can happen if the site triggers a competing navigation; wait and validate anyway.
      // eslint-disable-next-line no-await-in-loop
      await delay(900);
    }

    const afterUrl = page.url();
    const afterPage = getListingPageParam(afterUrl);
    if (isListingUrl(afterUrl, baseUrl) && afterPage === expectedPage) {
      return {
        ok: true,
        navigated: true,
        expected_page: expectedPage,
        before_url: preUrl,
        after_url: afterUrl,
        before_page: prePage,
        after_page: afterPage,
        attempts: attempt,
      };
    }

    // eslint-disable-next-line no-await-in-loop
    await delay(600);
  }

  return {
    ok: false,
    navigated: true,
    expected_page: expectedPage,
    before_url: preUrl,
    after_url: page.url(),
    before_page: prePage,
    after_page: getListingPageParam(page.url()),
    attempts: 2,
    error: lastError || "failed_to_reach_expected_page",
  };
}

async function discoverNextListingHref(page, baseUrl) {
  const currentUrl = page.url();
  let base;
  let current;
  try {
    base = new URL(baseUrl);
    current = new URL(currentUrl);
  } catch {
    return null;
  }

  const domCandidates = await page.evaluate(() => {
    const toAbs = (href) => {
      try {
        return new URL(href, window.location.href).toString();
      } catch {
        return null;
      }
    };
    const out = [];
    const push = (href, reason) => {
      if (!href) return;
      const abs = toAbs(href);
      if (!abs) return;
      out.push({ href: abs, reason });
    };

    push(document.querySelector('link[rel="next"]')?.getAttribute("href"), "link_rel_next");
    for (const a of Array.from(document.querySelectorAll('a[rel="next"][href]'))) {
      push(a.getAttribute("href"), "a_rel_next");
    }
    for (const a of Array.from(document.querySelectorAll('a[href][aria-label]'))) {
      const label = a.getAttribute("aria-label") || "";
      if (/siguiente|next/i.test(label)) {
        push(a.getAttribute("href"), "aria_next");
      }
    }
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const text = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (/^(siguiente|next)$/i.test(text)) {
        push(a.getAttribute("href"), "text_next");
      }
    }
    // Pagination-like links (best-effort): href containing "page".
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const href = a.getAttribute("href") || "";
      if (!href || !href.includes("page")) continue;
      push(href, "href_contains_page");
    }

    return out;
  });

  const uniq = new Map();
  for (const c of domCandidates || []) {
    if (!c?.href) continue;
    if (!uniq.has(c.href)) uniq.set(c.href, c.reason || "");
  }

  const filtered = [];
  for (const [href, reason] of uniq.entries()) {
    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.origin !== base.origin) continue;
    if (!isListingUrl(parsed.toString(), baseUrl)) continue;
    if (href === currentUrl) continue;
    filtered.push({ href, reason, url: parsed });
  }

  if (filtered.length === 0) {
    return null;
  }

  // Prefer explicit rel=next first if it survives filtering.
  const relNext = filtered.find(
    (c) => c.reason === "link_rel_next" || c.reason === "a_rel_next",
  );
  if (relNext) {
    return relNext.href;
  }

  const keys = ["page", "p", "pagina", "pageNumber", "page_number"];
  const currentPage = readNumericQueryParam(current, keys)?.value || 1;

  const withPage = filtered
    .map((c) => ({ ...c, page: readNumericQueryParam(c.url, keys)?.value || null }))
    .filter((c) => c.page !== null);

  if (withPage.length > 0) {
    const exactNext = withPage.find((c) => c.page === currentPage + 1);
    if (exactNext) {
      return exactNext.href;
    }
    const higher = withPage.filter((c) => c.page > currentPage).sort((a, b) => a.page - b.page);
    if (higher.length > 0) {
      return higher[0].href;
    }
  }

  // Fallback: return the first filtered candidate.
  return filtered[0].href;
}

async function waitForIpLinksToStabilize(page, { timeoutMs, stableForMs, minCount }) {
  const start = Date.now();
  let lastCount = await page
    .evaluate(() => document.querySelectorAll('a[href*=\"/ip/\"]').length)
    .catch(() => 0);
  let stableSince = Date.now();

  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    await delay(300);
    // eslint-disable-next-line no-await-in-loop
    const count = await page
      .evaluate(() => document.querySelectorAll('a[href*=\"/ip/\"]').length)
      .catch(() => lastCount);
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
      continue;
    }
    if (count >= minCount && Date.now() - stableSince >= stableForMs) {
      return count;
    }
  }
  return lastCount;
}

async function navigateToNext(page, baseUrl) {
  const prevUrl = page.url();

  // If there is a "load more" UX, prefer it (no page navigation).
  const loadedMore = await tryClickLoadMore(page);
  if (loadedMore) {
    return { ok: true, method: "load_more", href: null };
  }

  // Prefer direct page param increment (observed on WalmartMX browse URLs).
  try {
    const keys = ["page", "p", "pagina", "pageNumber", "page_number"];
    const prevParsed = new URL(prevUrl);
    const prevPage = readNumericQueryParam(prevParsed, keys)?.value || 1;
    const nextUrl = new URL(prevUrl);
    nextUrl.searchParams.set("page", String(prevPage + 1));
    if (!nextUrl.searchParams.get("affinityOverride")) {
      nextUrl.searchParams.set("affinityOverride", "default");
    }

    try {
      await page.goto(nextUrl.toString(), { waitUntil: "domcontentloaded" });
    } catch (error) {
      const message = String(error?.message || error);
      // ERR_ABORTED often means a competing navigation happened; check current URL first.
      await delay(800);
      if (!isListingUrl(page.url(), baseUrl)) {
        return { ok: false, method: "page_param", href: nextUrl.toString(), reason: "goto_failed", error: message };
      }
    }
    if (!isListingUrl(page.url(), baseUrl)) {
      return { ok: false, method: "page_param", href: nextUrl.toString(), reason: "navigated_to_non_listing" };
    }

    let afterPage = null;
    try {
      const afterParsed = new URL(page.url());
      afterPage = readNumericQueryParam(afterParsed, keys)?.value || null;
    } catch {
      afterPage = null;
    }
    if (afterPage !== null && afterPage <= prevPage) {
      return { ok: false, method: "page_param", href: nextUrl.toString(), reason: "page_param_not_advanced" };
    }

    return { ok: true, method: "page_param", href: nextUrl.toString() };
  } catch {
    // Fall through to DOM discovery.
  }

  const nextHref = await discoverNextListingHref(page, baseUrl);
  if (!nextHref || nextHref === prevUrl) {
    return { ok: false, method: "none", href: null };
  }

  try {
    await page.goto(nextHref, { waitUntil: "domcontentloaded" });
  } catch (error) {
    const message = String(error?.message || error);
    await delay(800);
    if (!isListingUrl(page.url(), baseUrl)) {
      return { ok: false, method: "goto", href: nextHref, reason: "goto_failed", error: message };
    }
  }
  if (!isListingUrl(page.url(), baseUrl)) {
    return { ok: false, method: "goto", href: nextHref, reason: "navigated_to_non_listing" };
  }

  return { ok: true, method: "goto", href: nextHref };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.proxy && !args.allowDirectIp) {
    console.error(
      "Safety policy: PROXY_URL is required for WalmartMX crawl by default (to avoid exposing your IP). Use --allow-direct-ip if you accept the risk.",
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

  const allProducts = [];
  const seenKeys = new Set();
  const pages = [];
  let emptyListingPagesInRow = 0;
  let noNewPagesInRow = 0;

  const runSummary = {
    site: "walmartmx",
    mode: "crawl",
    captured_at: capturedAt,
    base_url: sanitizeUrlForLog(args.baseUrl),
    final_url: null,
    manual_verification: null,
    pagination: {
      max_pages: args.maxPages,
      pages_crawled: 0,
      page_strategy: "direct_page_param_range",
      start_page: null,
      end_page: null,
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
      manual_confirm_enabled: Boolean(args.manualConfirm),
      persistent_profile: Boolean(args.useCdpChrome && args.chromeUserDataDir),
      chrome_user_data_dir: args.useCdpChrome && args.chromeUserDataDir ? path.resolve(args.chromeUserDataDir) : null,
    },
    products_extracted: 0,
    filters: {
      ac_only: {
        enabled: Boolean(args.acOnlyFilter),
        kept: 0,
        filtered_out: 0,
        sample_filtered_out: [],
      },
    },
    pages,
    output: {
      latest_products_json: path.join(outputRoot, "latest_products.json"),
      latest_run_json: path.join(runsDir, "latest_run.json"),
      latest_price_facts_csv: path.join(outputRoot, "latest_price_facts.csv"),
      latest_price_preview_html: path.join(outputRoot, "latest_price_preview.html"),
      latest_blocked_png: args.screenshotOnFail ? path.join(outputRoot, "latest_blocked.png") : null,
    },
    notes:
      "WalmartMX crawl is manual-verification capable. It does not attempt to bypass anti-bot challenges automatically.",
  };

  try {
    if (args.useCdpChrome) {
      const chrome = await launchChromeForCrawl(args);
      chromeProcess = chrome.child;
      if (!args.chromeUserDataDir) {
        tempChromeProfileDir = chrome.userDataDir;
        console.log(`Using temporary Chrome profile: ${chrome.userDataDir}`);
      } else {
        console.log(`Using persistent Chrome profile: ${path.resolve(args.chromeUserDataDir)}`);
      }

      browser = await chromium.connectOverCDP(chrome.endpoint);
      context = browser.contexts()[0] || (await browser.newContext());
      page = await waitForWalmartPage(context, args.baseUrl, args.attachWalmartPageTimeoutMs);
      page.setDefaultTimeout(args.timeoutMs);

      console.log("Manual verification mode: interact with the Chrome window if prompted.");
      console.log(`Category URL: ${args.baseUrl}`);
      console.log(`Attached page URL: ${page.url()}`);
    } else {
      const launchOptions = { headless: false };
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

      console.log("Opening Walmart Mexico category page (manual verification mode)...");
      await page.goto(args.baseUrl, { waitUntil: "domcontentloaded" });
    }

    const blockedBefore = await isBlocked(page).catch(() => null);
    const manual = args.manualConfirm
      ? await waitForManualConfirmThenPass(page, args.maxWaitForManualMs)
      : await waitForManualPass(page, args.maxWaitForManualMs);
    const blockedAfter = await isBlocked(page);

    runSummary.manual_verification = {
      blocked_before: Boolean(blockedBefore),
      passed: manual.passed,
      waited_ms: manual.waited_ms,
      mode: manual.mode || (args.manualConfirm ? "manual_confirm" : "auto_poll"),
      reason: manual.reason || null,
      user_aborted: Boolean(manual.user_aborted),
    };

    if (!manual.passed || blockedAfter) {
      const finalUrl = page.url();
      const title = await page.title().catch(() => "");
      runSummary.final_url = sanitizeUrlForLog(finalUrl);
      runSummary.failure = {
        reason: manual.user_aborted ? "verification_aborted_by_user" : "verification_not_passed",
        title: normalizeWhitespace(title),
        verification_reason: manual.reason || null,
      };

      if (args.screenshotOnFail) {
        try {
          await page.screenshot({
            path: path.join(outputRoot, "latest_blocked.png"),
            fullPage: true,
          });
        } catch {
          // ignore
        }
      }

      await writeLatestOutputs({ outputRoot, runsDir, runSummary, products: [] });
      process.exitCode = 3;
      return;
    }

    // Crawl pages until hitting limits. We navigate deterministically to page=1..N to avoid
    // repeated pages when `page.goto()` is aborted or the site redirects unexpectedly.
    const baseStartPage = getListingPageParam(args.baseUrl) || 1;
    runSummary.pagination.start_page = baseStartPage;

    for (let pageIndex = 1; pageIndex <= args.maxPages; pageIndex += 1) {
      const expectedPage = baseStartPage + (pageIndex - 1);
      const targetUrl = buildListingUrlForPage(args.baseUrl, expectedPage);

      const nav = await ensureOnExpectedListingPage(page, {
        baseUrl: args.baseUrl,
        targetUrl,
        expectedPage,
        timeoutMs: args.timeoutMs,
      });
      if (!nav.ok) {
        runSummary.failure = { reason: "failed_to_reach_expected_page", error: nav.error };
        runSummary.pagination.stop_reason = "failed_to_reach_expected_page";
        process.exitCode = 6;
        break;
      }

      if (await isBlocked(page)) {
        const manualAgain = args.manualConfirm
          ? await waitForManualConfirmThenPass(page, args.maxWaitForManualMs)
          : await waitForManualPass(page, args.maxWaitForManualMs);
        if (!manualAgain.passed || (await isBlocked(page))) {
          runSummary.failure = {
            reason: manualAgain.user_aborted ? "blocked_mid_run_user_aborted" : "blocked_mid_run",
            verification_reason: manualAgain.reason || null,
          };
          process.exitCode = 4;
          break;
        }
      }

      if (!isListingUrl(page.url(), args.baseUrl)) {
        runSummary.failure = {
          reason: "navigated_to_non_listing",
          url: sanitizeUrlForLog(page.url()),
        };
        runSummary.pagination.stop_reason = "navigated_to_non_listing";
        process.exitCode = 7;
        break;
      }

      try {
        await page.waitForFunction(
          () => document.querySelectorAll('a[href*=\"/ip/\"]').length > 0,
          null,
          { timeout: args.timeoutMs },
        );
      } catch {
        // continue best-effort
      }

      try {
        // Wait for the listing grid to finish client-side hydration (best-effort).
        await waitForIpLinksToStabilize(page, {
          timeoutMs: Math.min(args.timeoutMs, 20000),
          stableForMs: 1200,
          minCount: 15,
        });
      } catch {
        // ignore stabilization errors
      }

      // Small jitter to let any client-side rendering settle.
      await delay(randomIntInclusive(800, 1500));

      let productsOnPage = [];
      let extractionError = null;
      try {
        productsOnPage = await extractProductsFromDom(page, args.maxProducts, capturedAt);
      } catch (error) {
        extractionError = String(error?.message || error);
        runSummary.failure = { reason: "exception_during_extract", error: extractionError };
        runSummary.pagination.stop_reason = "exception_during_extract";
        process.exitCode = 8;
      }

      if (extractionError) {
        pages.push({
          index: pageIndex,
          expected_page_param: expectedPage,
          url: sanitizeUrlForLog(page.url()),
          target_url: sanitizeUrlForLog(targetUrl),
          page_param: getListingPageParam(page.url()),
          nav_attempts: nav.attempts,
          products_found: 0,
          products_new: 0,
          products_filtered_out: 0,
          total_unique_products: allProducts.length,
          error: extractionError,
        });
        break;
      }

      if (productsOnPage.length === 0) {
        emptyListingPagesInRow += 1;
      } else {
        emptyListingPagesInRow = 0;
      }
      let newOnPage = 0;
      let filteredOutOnPage = 0;
      for (const p of productsOnPage) {
        const key = p.product_id || p.product_url;
        if (!key) {
          continue;
        }
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);

        if (args.acOnlyFilter && !isAcRelatedWalmartProduct(p)) {
          filteredOutOnPage += 1;
          runSummary.filters.ac_only.filtered_out += 1;
          if (runSummary.filters.ac_only.sample_filtered_out.length < 30) {
            runSummary.filters.ac_only.sample_filtered_out.push({
              product_id: p.product_id || null,
              name: p.name || null,
              product_url: p.product_url || null,
              sale_price_raw: p.sale_price_raw || null,
            });
          }
          continue;
        }

        allProducts.push(p);
        newOnPage += 1;
        runSummary.filters.ac_only.kept += 1;
        if (allProducts.length >= args.maxProducts) {
          break;
        }
      }

      if (productsOnPage.length > 0 && newOnPage === 0) {
        noNewPagesInRow += 1;
      } else {
        noNewPagesInRow = 0;
      }

      const pageParam = getListingPageParam(page.url());

      pages.push({
        index: pageIndex,
        expected_page_param: expectedPage,
        url: sanitizeUrlForLog(page.url()),
        target_url: sanitizeUrlForLog(targetUrl),
        page_param: pageParam,
        nav_attempts: nav.attempts,
        products_found: productsOnPage.length,
        products_new: newOnPage,
        products_filtered_out: filteredOutOnPage,
        total_unique_products: allProducts.length,
      });

      runSummary.pagination.pages_crawled = pageIndex;
      runSummary.pagination.end_page = expectedPage;
      runSummary.products_extracted = allProducts.length;
      runSummary.final_url = sanitizeUrlForLog(page.url());

      await writeLatestOutputs({ outputRoot, runsDir, runSummary, products: allProducts });

      // Safety-first stop: consecutive empty listing pages usually indicate end-of-results or a blocked/hydration issue.
      if (emptyListingPagesInRow >= 2) {
        runSummary.pagination.stop_reason = "empty_listing_pages";
        break;
      }

      // Only apply this stop condition when running unfiltered deep crawls.
      if (!args.acOnlyFilter && args.maxPages > 50 && noNewPagesInRow >= 3) {
        runSummary.pagination.stop_reason = "no_new_products";
        break;
      }

      if (allProducts.length >= args.maxProducts) {
        runSummary.pagination.stop_reason = "max_products_reached";
        break;
      }

      if (pageIndex >= args.maxPages) {
        runSummary.pagination.stop_reason = "max_pages_reached";
        break;
      }

      // Between-page pacing (safety-first).
      const shortDelay = randomIntInclusive(args.minPageDelayMs, args.maxPageDelayMs);
      await delay(shortDelay);
      if (args.longBreakEvery > 0 && pageIndex % args.longBreakEvery === 0) {
        const longDelay = randomIntInclusive(args.longBreakMinMs, args.longBreakMaxMs);
        await delay(longDelay);
      }
    }

    // Persist to DB at the end (upsert).
    if (args.saveToDb && allProducts.length > 0) {
      const dbResult = await persistRunToSqliteV2({
        dbPath: args.dbPath,
        runSummary,
        rows: allProducts,
      });
      runSummary.database = dbResult;
    }

    await writeLatestOutputs({ outputRoot, runsDir, runSummary, products: allProducts });
    console.log("WalmartMX crawl finished.");
    console.log(`Pages crawled: ${runSummary.pagination.pages_crawled}`);
    console.log(`Unique products extracted: ${allProducts.length}`);
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
  console.error("WalmartMX crawl failed.");
  console.error(error);
  process.exitCode = 1;
});
