import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { request as playwrightRequest } from "playwright";

const ROOT = process.cwd();
const DAILY_DIR = path.join(ROOT, "data", "daily_crawls");
const LOG_DIR = path.join(DAILY_DIR, "logs");
const LATEST_RUN_FILE = path.join(DAILY_DIR, "latest_run.json");

const SITE_COMMANDS = {
  coppel: {
    label: "Coppel",
    npmArgs: ["run", "crawl:coppel", "--", "--skip-details"],
    checkUrl: "https://www.coppel.com/",
    unattended: true,
  },
  elektra: {
    label: "Elektra",
    npmArgs: ["run", "crawl:elektra"],
    checkUrl: "https://www.elektra.mx/",
    unattended: true,
  },
  homedepotmx: {
    label: "HomeDepotMX",
    npmArgs: ["run", "crawl:homedepotmx"],
    checkUrl: "https://www.homedepot.com.mx/",
    unattended: true,
    allowDirectIpFlag: "--allow-direct-ip",
  },
  walmartmx: {
    label: "WalmartMX",
    npmArgs: ["run", "crawl:walmartmx", "--", "--manual-confirm"],
    checkUrl: "https://www.walmart.com.mx/",
    unattended: false,
  },
};

const DEFAULT_SITES = ["coppel", "elektra", "homedepotmx"];

function timestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    skipPreflight: false,
    strictPreflight: false,
    buildSkuFields: true,
    buildDashboard: true,
    buildAlerts: true,
    interactive: false,
    notify: false,
    sites: null,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--skip-preflight") args.skipPreflight = true;
    else if (arg === "--strict-preflight") args.strictPreflight = true;
    else if (arg === "--no-sku-normalize") args.buildSkuFields = false;
    else if (arg === "--no-dashboard-build") args.buildDashboard = false;
    else if (arg === "--no-alerts-build") args.buildAlerts = false;
    else if (arg === "--interactive") args.interactive = true;
    else if (arg === "--notify") args.notify = true;
    else if (arg.startsWith("--sites=")) {
      args.sites = arg
        .slice("--sites=".length)
        .split(",")
        .map((site) => site.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  return args;
}

async function loadEnvFile() {
  const envPath = path.join(ROOT, ".env.crawler");
  const values = {};
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      value = value.replace(/^['"]|['"]$/g, "");
      if (key) values[key] = value;
    }
  } catch {
    return values;
  }
  return values;
}

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function buildSiteNpmArgs(config, env) {
  const npmArgs = [...config.npmArgs];
  if (config.allowDirectIpFlag && boolFromEnv(env.DAILY_CRAWL_ALLOW_DIRECT_IP, false)) {
    if (!npmArgs.includes("--")) {
      npmArgs.push("--");
    }
    npmArgs.push(config.allowDirectIpFlag);
  }
  return npmArgs;
}

function pickSites(args, env) {
  const envSites = env.DAILY_CRAWL_SITES
    ? env.DAILY_CRAWL_SITES.split(",").map((site) => site.trim().toLowerCase()).filter(Boolean)
    : null;
  const selected = args.sites || envSites || DEFAULT_SITES;
  return selected.filter((site) => SITE_COMMANDS[site]);
}

async function appendLog(logPath, message) {
  const line = message.endsWith("\n") ? message : `${message}\n`;
  process.stdout.write(line);
  await fs.appendFile(logPath, line, "utf8");
}

async function notify(title, message) {
  const escapedTitle = title.replaceAll('"', '\\"');
  const escapedMessage = message.replaceAll('"', '\\"');
  return new Promise((resolve) => {
    const child = spawn("osascript", [
      "-e",
      `display notification "${escapedMessage}" with title "${escapedTitle}"`,
    ]);
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

function buildPlaywrightProxy(proxyUrl) {
  if (!proxyUrl) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    return null;
  }
  return {
    server: `${parsed.protocol}//${parsed.host}`,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

async function checkUrl(url, timeoutMs, proxyUrl) {
  const proxy = buildPlaywrightProxy(proxyUrl);
  if (proxy) {
    let context;
    try {
      context = await playwrightRequest.newContext({
        proxy,
        timeout: timeoutMs,
        extraHTTPHeaders: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) MX-AC-Tracker/1.0",
        },
      });
      const response = await context.get(url, { timeout: timeoutMs, maxRedirects: 5 });
      return {
        url,
        ok: response.status() >= 200 && response.status() < 500,
        status: response.status(),
        proxy: true,
        error: null,
      };
    } catch (error) {
      return {
        url,
        ok: false,
        status: null,
        proxy: true,
        error: error.message,
      };
    } finally {
      await context?.dispose().catch(() => {});
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) MX-AC-Tracker/1.0",
      },
    });
    return {
      url,
      ok: response.status >= 200 && response.status < 500,
      status: response.status,
      proxy: false,
      error: null,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      proxy: false,
      error: error.name === "AbortError" ? "timeout" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runPreflight({ args, env, sites, logPath }) {
  if (args.skipPreflight) {
    return { skipped: true, checks: [], ok: true };
  }

  const timeoutMs = Number(env.VPN_CHECK_TIMEOUT_MS || 15000);
  const explicitCheckUrl = env.VPN_CHECK_URL;
  const urls = explicitCheckUrl
    ? [explicitCheckUrl]
    : [...new Set(sites.map((site) => SITE_COMMANDS[site].checkUrl).filter(Boolean))];

  await appendLog(logPath, `Preflight: checking ${urls.length} network target(s)...`);
  const checks = [];
  for (const url of urls) {
    const result = await checkUrl(url, timeoutMs, env.PROXY_URL || "");
    checks.push(result);
    const status = result.ok ? `OK ${result.status}` : `FAILED ${result.error || result.status || "unknown"}`;
    await appendLog(logPath, `  ${url} -> ${status}${result.proxy ? " via proxy" : ""}`);
  }

  const requireAll = args.strictPreflight || boolFromEnv(env.DAILY_CRAWL_STRICT_PREFLIGHT, false) || !!explicitCheckUrl;
  const ok = requireAll ? checks.every((check) => check.ok) : checks.some((check) => check.ok);
  return { skipped: false, checks, ok, requireAll };
}

function runCommand({ label, npmArgs, logPath, env, dryRun, interactive }) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    if (dryRun) {
      resolve({
        label,
        command: `npm ${npmArgs.join(" ")}`,
        status: "dry_run",
        exitCode: 0,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    const child = spawn("npm", npmArgs, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: interactive ? ["inherit", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      fs.appendFile(logPath, text, "utf8").catch(() => {});
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      fs.appendFile(logPath, text, "utf8").catch(() => {});
    });
    child.on("close", (code) => {
      resolve({
        label,
        command: `npm ${npmArgs.join(" ")}`,
        status: code === 0 ? "success" : "failed",
        exitCode: code,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });
    child.on("error", (error) => {
      resolve({
        label,
        command: `npm ${npmArgs.join(" ")}`,
        status: "failed",
        exitCode: null,
        error: error.message,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });
  });
}

async function main() {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const args = parseArgs(process.argv.slice(2));
  const envFile = await loadEnvFile();
  const env = { ...process.env, ...envFile };
  args.notify = args.notify || boolFromEnv(env.DAILY_CRAWL_NOTIFY, false);
  const sites = pickSites(args, env);
  const startedAt = new Date();
  const logPath = path.join(LOG_DIR, `daily_crawl_${timestampForFile(startedAt)}.log`);

  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    dryRun: args.dryRun,
    selectedSites: sites,
    logPath,
    preflight: null,
    results: [],
    skuNormalization: null,
    alertsBuild: null,
    dashboardBuild: null,
    overallStatus: "running",
  };

  await appendLog(logPath, `Daily crawl started: ${summary.startedAt}`);
  await appendLog(logPath, `Selected sites: ${sites.join(", ") || "(none)"}`);

  if (!sites.length) {
    summary.overallStatus = "failed";
    summary.finishedAt = new Date().toISOString();
    await appendLog(logPath, "No valid sites selected.");
    await fs.writeFile(LATEST_RUN_FILE, JSON.stringify(summary, null, 2), "utf8");
    process.exitCode = 1;
    return;
  }

  summary.preflight = await runPreflight({ args, env, sites, logPath });
  if (!summary.preflight.ok) {
    summary.overallStatus = "blocked_preflight";
    summary.finishedAt = new Date().toISOString();
    await appendLog(logPath, "Preflight failed. Check VPN/proxy/network, then rerun.");
    await fs.writeFile(LATEST_RUN_FILE, JSON.stringify(summary, null, 2), "utf8");
    if (args.notify) await notify("MX AC crawler blocked", "VPN/proxy/network check failed.");
    process.exitCode = 2;
    return;
  }

  for (const site of sites) {
    const config = SITE_COMMANDS[site];
    const npmArgs = buildSiteNpmArgs(config, env);
    if (!config.unattended && !args.interactive) {
      const skipped = {
        label: config.label,
        command: `npm ${npmArgs.join(" ")}`,
        status: "skipped",
        reason: "manual verification required; run with --interactive outside launchd",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      summary.results.push(skipped);
      await appendLog(logPath, `${config.label}: skipped (${skipped.reason})`);
      continue;
    }

    await appendLog(logPath, `\nRunning ${config.label}...`);
    const result = await runCommand({
      label: config.label,
      npmArgs,
      logPath,
      env,
      dryRun: args.dryRun,
      interactive: args.interactive,
    });
    summary.results.push(result);
    await appendLog(logPath, `${config.label}: ${result.status}`);
    if (result.status === "failed") {
      break;
    }
  }

  const anyFailed = summary.results.some((result) => result.status === "failed");
  if (!anyFailed && args.buildSkuFields) {
    await appendLog(logPath, "\nNormalizing SKU fields...");
    summary.skuNormalization = await runCommand({
      label: "SKU normalization",
      npmArgs: ["run", "sku:normalize"],
      logPath,
      env,
      dryRun: args.dryRun,
      interactive: false,
    });
    await appendLog(logPath, `SKU normalization: ${summary.skuNormalization.status}`);
  }

  if (!anyFailed && summary.skuNormalization?.status !== "failed" && args.buildAlerts) {
    await appendLog(logPath, "\nBuilding daily alerts...");
    summary.alertsBuild = await runCommand({
      label: "Daily alerts",
      npmArgs: ["run", "alerts:build"],
      logPath,
      env,
      dryRun: args.dryRun,
      interactive: false,
    });
    await appendLog(logPath, `Daily alerts: ${summary.alertsBuild.status}`);
  }

  if (
    !anyFailed &&
    summary.skuNormalization?.status !== "failed" &&
    summary.alertsBuild?.status !== "failed" &&
    args.buildDashboard
  ) {
    await appendLog(logPath, "\nBuilding dashboard data...");
    summary.dashboardBuild = await runCommand({
      label: "Dashboard data",
      npmArgs: ["run", "dashboard:build"],
      logPath,
      env,
      dryRun: args.dryRun,
      interactive: false,
    });
    await appendLog(logPath, `Dashboard data: ${summary.dashboardBuild.status}`);
  }

  summary.finishedAt = new Date().toISOString();
  summary.overallStatus =
    anyFailed ||
    summary.skuNormalization?.status === "failed" ||
    summary.alertsBuild?.status === "failed" ||
    summary.dashboardBuild?.status === "failed"
      ? "failed"
      : "success";
  await appendLog(logPath, `\nDaily crawl finished: ${summary.overallStatus}`);
  await fs.writeFile(LATEST_RUN_FILE, JSON.stringify(summary, null, 2), "utf8");

  if (args.notify) {
    await notify(
      summary.overallStatus === "success" ? "MX AC crawler complete" : "MX AC crawler failed",
      `${summary.results.filter((result) => result.status === "success").length}/${summary.results.length} site tasks succeeded.`,
    );
  }

  process.exitCode = summary.overallStatus === "success" ? 0 : 1;
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
