import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "data", "normalized_skus");
const OUT_JSON = path.join(OUT_DIR, "latest_normalized_skus.json");
const OUT_CSV = path.join(OUT_DIR, "latest_normalized_skus.csv");
const DB_PATH = path.join(ROOT, "data", "ac_price_monitor_mexico_v2.db");
const EXTRACTION_VERSION = "sku-normalizer-v1";
const MONTERREY_TZ = "America/Monterrey";

const SITE_CONFIG = [
  { id: "coppel", label: "Coppel", latestPath: "data/coppel/latest_products.json" },
  { id: "elektra", label: "Elektra", latestPath: "data/elektra/latest_products.json" },
  { id: "homedepotmx", label: "HomeDepotMX", latestPath: "data/homedepotmx/latest_products.json" },
  { id: "walmartmx", label: "WalmartMX", latestPath: "data/walmartmx/latest_products.json" },
];

const KNOWN_BRANDS = [
  "MIRAGE",
  "MIDEA",
  "MABE",
  "LG",
  "HISENSE",
  "WHIRLPOOL",
  "SAMSUNG",
  "PRIME",
  "YORK",
  "AURUS",
  "HKPRO",
  "TCL",
  "IUSA",
  "FRIKKO",
  "CARRIER",
  "RHEEM",
  "PANASONIC",
  "HONEYWELL",
  "TOSHIBA",
  "DAEWOO",
  "FROZEN",
  "AIWA",
  "COMFEE",
  "AUX",
  "LENOMEX",
];

const SERIES_RULES = [
  { brand: "PRIME", series: "Elite 2", patterns: [/\bELITE\s*2\b/, /\bE2\b/], confidence: "high" },
  { brand: "PRIME", series: "Elite 4", patterns: [/\bELITE\s*4\b/, /\bE4\b/], confidence: "high" },
  { brand: "PRIME", series: "Trendy K", patterns: [/\bTRENDY\s*K\b/], confidence: "high" },
  { brand: "PRIME", series: "Trendy 3", patterns: [/\bTRENDY\s*3\b/, /\bT3\b/], confidence: "high" },
  { brand: "PRIME", series: "Bright 3", patterns: [/\bBRIGHT\s*3\b/, /\bB3\b/], confidence: "high" },
  { brand: "PRIME", series: "Bright", patterns: [/\bBRIGHT\b/], confidence: "medium" },
  { brand: "PRIME", series: "A1 Advanced", patterns: [/\bA1\s*ADVANCED\b/, /\bA1\b/], confidence: "high" },
  { brand: "PRIME", series: "R3 Advanced", patterns: [/\bR3\s*ADVANCED\b/, /\bR3\b/], confidence: "high" },
  { brand: "PRIME", series: "Vantage 3", patterns: [/\bVANTAGE\s*3\b/, /\bV3\b/], confidence: "high" },
  { brand: "PRIME", series: "Ultra 3", patterns: [/\bULTRA\s*3\b/, /\bU3\b/], confidence: "high" },
  { brand: "PRIME", series: "Estandar", patterns: [/\bESTANDAR\b/], confidence: "medium" },

  { brand: "MIRAGE", series: "XR", patterns: [/\bXR\b/], confidence: "high" },
  { brand: "MIRAGE", series: "NEX", patterns: [/\bNEX\b/], confidence: "high" },
  { brand: "MIRAGE", series: "X Life", patterns: [/\bX\s*LIFE\b/, /\bXLIFE\b/], confidence: "high" },
  { brand: "MIRAGE", series: "Life12 Plus", patterns: [/\bLIFE\s*12\s*PLUS\b/], confidence: "high" },
  { brand: "MIRAGE", series: "V32", patterns: [/\bV32\b/], confidence: "high" },
  { brand: "MIRAGE", series: "X32", patterns: [/\bX32\b/], confidence: "high" },

  { brand: "MIDEA", series: "Fresh", patterns: [/\bFRESH\b/], confidence: "high" },
  { brand: "MIDEA", series: "EcoMaster", patterns: [/\bECO\s*MASTER\b/, /\bECOMASTER\b/], confidence: "high" },
  { brand: "MIDEA", series: "Comfee Aurora", patterns: [/\bCOMFEE\s*AURORA\b/, /\bAURORA\b/], confidence: "medium" },
  { brand: "MIDEA", series: "Xtreme Save", patterns: [/\bXTREME\s*SAVE\b/], confidence: "medium" },

  { brand: "LG", series: "Dual Cool AI Air", patterns: [/\bDUAL\s*COOL\s*AI\s*AIR\b/], confidence: "high" },
  { brand: "LG", series: "Dual Cool", patterns: [/\bDUAL\s*COOL\b/], confidence: "high" },
  { brand: "LG", series: "Comfort Sleep", patterns: [/\bCOMFORT\s*SLEEP\b/], confidence: "medium" },
  { brand: "LG", series: "Jet Cool", patterns: [/\bJET\s*COOL\b/], confidence: "medium" },
  { brand: "LG", series: "ThinQ", patterns: [/\bTHINQ\b/], confidence: "medium" },

  { brand: "WHIRLPOOL", series: "Xpert Energy Saver", patterns: [/\bXPERT\s*ENERGY\s*SAVER\b/], confidence: "high" },
  { brand: "WHIRLPOOL", series: "Classic On/Off", patterns: [/\bCLASSIC\s*ON\s*OFF\b/, /\bCLASSIC\s*ON\/OFF\b/], confidence: "high" },

  { brand: "SAMSUNG", series: "WindFree", patterns: [/\bWIND\s*FREE\b/, /\bWINDFREE\b/], confidence: "high" },
  { brand: "SAMSUNG", series: "Wind", patterns: [/\bWIND\b/], confidence: "medium" },

  { brand: "MABE", series: "3D Air Flow", patterns: [/\b3D\s*AIR\s*FLOW\b/], confidence: "high" },
  { brand: "MABE", series: "WiFi Ready", patterns: [/\bWIFI\s*READY\b/, /\bWI-FI\s*READY\b/], confidence: "medium" },

  { brand: "IUSA", series: "Primo", patterns: [/\bPRIMO\b/], confidence: "high" },
  { brand: "AURUS", series: "Serie L", patterns: [/\bSERIE\s*L\b/], confidence: "high" },
  { brand: "HISENSE", series: "R32 WiFi", patterns: [/\bR32\b(?=.*\bWI\s*FI\b)|\bR32\b(?=.*\bWIFI\b)/], confidence: "medium" },
];

