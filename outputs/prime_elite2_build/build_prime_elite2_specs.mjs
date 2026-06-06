import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const root = "/Users/luke2026/Project_OA/墨西哥电商数据-空调";
const outputDir = path.join(root, "outputs", "prime_elite2_specs");
const buildDir = path.join(root, "outputs", "prime_elite2_build");

const primaryImageUrl = "https://prime.com.mx/wp-content/uploads/2023/10/ELITE-2-1.jpg";
const officialOnOffUrl = "https://prime.com.mx/on-off/";
const officialPdfUrl = "https://prime.com.mx/images/pdf/Elite2.pdf";
const extendedPdfUrl = "https://www.airesprime.com/booklets/elite-2.pdf";

const modelRows = [
  {
    brand: "Prime",
    series: "Elite 2",
    category: "Minisplit high-wall",
    technology: "On/Off",
    capacityLabel: "1 Ton / 12000 BTU/h / 115V",
    ton: 1,
    btuH: 12000,
    voltageV: 115,
    energySavingPct: 5,
    eerImageLabel: "EEER",
    eer: 3.57,
    seerImageLabel: "SEEER",
    seer: 12.2,
    powerW: 1040,
    refrigerant: "R410A",
    evaporatorMm: "790 x 250 x 200",
    condenserMm: "770 x 510 x 300",
    evaporatorKg: 8,
    condenserKg: 27,
    coolOnlyModel: "EMPRC121-E2",
    heatCoolModel: "EMPRN121-E2",
  },
  {
    brand: "Prime",
    series: "Elite 2",
    category: "Minisplit high-wall",
    technology: "On/Off",
    capacityLabel: "1 Ton / 12000 BTU/h / 220V",
    ton: 1,
    btuH: 12000,
    voltageV: 220,
    energySavingPct: 4,
    eerImageLabel: "EEER",
    eer: 3.52,
    seerImageLabel: "SEEER",
    seer: 12.0,
    powerW: 1100,
    refrigerant: "R410A",
    evaporatorMm: "790 x 250 x 200",
    condenserMm: "770 x 510 x 300",
    evaporatorKg: 8,
    condenserKg: 27,
    coolOnlyModel: "EMPRC122-E2",
    heatCoolModel: "EMPRN122-E2",
  },
  {
    brand: "Prime",
    series: "Elite 2",
    category: "Minisplit high-wall",
    technology: "On/Off",
    capacityLabel: "1.5 Ton / 18000 BTU/h / 220V",
    ton: 1.5,
    btuH: 18000,
    voltageV: 220,
    energySavingPct: 4,
    eerImageLabel: "EEER",
    eer: 3.52,
    seerImageLabel: "SEEER",
    seer: 12.0,
    powerW: 1650,
    refrigerant: "R410A",
    evaporatorMm: "900 x 290 x 215",
    condenserMm: "810 x 574 x 330",
    evaporatorKg: 10,
    condenserKg: 35,
    coolOnlyModel: "EMPRC182-E2",
    heatCoolModel: "EMPRN182-E2",
  },
  {
    brand: "Prime",
    series: "Elite 2",
    category: "Minisplit high-wall",
    technology: "On/Off",
    capacityLabel: "2 Ton / 24000 BTU/h / 220V",
    ton: 2,
    btuH: 24000,
    voltageV: 220,
    energySavingPct: 6,
    eerImageLabel: "EEER",
    eer: 3.52,
    seerImageLabel: "SEEER",
    seer: 12.0,
    powerW: 2120,
    refrigerant: "R410A",
    evaporatorMm: "990 x 310 x 220",
    condenserMm: "860 x 620 x 360",
    evaporatorKg: 13,
    condenserKg: 45,
    coolOnlyModel: "EMPRC242-E2",
    heatCoolModel: "EMPRN242-E2",
  },
  {
    brand: "Prime",
    series: "Elite 2",
    category: "Minisplit high-wall",
    technology: "On/Off",
    capacityLabel: "3 Ton / 36000 BTU/h / 220V",
    ton: 3,
    btuH: 36000,
    voltageV: 220,
    energySavingPct: 7,
    eerImageLabel: "EEER",
    eer: 3.55,
    seerImageLabel: "SEEER",
    seer: 12.0,
    powerW: 3200,
    refrigerant: "R410A",
    evaporatorMm: "1180 x 345 x 260",
    condenserMm: "895 x 720 x 390",
    evaporatorKg: 16,
    condenserKg: 56,
    coolOnlyModel: "EMPRC362-E2",
    heatCoolModel: "EMPRN362-E2",
  },
];

