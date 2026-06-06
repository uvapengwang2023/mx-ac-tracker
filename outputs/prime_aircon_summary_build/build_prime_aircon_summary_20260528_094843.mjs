import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const root = "/Users/luke2026/Project_OA/墨西哥电商数据-空调";
const timestamp = "20260528_094843";
const outDir = path.join(root, "outputs", `prime_aircon_specs_${timestamp}`);
const buildDir = path.join(root, "outputs", "prime_aircon_summary_build");
const dataDir = path.join(root, "data", "prime");

const urls = {
  elite2Image: "https://prime.com.mx/wp-content/uploads/2023/10/ELITE-2-1.jpg",
  elite2ModelPdf: "https://www.airesprime.com/booklets/elite-2.pdf",
  elite4: "https://prime.com.mx/wp-content/uploads/2025/06/ELITE_4_POPUP.pdf",
  trendyK: "https://prime.com.mx/wp-content/uploads/2025/06/TRENDY_K_POPUP.pdf",
  trendy3: "https://prime.com.mx/wp-content/uploads/2025/06/TRENDY_3_POPUP.pdf",
};

const sourceFiles = {
  elite4: "data/prime/source_pdfs/ELITE_4_POPUP.pdf",
  trendyK: "data/prime/source_pdfs/TRENDY_K_POPUP.pdf",
  trendy3: "data/prime/source_pdfs/TRENDY_3_POPUP.pdf",
  elite2Csv: "data/prime/prime_elite2_specs_20260528.csv",
};