const MODEL_FAMILY_RULES = [
  { brand: "PRIME", pattern: /\bEMPR[CN]?\d{3}-([A-Z0-9]+)\b/, family: (match) => primeSeriesFromSuffix(match[1]) },
  { brand: "MIRAGE", pattern: /\b(SETC[A-Z]{2})\d{3}[A-Z]?\b/, family: (match) => `${match[1]} family` },
  { brand: "MABE", pattern: /\b(MMI|MMT|PTM)\d{2}[A-Z0-9]+\b/, family: (match) => `${match[1]} family` },
  { brand: "MIDEA", pattern: /\b(MAS|MAP|MAW|CAS)\d{2}[A-Z0-9]+\b/, family: (match) => `${match[1]} family` },
  { brand: "HISENSE", pattern: /\b(AC|AT|ART|AU|AH)\d{3}[A-Z0-9]+\b/, family: (match) => `${match[1]} family` },
  { brand: "SAMSUNG", pattern: /\b(AR\d{2}[A-Z0-9]+)(?:\/AX)?\b/, family: (match) => `${match[1].slice(0, 4)} family` },
  { brand: "LG", pattern: /\b([A-Z]{1,3}\d{3}[A-Z0-9]*)\b/, family: (match) => `${match[1].replace(/\d.*$/, "")} family` },
  { brand: "WHIRLPOOL", pattern: /\b(WA\d{4}Q|SWA\d{4}Q)\b/, family: (match) => `${match[1].replace(/\d.*/, "")} family` },
  { brand: "AURUS", pattern: /\b(ARU32|ARU)\b/, family: (match) => `${match[1]} family` },
  { brand: "HKPRO", pattern: /\b(HKMS[A-Z0-9-]+)\b/, family: () => "HKMS family" },
  { brand: "TCL", pattern: /\b(S\d{2}P-[A-Z0-9]+)\b/, family: () => "S-P family" },
];

const PRODUCT_TYPE_LABELS = {
  minisplit: "Minisplit",
  window: "Ventana",
  portable_ac: "Portatil AC",
  air_cooler_fan: "Ventilador/Enfriador",
  accessory: "Accesorio",
  other_ac: "Aire acondicionado",
  other: "Otros",
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function latinUpper(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.products)) return value.products;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function sha1Hex(value) {
  return crypto.createHash("sha1").update(String(value), "utf8").digest("hex");
}

function canonicalPidFromReadable(pidReadable) {
  return sha1Hex(pidReadable).slice(0, 16);
}

function websiteLabel(siteId) {
  return SITE_CONFIG.find((site) => site.id === siteId)?.label || siteId;
}

function pickFirst(row, keys) {
  for (const key of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, key) && row[key] !== "" && row[key] !== null) {
      return row[key];
    }
  }
  return null;
}

