import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const LABEL = "com.mx-ac-tracker.daily-crawl";
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const DEFAULT_SITES = "coppel,elektra,homedepotmx";

function parseArgs(argv) {
  const args = {
    hour: 9,
    minute: 0,
    sites: DEFAULT_SITES,
    uninstall: false,
    printOnly: false,
  };

  for (const arg of argv) {
    if (arg === "--uninstall") args.uninstall = true;
    else if (arg === "--print-only") args.printOnly = true;
    else if (arg.startsWith("--hour=")) args.hour = Number(arg.slice("--hour=".length));
    else if (arg.startsWith("--minute=")) args.minute = Number(arg.slice("--minute=".length));
    else if (arg.startsWith("--sites=")) args.sites = arg.slice("--sites=".length);
  }
  return args;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildPlist(args) {
  const command = `cd ${JSON.stringify(ROOT)} && npm run daily:crawl -- --sites=${args.sites}`;
  const outLog = path.join(ROOT, "data", "daily_crawls", "launchd.out.log");
  const errLog = path.join(ROOT, "data", "daily_crawls", "launchd.err.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(ROOT)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${args.hour}</integer>
    <key>Minute</key>
    <integer>${args.minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(outLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(errLog)}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

async function unload() {
  spawnSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.uninstall) {
    await unload();
    await fs.rm(PLIST_PATH, { force: true });
    console.log(`Uninstalled ${LABEL}`);
    return;
  }

  const plist = buildPlist(args);
  if (args.printOnly) {
    console.log(plist);
    return;
  }

  await fs.mkdir(path.dirname(PLIST_PATH), { recursive: true });
  await fs.mkdir(path.join(ROOT, "data", "daily_crawls"), { recursive: true });
  await fs.writeFile(PLIST_PATH, plist, "utf8");
  await unload();
  const loaded = spawnSync("launchctl", ["load", PLIST_PATH], { encoding: "utf8" });
  if (loaded.status !== 0) {
    console.error(loaded.stderr || loaded.stdout || "launchctl load failed");
    process.exitCode = loaded.status || 1;
    return;
  }
  console.log(`Installed ${LABEL}`);
  console.log(`Schedule: daily ${String(args.hour).padStart(2, "0")}:${String(args.minute).padStart(2, "0")}`);
  console.log(`Sites: ${args.sites}`);
  console.log(`Plist: ${PLIST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