function uploadYm(url) {
  const match = String(url ?? "").match(/\/uploads\/(\d{4})\/(\d{2})\//);
  return match ? `${match[1]}-${match[2]}` : "";
}

const elite2Features = [
  ["Refrigerante ecológico R410A", "R410A 冷媒；官网文案说明不使用氯，保护臭氧层。"],
  ["Alta eficiencia y tecnología", "高低电压/电压变化保护、智能除霜、自动摆风和长距离送风等描述。"],
  ["Flujo de aire de 4 vías", "四向气流，强调快速、均匀制冷/制热。"],
  ["Aire limpio y puro", "抗菌滤网为可选项，面向粉尘、病毒、细菌和过敏原微粒。"],
  ["Recubrimiento anticorrosivo", "抗腐蚀涂层，适用于潮湿、盐雾等腐蚀性环境。"],
  ["Confort / temporizador / autolimpieza", "温度调节、低噪、定时开关、抗霉、自清洁和除湿等舒适性功能。"],
];

const common2025Features = [
  ["Gas Ecológico R410a", "R410a；源文件说明不使用氯，强调保护臭氧层、低噪和热泵可靠性。"],
  ["Recubrimiento Anticorrosivo GoldShield", "抗腐蚀涂层；源文件描述适用于腐蚀、潮湿、盐雾环境，并标注提升制冷速度。"],
  ["Función Turbo", "快速制冷；源文件描述通过最大化出风量，使房间更快降温。"],
  ["Alta eficiencia y tecnología", "高技术压缩机、旋转式密闭压缩机、制冷更快、低噪、寿命更长。"],
  ["Modo Dormir Sleep", "低噪、自动降低风扇速度、关闭显示灯，面向睡眠场景。"],
  ["Control de Temperatura y Humedad", "面向舒适温湿度控制。"],
  ["Función I FEEL / Yo siento", "遥控器内置温度传感器，按遥控器附近环境温度调节运行。"],
  ["Temporizador", "自动开关机定时。"],
  ["Auto Limpieza", "一键自清洁，源文件描述通过蒸发器快速冷却帮助剥离污垢。"],
];

const featureRows = [
  ...elite2Features.map(([feature, note]) => ["Elite 2", feature, note, urls.elite2Image, uploadYm(urls.elite2Image)]),
  ...[
    ["Elite 4", urls.elite4],
    ["Trendy K", urls.trendyK],
    ["Trendy 3", urls.trendy3],
  ].flatMap(([series, url]) => common2025Features.map(([feature, note]) => [series, feature, note, url, uploadYm(url)])),
];

function n(value) {
  if (value === "" || value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  const normalized = String(value).replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
}

function base(row) {
  const merged = {
    brand: "Prime",
    productType: "Minisplit",
    subtype: "convencional / On-Off",
    controlType: "Remoto",
    sourceFile: "",
    sourceUrl: "",
    sourceNote: "",
    ...row,
  };
  return {
    ...merged,
    siteUploadYm: row.siteUploadYm ?? uploadYm(merged.sourceUrl),
  };
}

const elite2Rows = [
  base({
    series: "Elite 2",
    modelKey: "121-E2",
    capacityTon: 1,
    coolingCapacityBtu: 12000,
    powerSupply: "115V",
    voltageNorm: 115,
    coolingPowerW: 1040,
    eer: 3.57,
    seer: 12.2,
    refrigerantType: "R410A",
    evapDimsMm: "790 x 250 x 200",
    condDimsMm: "770 x 510 x 300",
    evapNetKg: 8,
    condNetKg: 27,
    evapCoolOnlyModel: "EMPRC121-E2",
    evapHeatCoolModel: "EMPRN121-E2",
    sourceUrl: urls.elite2Image,
    sourceFile: sourceFiles.elite2Csv,
    sourceNote: "来自上次整理结果；型号为补充来源。",
  }),
  base({
    series: "Elite 2",
    modelKey: "122-E2",
    capacityTon: 1,
    coolingCapacityBtu: 12000,
    powerSupply: "220V",
    voltageNorm: 220,
    coolingPowerW: 1100,
    eer: 3.52,
    seer: 12.0,
    refrigerantType: "R410A",
    evapDimsMm: "790 x 250 x 200",
    condDimsMm: "770 x 510 x 300",
    evapNetKg: 8,
    condNetKg: 27,
    evapCoolOnlyModel: "EMPRC122-E2",
    evapHeatCoolModel: "EMPRN122-E2",
    sourceUrl: urls.elite2Image,
    sourceFile: sourceFiles.elite2Csv,
    sourceNote: "来自上次整理结果；型号为补充来源。",
  }),
  base({
    series: "Elite 2",
    modelKey: "182-E2",
    capacityTon: 1.5,
    coolingCapacityBtu: 18000,
    powerSupply: "220V",
    voltageNorm: 220,
    coolingPowerW: 1650,
    eer: 3.52,
    seer: 12.0,
    refrigerantType: "R410A",
    evapDimsMm: "900 x 290 x 215",
    condDimsMm: "810 x 574 x 330",
    evapNetKg: 10,
    condNetKg: 35,
    evapCoolOnlyModel: "EMPRC182-E2",
    evapHeatCoolModel: "EMPRN182-E2",
    sourceUrl: urls.elite2Image,
    sourceFile: sourceFiles.elite2Csv,
    sourceNote: "来自上次整理结果；型号为补充来源。",
  }),
  base({
    series: "Elite 2",
    modelKey: "242-E2",
    capacityTon: 2,
    coolingCapacityBtu: 24000,
    powerSupply: "220V",
    voltageNorm: 220,
    coolingPowerW: 2120,
    eer: 3.52,
    seer: 12.0,
    refrigerantType: "R410A",
    evapDimsMm: "990 x 310 x 220",
    condDimsMm: "860 x 620 x 360",
    evapNetKg: 13,
    condNetKg: 45,
    evapCoolOnlyModel: "EMPRC242-E2",
    evapHeatCoolModel: "EMPRN242-E2",
    sourceUrl: urls.elite2Image,
    sourceFile: sourceFiles.elite2Csv,
    sourceNote: "来自上次整理结果；型号为补充来源。",
  }),
  base({
    series: "Elite 2",
    modelKey: "362-E2",
    capacityTon: 3,
    coolingCapacityBtu: 36000,
    powerSupply: "220V",
    voltageNorm: 220,
    coolingPowerW: 3200,
    eer: 3.55,
    seer: 12.0,
    refrigerantType: "R410A",
    evapDimsMm: "1180 x 345 x 260",
    condDimsMm: "895 x 720 x 390",
    evapNetKg: 16,
    condNetKg: 56,
    evapCoolOnlyModel: "EMPRC362-E2",
    evapHeatCoolModel: "EMPRN362-E2",
    sourceUrl: urls.elite2Image,
    sourceFile: sourceFiles.elite2Csv,
    sourceNote: "来自上次整理结果；型号为补充来源。",
  }),
];

const elite4Rows = [
  ["121-E4", 1, 12000, "110-120V/60Hz", 115, 1250, "11,1", "3,57", "12,2", 12000, 1250, "11,1", 3.3, 1.2, 1429, 13.4, "550/500/450/400", "42/40/38/36", "805*197*270", "864*265*332", 50, "660*530*250", "768×575×338", "R410A", 0.49, 0.65, "1/4", "1/2", "16~43", "-7~24", 12, 7, "EMPRC121-E4", "EMPRN121-E4", "CMPRC121-E4", "CMPRN121-E4"],
  ["122-E4", 1, 12000, "220-230V/60Hz", 220, 1260, "5,9", "3,49", "11,9", 12000, 1260, "5,9", 3.3, 1.2, 1438, 6.7, "550/500/450/400", "42/40/38/36", "805*197*270", "864*265*332", 50, "660*530*250", "768×575×338", "R410A", 0.45, 0.65, "1/4", "1/2", "16~43", "-7~24", 12, 7, "EMPRC122-E4", "EMPRN122-E4", "CMPRC122-E4", "CMPRN122-E4"],
  ["182-E4", 1.5, 18000, "220-230V/60Hz", 220, 1880, "8,5", "3,52", "12,0", 18000, 1880, "8,5", 3.3, 1.8, 2177, 10.2, "820/720/620/520", "44/41/38/35", "910*225*295", "979*292*354", 54, "780*560*270", "889×612×359", "R410A", 0.76, 0.95, "1/4", "1/2", "16~43", "-7~24", 12, 7, "EMPRC182-E4", "EMPRN182-E4", "CMPRC182-E4", "CMPRN182-E4"],
  ["242-E4", 2, 24000, "220-230V/60Hz", 220, 2450, "11,5", "3,48", "11,9", 24000, 2450, "11,5", 3.3, 2.2, 2894, 13.6, "1150/1080/1000/850", "46/43/40/37", "1030*223*319", "1102*305*395", 54, "780*560*270", "889×612×359", "R410A", 0.93, 1.2, "1/4", "1/2", "16~43", "-7~24", 15, 8, "EMPRC242-E4", "EMPRN242-E4", "CMPRC242-E4", "CMPRN242-E4"],
  ["362-E4", 3, 36000, "220-230V/60Hz", 220, 3400, "15,5", "3,55", "12,0", 36000, 3400, "15,5", 3.3, 2.6, 4286, 20.1, "1300/1200/1000/900", "48/45/42/39", "1165*326*232", "1243*409*319", 56, "860*720*320", "982×777×438", "R410A", 1.3, 1.75, "3/8", "5/8", "16~43", "-7~24", 15, 8, "EMPRC362-E4", "EMPRN362-E4", "CMPRC362-E4", "CMPRN362-E4"],
].map((r) => base({
  series: "Elite 4",
  modelKey: r[0],
  capacityTon: r[1],
  coolingCapacityBtu: r[2],
  powerSupply: r[3],
  voltageNorm: r[4],
  coolingPowerW: r[5],
  coolingCurrentA: n(r[6]),
  eer: n(r[7]),
  seer: n(r[8]),
  heatingCapacityBtu: r[9],
  heatingPowerW: r[10],
  heatingCurrentA: n(r[11]),
  cop: r[12],
  dehumidificationLh: r[13],
  maxInputW: r[14],
  maxCurrentA: r[15],
  compressorType: "Rotativo",
  indoorAirflowM3h: r[16],
  indoorNoiseDb: r[17],
  evapDimsMm: r[18],
  evapPackageMm: r[19],
  outdoorNoiseDb: r[20],
  condDimsMm: r[21],
  condPackageMm: r[22],
  refrigerantType: "R410A",
  refrigerantRaw: r[23],
  refrigerantChargeCoolKg: r[24],
  refrigerantChargeHeatCoolKg: r[25],
  liquidPipeIn: r[26],
  gasPipeIn: r[27],
  outdoorCoolingTempC: r[28],
  outdoorHeatingTempC: r[29],
  maxPipeLengthM: r[30],
  maxLevelDiffM: r[31],
  evapCoolOnlyModel: r[32],
  evapHeatCoolModel: r[33],
  condCoolOnlyModel: r[34],
  condHeatCoolModel: r[35],
  sourceUrl: urls.elite4,
  sourceFile: sourceFiles.elite4,
}));

const trendy3Rows = [
  ["122-T3", 1, 12000, 12000, "3,57", "12,2", 1.3, 40, 37, 34, 51, "5,9", 1260, 7.7, 1635, "R410/600g", "φ7×2", "φ7×1", 450, "1270/1170/1050/900/850", "1250/1150/1050/950/900", 14, 31, "3/8", "1/4", "3x1.5mm2 2x0.75mm2", "15~23", "777×250×201", "777×290×498", 8.5, 26, "840×315×260", "818×325×520", 10.5, 29, "EMPRC121-T3", "EMPRN121-T3", "CMPRC121-T3", "CMPRN121-T3", "表头为 122-T3，但型号格为 121-T3，按源文件保留并标注。"],
  ["182-T3", 1.5, 18000, 18500, "3,52", "12,0", 2.0, 48, 42, 36, 54, "8,5", 1880, 10.9, 2470, "R410/1150g", "φ7×2", "φ7×2", 820, "1400/1300/1150/950/800", "1300/1200/1100/900/800", 25, 34, "1/2", "1/4", "3x1.5mm2 2x0.075mm2", "20~35", "910x294x206", "795x305x549", 10, 33, "979x372x277", "835x340x585", 13, 36, "EMPRC182-T3", "EMPRN182-T3", "CMPRC182-T3", "CMPRN182-T3", ""],
  ["242-T3", 2, 24000, 25000, "3,48", "11,9", 2.2, 52, 44, 39, 53, "11,5", 2450, 14.6, 3290, "R410/1400g", "φ7×2", "φ7×2", 1100, "1400/1250/1100/1000/900", "1280/1200/1100/1000/900", 45, 45, "1/2", "1/4", "4x0.75mm2 2x0.075mm2", "30~50", "1010x315x220", "853x349x602", 13, 39, "1096x390x297", "890x385x628", 16, 43, "EMPRC242-T3", "EMPRN242-T3", "CMPRC242-T3", "CMPRN242-T3", ""],
].map((r) => base({
  series: "Trendy 3",
  modelKey: r[0],
  capacityTon: r[1],
  coolingCapacityBtu: r[2],
  heatingCapacityBtu: r[3],
  powerSupply: "208-230V/60Hz/1P",
  voltageRange: "198~253",
  voltageNorm: 220,
  eer: n(r[4]),
  seer: n(r[5]),
  dehumidificationLh: r[6],
  pressureHighMpa: 4.5,
  pressureLowMpa: 1.9,
  indoorNoiseDb: `${r[7]}/${r[8]}/${r[9]}`,
  indoorNoiseHighDb: r[7],
  indoorNoiseMedDb: r[8],
  indoorNoiseLowDb: r[9],
  outdoorNoiseDb: r[10],
  coolingCurrentA: n(r[11]),
  coolingPowerW: r[12],
  maxCurrentA: r[13],
  maxInputW: r[14],
  refrigerantRaw: r[15],
  refrigerantType: "R410A",
  compressorType: "Rotativo",
  evapPipe: r[16],
  condPipe: r[17],
  indoorAirflowM3h: r[18],
  indoorFanType: "Flujo cruzado",
  indoorFanSpeedCoolingRpm: r[19],
  indoorFanSpeedHeatingRpm: r[20],
  indoorFanMotorPowerW: r[21],
  outdoorFanMotorPowerW: r[22],
  gasPipeIn: r[23],
  liquidPipeIn: r[24],
  wiring: r[25],
  drainPipe: "O.D 16mm",
  recommendedAreaM2: r[26],
  evapDimsMm: r[27],
  condDimsMm: r[28],
  evapNetKg: r[29],
  condNetKg: r[30],
  evapPackageMm: r[31],
  condPackageMm: r[32],
  evapGrossKg: r[33],
  condGrossKg: r[34],
  evapCoolOnlyModel: r[35],
  evapHeatCoolModel: r[36],
  condCoolOnlyModel: r[37],
  condHeatCoolModel: r[38],
  sourceNote: r[39],
  sourceUrl: urls.trendy3,
  sourceFile: sourceFiles.trendy3,
}));

const trendyKRows = [
  ["121-K", 1, 12000, 12000, "3,57", "12,2", 1.3, 4.5, 1.9, 41, 37, 34, 51, "115V~/60Hz/1P", "115~", 115, "11,1", 1250, 14.3, 1450, "R410/600g", "φ7×2", "φ7×1", 520, "1400/1260/1100/900/850", "1400/1260/1100/950/900", 20, 31, "3/8", "1/4", "3x1.5mm2 2x0.75mm2", "15~23", "777×250×201", "777×290×498", 8, 26, "840×315×260", "818×325×515", 10, 29, "EMPRC121-K", "EMPRN121-K", "CMPRC121-K", "CMPRN121-K", ""],
  ["362-K", 3, 36000, 36000, "3,55", "2.2", 4.5, 1.9, 50, 48, 45, 58, 55, "208-230V~/60Hz/1P", "198~253", 220, "14,0", 3000, 18.0, 4800, "R410/1650g", "φ7×2", "φ7×2", 1400, "1270/1100/900", "1250/1100/900", 65, 54, "5/8", "1/4", "4x0.75mm2 2x0.075mm2", "45~65", "1186x340x258", "920x380x699", 16, 56, "1262x420x337", "960x430x732", 20, 61, "EMPRC362-K", "EMPRN362-K", "CMPRC362-K", "CMPRN362-K", "PDF 中 36K SEER 显示为 2.2，压力低压显示 50 MPa，室内低档噪音显示 58 dB(A)；按源文件保留，建议二次确认。"],
].map((r) => base({
  series: "Trendy K",
  modelKey: r[0],
  capacityTon: r[1],
  coolingCapacityBtu: r[2],
  heatingCapacityBtu: r[3],
  eer: n(r[4]),
  seer: n(r[5]),
  dehumidificationLh: r[6],
  pressureHighMpa: r[7],
  pressureLowMpa: r[8],
  indoorNoiseDb: `${r[9]}/${r[10]}/${r[11]}`,
  indoorNoiseHighDb: r[9],
  indoorNoiseMedDb: r[10],
  indoorNoiseLowDb: r[11],
  outdoorNoiseDb: r[12],
  powerSupply: r[13],
  voltageRange: r[14],
  voltageNorm: r[15],
  coolingCurrentA: n(r[16]),
  coolingPowerW: r[17],
  maxCurrentA: r[18],
  maxInputW: r[19],
  refrigerantRaw: r[20],
  refrigerantType: "R410A",
  compressorType: "Rotativo",
  evapPipe: r[21],
  condPipe: r[22],
  indoorAirflowM3h: r[23],
  indoorFanType: "Flujo cruzado",
  indoorFanSpeedCoolingRpm: r[24],
  indoorFanSpeedHeatingRpm: r[25],
  indoorFanMotorPowerW: r[26],
  outdoorFanMotorPowerW: r[27],
  gasPipeIn: r[28],
  liquidPipeIn: r[29],
  wiring: r[30],
  drainPipe: "O.D 16mm",
  recommendedAreaM2: r[31],
  evapDimsMm: r[32],
  condDimsMm: r[33],
  evapNetKg: r[34],
  condNetKg: r[35],
  evapPackageMm: r[36],
  condPackageMm: r[37],
  evapGrossKg: r[38],
  condGrossKg: r[39],
  evapCoolOnlyModel: r[40],
  evapHeatCoolModel: r[41],
  condCoolOnlyModel: r[42],
  condHeatCoolModel: r[43],
  sourceNote: r[44],
  sourceUrl: urls.trendyK,
  sourceFile: sourceFiles.trendyK,
}));

const allRows = [...elite2Rows, ...elite4Rows, ...trendyKRows, ...trendy3Rows];

const coreHeaders = [
  "序号", "品牌", "系列", "型号/表头", "容量_Ton", "制冷量_BTU/h", "电源/电压", "规范电压_V",
  "制冷功率_W", "制冷电流_A", "EER_W/W", "SEER或REEE_W/W", "制热量_BTU/h", "制热功率_W",
  "制热电流_A", "COP_W/W", "除湿量_L/h", "最大输入_W", "最大电流_A", "冷媒_原文",
  "冷媒类型_规范", "蒸发器尺寸_mm", "冷凝器尺寸_mm", "蒸发器净重_kg", "冷凝器净重_kg",
  "室内噪音_dB(A)", "室外噪音_dB(A)", "室内风量_m3/h", "适用面积_m2", "液管_in",
  "气管_in", "蒸发器单冷型号", "蒸发器冷暖型号", "冷凝器单冷型号", "冷凝器冷暖型号",
  "来源文件", "来源URL", "网站录入年月_链接", "备注",
];

const coreRows = allRows.map((r, idx) => [
  idx + 1, r.brand, r.series, r.modelKey, r.capacityTon, r.coolingCapacityBtu, r.powerSupply, r.voltageNorm,
  r.coolingPowerW ?? "", r.coolingCurrentA ?? "", r.eer ?? "", r.seer ?? "", r.heatingCapacityBtu ?? "", r.heatingPowerW ?? "",
  r.heatingCurrentA ?? "", r.cop ?? "", r.dehumidificationLh ?? "", r.maxInputW ?? "", r.maxCurrentA ?? "", r.refrigerantRaw ?? r.refrigerantType ?? "",
  r.refrigerantType ?? "", r.evapDimsMm ?? "", r.condDimsMm ?? "", r.evapNetKg ?? "", r.condNetKg ?? "",
  r.indoorNoiseDb ?? "", r.outdoorNoiseDb ?? "", r.indoorAirflowM3h ?? "", r.recommendedAreaM2 ?? "", r.liquidPipeIn ?? "",
  r.gasPipeIn ?? "", r.evapCoolOnlyModel ?? "", r.evapHeatCoolModel ?? "", r.condCoolOnlyModel ?? "", r.condHeatCoolModel ?? "",
  r.sourceFile, r.sourceUrl, r.siteUploadYm, r.sourceNote ?? "",
]);

const extendedHeaders = [
  "系列", "型号/表头", "容量_Ton", "制冷量_BTU/h", "制热量_BTU/h", "电源/电压", "电压范围",
  "制冷功率_W", "制冷电流_A", "EER", "SEER/REEE", "制热功率_W", "制热电流_A", "COP",
  "除湿量_L/h", "高压_MPa", "低压_MPa", "室内噪音_高", "室内噪音_中", "室内噪音_低", "室外噪音",
  "最大输入_W", "最大电流_A", "压缩机", "冷媒原文", "单冷充注_kg", "冷暖充注_kg", "蒸发器尺寸_mm",
  "冷凝器尺寸_mm", "蒸发器包装_mm", "冷凝器包装_mm", "蒸发器净重_kg", "冷凝器净重_kg",
  "蒸发器毛重_kg", "冷凝器毛重_kg", "室内风量_m3/h", "室内风扇类型", "制冷风速_rpm",
  "制热风速_rpm", "液管_in", "气管_in", "接线", "排水管", "制冷外温_C", "制热外温_C",
  "最大管长_m", "最大高差_m", "网站录入年月_链接", "来源文件", "备注",
];

const extendedRows = allRows.map((r) => [
  r.series, r.modelKey, r.capacityTon, r.coolingCapacityBtu, r.heatingCapacityBtu ?? "", r.powerSupply, r.voltageRange ?? "",
  r.coolingPowerW ?? "", r.coolingCurrentA ?? "", r.eer ?? "", r.seer ?? "", r.heatingPowerW ?? "", r.heatingCurrentA ?? "", r.cop ?? "",
  r.dehumidificationLh ?? "", r.pressureHighMpa ?? "", r.pressureLowMpa ?? "", r.indoorNoiseHighDb ?? "", r.indoorNoiseMedDb ?? "", r.indoorNoiseLowDb ?? "", r.outdoorNoiseDb ?? "",
  r.maxInputW ?? "", r.maxCurrentA ?? "", r.compressorType ?? "", r.refrigerantRaw ?? r.refrigerantType ?? "", r.refrigerantChargeCoolKg ?? "", r.refrigerantChargeHeatCoolKg ?? "", r.evapDimsMm ?? "",
  r.condDimsMm ?? "", r.evapPackageMm ?? "", r.condPackageMm ?? "", r.evapNetKg ?? "", r.condNetKg ?? "",
  r.evapGrossKg ?? "", r.condGrossKg ?? "", r.indoorAirflowM3h ?? "", r.indoorFanType ?? "", r.indoorFanSpeedCoolingRpm ?? "",
  r.indoorFanSpeedHeatingRpm ?? "", r.liquidPipeIn ?? "", r.gasPipeIn ?? "", r.wiring ?? "", r.drainPipe ?? "", r.outdoorCoolingTempC ?? "", r.outdoorHeatingTempC ?? "",
  r.maxPipeLengthM ?? "", r.maxLevelDiffM ?? "", r.siteUploadYm, r.sourceFile, r.sourceNote ?? "",
]);

const modelMapHeaders = ["系列", "型号/表头", "容量_Ton", "制冷量_BTU/h", "蒸发器单冷", "蒸发器冷暖", "冷凝器单冷", "冷凝器冷暖", "备注"];
const modelMapRows = allRows.map((r) => [
  r.series, r.modelKey, r.capacityTon, r.coolingCapacityBtu, r.evapCoolOnlyModel ?? "", r.evapHeatCoolModel ?? "", r.condCoolOnlyModel ?? "", r.condHeatCoolModel ?? "", r.sourceNote ?? "",
]);

const sourceRows = [
  ["来源", "URL/文件", "网站录入年月_链接", "本次用途", "口径说明"],
  ["上次 Elite 2 整理结果", sourceFiles.elite2Csv, "", "合并进本次汇总", "不覆盖上次 Excel；核心数值来自用户上次图片采集。"],
  ["Elite 2 图片", urls.elite2Image, uploadYm(urls.elite2Image), "Elite 2 核心参数与功能卖点产品时间来源", "图中字段原文为 EEER/SEEER，本次规范列记为 EER/SEER；URL 中 /2023/10/ 视作产品信息录入/上传年月。"],
  ["Elite 2 型号补充 PDF", urls.elite2ModelPdf, "", "Elite 2 型号补充", "保留为补充来源；该链接本身无 /uploads/YYYY/MM/ 时间片段。"],
  ["ELITE_4_POPUP.pdf", urls.elite4, uploadYm(urls.elite4), "Elite 4 参数、型号与功能卖点", "122-E4 的冷媒充注量用渲染页核对：单冷 0.45 kg，冷暖 0.65 kg；URL 中 /2025/06/ 视作产品信息录入/上传年月。"],
  ["TRENDY_K_POPUP.pdf", urls.trendyK, uploadYm(urls.trendyK), "Trendy K 参数、型号与功能卖点", "362-K 的 SEER=2.2、低压=50 MPa、室内低档噪音=58 dB(A) 均按 PDF 可见值保留，疑似源文件异常。"],
  ["TRENDY_3_POPUP.pdf", urls.trendy3, uploadYm(urls.trendy3), "Trendy 3 参数、型号与功能卖点", "12K 表头为 122-T3，但型号格显示 EMPRC/EMPRN/CMPRC/CMPRN121-T3，按源文件保留并标注。"],
  ["采集时间", timestamp, "", "文件命名与审计", "Asia/Shanghai；本次新建修正版文件，不覆盖旧文件。"],
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

function addTable(sheet, address, name) {
  const table = sheet.tables.add(address, true, name);
  table.showBandedRows = true;
  table.showFilterButton = true;
  return table;
}

function setWidths(sheet, widths) {
  for (const [col, width] of Object.entries(widths)) {
    sheet.getRange(`${col}:${col}`).format.columnWidthPx = width;
  }
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeCsv(rows, filePath) {
  await fs.writeFile(filePath, `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`, "utf8");
}

const workbook = Workbook.create();
const core = workbook.worksheets.add("汇总_核心参数");
const ext = workbook.worksheets.add("扩展参数_PDF");
const modelMap = workbook.worksheets.add("型号映射");
const features = workbook.worksheets.add("功能卖点");
const sources = workbook.worksheets.add("来源与口径");

setValues(core, `A1:AM1`, [["Prime 空调参数汇总（Elite 2 + Elite 4 + Trendy K + Trendy 3）", ...Array(coreHeaders.length - 1).fill("")]]);
core.getRange("A1:AM1").merge();
styleTitle(core, "A1:AM1");
setValues(core, `A2:AM2`, [["本文件为新建修正版汇总，不覆盖上次文件；功能卖点覆盖 4 个产品，链接年月已结构化保存。", ...Array(coreHeaders.length - 1).fill("")]]);
core.getRange("A2:AM2").merge();
styleSubtitle(core, "A2:AM2");
setValues(core, `A4:AM${4 + coreRows.length}`, [coreHeaders, ...coreRows]);
styleHeader(core, "A4:AM4");
addTable(core, `A4:AM${4 + coreRows.length}`, "PrimeAirconCore");
core.freezePanes.freezeRows(4);
setWidths(core, { A: 55, B: 80, C: 95, D: 95, E: 80, F: 110, G: 145, H: 85, I: 95, J: 95, K: 85, L: 115, M: 110, N: 95, O: 95, P: 80, Q: 95, R: 90, S: 90, T: 125, U: 105, V: 135, W: 135, X: 105, Y: 105, Z: 115, AA: 100, AB: 120, AC: 100, AD: 80, AE: 80, AF: 125, AG: 125, AH: 125, AI: 125, AJ: 185, AK: 300, AL: 125, AM: 330 });
core.getRange("A:AM").format.wrapText = true;

setValues(ext, `A1:AX1`, [["PDF 扩展参数明细", ...Array(extendedHeaders.length - 1).fill("")]]);
ext.getRange("A1:AX1").merge();
styleTitle(ext, "A1:AX1");
setValues(ext, `A2:AX2`, [["按一机型一行保留更细字段；Elite 2 仅含上次图片可得字段，PDF 扩展项为空。", ...Array(extendedHeaders.length - 1).fill("")]]);
ext.getRange("A2:AX2").merge();
styleSubtitle(ext, "A2:AX2");
setValues(ext, `A4:AX${4 + extendedRows.length}`, [extendedHeaders, ...extendedRows]);
styleHeader(ext, "A4:AX4");
addTable(ext, `A4:AX${4 + extendedRows.length}`, "PrimeAirconExtended");
ext.freezePanes.freezeRows(4);
setWidths(ext, { A: 95, B: 95, C: 80, D: 110, E: 110, F: 150, G: 95, H: 95, I: 95, J: 75, K: 95, L: 95, M: 95, N: 75, O: 90, P: 85, Q: 85, R: 85, S: 85, T: 85, U: 85, V: 90, W: 90, X: 95, Y: 115, Z: 95, AA: 95, AB: 135, AC: 135, AD: 135, AE: 135, AF: 100, AG: 100, AH: 100, AI: 100, AJ: 120, AK: 120, AL: 165, AM: 165, AN: 75, AO: 75, AP: 165, AQ: 95, AR: 95, AS: 95, AT: 95, AU: 95, AV: 95, AW: 180, AX: 330 });
ext.getRange("A:AX").format.wrapText = true;

setValues(modelMap, "A1:I1", [["型号映射", "", "", "", "", "", "", "", ""]]);
modelMap.getRange("A1:I1").merge();
styleTitle(modelMap, "A1:I1");
setValues(modelMap, "A2:I2", [["按蒸发器/冷凝器、单冷/冷暖拆分；空值表示来源未提供。", "", "", "", "", "", "", "", ""]]);
modelMap.getRange("A2:I2").merge();
styleSubtitle(modelMap, "A2:I2");
setValues(modelMap, `A4:I${4 + modelMapRows.length}`, [modelMapHeaders, ...modelMapRows]);
styleHeader(modelMap, "A4:I4");
addTable(modelMap, `A4:I${4 + modelMapRows.length}`, "PrimeAirconModels");
modelMap.freezePanes.freezeRows(4);
setWidths(modelMap, { A: 100, B: 100, C: 80, D: 110, E: 140, F: 140, G: 140, H: 140, I: 380 });
modelMap.getRange("A:I").format.wrapText = true;

setValues(features, "A1:E1", [["功能卖点", "", "", "", ""]]);
features.getRange("A1:E1").merge();
styleTitle(features, "A1:E1");
setValues(features, "A2:E2", [["按产品/系列展开，覆盖 Elite 2、Elite 4、Trendy K、Trendy 3 共 4 个产品；同时保留链接中的上传年月。", "", "", "", ""]]);
features.getRange("A2:E2").merge();
styleSubtitle(features, "A2:E2");
setValues(features, `A4:E${4 + featureRows.length}`, [["产品/系列", "功能/卖点", "整理说明", "来源URL", "网站录入年月_链接"], ...featureRows]);
styleHeader(features, "A4:E4");
addTable(features, `A4:E${4 + featureRows.length}`, "PrimeAirconFeatures");
features.freezePanes.freezeRows(4);
setWidths(features, { A: 110, B: 250, C: 560, D: 360, E: 125 });
features.getRange("A:E").format.wrapText = true;

setValues(sources, "A1:E1", [["来源与口径说明", "", "", "", ""]]);
sources.getRange("A1:E1").merge();
styleTitle(sources, "A1:E1");
setValues(sources, "A2:E2", [["用于审计来源、记录异常值、合并策略，以及 URL 中的产品信息录入/上传年月。", "", "", "", ""]]);
sources.getRange("A2:E2").merge();
styleSubtitle(sources, "A2:E2");
setValues(sources, `A4:E${3 + sourceRows.length}`, sourceRows);
styleHeader(sources, "A4:E4");
addTable(sources, `A4:E${3 + sourceRows.length}`, "PrimeAirconSources");
sources.freezePanes.freezeRows(4);
setWidths(sources, { A: 180, B: 520, C: 125, D: 300, E: 820 });
sources.getRange("A:E").format.wrapText = true;
sources.getRange("5:11").format.rowHeightPx = 48;

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });

const xlsxPath = path.join(outDir, `01_Prime空调参数汇总_${timestamp}.xlsx`);
const csvPath = path.join(outDir, `01_Prime空调参数汇总_${timestamp}.csv`);
await writeCsv([coreHeaders, ...coreRows], csvPath);

const coreInspect = await workbook.inspect({
  kind: "table",
  range: "汇总_核心参数!A4:AM19",
  include: "values",
  tableMaxRows: 18,
  tableMaxCols: 39,
});
console.log(coreInspect.ndjson);

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
});
console.log(errorScan.ndjson);

const renderTargets = [
  ["汇总_核心参数", "A1:AM19", "render_core.png"],
  ["扩展参数_PDF", "A1:AX19", "render_extended.png"],
  ["功能卖点", "A1:E38", "render_features.png"],
  ["来源与口径", "A1:E12", "render_sources.png"],
];
for (const [sheetName, range, fileName] of renderTargets) {
  const blob = await workbook.render({ sheetName, range, scale: 1.1 });
  await fs.writeFile(path.join(buildDir, fileName), Buffer.from(await blob.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(xlsxPath);
console.log(`WROTE_XLSX=${xlsxPath}`);
console.log(`WROTE_CSV=${csvPath}`);