function primaryProductKey(row) {
  return normalizeText(
    pickFirst(row, ["product_id", "sku_id", "pdp_sku", "ldjson_sku", "detail_model", "product_url", "link"]),
  );
}

function canonicalId(siteLabel, primaryKey) {
  if (!siteLabel || !primaryKey) return null;
  return canonicalPidFromReadable(`PID::SPK::${siteLabel}::${primaryKey}`);
}

function toDateInTimeZone(isoOrDate, timeZone) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((part) => part.type === "year")?.value;
  const m = parts.find((part) => part.type === "month")?.value;
  const d = parts.find((part) => part.type === "day")?.value;
  return y && m && d ? `${y}-${m}-${d}` : null;
}

function toSqliteUtcDatetime(isoOrDate) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(String(isoOrDate));
  if (Number.isNaN(date.getTime())) return null;
  const pad2 = (n) => String(n).padStart(2, "0");
  const pad3 = (n) => String(n).padStart(3, "0");
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}` +
    ` ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}.` +
    `${pad3(date.getUTCMilliseconds())}`
  );
}

function extractBrand(row, titleNorm) {
  const explicit = latinUpper(pickFirst(row, ["brand", "ldjson_brand_name"]));
  if (explicit) {
    const known = KNOWN_BRANDS.find((brand) => explicit.includes(brand));
    return { brand: known || explicit, confidence: known ? "high" : "medium", source: "explicit" };
  }
  const found = KNOWN_BRANDS.find((brand) => new RegExp(`(^|[^A-Z0-9])${brand}([^A-Z0-9]|$)`).test(titleNorm));
  return found
    ? { brand: found, confidence: "medium", source: "title" }
    : { brand: null, confidence: "unknown", source: "missing" };
}

function extractProductType(titleNorm) {
  const hasCapacityHint =
    /\b(1\/2|3\/4)\s*(?:TONELADAS?|TONS?|TON|T)\b/.test(titleNorm) ||
    /\b\d+(?:[.,]\d+)?\s*(?:TONELADAS?|TONS?|TON\b|T\b)\b/.test(titleNorm) ||
    /\b(\d{1,3}(?:[,. ]?\d{3})|\d{4,5})\s*(?:BTU(?:\/H)?|BTUS|BTU'S|BTU´S)\b/.test(titleNorm);
  const accessory =
    /\b(CUBIERTA|DEFLECTOR|REJILLA|MANGUERA|ADAPTADOR|KIT|SOPORTE|FILTRO|CONTROL REMOTO|FUNDA|PANEL(?:ES)? LATERAL|LIMPIEZA|TUBO|SALIDA DE AIRE|VENTILACION DE AIRE|MOLDURA|CLIP|BOLSA)\b/.test(
      titleNorm,
    );
  if (accessory && (!hasCapacityHint || /^(CONTROL REMOTO|CUBIERTA|DEFLECTOR|REJILLA|MANGUERA|ADAPTADOR|KIT|SOPORTE|FILTRO|FUNDA)\b/.test(titleNorm))) {
    return { productType: "accessory", isAirConditioner: false, confidence: "high" };
  }
  if (/\b(VENTILADOR|ENFRIADOR|AIRE LAVADO|AIR COOLER|HUMIDIFICADOR|CALEFACTOR)\b/.test(titleNorm)) {
    return { productType: "air_cooler_fan", isAirConditioner: false, confidence: "high" };
  }
  if (/\b(MINISPLIT|MINI SPLIT|MINI-SPLIT|SPLIT)\b/.test(titleNorm)) {
    return { productType: "minisplit", isAirConditioner: true, confidence: "high" };
  }
  if (/\bVENTANA\b/.test(titleNorm)) {
    return { productType: "window", isAirConditioner: true, confidence: "high" };
  }
  if (/\bPORTATIL\b/.test(titleNorm)) {
    return { productType: "portable_ac", isAirConditioner: true, confidence: "medium" };
  }
  if (/\bAIRE ACOND|\bA\/C\b|\bACONDICIONADO\b/.test(titleNorm)) {
    return { productType: "other_ac", isAirConditioner: true, confidence: "medium" };
  }
  return { productType: "other", isAirConditioner: false, confidence: "low" };
}

function extractBtu(titleNorm) {
  const mil = titleNorm.match(/\b(\d{1,2})\s*MIL\s*BTU\b/);
  if (mil) return { btu: Number(mil[1]) * 1000, source: "mil_btu", confidence: "medium" };

  const btuMatch = titleNorm.match(/\b(\d{1,3}(?:[,. ]?\d{3})|\d{4,5})\s*(?:BTU(?:\/H)?|BTUS|BTU'S|BTU´S)\b/);
  if (btuMatch) {
    const btu = Number(btuMatch[1].replace(/[,. ]/g, ""));
    if (Number.isFinite(btu) && btu >= 5000 && btu <= 60000) {
      return { btu, source: "title_btu", confidence: "high" };
    }
  }

  const kMatch = titleNorm.match(/\b(12|18|24|36)\s*K\b/);
  if (kMatch) return { btu: Number(kMatch[1]) * 1000, source: "k_capacity", confidence: "medium" };
  return { btu: null, source: null, confidence: "unknown" };
}

function extractTon(titleNorm, btuInfo) {
  const fraction = titleNorm.match(/\b(1\/2|3\/4)\s*(?:TONELADAS?|TONS?|TON|T)\b/);
  if (fraction) {
    const ton = fraction[1] === "3/4" ? 0.75 : 0.5;
    return reconcileTonWithBtu({ ton, source: "fraction_ton", confidence: "medium" }, btuInfo);
  }

  const tonMatch =
    titleNorm.match(/(?:^|[^/0-9])(\d+(?:[.,]\d+)?)\s*(?:TONELADAS?|TONS?|TON\b)\b/) ||
    titleNorm.match(/(?:^|[^/0-9])(\d+(?:[.,]\d+)?)\s*T\b/);
  if (tonMatch) {
    const raw = tonMatch[1];
    const ton = Number(raw.replace(",", "."));
    if (Number.isFinite(ton) && ton > 0 && ton <= 5) {
      return reconcileTonWithBtu({ ton: round(ton, 2), source: "title_ton", confidence: "high" }, btuInfo);
    }
  }

  if (btuInfo.btu) {
    return { ton: round(btuInfo.btu / 12000, 2), source: "btu_derived", confidence: btuInfo.confidence };
  }
  return { ton: null, source: null, confidence: "unknown" };
}

function reconcileTonWithBtu(tonInfo, btuInfo) {
  if (!btuInfo.btu) return tonInfo;
  const btuTon = round(btuInfo.btu / 12000, 2);
  if (Math.abs(btuTon - tonInfo.ton) > 0.2) {
    return {
      ton: btuTon,
      source: "btu_derived_conflict",
      confidence: "medium",
      conflict: { titleTon: tonInfo.ton, btuDerivedTon: btuTon },
    };
  }
  return tonInfo;
}

function extractVoltage(titleNorm) {
  const values = [...titleNorm.matchAll(/\b(110|115|120|127|208|220|230)\s*V\b/g)].map((match) => Number(match[1]));
  const unique = [...new Set(values)];
  if (!unique.length) {
    return { voltageV: null, voltageClass: null, voltageValues: [], confidence: "unknown" };
  }
  const classes = [...new Set(unique.map((value) => (value < 150 ? "110-127V" : "220-230V")))];
  return {
    voltageV: unique[0],
    voltageClass: classes.length === 1 ? classes[0] : "multiple",
    voltageValues: unique,
    confidence: classes.length === 1 ? "high" : "medium",
  };
}

function extractInverter(titleNorm) {
  if (/\bINVERTER\b|\bDUAL\s*INVERTER\b|\bSMART\s*INVERTER\b/.test(titleNorm)) {
    return { inverter: true, confidence: "high" };
  }
  if (/\bON\s*OFF\b|\bON\/OFF\b|\bCONVENCIONAL\b|\bTRADICIONAL\b|\bROTATIVO\b|\bESTANDAR\b/.test(titleNorm)) {
    return { inverter: false, confidence: "medium" };
  }
  return { inverter: null, confidence: "unknown" };
}

function extractCoolingMode(titleNorm) {
  if (/\bFRIO\s*(?:Y|\/|-)?\s*CALOR\b|\bF\/CALOR\b|\bFRIOCALOR\b|\bHEAT\s*COOL\b/.test(titleNorm)) {
    return { coolingMode: "frio_calor", confidence: "high" };
  }
  if (/\bSOLO\s*FRIO\b|\bS\/\s*FRIO\b|\bS\s*FRIO\b|\bSOLOFRIO\b/.test(titleNorm)) {
    return { coolingMode: "solo_frio", confidence: "high" };
  }
  if (/\bFRIO\b/.test(titleNorm)) {
    return { coolingMode: "solo_frio", confidence: "low" };
  }
  return { coolingMode: null, confidence: "unknown" };
}

function extractRefrigerant(titleNorm) {
  if (/\bR32\b/.test(titleNorm)) return { refrigerant: "R32", confidence: "high" };
  if (/\bR410A?\b/.test(titleNorm)) return { refrigerant: "R410A", confidence: "high" };
  return { refrigerant: null, confidence: "unknown" };
}

function extractWifi(titleNorm) {
  if (/\bWI\s*FI\b|\bWIFI\b|\bWI-FI\b/.test(titleNorm)) return { wifi: true, confidence: "high" };
  return { wifi: null, confidence: "unknown" };
}

function extractSeer(titleNorm) {
  const match = titleNorm.match(/\bSEER\s*(\d+(?:[.,]\d+)?)\b/);
  if (!match) return { seer: null, confidence: "unknown" };
  return { seer: Number(match[1].replace(",", ".")), confidence: "medium" };
}

function extractModelCode(titleNorm) {
  const candidates = [...titleNorm.matchAll(/\b[A-Z]{1,8}[A-Z0-9]{1,12}(?:[-/][A-Z0-9]{1,8})?\b/g)]
    .map((match) => match[0])
    .filter((token) => {
      if (KNOWN_BRANDS.includes(token)) return false;
      if (/^(BTU|BTUS|FRIO|CALOR|SOLO|MINISPLIT|PORTATIL|VENTANA|INVERTER|WIFI|R32|R410A?|TON|END|MOD)$/.test(token)) {
        return false;
      }
      if (/^\d/.test(token)) return false;
      return /\d/.test(token) && token.length >= 4;
    });
  const preferred = candidates.find((token) => /[-/]/.test(token)) || candidates.at(-1) || null;
  return { modelCode: preferred, candidates };
}

function primeSeriesFromSuffix(suffix) {
  const normalized = String(suffix || "").replace(/^-/, "").toUpperCase();
  return {
    E2: "Elite 2",
    E4: "Elite 4",
    B3: "Bright 3",
    V3: "Vantage 3",
    U3: "Ultra 3",
    A1: "A1 Advanced",
    R3: "R3 Advanced",
    T3: "Trendy 3",
    K: "Trendy K",
  }[normalized] || `${normalized} family`;
}

function extractSeries({ brand, titleNorm, modelCode }) {
  const brandRules = SERIES_RULES.filter((rule) => !rule.brand || rule.brand === brand);
  for (const rule of brandRules) {
    if (rule.patterns.some((pattern) => pattern.test(titleNorm))) {
      return {
        productSeries: rule.series,
        seriesSource: "title_rule",
        seriesConfidence: rule.confidence,
        seriesType: "named_series",
      };
    }
  }

  const genericSerie = titleNorm.match(/\bSERIE\s+([A-Z0-9]{1,12})\b/);
  if (genericSerie) {
    return {
      productSeries: `Serie ${genericSerie[1]}`,
      seriesSource: "generic_serie",
      seriesConfidence: "medium",
      seriesType: "named_series",
    };
  }

  const modelText = modelCode ? latinUpper(modelCode) : titleNorm;
  for (const rule of MODEL_FAMILY_RULES.filter((item) => item.brand === brand)) {
    const match = modelText.match(rule.pattern);
    if (match) {
      return {
        productSeries: rule.family(match),
        seriesSource: "model_family_rule",
        seriesConfidence: "low",
        seriesType: "model_family",
      };
    }
  }

  return {
    productSeries: null,
    seriesSource: null,
    seriesConfidence: "unknown",
    seriesType: "unknown",
  };
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function confidenceValue(value) {
  return { high: 1, medium: 0.75, low: 0.45, unknown: 0, missing: 0 }[value] ?? 0;
}

function buildComparableKey(row) {
  return [
    row.brandNorm || "UNKNOWN",
    row.productSeries || row.modelFamily || "NO_SERIES",
    row.productType || "NO_TYPE",
    row.capacityTon ? `${row.capacityTon}T` : "NO_CAPACITY",
    row.voltageClass || "NO_VOLTAGE",
    row.inverter === true ? "INVERTER" : row.inverter === false ? "ON_OFF" : "TECH_UNKNOWN",
    row.coolingMode || "MODE_UNKNOWN",
  ].join("|");
}

function buildReviewFlags(row, fieldConfidences) {
  const flags = [];
  if (!row.brandNorm) flags.push("brand_missing");
  if (!row.isAirConditioner) flags.push("not_ac_or_noise");
  if (!row.productSeries) flags.push("series_missing");
  if (row.seriesType === "model_family") flags.push("series_is_model_family");
  if (!row.capacityTon && row.isAirConditioner) flags.push("capacity_missing");
  if (!row.voltageClass && row.isAirConditioner) flags.push("voltage_missing");
  if (row.voltageClass === "multiple") flags.push("voltage_multiple");
  if (row.inverter === null && row.isAirConditioner) flags.push("inverter_unknown");
  if (!row.coolingMode && row.isAirConditioner) flags.push("cooling_mode_missing");
  if (fieldConfidences.capacity === "medium" && row.capacitySource === "btu_derived_conflict") flags.push("capacity_conflict");
  return flags;
}

function normalizeProduct(row, site) {
  const title = normalizeText(pickFirst(row, ["name", "title", "pdp_name", "product_name"]));
  const titleNorm = latinUpper(title);
  const productId = primaryProductKey(row);
  const siteLabel = site.label;
  const cid = canonicalId(siteLabel, productId);

  const brandInfo = extractBrand(row, titleNorm);
  const typeInfo = extractProductType(titleNorm);
  const btuInfo = extractBtu(titleNorm);
  const tonInfo = extractTon(titleNorm, btuInfo);
  const voltageInfo = extractVoltage(titleNorm);
  const inverterInfo = extractInverter(titleNorm);
  const coolingInfo = extractCoolingMode(titleNorm);
  const refrigerantInfo = extractRefrigerant(titleNorm);
  const wifiInfo = extractWifi(titleNorm);
  const seerInfo = extractSeer(titleNorm);
  const modelInfo = extractModelCode(titleNorm);
  const seriesInfo = extractSeries({ brand: brandInfo.brand, titleNorm, modelCode: modelInfo.modelCode });

  const fieldConfidences = {
    brand: brandInfo.confidence,
    productType: typeInfo.confidence,
    series: seriesInfo.seriesConfidence,
    capacity: tonInfo.confidence,
    btu: btuInfo.confidence,
    voltage: voltageInfo.confidence,
    inverter: inverterInfo.confidence,
    coolingMode: coolingInfo.confidence,
    refrigerant: refrigerantInfo.confidence,
    wifi: wifiInfo.confidence,
    seer: seerInfo.confidence,
  };

  const extractedAt = new Date().toISOString();
  const date = toDateInTimeZone(row.captured_at || extractedAt, MONTERREY_TZ) || toDateInTimeZone(extractedAt, MONTERREY_TZ);
  const normalized = {
    date,
    siteId: site.id,
    website: siteLabel,
    productId,
    canonicalProductId: cid,
    sourceProductKey: productId ? `SPK::${siteLabel}::${productId}` : null,
    title,
    productUrl: row.product_url || row.link || null,
    imageUrl: row.image_url || row.image || null,
    price: Number(row.sale_price_mxn || row.price || row.pdp_sale_price_mxn) || null,
    brandRaw: normalizeText(pickFirst(row, ["brand", "ldjson_brand_name"])) || null,
    brandNorm: brandInfo.brand,
    brandSource: brandInfo.source,
    productType: typeInfo.productType,
    productTypeLabel: PRODUCT_TYPE_LABELS[typeInfo.productType] || "Otros",
    isAirConditioner: typeInfo.isAirConditioner,
    productSeries: seriesInfo.productSeries,
    seriesSource: seriesInfo.seriesSource,
    seriesConfidence: seriesInfo.seriesConfidence,
    seriesType: seriesInfo.seriesType,
    modelCode: modelInfo.modelCode,
    modelCodeCandidates: modelInfo.candidates,
    modelFamily: seriesInfo.seriesType === "model_family" ? seriesInfo.productSeries : null,
    capacityTon: tonInfo.ton,
    capacityBtu: btuInfo.btu,
    capacitySource: tonInfo.source,
    capacityConflict: tonInfo.conflict || null,
    voltageV: voltageInfo.voltageV,
    voltageClass: voltageInfo.voltageClass,
    voltageValues: voltageInfo.voltageValues,
    inverter: inverterInfo.inverter,
    coolingMode: coolingInfo.coolingMode,
    refrigerant: refrigerantInfo.refrigerant,
    wifi: wifiInfo.wifi,
    seer: seerInfo.seer,
    fieldConfidences,
    extractionVersion: EXTRACTION_VERSION,
    extractedAt,
  };

  normalized.comparableKey = buildComparableKey(normalized);
  normalized.reviewFlags = buildReviewFlags(normalized, fieldConfidences);
  normalized.confidenceScore = round(
    [
      fieldConfidences.brand,
      fieldConfidences.productType,
      fieldConfidences.series,
      fieldConfidences.capacity,
      fieldConfidences.voltage,
      fieldConfidences.inverter,
      fieldConfidences.coolingMode,
    ].reduce((sum, item) => sum + confidenceValue(item), 0) / 7,
    2,
  );
  return normalized;
}

function summarize(rows) {
  const acRows = rows.filter((row) => row.isAirConditioner);
  const pct = (num, den) => (den ? round((num / den) * 100, 1) : 0);
  return {
    totalProducts: rows.length,
    airConditionerProducts: acRows.length,
    noiseOrAccessoryProducts: rows.length - acRows.length,
    brandCoveragePct: pct(acRows.filter((row) => row.brandNorm).length, acRows.length),
    seriesCoveragePct: pct(acRows.filter((row) => row.productSeries).length, acRows.length),
    namedSeriesCoveragePct: pct(acRows.filter((row) => row.seriesType === "named_series").length, acRows.length),
    capacityCoveragePct: pct(acRows.filter((row) => Number.isFinite(row.capacityTon)).length, acRows.length),
    voltageCoveragePct: pct(acRows.filter((row) => row.voltageClass && row.voltageClass !== "multiple").length, acRows.length),
    inverterCoveragePct: pct(acRows.filter((row) => row.inverter !== null).length, acRows.length),
    coolingModeCoveragePct: pct(acRows.filter((row) => row.coolingMode).length, acRows.length),
    reviewNeeded: rows.filter((row) => row.reviewFlags.length).length,
    reviewNeededPct: pct(rows.filter((row) => row.reviewFlags.length).length, rows.length),
    extractionVersion: EXTRACTION_VERSION,
  };
}

function countBy(rows, keyFn, limit = 20) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "UNKNOWN";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeCsv(rows) {
  const columns = [
    "date",
    "website",
    "productId",
    "canonicalProductId",
    "brandNorm",
    "productSeries",
    "seriesConfidence",
    "seriesType",
    "modelCode",
    "productType",
    "capacityTon",
    "capacityBtu",
    "voltageClass",
    "inverter",
    "coolingMode",
    "refrigerant",
    "wifi",
    "confidenceScore",
    "reviewFlags",
    "title",
    "productUrl",
  ];
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
  await fs.writeFile(OUT_CSV, `${csv}\n`, "utf8");
}

function initDb(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
CREATE TABLE IF NOT EXISTS sku_normalized_fields (
  date DATE NOT NULL,
  website TEXT NOT NULL,
  canonical_product_id TEXT NOT NULL,
  source_product_key TEXT,
  product_id TEXT,
  title TEXT,
  brand_norm TEXT,
  brand_raw TEXT,
  product_type TEXT,
  is_air_conditioner INTEGER,
  product_series TEXT,
  series_source TEXT,
  series_confidence TEXT,
  series_type TEXT,
  model_code TEXT,
  model_family TEXT,
  capacity_ton REAL,
  capacity_btu INTEGER,
  capacity_source TEXT,
  voltage_v INTEGER,
  voltage_class TEXT,
  inverter INTEGER,
  cooling_mode TEXT,
  refrigerant TEXT,
  wifi INTEGER,
  seer REAL,
  comparable_key TEXT,
  confidence_score REAL,
  review_flags_json TEXT,
  field_confidences_json TEXT,
  extraction_version TEXT,
  extracted_at DATETIME,
  PRIMARY KEY (date, website, canonical_product_id)
);
CREATE TABLE IF NOT EXISTS sku_normalization_runs (
  id INTEGER PRIMARY KEY,
  generated_at DATETIME NOT NULL,
  latest_date DATE,
  total_products INTEGER,
  air_conditioner_products INTEGER,
  series_coverage_pct REAL,
  capacity_coverage_pct REAL,
  review_needed INTEGER,
  extraction_version TEXT,
  summary_json TEXT
);
  `);
}