const imageTableRows = [
  ["参数", "1 Ton 12000 BTU/h 115V", "1 Ton 12000 BTU/h 220V", "1.5 Ton 18000 BTU/h", "2 Ton 24000 BTU/h", "3 Ton 36000 BTU/h"],
  ["Ahorro Energía*", "5%", "4%", "4%", "6%", "7%"],
  ["EEER", "3,57", "3,52", "3,52", "3,52", "3,55"],
  ["SEEER", "12,2", "12,0", "12,0", "12,0", "12,0"],
  ["Potencia (W)", "1040", "1100", "1650", "2120", "3200"],
  ["Voltaje (V~)", "115V", "220V", "220V", "220V", "220V"],
  ["Refrigerante", "R410A", "R410A", "R410A", "R410A", "R410A"],
  ["Medidas Evaporadora (mm)", "790 x 250 x 200", "790 x 250 x 200", "900 x 290 x 215", "990 x 310 x 220", "1180 x 345 x 260"],
  ["Medidas Condensadora (mm)", "770 x 510 x 300", "770 x 510 x 300", "810 x 574 x 330", "860 x 620 x 360", "895 x 720 x 390"],
  ["Peso Evaporadora (kg)", "8", "8", "10", "13", "16"],
  ["Peso Condensadora (kg)", "27", "27", "35", "45", "56"],
];

const featureRows = [
  ["功能/卖点", "整理说明", "来源"],
  ["Refrigerante ecológico R410A", "R410A 冷媒；官网文案说明不使用氯，保护臭氧层。", officialPdfUrl],
  ["Alta eficiencia y tecnología", "具备高低电压/电压变化保护、智能除霜、自动摆风和长距离送风等描述。", officialPdfUrl],
  ["Flujo de aire de 4 vías", "四向气流，强调快速、均匀制冷/制热。", officialPdfUrl],
  ["Aire limpio y puro", "抗菌滤网为可选项，面向粉尘、病毒、细菌和过敏原微粒。", officialPdfUrl],
  ["Recubrimiento anticorrosivo", "抗腐蚀涂层，适用于潮湿、盐雾等腐蚀性环境。", officialPdfUrl],
  ["Confort / temporizador / autolimpieza", "温度调节、低噪、定时开关、抗霉、自清洁和除湿等舒适性功能。", officialPdfUrl],
];

const sourceRows = [
  ["来源类型", "URL/文件", "使用方式", "备注"],
  ["主数据图片", primaryImageUrl, "用于采集本工作簿全部核心数值参数", "图片文件名 ELITE-2-1.jpg，页面图中字段原文保留为 EEER/SEEER。"],
  ["Prime 官网 On/Off 页面", officialOnOffUrl, "用于确认 Elite 2 属于 On/Off minisplit、容量覆盖 1T/1.5T/2T/3T，版本含 Solo Frío / Frío-Calor", "官网页面文本确认产品线和容量项。"],
  ["Prime 官网 PDF", officialPdfUrl, "用于整理功能/卖点文案", "该 PDF 规格表字段与图片部分尺寸口径不一致，核心数值以用户给出的图片为准。"],
  ["AiresPrime Elite 2 PDF", extendedPdfUrl, "用于补充 EMPRC/EMPRN 型号代码", "该 PDF 提供 3T 型号代码；部分尺寸/SEER 与图片有差异，已单独标注来源。"],
  ["采集日期", "2026-05-28", "Asia/Shanghai", "当前工作区日期。"],
];

