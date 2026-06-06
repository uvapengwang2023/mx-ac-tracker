#!/usr/bin/env node

import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "data/ac_price_monitor_mexico_v2.db";
const DEFAULT_RECORD_PATH = "PROJECT_RECORD.md";
const MEXICO_CITY_TZ = "America/Mexico_City";

const SITE_RUN_FILES = [
  { website: "Coppel", runFile: "data/coppel/runs/latest_run.json" },
  { website: "Elektra", runFile: "data/elektra/runs/latest_run.json" },
  { website: "HomeDepotMX", runFile: "data/homedepotmx/runs/latest_run.json" },
  { website: "WalmartMX", runFile: "data/walmartmx/runs/latest_run.json" },
];

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeMdCell(value) {
  return normalizeWhitespace(value).replace(/\|/g, "/");
}

function formatDateInTimeZone(isoOrDate, timeZone) {
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

function formatLocalRecordedAt(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const pad2 = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());

  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const tzH = pad2(Math.floor(abs / 60));
  const tzM = pad2(abs % 60);

  // Keep existing style in record file: YYYY-MM-DD HH:mm:ss -03
  const tz = tzM === "00" ? `${sign}${tzH}` : `${sign}${tzH}:${tzM}`;
  return `${y}-${m}-${day} ${h}:${min}:${s} ${tz}`;
}

function parseArgs(argv) {
  const args = {
    dbPath: process.env.DB_PATH || DEFAULT_DB_PATH,
    recordPath: DEFAULT_RECORD_PATH,
    dateMx: "",
    note: "Automated append.",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--db-path" && next) {
      args.dbPath = next;
      i += 1;
    } else if (token === "--record-path" && next) {
      args.recordPath = next;
      i += 1;
    } else if (token === "--date" && next) {
      args.dateMx = next;
      i += 1;
    } else if (token === "--note" && next) {
      args.note = next;
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    }
  }

  if (!args.dateMx) {
    const todayMx = formatDateInTimeZone(new Date(), MEXICO_CITY_TZ);
    if (!todayMx) {
      throw new Error("Failed to derive Mexico City date");
    }
    args.dateMx = todayMx;
  }

  return args;
}

function initCountMap() {
  return {
    Coppel: 0,
    Elektra: 0,
    HomeDepotMX: 0,
    WalmartMX: 0,
  };
}

function readLatestCapturedAt(runFile) {
  if (!existsSync(runFile)) {
    return "missing";
  }
  try {
    const raw = JSON.parse(readFileSync(runFile, "utf8"));
    return raw?.captured_at || raw?.finished_at || raw?.started_at || "n/a";
  } catch {
    return "invalid_json";
  }
}

function buildTableRow({ dateMx, recordedAt, counts, total, dbPath, note }) {
  return [
    "|",
    escapeMdCell(dateMx),
    "|",
    escapeMdCell(recordedAt),
    "|",
    String(counts.Coppel ?? 0),
    "|",
    String(counts.Elektra ?? 0),
    "|",
    String(counts.HomeDepotMX ?? 0),
    "|",
    String(counts.WalmartMX ?? 0),
    "|",
    String(total ?? 0),
    "|",
    escapeMdCell(dbPath),
    "|",
    escapeMdCell(note || ""),
    "|",
  ].join(" ");
}

function buildRunSummarySection(capturedAtRows) {
  const lines = capturedAtRows.map(
    ({ runFile, capturedAt }) => `- ${runFile} -> ${capturedAt}`,
  );
  return [
    "## Run Summaries (latest captured_at)",
    "",
    ...lines,
    "",
  ].join("\n");
}

function buildInitialRecord({ row, runSummarySection }) {
  return [
    "# Project Record",
    "",
    "## Daily Crawl + DB Load Log",
    "",
    "| Date (Mexico City) | Recorded At | Coppel | Elektra | HomeDepotMX | WalmartMX | Total price_facts | DB Path | Notes |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    row,
    "",
    runSummarySection,
  ].join("\n");
}

function upsertRecordContent(existing, row, runSummarySection) {
  const runHeadingRegex = /^## Run Summaries.*$/m;
  const match = existing.match(runHeadingRegex);
  let beforeRunSection = existing;

  if (match?.index !== undefined) {
    beforeRunSection = existing.slice(0, match.index);
  }

  if (!beforeRunSection.includes("## Daily Crawl + DB Load Log")) {
    return buildInitialRecord({ row, runSummarySection });
  }

  if (!beforeRunSection.includes("| Date (Mexico City) |")) {
    beforeRunSection = `${beforeRunSection.trimEnd()}\n\n| Date (Mexico City) | Recorded At | Coppel | Elektra | HomeDepotMX | WalmartMX | Total price_facts | DB Path | Notes |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |\n`;
  }

  const nextTable = `${beforeRunSection.trimEnd()}\n${row}\n`;
  return `${nextTable}\n${runSummarySection}`.trimEnd() + "\n";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPathResolved = path.resolve(args.dbPath);
  const recordPathResolved = path.resolve(args.recordPath);

  const db = new DatabaseSync(args.dbPath);
  try {
    const counts = initCountMap();
    const rows = db
      .prepare("SELECT website, COUNT(*) AS cnt FROM price_facts WHERE date = ? GROUP BY website")
      .all(args.dateMx);
    const totalRow = db
      .prepare("SELECT COUNT(*) AS n FROM price_facts WHERE date = ?")
      .get(args.dateMx);

    for (const row of rows || []) {
      if (Object.prototype.hasOwnProperty.call(counts, row.website)) {
        counts[row.website] = Number(row.cnt) || 0;
      }
    }

    const total = Number(totalRow?.n) || 0;
    const recordedAt = formatLocalRecordedAt(new Date());
    const rowLine = buildTableRow({
      dateMx: args.dateMx,
      recordedAt,
      counts,
      total,
      dbPath: path.relative(process.cwd(), dbPathResolved) || args.dbPath,
      note: args.note,
    });

    const runSummaryRows = SITE_RUN_FILES.map(({ runFile }) => ({
      runFile,
      capturedAt: readLatestCapturedAt(runFile),
    }));
    const runSummarySection = buildRunSummarySection(runSummaryRows);

    let nextContent = "";
    if (!existsSync(recordPathResolved)) {
      nextContent = buildInitialRecord({ row: rowLine, runSummarySection });
    } else {
      const current = await fs.readFile(recordPathResolved, "utf8");
      nextContent = upsertRecordContent(current, rowLine, runSummarySection);
    }

    if (args.dryRun) {
      console.log("Dry run mode. The following row would be appended:");
      console.log(rowLine);
      return;
    }

    await fs.writeFile(recordPathResolved, nextContent, "utf8");
    console.log(`Project record updated: ${recordPathResolved}`);
    console.log(`Appended row for ${args.dateMx}`);
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