async function persistToDb(rows, summary) {
  try {
    await fs.access(DB_PATH);
  } catch {
    return { enabled: false, reason: "database_not_found", dbPath: DB_PATH, rowsUpserted: 0 };
  }

  const db = new DatabaseSync(DB_PATH);
  try {
    initDb(db);
    const insert = db.prepare(`
INSERT INTO sku_normalized_fields (
  date, website, canonical_product_id, source_product_key, product_id, title, brand_norm, brand_raw,
  product_type, is_air_conditioner, product_series, series_source, series_confidence, series_type,
  model_code, model_family, capacity_ton, capacity_btu, capacity_source, voltage_v, voltage_class,
  inverter, cooling_mode, refrigerant, wifi, seer, comparable_key, confidence_score,
  review_flags_json, field_confidences_json, extraction_version, extracted_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(date, website, canonical_product_id) DO UPDATE SET
  source_product_key=excluded.source_product_key,
  product_id=excluded.product_id,
  title=excluded.title,
  brand_norm=excluded.brand_norm,
  brand_raw=excluded.brand_raw,
  product_type=excluded.product_type,
  is_air_conditioner=excluded.is_air_conditioner,
  product_series=excluded.product_series,
  series_source=excluded.series_source,
  series_confidence=excluded.series_confidence,
  series_type=excluded.series_type,
  model_code=excluded.model_code,
  model_family=excluded.model_family,
  capacity_ton=excluded.capacity_ton,
  capacity_btu=excluded.capacity_btu,
  capacity_source=excluded.capacity_source,
  voltage_v=excluded.voltage_v,
  voltage_class=excluded.voltage_class,
  inverter=excluded.inverter,
  cooling_mode=excluded.cooling_mode,
  refrigerant=excluded.refrigerant,
  wifi=excluded.wifi,
  seer=excluded.seer,
  comparable_key=excluded.comparable_key,
  confidence_score=excluded.confidence_score,
  review_flags_json=excluded.review_flags_json,
  field_confidences_json=excluded.field_confidences_json,
  extraction_version=excluded.extraction_version,
  extracted_at=excluded.extracted_at;
    `);
    const updateMaster = db.prepare(`
UPDATE product_master
SET
  btu=COALESCE(?, btu),
  voltage=COALESCE(?, voltage),
  mode=COALESCE(?, mode),
  type=COALESCE(?, type),
  brand=COALESCE(?, brand),
  model_sig_raw=COALESCE(?, model_sig_raw),
  model_sig_norm=COALESCE(?, model_sig_norm)
WHERE canonical_product_id = ?;
    `);
    const insertRun = db.prepare(`
INSERT INTO sku_normalization_runs (
  generated_at, latest_date, total_products, air_conditioner_products,
  series_coverage_pct, capacity_coverage_pct, review_needed, extraction_version, summary_json
) VALUES (?,?,?,?,?,?,?,?,?)
    `);

    db.exec("BEGIN;");
    let rowsUpserted = 0;
    for (const row of rows.filter((item) => item.canonicalProductId)) {
      insert.run(
        row.date,
        row.website,
        row.canonicalProductId,
        row.sourceProductKey,
        row.productId,
        row.title,
        row.brandNorm,
        row.brandRaw,
        row.productType,
        row.isAirConditioner ? 1 : 0,
        row.productSeries,
        row.seriesSource,
        row.seriesConfidence,
        row.seriesType,
        row.modelCode,
        row.modelFamily,
        row.capacityTon,
        row.capacityBtu,
        row.capacitySource,
        row.voltageV,
        row.voltageClass,
        row.inverter === null ? null : row.inverter ? 1 : 0,
        row.coolingMode,
        row.refrigerant,
        row.wifi === null ? null : row.wifi ? 1 : 0,
        row.seer,
        row.comparableKey,
        row.confidenceScore,
        JSON.stringify(row.reviewFlags),
        JSON.stringify(row.fieldConfidences),
        row.extractionVersion,
        toSqliteUtcDatetime(row.extractedAt),
      );
      updateMaster.run(
        row.capacityBtu,
        row.voltageClass,
        row.coolingMode,
        row.productType,
        row.brandNorm,
        row.productSeries || row.modelCode,
        row.comparableKey,
        row.canonicalProductId,
      );
      rowsUpserted += 1;
    }
    insertRun.run(
      toSqliteUtcDatetime(new Date()),
      rows.map((row) => row.date).sort().at(-1) || null,
      summary.totalProducts,
      summary.airConditionerProducts,
      summary.seriesCoveragePct,
      summary.capacityCoveragePct,
      summary.reviewNeeded,
      EXTRACTION_VERSION,
      JSON.stringify(summary),
    );
    db.exec("COMMIT;");
    return { enabled: true, reason: "ok", dbPath: DB_PATH, rowsUpserted };
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore rollback failures
    }
    throw error;
  } finally {
    db.close();
  }
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return [];
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const rows = [];
  const sourceCounts = [];

  for (const site of SITE_CONFIG) {
    const raw = asArray(await readJson(site.latestPath));
    sourceCounts.push({ site: site.label, count: raw.length, source: site.latestPath });
    for (const row of raw) {
      const normalized = normalizeProduct(row, site);
      if (normalized.title) rows.push(normalized);
    }
  }

  const summary = summarize(rows);
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    summary,
    sourceCounts,
    byBrand: countBy(rows.filter((row) => row.isAirConditioner), (row) => row.brandNorm),
    bySeries: countBy(
      rows.filter((row) => row.isAirConditioner && row.productSeries),
      (row) => `${row.brandNorm || "UNKNOWN"} / ${row.productSeries}`,
    ),
    byReviewFlag: countBy(rows.flatMap((row) => row.reviewFlags.map((flag) => ({ flag }))), (row) => row.flag),
    rows,
  };
  const dbResult = await persistToDb(rows, summary);
  payload.database = dbResult;

  await fs.writeFile(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  await writeCsv(rows);

  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_CSV)}`);
  console.log(
    `Normalized: ${summary.totalProducts}; AC: ${summary.airConditionerProducts}; series coverage: ${summary.seriesCoveragePct}%; review needed: ${summary.reviewNeeded}`,
  );
  console.log(`Database: ${dbResult.enabled ? `${dbResult.rowsUpserted} rows` : dbResult.reason}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