function setValues(sheet, address, rows) {
  sheet.getRange(address).values = rows;
}

function styleTitle(sheet, address) {
  const range = sheet.getRange(address);
  range.format.font.bold = true;
  range.format.font.size = 16;
  range.format.font.color = "#FFFFFF";
  range.format.fill.color = "#174E96";
  range.format.wrapText = true;
}

function styleSubtitle(sheet, address) {
  const range = sheet.getRange(address);
  range.format.font.italic = true;
  range.format.font.color = "#40546A";
  range.format.wrapText = true;
}

function styleHeader(sheet, address) {
  const range = sheet.getRange(address);
  range.format.font.bold = true;
  range.format.font.color = "#FFFFFF";
  range.format.fill.color = "#1F5FA8";
  range.format.wrapText = true;
}

function setWidths(sheet, widths) {
  for (const [col, width] of Object.entries(widths)) {
    sheet.getRange(`${col}:${col}`).format.columnWidthPx = width;
  }
}

function addTable(sheet, address, name) {
  const table = sheet.tables.add(address, true, name);
  table.showBandedRows = true;
  table.showFilterButton = true;
  return table;
}

function writeFlatCsv(rows, filePath) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          const text = value === null || value === undefined ? "" : String(value);
          return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
  return fs.writeFile(filePath, `${csv}\n`, "utf8");
}

const workbook = Workbook.create();
const flat = workbook.worksheets.add("整理表_按机型");
const raw = workbook.worksheets.add("图片原表");
const features = workbook.worksheets.add("功能卖点");
const sources = workbook.worksheets.add("来源与口径");

const flatHeaders = [
  "品牌",
  "系列",
  "品类",
  "技术类型",
  "容量配置",
  "容量_Ton",
  "制冷量_BTU/h",
  "电压_V",
  "节能率_%",
  "EER_图片原文EEER",
  "SEER_图片原文SEEER",
  "功率_W",
  "冷媒",
  "蒸发器尺寸_mm",
  "冷凝器尺寸_mm",
  "蒸发器重量_kg",
  "冷凝器重量_kg",
  "单冷型号_补充",
  "冷暖型号_补充",
  "数值来源_简写",
  "型号来源_简写",
];
const flatRows = modelRows.map((row) => [
  row.brand,
  row.series,
  row.category,
  row.technology,
  row.capacityLabel,
  row.ton,
  row.btuH,
  row.voltageV,
  row.energySavingPct,
  row.eer,
  row.seer,
  row.powerW,
  row.refrigerant,
  row.evaporatorMm,
  row.condenserMm,
  row.evaporatorKg,
  row.condenserKg,
  row.coolOnlyModel,
  row.heatCoolModel,
  "Prime 图片 ELITE-2-1.jpg",
  "AiresPrime Elite 2 PDF",
]);

setValues(flat, "A1:U1", [["Prime Elite 2 空调参数整理（图片采集主表）", ...Array(20).fill("")]]);
flat.getRange("A1:U1").merge();
styleTitle(flat, "A1:U1");
setValues(flat, "A2:U2", [["核心数值来自用户提供的 Prime ELITE 2 图片；型号代码为补充字段，已在“来源与口径”中说明。", ...Array(20).fill("")]]);
flat.getRange("A2:U2").merge();
styleSubtitle(flat, "A2:U2");
setValues(flat, `A4:U${4 + flatRows.length}`, [flatHeaders, ...flatRows]);
styleHeader(flat, "A4:U4");
addTable(flat, `A4:U${4 + flatRows.length}`, "PrimeElite2Flat");
flat.freezePanes.freezeRows(4);
setWidths(flat, {
  A: 85,
  B: 85,
  C: 150,
  D: 95,
  E: 205,
  F: 80,
  G: 115,
  H: 75,
  I: 75,
  J: 140,
  K: 170,
  L: 80,
  M: 80,
  N: 150,
  O: 150,
  P: 105,
  Q: 115,
  R: 125,
  S: 125,
  T: 195,
  U: 195,
});
flat.getRange("A:U").format.wrapText = true;
flat.getRange("F:L").format.numberFormat = "0.00";
flat.getRange("G:G").format.numberFormat = "#,##0";
flat.getRange("L:L").format.numberFormat = "#,##0";

