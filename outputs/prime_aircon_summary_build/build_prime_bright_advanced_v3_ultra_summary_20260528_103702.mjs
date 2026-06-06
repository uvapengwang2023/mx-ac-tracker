import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const root = "/Users/luke2026/Project_OA/墨西哥电商数据-空调";
const timestamp = "20260528_103702";
const outDir = path.join(root, "outputs", `prime_aircon_specs_${timestamp}`);

const urls = {
  a1: "https://prime.com.mx/wp-content/uploads/2025/06/A1_ADVANCED_POPUP.jpg",
  bright1: "https://prime.com.mx/wp-content/uploads/2023/10/BRIGHT-1.jpg",
  r3: "https://prime.com.mx/wp-content/uploads/2025/06/R3_ADVANCED_POPUP.jpg",
  bright3: "https://prime.com.mx/wp-content/uploads/2025/11/BRIGHT_3_POPUP.jpg",
  v3: "https://prime.com.mx/wp-content/uploads/2026/05/FICHA_V3_compressed.pdf",
  ultra3: "https://prime.com.mx/wp-content/uploads/2026/05/SEER22_ULTRA_compressed.pdf",
};

const sourceFiles = {
  a1: "data/prime/source_images_20260528_102300/A1_ADVANCED_POPUP.jpg",
  bright1: "data/prime/source_images_20260528_102300/BRIGHT-1.jpg",
  r3: "data/prime/source_images_20260528_102300/R3_ADVANCED_POPUP.jpg",
  bright3: "data/prime/source_images_20260528_102300/BRIGHT_3_POPUP.jpg",
  v3: "data/prime/source_pdfs_20260528_103702/FICHA_V3_compressed.pdf",
  ultra3: "data/prime/source_pdfs_20260528_103702/SEER22_ULTRA_compressed.pdf",
};

const exifTimes = {
  [urls.a1]: "2025:06:20 17:17:46",
  [urls.bright1]: "",
  [urls.r3]: "2025:06:18 18:54:20",
  [urls.bright3]: "2025:10:30 16:15:17",
  [urls.v3]: "PDF CreationDate D:20260430113341-05'00'; ModDate D:20260526035613Z",
  [urls.ultra3]: "PDF CreationDate D:20260521135149-05'00'; ModDate D:20260526004822Z",
};