setValues(raw, "A1:F1", [["Prime Elite 2 图片原表（横向规格）", "", "", "", "", ""]]);
raw.getRange("A1:F1").merge();
styleTitle(raw, "A1:F1");
setValues(raw, "A2:F2", [["完全按图片表格字段整理，逗号小数保留原始西语图片写法。", "", "", "", "", ""]]);
raw.getRange("A2:F2").merge();
styleSubtitle(raw, "A2:F2");
setValues(raw, `A4:F${3 + imageTableRows.length}`, imageTableRows);
styleHeader(raw, "A4:F4");
addTable(raw, `A4:F${3 + imageTableRows.length}`, "PrimeElite2ImageTable");
raw.freezePanes.freezeRows(4);
setWidths(raw, { A: 215, B: 155, C: 155, D: 155, E: 155, F: 165 });
raw.getRange("A:F").format.wrapText = true;

setValues(features, "A1:C1", [["Prime Elite 2 功能卖点（官网文案整理）", "", ""]]);
features.getRange("A1:C1").merge();
styleTitle(features, "A1:C1");
setValues(features, "A2:C2", [["用于商品参数库的非数值卖点标签，便于后续做竞品对比。", "", ""]]);
features.getRange("A2:C2").merge();
styleSubtitle(features, "A2:C2");
setValues(features, `A4:C${3 + featureRows.length}`, featureRows);
styleHeader(features, "A4:C4");
addTable(features, `A4:C${3 + featureRows.length}`, "PrimeElite2Features");
features.freezePanes.freezeRows(4);
setWidths(features, { A: 230, B: 520, C: 285 });
features.getRange("A:C").format.wrapText = true;

setValues(sources, "A1:D1", [["采集来源与口径说明", "", "", ""]]);
sources.getRange("A1:D1").merge();
styleTitle(sources, "A1:D1");
setValues(sources, "A2:D2", [["用途：审计来源、区分图片参数与补充来源，避免后续混用冲突口径。", "", "", ""]]);
sources.getRange("A2:D2").merge();
styleSubtitle(sources, "A2:D2");
setValues(sources, `A4:D${3 + sourceRows.length}`, sourceRows);
styleHeader(sources, "A4:D4");
addTable(sources, `A4:D${3 + sourceRows.length}`, "PrimeElite2Sources");
sources.freezePanes.freezeRows(4);
setWidths(sources, { A: 150, B: 355, C: 380, D: 520 });
sources.getRange("A:D").format.wrapText = true;

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(path.join(root, "data", "prime"), { recursive: true });

const outputPath = path.join(outputDir, "prime_elite2_specs_20260528.xlsx");
const csvPath = path.join(root, "data", "prime", "prime_elite2_specs_20260528.csv");
const csvRows = [flatHeaders, ...flatRows];
await writeFlatCsv(csvRows, csvPath);

const inspectFlat = await workbook.inspect({
  kind: "table",
  range: "整理表_按机型!A4:U9",
  include: "values",
  tableMaxRows: 10,
  tableMaxCols: 25,
});
console.log(inspectFlat.ndjson);

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errorScan.ndjson);

const renderTargets = [
  ["整理表_按机型", "A1:U9", "render_flat.png"],
  ["图片原表", "A1:F15", "render_raw.png"],
  ["来源与口径", "A1:D10", "render_sources.png"],
];
for (const [sheetName, range, fileName] of renderTargets) {
  const blob = await workbook.render({ sheetName, range, scale: 1.5 });
  const buffer = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile(path.join(buildDir, fileName), buffer);
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`WROTE_XLSX=${outputPath}`);
console.log(`WROTE_CSV=${csvPath}`);