function uploadYm(url) {
  const match = String(url ?? "").match(/\/uploads\/(\d{4})\/(\d{2})\//);
  return match ? `${match[1]}-${match[2]}` : "";
}

function n(value) {
  if (value === "" || value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : value;
}

function colName(num) {
  let name = "";
  while (num > 0) {
    const rem = (num - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    num = Math.floor((num - 1) / 26);
  }
  return name;
}

function base(row) {
  const sourceUrl = row.sourceUrl ?? "";
  return {
    brand: "Prime",
    productType: "Minisplit",
    subtype: "Inverter",
    controlType: "Remoto",
    type: row.type ?? "Minisplit",
    sourceFile: row.sourceFile ?? "",
    sourceUrl,
    siteUploadYm: uploadYm(sourceUrl),
    exifTime: exifTimes[sourceUrl] ?? "",
    sourceNote: "",
    ...row,
  };
}

const rows = [
  base({
    series: "A1 Advanced",
    modelKey: "362-A1",
    capacityLabel: "36K",
    seerBadge: "SEER 18",
    capacityTon: 3,
    coolingCapacityBtu: 36000,
    coolingCapacityRaw: "36000(10800~37000)",
    heatingCapacityBtu: 36000,
    heatingCapacityRaw: "36000(10800~37500)",
    powerSupply: "208-230V~/60Hz",
    voltageRange: "165~265",
    voltageNorm: 220,
    eer: 5.28,
    seer: 18.01,
    dehumidificationLh: 2.8,
    pressureHighMpa: 4.5,
    pressureLowMpa: 1.9,
    indoorNoiseDb: "54/51/48",
    indoorNoiseHighDb: 54,
    indoorNoiseMedDb: 51,
    indoorNoiseLowDb: 48,
    outdoorNoiseDb: 59,
    maxCurrentA: 18.0,
    maxInputW: 3900,
    refrigerantRaw: "R410a/2010g",
    refrigerantType: "R410A",
    refrigerantChargeKg: 2.01,
    compressorType: "Rotativo",
    evapPipe: "φ7×2",
    condPipe: "φ7×2",
    indoorAirflowM3h: "1450",
    indoorFanType: "Flujo cruzado",
    indoorFanSpeedCoolingRpm: "1300/1200/950/800/750",
    indoorFanSpeedHeatingRpm: "1250/1150/950/800/750",
    indoorFanSpeedDryRpm: "1300",
    indoorFanSpeedSleepRpm: "800",
    indoorFanMotorModel: "22001-000240(ADC)",
    indoorFanMotorPowerW: 45,
    outdoorFanType: "Hélice",
    outdoorFanMotorModel: "22001-000147(DC)",
    outdoorFanSpeedRpm: 850,
    outdoorFanMotorPowerW: 85,
    gasPipeIn: '1/2"',
    liquidPipeIn: '1/4"',
    wiring: "4×0.75/3*2.5mm2",
    drainPipe: "O.D 16mm",
    recommendedAreaM2: "15~23",
    evapDimsMm: "1186×340×258",
    condDimsMm: "976×421×804",
    evapPackageMm: "1260×430×328",
    condPackageMm: "1022×480×835",
    evapNetKg: 16.5,
    condNetKg: 46.5,
    evapGrossKg: 19.5,
    condGrossKg: 50.5,
    evapCoolOnlyModel: "EMPRC362-A1",
    evapHeatCoolModel: "EMPRN362-A1",
    condCoolOnlyModel: "CMPRC362-A1",
    condHeatCoolModel: "CMPRN362-A1",
    sourceUrl: urls.a1,
    sourceFile: sourceFiles.a1,
    sourceNote: "来源图为完整参数表；36K 适用面积显示为 15~23 m²，已按源图保留并在异常检查页提示复核。",
  }),

  ...[
    ["Bright 1 12K 115V", "1 Ton 12000 btu/h 115V", 1, 12000, "115V", 115, "14,1%", 5.34, 18.25, 1228.1, "830×270×190", "720×540×290", 8, 23],
    ["Bright 1 12K 220V", "1 Ton 12000 btu/h 220V", 1, 12000, "220V", 220, "14,5%", 5.36, 18.3, 1292.57, "830×270×190", "720×540×290", 8, 23],
    ["Bright 1 18K", "1.5 Ton 18000 btu/h", 1.5, 18000, "220V", 220, "13,2%", 5.30, 18.09, 1870.77, "950×293×205", "858×570×292", 10, 28],
    ["Bright 1 24K", "2 Ton 24000 btu/h", 2, 24000, "220V", 220, "23,9%", 5.44, 18.58, 2071.19, "1020×320×215", "923×660×345", 13, 37],
    ["Bright 1 36K", "3 Ton 36000 btu/h", 3, 36000, "220V", 220, "20,3%", 5.28, 18.01, 3800.0, "1100×325×240", "1018×837×391", 17, 61],
  ].map((r) => base({
    series: "Bright 1",
    modelKey: r[0],
    capacityLabel: r[1],
    capacityTon: r[2],
    coolingCapacityBtu: r[3],
    powerSupply: r[4],
    voltageNorm: r[5],
    energySavingPct: r[6],
    eer: r[7],
    seer: r[8],
    coolingPowerW: r[9],
    refrigerantRaw: "R410A",
    refrigerantType: "R410A",
    evapDimsMm: r[10],
    condDimsMm: r[11],
    evapNetKg: r[12],
    condNetKg: r[13],
    sourceUrl: urls.bright1,
    sourceFile: sourceFiles.bright1,
    sourceNote: "来源图为简版参数表，未显示 EMPR/CMPR 型号代码、噪音、风量和制热等扩展字段；型号/表头用图中容量与电压描述。",
  })),

  ...[
    ["121-R3", "SEER 18", 1, 12000, "12000(2050~12500)", 12000, "12000(2050~12625)", "115V~/60Hz/1P", "105~125", 115, "11,1", 1250, 13.0, 1500, 5.34, 18.25, 1.3, 40, 36, 33, 53, "R32/500g", 0.5, "φ5×2", "φ7×1", "500/550", "1350/1200/1100/1000/950/900/750", "1350/1200/1100/1050/1000/950/850", 900, 750, "22001-000238(AC)", 20, "22001-000555 (DC)", 1000, 33, '3/8"', '1/4"', "4×1.5mm2", "15~23", "777×250×201", "777×290×498", 8, 22, "840×315×260", "818×325×515", 10, 25],
    ["122-R3", "SEER 18", 1, 12000, "12000(2730~12500)", 12000, "12000(2730~12500)", "208-230V~/60Hz/1P", "165~265", 220, "5,9", 1260, 7.7, 1650, 5.36, 18.30, 1.3, 40, 37, 33, 53, "R32/475g", 0.475, "φ5×2", "φ7×1", "500/550", "1250/1150/1050/1000/950/900/800", "1250/1150/1080/1000/950/900/800", 900, 800, "22001-000561(AC)", 13, "22001-000626 (DC)", 1200, 33, '3/8"', '1/4"', "4×1.0mm2", "15~23", "777×250×201", "722×276×459", 8, 20, "840×315×260", "765×310×481", 10, 23],
    ["182-R3", "SEER 20", 1.5, 18000, "18000(4095~18500)", 18000, "18000(4095~18500)", "208-230V~/60Hz/1P", "165~265", 220, "8,5", 1880, 12.0, 2500, 5.87, 20.05, 1.8, 45, 39, 34, 54, "R32/670g", 0.67, "φ7×2", "φ7×1", "1000/1050", "1400/1260/1150/1050/960/870/800", "1300/1200/1100/1000/900/800/750", 870, 800, "22001-000562(DC)", 25, "22001-000555 (DC)", 1000, 33, '3/8"', '1/4"', "4×0.75mm2", "20~35", "910×294×206", "810×305×549", 9, 24.5, "979×372×277", "835×340×585", 12, 28.5],
    ["242-R3", "SEER 20", 2, 24000, "24000(5120~24500)", 24000, "24000(5120~24500)", "208-230V~/60Hz/1P", "165~265", 220, "9,24", 2071.9, 12.0, 2700, 6.03, 20.58, 2.4, 47, 45, 39, 55, "R32/1040g", 1.04, "φ7×2", "φ7×2", "1300/1400", "1270/1200/1150/1100/1000/920/850", "1270/1200/1100/1000/920/850/750", 920, 850, "22001-000240(DC)", 45, "22001-000493 (DC)", 1000, 33, '1/2"', '1/4"', "4×0.75mm2", "30~50", "1010×315×220", "863×349×602", 11.5, 31, "1096×390×297", "890×385×628", 14.5, 36],
  ].map((r) => base({
    series: "R3 Advanced",
    modelKey: r[0],
    seerBadge: r[1],
    capacityTon: r[2],
    coolingCapacityBtu: r[3],
    coolingCapacityRaw: r[4],
    heatingCapacityBtu: r[5],
    heatingCapacityRaw: r[6],
    powerSupply: r[7],
    voltageRange: r[8],
    voltageNorm: r[9],
    coolingCurrentA: n(r[10]),
    coolingPowerW: r[11],
    maxCurrentA: r[12],
    maxInputW: r[13],
    eer: r[14],
    seer: r[15],
    dehumidificationLh: r[16],
    pressureHighMpa: 4.5,
    pressureLowMpa: 1.9,
    indoorNoiseDb: `${r[17]}/${r[18]}/${r[19]}`,
    indoorNoiseHighDb: r[17],
    indoorNoiseMedDb: r[18],
    indoorNoiseLowDb: r[19],
    outdoorNoiseDb: r[20],
    refrigerantRaw: r[21],
    refrigerantType: "R32",
    refrigerantChargeKg: r[22],
    compressorType: "Rotativo",
    evapPipe: r[23],
    condPipe: r[24],
    indoorAirflowM3h: r[25],
    indoorFanType: "Flujo cruzado",
    indoorFanSpeedCoolingRpm: r[26],
    indoorFanSpeedHeatingRpm: r[27],
    indoorFanSpeedDryRpm: String(r[28]),
    indoorFanSpeedSleepRpm: String(r[29]),
    indoorFanMotorModel: r[30],
    indoorFanMotorPowerW: r[31],
    outdoorFanType: "Hélice",
    outdoorFanMotorModel: r[32],
    outdoorFanSpeedRpm: r[33],
    outdoorFanMotorPowerW: r[34],
    gasPipeIn: r[35],
    liquidPipeIn: r[36],
    wiring: r[37],
    drainPipe: "O.D 16mm",
    recommendedAreaM2: r[38],
    evapDimsMm: r[39],
    condDimsMm: r[40],
    evapNetKg: r[41],
    condNetKg: r[42],
    evapPackageMm: r[43],
    condPackageMm: r[44],
    evapGrossKg: r[45],
    condGrossKg: r[46],
    evapCoolOnlyModel: `EMPRC${r[0]}`,
    evapHeatCoolModel: `EMPRN${r[0]}`,
    condCoolOnlyModel: `CMPRC${r[0]}`,
    condHeatCoolModel: `CMPRN${r[0]}`,
    sourceUrl: urls.r3,
    sourceFile: sourceFiles.r3,
  })),

  ...[
    ["121-B3", "12K", 1, 12000, "110-120V/60Hz", 115, 1250, "11,1", 18.25, 1250, "11,1", 1.2, 1776, 15.9, "550/500/450/400", "42/40/38/36", 50, "805*197*270", "660*530*250", "864*265*332", "768×575×338", "R32", 0.59, '1/4"', '3/8"', "16~43", "-15~24", 12, 7],
    ["122-B3", "12K", 1, 12000, "220-230V/60Hz", 220, 1260, "5,9", 18.3, 1260, "5,9", 1.2, 1788, 8.4, "550/500/450/400", "42/40/38/36", 50, "805*197*270", "660*530*250", "864*265*332", "768×575×338", "R32", 0.62, '1/4"', '3/8"', "16~52", "-15~24", 12, 7],
    ["182-B3", "18K", 1.5, 18000, "220-230V/60Hz", 220, 1880, "8,5", 20.05, 1880, "8,5", 1.8, 2899, 13.6, "820/720/620/520", "44/41/38/35", 54, "910*225*295", "780*560*270", "979*292*354", "889×612×359", "R32", 0.95, '1/4"', '1/2"', "16~52", "-15~24", 12, 7],
    ["242-B3", "24K", 2, 24000, "220-230V/60Hz", 220, 2450, "11,5", 20.58, 2450, "11,5", 2.2, 3505, 16.4, "1150/1080/1000/850", "46/43/40/37", 54, "1030*223*319", "780*560*270", "1102*305*395", "889×612×359", "R32", 1.1, '1/4"', '1/2"', "16~52", "-15~24", 15, 8],
    ["362-B3", "36K", 3, 36000, "220-230V/60Hz", 220, 3900, "18,0", 18.01, 3900, "18,0", 2.5, 3983, 18.7, "1300/1200/1000/900", "48/45/42/39", 56, "1165*326*232", "860*720*320", "1243*409*319", "982×777×438", "R32", 1.6, '1/4"', '5/8"', "16~52", "-15~24", 15, 8],
  ].map((r) => base({
    series: "Bright 3",
    modelKey: r[0],
    capacityLabel: r[1],
    capacityTon: r[2],
    coolingCapacityBtu: r[3],
    heatingCapacityBtu: r[3],
    powerSupply: r[4],
    voltageNorm: r[5],
    coolingPowerW: r[6],
    coolingCurrentA: n(r[7]),
    seer: r[8],
    heatingPowerW: r[9],
    heatingCurrentA: n(r[10]),
    hspf: 8.6,
    dehumidificationLh: r[11],
    maxInputW: r[12],
    maxCurrentA: r[13],
    compressorType: "Rotativo",
    indoorAirflowM3h: r[14],
    indoorNoiseDb: r[15],
    outdoorNoiseDb: r[16],
    evapDimsMm: r[17],
    condDimsMm: r[18],
    evapPackageMm: r[19],
    condPackageMm: r[20],
    refrigerantRaw: r[21],
    refrigerantType: r[21],
    refrigerantChargeKg: r[22],
    liquidPipeIn: r[23],
    gasPipeIn: r[24],
    outdoorCoolingTempC: r[25],
    outdoorHeatingTempC: r[26],
    maxPipeLengthM: r[27],
    maxLevelDiffM: r[28],
    evapCoolOnlyModel: `EMPRC${r[0]}`,
    evapHeatCoolModel: `EMPRN${r[0]}`,
    condCoolOnlyModel: `CMPRC${r[0]}`,
    condHeatCoolModel: `CMPRN${r[0]}`,
    sourceUrl: urls.bright3,
    sourceFile: sourceFiles.bright3,
    sourceNote: "来源图未显示净重/毛重字段；保留为空。",
  })),

  ...[
    ["121-V3", "12K", 1, 12000, "3520 (800-4100)", "3520 (800-4100)", "115V/60Hz", 115, 1040, "9.1(2.0-11)", 1040, "9.2(2.2-11)", 1600, 11, 20, 1, "R32", 0.5, 4.3, 2.5, 600, 42, 8, 23, "Ventilador de Flujo Cruzado", "Φ102", 560, "761*295*200", "825*367*277", "711*538*280", "825*345*595"],
    ["122-V3", "12K", 1, 12000, "3520 (800-4100)", "3520 (800-4100)", "220V/60Hz", 220, 1200, "5.5(1.7-8.1)", 1020, "4.5(0.9-5.8)", 1350, 6, 20, 1, "R32", 0.58, 4.3, 2.5, 600, 42, 8, 24, "Ventilador de Flujo Cruzado", "Φ106", 620, "761*295*200", "825*367*277", "711*538*280", "825*345*595"],
    ["182-V3", "18K", 1.5, 18000, "5300 (4400-5300)", "5300 (4400-5300)", "220V/60Hz", 220, 1400, "6.2(1.9-8.4)", 1440, "6.3(1.4-8.3)", 2200, 12, 20, 1.6, "R32", 1.03, 4.3, 2.5, 1050, 49, 11.5, 28, "Ventilador de Flujo Cruzado", "Φ106", 715, "900*310*225", "970*382*302", "786*556*304", "903*382*615"],
    ["242-V3", "24K", 2, 24000, "7040 (1800-7600)", "7040 (1800-7600)", "220V/60Hz", 220, 2100, "10", 2200, "10", 3400, 16, 20, 2.36, "R32", 1.3, 4.3, 2.5, 1300, 50, 13, 31.5, "Ventilador de Flujo Cruzado", "Φ107.9", 839, "1082*330*233", "1155*397*312", "824*655*320", "945*400*715"],
  ].map((r) => base({
    series: "Vantage 3",
    modelKey: r[0],
    seerBadge: "SEER 20",
    capacityLabel: r[1],
    capacityTon: r[2],
    coolingCapacityBtu: r[3],
    heatingCapacityBtu: r[3],
    coolingCapacityRaw: r[4],
    heatingCapacityRaw: r[5],
    powerSupply: r[6],
    voltageNorm: r[7],
    coolingPowerW: r[8],
    coolingCurrentA: r[9],
    heatingPowerW: r[10],
    heatingCurrentA: r[11],
    maxInputW: r[12],
    maxCurrentA: r[13],
    seer: r[14],
    dehumidificationLh: r[15],
    refrigerantRaw: r[16],
    refrigerantType: r[16],
    refrigerantChargeKg: r[17],
    pressureHighMpa: r[18],
    pressureLowMpa: r[19],
    indoorAirflowM3h: r[20],
    indoorNoiseDb: r[21],
    evapNetKg: r[22],
    condNetKg: r[23],
    indoorFanType: r[24],
    indoorFanDiameterMm: r[25],
    indoorFanLengthMm: r[26],
    evapDimsMm: r[27],
    evapPackageMm: r[28],
    condDimsMm: r[29],
    condPackageMm: r[30],
    evapCoolOnlyModel: `EMPRC${r[0]}`,
    evapHeatCoolModel: `EMPRN${r[0]}`,
    condCoolOnlyModel: `CMPRC${r[0]}`,
    condHeatCoolModel: `CMPRN${r[0]}`,
    sourceUrl: urls.v3,
    sourceFile: sourceFiles.v3,
    sourceNote: "PDF 原表容量单位为 W；核心表制冷/制热量按 12K/18K/24K 容量标识记录为 BTU/h，W 原文保留在扩展表。",
  })),

  ...[
    ["121-U3", "12K", 1, 12000, "3520(1000-4100)", "3600", "115V / 60Hz", 115, 960, "8.5(1.7-8.1)", 850, "7.6(0.9-5.8)", 1600, 12.5, 22, 6.44, "46,77", 10, 1, "R32", "", 4.3, 2.5, 700, "Ventilador de flujo cruzado", "ø106", 620, "827*299*200", "711*538*280", "DG4 / 1/4", "DG8 / 3/8"],
    ["122-U3", "12K", 1, 12000, "3520(1000-4100)", "3600", "208-230V / 60Hz", 220, 880, "4.4(1.7-8.1)", 850, "4.3(0.9-5.8)", 1600, 10.5, 22, 6.44, "46,77", 10, 1, "R32", "", 4.3, 2.5, 690, "Ventilador de flujo cruzado", "ø106", 620, "827*299*200", "711*538*280", "DG4 / 1/4", "DG8 / 3/8"],
    ["182-U3", "18K", 1.5, 18000, "5300(4400-5300)", "5300(4400-5300)", "208-230V / 60Hz", 220, 1400, "6.2(1.9-8.4)", 1400, "6.3(1.4-8.3)", 2200, 12, 22, 6.44, "37,5", 9, 1.6, "R32", "", 4.3, 2.5, 1050, "Ventilador de flujo cruzado", "ø106", 715, "997*316*227", "786*556*304", "DG4 / 1/4", "DG10 / 1/2"],
    ["242-U3", "24K", 2, 24000, "7040(1800-7600)", "7040(1800-7600)", "208-230V / 60Hz", 220, 2000, "8.7", 2000, "8.7", 2800, 15, 22, 6.44, "37,5", 9, 1.8, "R32", "", 4.3, 2.5, 1300, "Ventilador de flujo cruzado", "ø107.9", 839, "1132*330*232", "894*700*360", "DG4 / 1/4", "DG13 / 5/8"],
  ].map((r) => base({
    series: "Ultra 3",
    modelKey: r[0],
    seerBadge: "SEER 22",
    capacityLabel: r[1],
    capacityTon: r[2],
    coolingCapacityBtu: r[3],
    heatingCapacityBtu: r[3],
    coolingCapacityRaw: r[4],
    heatingCapacityRaw: r[5],
    powerSupply: r[6],
    voltageNorm: r[7],
    coolingPowerW: r[8],
    coolingCurrentA: r[9],
    heatingPowerW: r[10],
    heatingCurrentA: r[11],
    maxInputW: r[12],
    maxCurrentA: r[13],
    seer: r[14],
    eer: r[15],
    energySavingPct: r[16],
    hspf: r[17],
    dehumidificationLh: r[18],
    refrigerantRaw: r[19],
    refrigerantType: r[19],
    refrigerantChargeKg: r[20],
    pressureHighMpa: r[21],
    pressureLowMpa: r[22],
    indoorAirflowM3h: r[23],
    indoorFanType: r[24],
    indoorFanDiameterMm: r[25],
    indoorFanLengthMm: r[26],
    evapDimsMm: r[27],
    condDimsMm: r[28],
    liquidPipeIn: r[29],
    gasPipeIn: r[30],
    evapCoolOnlyModel: `EMPRC${r[0]}`,
    evapHeatCoolModel: `EMPRN${r[0]}`,
    condCoolOnlyModel: `CMPRC${r[0]}`,
    condHeatCoolModel: `CMPRN${r[0]}`,
    sourceUrl: urls.ultra3,
    sourceFile: sourceFiles.ultra3,
    sourceNote: "PDF 原表容量单位为 W；核心表制冷/制热量按 12K/18K/24K 容量标识记录为 BTU/h，W 原文保留在扩展表。",
  })),
];

const coreHeaders = [
  "序号", "品牌", "系列", "型号/表头", "容量标识", "容量_Ton", "制冷量_BTU/h", "制热量_BTU/h",
  "电源/电压", "规范电压_V", "制冷功率_W", "制冷电流_A", "EEER/EER_W/W", "SEER/SEEER_W/W", "HSPF",
  "除湿量_L/h", "最大输入_W", "最大电流_A", "冷媒_原文", "冷媒类型_规范", "冷媒充注_kg",
  "蒸发器尺寸_mm", "冷凝器尺寸_mm", "蒸发器净重_kg", "冷凝器净重_kg", "室内噪音_dB(A)",
  "室外噪音_dB(A)", "室内风量_m3/h", "适用面积_m2", "液管_in", "气管_in", "蒸发器单冷型号",
  "蒸发器冷暖型号", "冷凝器单冷型号", "冷凝器冷暖型号", "来源文件", "来源URL", "网站录入年月_链接",
  "图片/PDF元数据时间", "备注",
];

const coreRows = rows.map((r, idx) => [
  idx + 1, r.brand, r.series, r.modelKey, r.capacityLabel ?? "", r.capacityTon ?? "", r.coolingCapacityBtu ?? "", r.heatingCapacityBtu ?? "",
  r.powerSupply ?? "", r.voltageNorm ?? "", r.coolingPowerW ?? "", r.coolingCurrentA ?? "", r.eer ?? "", r.seer ?? "", r.hspf ?? "",
  r.dehumidificationLh ?? "", r.maxInputW ?? "", r.maxCurrentA ?? "", r.refrigerantRaw ?? "", r.refrigerantType ?? "", r.refrigerantChargeKg ?? "",
  r.evapDimsMm ?? "", r.condDimsMm ?? "", r.evapNetKg ?? "", r.condNetKg ?? "", r.indoorNoiseDb ?? "",
  r.outdoorNoiseDb ?? "", r.indoorAirflowM3h ?? "", r.recommendedAreaM2 ?? "", r.liquidPipeIn ?? "", r.gasPipeIn ?? "", r.evapCoolOnlyModel ?? "",
  r.evapHeatCoolModel ?? "", r.condCoolOnlyModel ?? "", r.condHeatCoolModel ?? "", r.sourceFile, r.sourceUrl, r.siteUploadYm,
  r.exifTime, r.sourceNote ?? "",
]);

const extendedHeaders = [
  "系列", "型号/表头", "SEER等级标识", "容量标识", "制冷量原文", "制热量原文", "电源原文", "电压范围",
  "类型", "控制方式", "制冷功率_W", "制冷电流_A", "EEER/EER", "SEER/SEEER", "制热功率_W", "制热电流_A",
  "HSPF", "节能率", "除湿量_L/h", "高压_MPa", "低压_MPa", "室内噪音_高", "室内噪音_中", "室内噪音_低",
  "室内噪音_综合", "室外噪音", "最大输入_W", "最大电流_A", "压缩机", "冷媒原文", "冷媒类型", "冷媒充注_kg",
  "蒸发器管路", "冷凝器管路", "室内风量_m3/h", "室内风扇类型", "室内风机直径_mm", "室内风机长度_mm", "制冷风速_rpm", "制热风速_rpm", "干燥风速_rpm",
  "睡眠风速_rpm", "室内风机型号", "室内风机功率_W", "室外风机类型", "室外风机型号", "室外风速_rpm",
  "室外风机功率_W", "液管_in", "气管_in", "接线", "排水管", "制冷外温_C", "制热外温_C", "最大管长_m",
  "最大高差_m", "适用面积_m2", "蒸发器尺寸_mm", "冷凝器尺寸_mm", "蒸发器包装_mm", "冷凝器包装_mm",
  "蒸发器净重_kg", "冷凝器净重_kg", "蒸发器毛重_kg", "冷凝器毛重_kg", "来源文件", "网站录入年月_链接", "备注",
];

const extendedRows = rows.map((r) => [
  r.series, r.modelKey, r.seerBadge ?? "", r.capacityLabel ?? "", r.coolingCapacityRaw ?? r.coolingCapacityBtu ?? "", r.heatingCapacityRaw ?? r.heatingCapacityBtu ?? "", r.powerSupply ?? "", r.voltageRange ?? "",
  r.type ?? "", r.controlType ?? "", r.coolingPowerW ?? "", r.coolingCurrentA ?? "", r.eer ?? "", r.seer ?? "", r.heatingPowerW ?? "", r.heatingCurrentA ?? "",
  r.hspf ?? "", r.energySavingPct ?? "", r.dehumidificationLh ?? "", r.pressureHighMpa ?? "", r.pressureLowMpa ?? "", r.indoorNoiseHighDb ?? "", r.indoorNoiseMedDb ?? "", r.indoorNoiseLowDb ?? "",
  r.indoorNoiseDb ?? "", r.outdoorNoiseDb ?? "", r.maxInputW ?? "", r.maxCurrentA ?? "", r.compressorType ?? "", r.refrigerantRaw ?? "", r.refrigerantType ?? "", r.refrigerantChargeKg ?? "",
  r.evapPipe ?? "", r.condPipe ?? "", r.indoorAirflowM3h ?? "", r.indoorFanType ?? "", r.indoorFanDiameterMm ?? "", r.indoorFanLengthMm ?? "", r.indoorFanSpeedCoolingRpm ?? "", r.indoorFanSpeedHeatingRpm ?? "", r.indoorFanSpeedDryRpm ?? "",
  r.indoorFanSpeedSleepRpm ?? "", r.indoorFanMotorModel ?? "", r.indoorFanMotorPowerW ?? "", r.outdoorFanType ?? "", r.outdoorFanMotorModel ?? "", r.outdoorFanSpeedRpm ?? "",
  r.outdoorFanMotorPowerW ?? "", r.liquidPipeIn ?? "", r.gasPipeIn ?? "", r.wiring ?? "", r.drainPipe ?? "", r.outdoorCoolingTempC ?? "", r.outdoorHeatingTempC ?? "", r.maxPipeLengthM ?? "",
  r.maxLevelDiffM ?? "", r.recommendedAreaM2 ?? "", r.evapDimsMm ?? "", r.condDimsMm ?? "", r.evapPackageMm ?? "", r.condPackageMm ?? "",
  r.evapNetKg ?? "", r.condNetKg ?? "", r.evapGrossKg ?? "", r.condGrossKg ?? "", r.sourceFile, r.siteUploadYm, r.sourceNote ?? "",
]);

const modelMapHeaders = ["系列", "型号/表头", "容量标识", "容量_Ton", "制冷量_BTU/h", "蒸发器单冷", "蒸发器冷暖", "冷凝器单冷", "冷凝器冷暖", "备注"];
const modelMapRows = rows.map((r) => [
  r.series, r.modelKey, r.capacityLabel ?? "", r.capacityTon ?? "", r.coolingCapacityBtu ?? "", r.evapCoolOnlyModel ?? "", r.evapHeatCoolModel ?? "", r.condCoolOnlyModel ?? "", r.condHeatCoolModel ?? "",
  r.series === "Bright 1" ? "来源图未显示型号代码，未推断。" : "",
]);

const featureRows = [
  ["A1 Advanced", "SEER 18 / SEER 18.01", "图片标题标注 SEER 18，参数表 SEER 为 18.01。", urls.a1, uploadYm(urls.a1), "SEER 18；SEER (Enfriamiento) 18,01"],
  ["A1 Advanced", "36K 冷暖/单冷型号齐全", "参数表提供蒸发器/冷凝器的单冷与冷暖型号。", urls.a1, uploadYm(urls.a1), "EMPRC/EMPRN/CMPRC/CMPRN362-A1"],
  ["Bright 1", "Inverter Bright", "图片标题和机身标注 inverter / BRIGHT。", urls.bright1, uploadYm(urls.bright1), "INVERTER BRIGHT / inverter"],
  ["Bright 1", "Ahorro Energía", "表格给出节能率 13.2%~23.9%。", urls.bright1, uploadYm(urls.bright1), "Ahorro Energía*"],
  ["Bright 1", "SEEER 18.01~18.58", "简版表格给出 SEEER 指标。", urls.bright1, uploadYm(urls.bright1), "SEEER"],
  ["R3 Advanced", "SEER 18 / SEER 20", "12K 型号标注 SEER 18，18K/24K 标注 SEER 20。", urls.r3, uploadYm(urls.r3), "SEER 18 / SEER 20"],
  ["R3 Advanced", "R32 冷媒", "所有 R3 型号冷媒为 R32，并列出充注量。", urls.r3, uploadYm(urls.r3), "R32/500g, R32/475g, R32/670g, R32/1040g"],
  ["R3 Advanced", "宽电压范围", "115V 型号范围 105~125V；220V 型号范围 165~265V。", urls.r3, uploadYm(urls.r3), "Rango de voltaje"],
  ["Bright 3", "Inverter Bright 3", "图片标题和机身标注 inverter。", urls.bright3, uploadYm(urls.bright3), "BRIGHT 3 / inverter"],
  ["Bright 3", "R32 冷媒", "所有 Bright 3 型号冷媒为 R32，并列出 kg 级充注量。", urls.bright3, uploadYm(urls.bright3), "Tipo de refrigerante R32"],
  ["Bright 3", "SEER 18.01~20.58 / HSPF 8.6", "制冷 SEER 与制热 HSPF 均在图中参数表给出。", urls.bright3, uploadYm(urls.bright3), "SEER / HSPF"],
  ["Vantage 3", "Super Silencioso", "PDF 功能页说明通过软硬件降低噪音。", urls.v3, uploadYm(urls.v3), "Super Silencioso"],
  ["Vantage 3", "SEER 20", "PDF 功能页标注 SEER 20。", urls.v3, uploadYm(urls.v3), "SEER 20"],
  ["Vantage 3", "GoldShield 抗腐蚀涂层", "PDF 说明适用于腐蚀、潮湿、盐雾环境，并提升制冷速度。", urls.v3, uploadYm(urls.v3), "Recubrimiento Anticorrosivo GoldShield"],
  ["Vantage 3", "Gas Ecológico R32", "PDF 说明 R32 低全球变暖影响、用量更少、能效更高、零臭氧影响。", urls.v3, uploadYm(urls.v3), "Gas Ecológico R32"],
  ["Vantage 3", "WIFI READY", "PDF 标注 WiFi 通信接口为可选。", urls.v3, uploadYm(urls.v3), "WIFI READY / Interface de Comunicación WIFI (Opcional)"],
  ["Ultra 3", "SEER 22", "PDF 功能页和参数页均标注 SEER 22。", urls.ultra3, uploadYm(urls.ultra3), "SEER 22"],
  ["Ultra 3", "Tecnología Light Breeze", "PDF 说明微孔出风，减少直吹体感。", urls.ultra3, uploadYm(urls.ultra3), "Tecnología Light Breeze con Microporos Inteligentes"],
  ["Ultra 3", "WiFi 远程控制", "PDF 说明可远程智能控制开关机。", urls.ultra3, uploadYm(urls.ultra3), "WIFI / Controla a larga distancia"],
  ["Ultra 3", "Gas Ecológico R32", "PDF 说明 R32 低全球变暖影响、用量更少、能效更高、零臭氧影响。", urls.ultra3, uploadYm(urls.ultra3), "Gas Ecológico R32"],
  ["Ultra 3", "GoldShield + 自动清洁 + 防电压峰值", "PDF 同时列出 GoldShield、自清洁和电压峰值保护。", urls.ultra3, uploadYm(urls.ultra3), "GoldShield / Auto Limpieza / Protección de Tarjeta Contra Picos de Voltaje"],
];

const sourceRows = [
  ["来源", "URL/文件", "网站录入年月_链接", "图片/PDF元数据时间", "本次用途", "口径说明"],
  ["A1_ADVANCED_POPUP.jpg", urls.a1, uploadYm(urls.a1), exifTimes[urls.a1], "A1 Advanced 362-A1 详细参数", "URL 中 /2025/06/ 作为网站录入年月；参数按图片表格逐项录入。"],
  ["BRIGHT-1.jpg", urls.bright1, uploadYm(urls.bright1), exifTimes[urls.bright1], "Bright 1 简版核心参数", "URL 中 /2023/10/ 作为网站录入年月；图片未显示型号代码和扩展字段。"],
  ["R3_ADVANCED_POPUP.jpg", urls.r3, uploadYm(urls.r3), exifTimes[urls.r3], "R3 Advanced 4 个型号详细参数", "URL 中 /2025/06/ 作为网站录入年月；参数按图片表格逐项录入。"],
  ["BRIGHT_3_POPUP.jpg", urls.bright3, uploadYm(urls.bright3), exifTimes[urls.bright3], "Bright 3 5 个型号详细参数", "URL 中 /2025/11/ 作为网站录入年月；EXIF 显示制作时间为 2025:10:30，仅作参考。"],
  ["FICHA_V3_compressed.pdf", urls.v3, uploadYm(urls.v3), exifTimes[urls.v3], "Vantage 3 4 个型号详细参数与功能卖点", "URL 中 /2026/05/ 作为网站录入年月；PDF 元数据时间仅作审计参考。"],
  ["SEER22_ULTRA_compressed.pdf", urls.ultra3, uploadYm(urls.ultra3), exifTimes[urls.ultra3], "Ultra 3 4 个型号详细参数与功能卖点", "URL 中 /2026/05/ 作为网站录入年月；PDF 元数据时间仅作审计参考。"],
  ["采集时间", timestamp, "", "", "文件命名与审计", "本次新建汇总文件，不覆盖历史文件。"],
];

const anomalyRows = [
  ["级别", "系列", "型号/表头", "字段", "源值", "检查说明", "处理建议"],
  ["需复核", "A1 Advanced", "362-A1", "适用面积_m2", "15~23", "36K/3Ton 来源图显示 15~23 m²，明显低于同批次其他大容量机型常见区间；已按源图保留。", "录入网站前建议复核品牌原始资料或厂家确认。"],
  ["信息", "Bright 1", "全部", "型号代码/扩展字段", "未显示", "BRIGHT-1 图片为简版表格，仅有能效、功率、电压、冷媒、尺寸、重量等核心字段。", "不推断 EMPR/CMPR 型号代码；后续有资料时再补。"],
  ["信息", "Bright 3", "全部", "网站录入年月 vs EXIF", "链接 2025-11；EXIF 2025:10:30", "链接年月和图片制作时间不同；本表按用户要求保存链接中的产品信息录入年月。", "网站录入时间字段采用 2025-11，EXIF 仅留存审计。"],
  ["信息", "Bright 3", "全部", "重量字段", "未显示", "BRIGHT_3_POPUP 图片未显示蒸发器/冷凝器净重和毛重。", "对应字段留空。"],
  ["信息", "Vantage 3 / Ultra 3", "全部", "容量单位", "PDF 原表为 W", "两个 PDF 参数页容量原文字段为 W；核心表为了和前批次统一，按 12K/18K/24K 型号标识记录 BTU/h，W 原文放在扩展表。", "如需要严格工程单位，可在后续版本增加“制冷量_W/制热量_W”核心列。"],
  ["信息", "Vantage 3", "全部", "功率单位", "表格单位栏显示 KW，但数值为 1040/1200/1400/2100 等 W 级数值", "PDF 表头单位疑似排版/OCR 不一致；本表按 W 录入。", "按源图保留原文在扩展表，核心字段以 W 计。"],
  ["需复核", "Ultra 3", "121-U3", "电流范围", "Frío 8.5(1.7-8.1) / Calor 7.6(0.9-5.8)", "标称值大于括号范围上限，可能为源文件排版或识别异常；已按 PDF 可见值保留。", "录入前建议复核原始 PDF 或厂家资料。"],
  ["信息", "Ultra 3", "全部", "HSPF/系统行", "10 / 10 / HSPF 9.0 / HSPF 9", "PDF 该行标签和数值呈混合显示，本表将其归入 HSPF 字段并保留源值。", "若网站字段不需要 HSPF，可仅作备注。"],
];

function setValues(sheet, row, col, data) {
  const endCol = colName(col + data[0].length - 1);
  const endRow = row + data.length - 1;
  sheet.getRange(`${colName(col)}${row}:${endCol}${endRow}`).values = data;
}

function styleTitle(sheet, rangeAddress) {
  const range = sheet.getRange(rangeAddress);
  range.format.font.bold = true;
  range.format.font.size = 16;
  range.format.font.color = "#FFFFFF";
  range.format.fill.color = "#174E96";
}

function styleSubtitle(sheet, rangeAddress) {
  const range = sheet.getRange(rangeAddress);
  range.format.font.italic = true;
  range.format.font.color = "#40546A";
  range.format.wrapText = true;
}

function styleHeader(sheet, rangeAddress) {
  const range = sheet.getRange(rangeAddress);
  range.format.font.bold = true;
  range.format.font.color = "#FFFFFF";
  range.format.fill.color = "#1F5FA8";
  range.format.wrapText = true;
}

function addTable(sheet, startRow, headers, body, name) {
  const endCol = colName(headers.length);
  const endRow = startRow + body.length;
  const address = `A${startRow}:${endCol}${endRow}`;
  sheet.tables.add(address, true, name).showBandedRows = true;
  return address;
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

async function writeCsv(rowsForCsv, filePath) {
  await fs.writeFile(filePath, `${rowsForCsv.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`, "utf8");
}

const workbook = Workbook.create();
const core = workbook.worksheets.add("汇总_核心参数");
const ext = workbook.worksheets.add("扩展参数_图片PDF");
const modelMap = workbook.worksheets.add("型号映射");
const features = workbook.worksheets.add("功能卖点");
const sources = workbook.worksheets.add("来源与口径");
const anomalies = workbook.worksheets.add("异常检查");

function buildSheet(sheet, title, subtitle, headers, body, tableName, widths) {
  const endCol = colName(headers.length);
  setValues(sheet, 1, 1, [[title, ...Array(headers.length - 1).fill("")]]);
  sheet.getRange(`A1:${endCol}1`).merge();
  styleTitle(sheet, `A1:${endCol}1`);
  setValues(sheet, 2, 1, [[subtitle, ...Array(headers.length - 1).fill("")]]);
  sheet.getRange(`A2:${endCol}2`).merge();
  styleSubtitle(sheet, `A2:${endCol}2`);
  setValues(sheet, 4, 1, [headers, ...body]);
  styleHeader(sheet, `A4:${endCol}4`);
  addTable(sheet, 4, headers, body, tableName);
  sheet.freezePanes.freezeRows(4);
  sheet.getRange(`A:${endCol}`).format.wrapText = true;
  setWidths(sheet, widths);
}

buildSheet(
  core,
  "Prime 空调参数汇总（A1 Advanced + Bright 1 + R3 Advanced + Bright 3 + Vantage 3 + Ultra 3）",
  "六个产品来源汇总在一起；链接中的网站录入年月已结构化保存，简版图/PDF差异字段留空并备注。",
  coreHeaders,
  coreRows,
  "PrimeAirconCoreNewBatch",
  { A: 55, B: 80, C: 120, D: 125, E: 120, F: 80, G: 110, H: 110, I: 150, J: 85, K: 95, L: 95, M: 95, N: 115, O: 80, P: 95, Q: 90, R: 90, S: 125, T: 105, U: 95, V: 135, W: 135, X: 105, Y: 105, Z: 120, AA: 100, AB: 125, AC: 95, AD: 80, AE: 80, AF: 125, AG: 125, AH: 125, AI: 125, AJ: 210, AK: 330, AL: 125, AM: 145, AN: 360 }
);

buildSheet(
  ext,
  "图片/PDF扩展参数明细",
  "保留图片和 PDF 可见的细字段；Bright 1 为简版图，扩展项为空值较多。",
  extendedHeaders,
  extendedRows,
  "PrimeAirconImageExtended",
  { A: 120, B: 125, C: 95, D: 110, E: 150, F: 150, G: 150, H: 95, I: 90, J: 90, K: 95, L: 95, M: 90, N: 105, O: 95, P: 95, Q: 80, R: 85, S: 95, T: 85, U: 85, V: 85, W: 85, X: 85, Y: 110, Z: 85, AA: 90, AB: 90, AC: 95, AD: 120, AE: 95, AF: 95, AG: 95, AH: 95, AI: 120, AJ: 120, AK: 190, AL: 190, AM: 95, AN: 95, AO: 145, AP: 95, AQ: 95, AR: 145, AS: 95, AT: 95, AU: 80, AV: 80, AW: 170, AX: 95, AY: 95, AZ: 95, BA: 95, BB: 95, BC: 95, BD: 135, BE: 135, BF: 135, BG: 135, BH: 100, BI: 100, BJ: 100, BK: 100, BL: 210, BM: 125, BN: 350 }
);

buildSheet(
  modelMap,
  "型号映射",
  "按蒸发器/冷凝器、单冷/冷暖拆分；Bright 1 来源图未显示型号代码。",
  modelMapHeaders,
  modelMapRows,
  "PrimeAirconModelMapNewBatch",
  { A: 120, B: 125, C: 120, D: 80, E: 110, F: 140, G: 140, H: 140, I: 140, J: 320 }
);

buildSheet(
  features,
  "功能卖点",
  "基于图片可见文案和参数字段整理，不额外臆造未出现的宣传语。",
  ["产品/系列", "功能/卖点", "整理说明", "来源URL", "网站录入年月_链接", "证据字段"],
  featureRows,
  "PrimeAirconFeaturePointsNewBatch",
  { A: 130, B: 230, C: 520, D: 360, E: 125, F: 260 }
);

buildSheet(
  sources,
  "来源与口径说明",
  "记录来源 URL、链接年月、EXIF 时间、抽取用途和口径说明。",
  sourceRows[0],
  sourceRows.slice(1),
  "PrimeAirconSourcesNewBatch",
  { A: 190, B: 520, C: 125, D: 150, E: 260, F: 640 }
);

buildSheet(
  anomalies,
  "异常检查",
  "将需要复核、来源限制和时间口径差异单独列出，避免混入正常参数。",
  anomalyRows[0],
  anomalyRows.slice(1),
  "PrimeAirconAnomaliesNewBatch",
  { A: 85, B: 120, C: 130, D: 145, E: 190, F: 560, G: 360 }
);

sources.getRange("5:12").format.rowHeightPx = 48;
anomalies.getRange("5:12").format.rowHeightPx = 58;

await fs.mkdir(outDir, { recursive: true });
const xlsxPath = path.join(outDir, `01_Prime空调参数汇总_${timestamp}.xlsx`);
const csvPath = path.join(outDir, `02_Prime空调参数汇总_${timestamp}.csv`);
await writeCsv([coreHeaders, ...coreRows], csvPath);

const coreInspect = await workbook.inspect({
  kind: "table",
  range: `汇总_核心参数!A4:${colName(coreHeaders.length)}27`,
  include: "values",
  tableMaxRows: 26,
  tableMaxCols: 40,
});
console.log(coreInspect.ndjson);

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
});
console.log(errorScan.ndjson);

const renderTargets = [
  ["汇总_核心参数", `A1:${colName(coreHeaders.length)}27`, "render_new_core.png"],
  ["扩展参数_图片PDF", `A1:${colName(extendedHeaders.length)}27`, "render_new_extended.png"],
  ["功能卖点", "A1:F26", "render_new_features.png"],
  ["异常检查", "A1:G13", "render_new_anomalies.png"],
];
for (const [sheetName, range, fileName] of renderTargets) {
  const blob = await workbook.render({ sheetName, range, scale: 1.05 });
  await fs.writeFile(path.join(root, "outputs", "prime_aircon_summary_build", fileName), Buffer.from(await blob.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(xlsxPath);
console.log(`WROTE_XLSX=${xlsxPath}`);
console.log(`WROTE_CSV=${csvPath}`);
