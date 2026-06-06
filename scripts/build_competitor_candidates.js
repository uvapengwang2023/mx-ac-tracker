import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const INPUT_JSON = path.join(ROOT, "data", "normalized_skus", "latest_normalized_skus.json");
const OUT_DIR = path.join(ROOT, "data", "competitor_candidates");
const OUT_JSON = path.join(OUT_DIR, "latest_competitor_candidates.json");
const OUT_CSV = path.join(OUT_DIR, "latest_competitor_candidates.csv");
const DB_PATH = path.join(ROOT, "data", "ac_price_monitor_mexico_v2.db");
const VERSION = "competitor-candidates-v1";

const TARGET_BRANDS = (process.env.COMPETITOR_TARGET_BRANDS || "PRIME")
  .split(",")
  .map((brand) => brand.trim().toUpperCase())
  .filter(Boolean);

const TARGET_LIMIT = Number(process.env.COMPETITOR_TARGET_LIMIT || 80);
const CANDIDATES_PER_TARGET = Number(process.env.COMPETITOR_CANDIDATES_PER_TARGET || 12);
const SAME_BRAND_REFERENCE_LIMIT = Number(process.env.COMPETITOR_SAME_BRAND_REFERENCE_LIMIT || 2);

const STRATEGIC_BRANDS = new Set(["MIRAGE", "MIDEA", "MABE", "LG", "HISENSE", "SAMSUNG", "WHIRLPOOL", "YORK"]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function boolLabel(value) {
  if (value === true) return "inverter";
  if (value === false) return "on_off";
  return "unknown";
}

function coolingLabel(value) {
  return {
    solo_frio: "solo_frio",
    frio_calor: "frio_calor",
  }[value] || "unknown";
}

function productKey(row) {
  return row.sourceProductKey || row.canonicalProductId || `${row.website}:${row.productId || row.title}`;
}

function compactProduct(row) {
  return {
    key: productKey(row),
    website: row.website,
    productId: row.productId,
    title: row.title,
    productUrl: row.productUrl,
    imageUrl: row.imageUrl,
    price: row.price,
    brand: row.brandNorm,
    series: row.productSeries,
    seriesType: row.seriesType,
    seriesConfidence: row.seriesConfidence,
    modelCode: row.modelCode,
    productType: row.productType,
    productTypeLabel: row.productTypeLabel,
    capacityTon: row.capacityTon,
    voltageClass: row.voltageClass,
    inverter: row.inverter,
    coolingMode: row.coolingMode,
    confidenceScore: row.confidenceScore,
    reviewFlags: row.reviewFlags || [],
  };
}

function isEligibleTarget(row) {
  return (
    TARGET_BRANDS.includes(row.brandNorm) &&
    row.isAirConditioner === true &&
    Number.isFinite(row.price) &&
    Number.isFinite(row.capacityTon)
  );
}

function isEligibleCandidate(row) {
  return row.isAirConditioner === true && Number.isFinite(row.price) && Number.isFinite(row.capacityTon);
}

function isProductTypeCompatible(target, candidate) {
  if (target.productType === candidate.productType) return true;
  const soft = new Set(["minisplit", "other_ac"]);
  return soft.has(target.productType) && soft.has(candidate.productType);
}

function capacityScore(target, candidate, reasons, risks) {
  const diff = Math.abs(target.capacityTon - candidate.capacityTon);
  if (diff <= 0.05) {
    reasons.push("容量一致");
    return 24;
  }
  if (diff <= 0.25) {
    risks.push(`容量接近但不完全一致：${target.capacityTon}T vs ${candidate.capacityTon}T`);
    return 14;
  }
  if (diff <= 0.5) {
    risks.push(`容量差异较大：${target.capacityTon}T vs ${candidate.capacityTon}T`);
    return 6;
  }
  return -100;
}

function productTypeScore(target, candidate, reasons, risks) {
  if (target.productType === candidate.productType) {
    reasons.push("产品类型一致");
    return 18;
  }
  if (isProductTypeCompatible(target, candidate)) {
    risks.push(`产品类型近似：${target.productTypeLabel} vs ${candidate.productTypeLabel}`);
    return 12;
  }
  risks.push(`产品类型不一致：${target.productTypeLabel} vs ${candidate.productTypeLabel}`);
  return 0;
}

function exactOrUnknownScore({ targetValue, candidateValue, exactPoints, unknownPoints, label, reasons, risks }) {
  if (targetValue === null || targetValue === undefined || candidateValue === null || candidateValue === undefined) {
    risks.push(`${label}有缺失`);
    return unknownPoints;
  }
  if (targetValue === candidateValue) {
    reasons.push(`${label}一致`);
    return exactPoints;
  }
  risks.push(`${label}不一致`);
  return 0;
}

function priceScore(target, candidate, reasons, risks) {
  const delta = candidate.price - target.price;
  const pct = target.price ? delta / target.price : null;
  if (!Number.isFinite(pct)) return 0;
  const absPct = Math.abs(pct);
  if (absPct <= 0.1) {
    reasons.push("价格差在 10% 内");
    return 12;
  }
  if (absPct <= 0.2) {
    reasons.push("价格差在 20% 内");
    return 9;
  }
  if (absPct <= 0.35) {
    risks.push("价格差在 20%-35%");
    return 6;
  }
  if (absPct <= 0.5) {
    risks.push("价格差在 35%-50%");
    return 3;
  }
  risks.push("价格差超过 50%");
  return 0;
}

function seriesSignalScore(target, candidate, reasons, risks) {
  if (candidate.brandNorm === target.brandNorm && target.productSeries && candidate.productSeries === target.productSeries) {
    reasons.push("同品牌同系列/型号族，可作内部价格参照");
    return 6;
  }
  if (candidate.seriesType === "named_series") {
    reasons.push("候选商品有明确系列");
    return 4;
  }
  if (candidate.seriesType === "model_family") {
    risks.push("候选系列来自低置信度型号族");
    return 2;
  }
  risks.push("候选系列缺失");
  return 0;
}

function brandScore(target, candidate, reasons) {
  if (candidate.brandNorm === target.brandNorm) {
    reasons.push("同品牌跨平台参考");
    return 0;
  }
  if (STRATEGIC_BRANDS.has(candidate.brandNorm)) {
    reasons.push("重点竞品品牌");
    return 6;
  }
  return 3;
}

function classifyCandidate({ target, candidate, score, reasons, risks }) {
  const sameBrand = target.brandNorm === candidate.brandNorm;
  const capacityExact = Math.abs(target.capacityTon - candidate.capacityTon) <= 0.05;
  const typeCompatible = isProductTypeCompatible(target, candidate);
  const hardMismatch =
    (target.inverter !== null && candidate.inverter !== null && target.inverter !== candidate.inverter) ||
    (target.coolingMode && candidate.coolingMode && target.coolingMode !== candidate.coolingMode) ||
    (target.voltageClass && candidate.voltageClass && target.voltageClass !== candidate.voltageClass);
  const criticalMissing =
    !target.voltageClass ||
    !candidate.voltageClass ||
    target.inverter === null ||
    candidate.inverter === null ||
    !target.coolingMode ||
    !candidate.coolingMode;
  const exactSpecCount = [
    target.inverter !== null && candidate.inverter !== null && target.inverter === candidate.inverter,
    target.coolingMode && candidate.coolingMode && target.coolingMode === candidate.coolingMode,
    target.voltageClass && candidate.voltageClass && target.voltageClass === candidate.voltageClass,
  ].filter(Boolean).length;

  if (sameBrand) {
    return { tier: "internal_reference", label: "内部参照", candidateType: "same_brand_reference" };
  }
  if (score >= 92 && capacityExact && typeCompatible && !hardMismatch && !criticalMissing && exactSpecCount >= 3) {
    return { tier: "direct", label: "直接竞品", candidateType: "competitor" };
  }
  if (score >= 80 && capacityExact && typeCompatible && !hardMismatch && exactSpecCount >= 2) {
    return { tier: "close", label: "强候选", candidateType: "competitor" };
  }
  if (score >= 65 && capacityExact && typeCompatible) {
    return { tier: "benchmark", label: "价格/规格参照", candidateType: "benchmark" };
  }
  if (score >= 45) {
    return { tier: "watch", label: "弱候选/观察", candidateType: "watch" };
  }
  risks.push("相似度不足，仅保留为排除参考");
  return { tier: "exclude", label: "暂不纳入", candidateType: "exclude" };
}

function scoreCandidate(target, candidate) {
  const reasons = [];
  const risks = [];
  let score = 0;

  score += productTypeScore(target, candidate, reasons, risks);
  score += capacityScore(target, candidate, reasons, risks);
  if (score < 0) return null;
  score += exactOrUnknownScore({
    targetValue: target.voltageClass,
    candidateValue: candidate.voltageClass,
    exactPoints: 12,
    unknownPoints: 5,
    label: "电压",
    reasons,
    risks,
  });
  score += exactOrUnknownScore({
    targetValue: target.inverter,
    candidateValue: candidate.inverter,
    exactPoints: 14,
    unknownPoints: 6,
    label: "变频/定频",
    reasons,
    risks,
  });
  score += exactOrUnknownScore({
    targetValue: target.coolingMode,
    candidateValue: candidate.coolingMode,
    exactPoints: 14,
    unknownPoints: 6,
    label: "单冷/冷暖",
    reasons,
    risks,
  });
  score += priceScore(target, candidate, reasons, risks);
  score += seriesSignalScore(target, candidate, reasons, risks);
  score += brandScore(target, candidate, reasons);

  score = Math.max(0, Math.min(100, round(score, 1)));
  const classification = classifyCandidate({ target, candidate, score, reasons, risks });
  const priceDelta = candidate.price - target.price;
  return {
    score,
    ...classification,
    priceDelta: round(priceDelta),
    priceDeltaPct: target.price ? round((priceDelta / target.price) * 100, 1) : null,
    reasons: [...new Set(reasons)].slice(0, 8),
    risks: [...new Set(risks)].slice(0, 8),
  };
}

function buildCandidateGroups(rows) {
  const targets = rows
    .filter(isEligibleTarget)
    .sort((a, b) => {
      const confidenceOrder = { high: 0, medium: 1, low: 2, unknown: 3 };
      return (
        (confidenceOrder[a.seriesConfidence] ?? 4) - (confidenceOrder[b.seriesConfidence] ?? 4) ||
        String(a.productSeries || "").localeCompare(String(b.productSeries || "")) ||
        a.price - b.price
      );
    })
    .slice(0, TARGET_LIMIT);
  const candidates = rows.filter(isEligibleCandidate);

  const targetGroups = [];
  const flatCandidates = [];

  for (const target of targets) {
    const scored = candidates
      .filter((candidate) => productKey(candidate) !== productKey(target))
      .map((candidate) => {
        const scoring = scoreCandidate(target, candidate);
        if (!scoring || scoring.tier === "exclude") return null;
        return {
          targetKey: productKey(target),
          candidateKey: productKey(candidate),
          target: compactProduct(target),
          candidate: compactProduct(candidate),
          ...scoring,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const tierOrder = { direct: 0, close: 1, benchmark: 2, internal_reference: 3, watch: 4 };
        return (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9) || b.score - a.score || Math.abs(a.priceDelta) - Math.abs(b.priceDelta);
      });

    const selected = [];
    let sameBrandCount = 0;
    for (const row of scored) {
      const sameBrand = row.candidate.brand === target.brandNorm;
      if (sameBrand) {
        if (sameBrandCount >= SAME_BRAND_REFERENCE_LIMIT) continue;
        sameBrandCount += 1;
      }
      selected.push(row);
      if (selected.length >= CANDIDATES_PER_TARGET) break;
    }

    const counts = selected.reduce((acc, row) => {
      acc[row.tier] = (acc[row.tier] || 0) + 1;
      return acc;
    }, {});
    targetGroups.push({
      target: compactProduct(target),
      summary: {
        candidates: selected.length,
        direct: counts.direct || 0,
        close: counts.close || 0,
        benchmark: counts.benchmark || 0,
        internalReference: counts.internal_reference || 0,
        watch: counts.watch || 0,
      },
      candidates: selected.map(({ target: _target, ...candidateRow }) => candidateRow),
    });
    flatCandidates.push(...selected);
  }

  return { targetGroups, flatCandidates };
}

function summarizeRows(rows, keyFn) {
  return [...rows.reduce((map, row) => {
    const key = keyFn(row) || "UNKNOWN";
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map()).entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const headers = [
    "target_brand",
    "target_series",
    "target_model",
    "target_title",
    "target_site",
    "target_price",
    "target_capacity_ton",
    "target_voltage",
    "target_inverter",
    "target_cooling_mode",
    "candidate_tier",
    "score",
    "candidate_brand",
    "candidate_series",
    "candidate_model",
    "candidate_title",
    "candidate_site",
    "candidate_price",
    "price_delta",
    "price_delta_pct",
    "candidate_capacity_ton",
    "candidate_voltage",
    "candidate_inverter",
    "candidate_cooling_mode",
    "candidate_url",
    "reasons",
    "risks",
  ];
  const lines = rows.map((row) => [
    row.target.brand,
    row.target.series,
    row.target.modelCode,
    row.target.title,
    row.target.website,
    row.target.price,
    row.target.capacityTon,
    row.target.voltageClass,
    boolLabel(row.target.inverter),
    coolingLabel(row.target.coolingMode),
    row.label,
    row.score,
    row.candidate.brand,
    row.candidate.series,
    row.candidate.modelCode,
    row.candidate.title,
    row.candidate.website,
    row.candidate.price,
    row.priceDelta,
    row.priceDeltaPct,
    row.candidate.capacityTon,
    row.candidate.voltageClass,
    boolLabel(row.candidate.inverter),
    coolingLabel(row.candidate.coolingMode),
    row.candidate.productUrl,
    row.reasons.join("; "),
    row.risks.join("; "),
  ]);
  return [headers, ...lines].map((line) => line.map(csvEscape).join(",")).join("\n") + "\n";
}

function writeSqlite({ runId, generatedAt, targetBrands, targetGroups, flatCandidates }) {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitor_candidate_runs (
      run_id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      target_brands TEXT NOT NULL,
      target_count INTEGER NOT NULL,
      candidate_pair_count INTEGER NOT NULL,
      extraction_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS competitor_candidates (
      run_id TEXT NOT NULL,
      target_key TEXT NOT NULL,
      target_brand TEXT,
      target_title TEXT,
      target_series TEXT,
      target_model TEXT,
      target_capacity_ton REAL,
      target_voltage TEXT,
      target_inverter INTEGER,
      target_cooling_mode TEXT,
      target_price REAL,
      candidate_key TEXT NOT NULL,
      candidate_brand TEXT,
      candidate_title TEXT,
      candidate_series TEXT,
      candidate_model TEXT,
      candidate_capacity_ton REAL,
      candidate_voltage TEXT,
      candidate_inverter INTEGER,
      candidate_cooling_mode TEXT,
      candidate_price REAL,
      candidate_site TEXT,
      candidate_url TEXT,
      score REAL,
      tier TEXT,
      candidate_type TEXT,
      price_delta REAL,
      price_delta_pct REAL,
      reasons_json TEXT,
      risks_json TEXT,
      PRIMARY KEY (run_id, target_key, candidate_key)
    );
  `);
  db.prepare(
    `INSERT OR REPLACE INTO competitor_candidate_runs (
      run_id, generated_at, target_brands, target_count, candidate_pair_count, extraction_version
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(runId, generatedAt, targetBrands.join(","), targetGroups.length, flatCandidates.length, VERSION);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO competitor_candidates (
      run_id, target_key, target_brand, target_title, target_series, target_model, target_capacity_ton, target_voltage,
      target_inverter, target_cooling_mode, target_price, candidate_key, candidate_brand, candidate_title,
      candidate_series, candidate_model, candidate_capacity_ton, candidate_voltage, candidate_inverter,
      candidate_cooling_mode, candidate_price, candidate_site, candidate_url, score, tier, candidate_type,
      price_delta, price_delta_pct, reasons_json, risks_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM competitor_candidates WHERE run_id = ?").run(runId);
    for (const row of flatCandidates) {
      insert.run(
        runId,
        row.targetKey,
        row.target.brand,
        row.target.title,
        row.target.series,
        row.target.modelCode,
        row.target.capacityTon,
        row.target.voltageClass,
        row.target.inverter === null ? null : row.target.inverter ? 1 : 0,
        row.target.coolingMode,
        row.target.price,
        row.candidateKey,
        row.candidate.brand,
        row.candidate.title,
        row.candidate.series,
        row.candidate.modelCode,
        row.candidate.capacityTon,
        row.candidate.voltageClass,
        row.candidate.inverter === null ? null : row.candidate.inverter ? 1 : 0,
        row.candidate.coolingMode,
        row.candidate.price,
        row.candidate.website,
        row.candidate.productUrl,
        row.score,
        row.tier,
        row.candidateType,
        row.priceDelta,
        row.priceDeltaPct,
        JSON.stringify(row.reasons),
        JSON.stringify(row.risks),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  db.close();
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const normalized = await readJson(INPUT_JSON);
  const rows = (normalized.rows || []).filter((row) => row.title && row.brandNorm);
  const { targetGroups, flatCandidates } = buildCandidateGroups(rows);
  const generatedAt = new Date().toISOString();
  const runId = generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14);

  const directOrClose = flatCandidates.filter((row) => row.tier === "direct" || row.tier === "close");
  const output = {
    generatedAt,
    runId,
    version: VERSION,
    source: "data/normalized_skus/latest_normalized_skus.json",
    targetBrands: TARGET_BRANDS,
    summary: {
      sourceProducts: rows.length,
      targetCount: targetGroups.length,
      candidatePairCount: flatCandidates.length,
      directCandidateCount: flatCandidates.filter((row) => row.tier === "direct").length,
      closeCandidateCount: flatCandidates.filter((row) => row.tier === "close").length,
      benchmarkCandidateCount: flatCandidates.filter((row) => row.tier === "benchmark").length,
      internalReferenceCount: flatCandidates.filter((row) => row.tier === "internal_reference").length,
      avgCandidatesPerTarget: targetGroups.length ? round(flatCandidates.length / targetGroups.length, 1) : 0,
      targetsWithDirectOrClose: new Set(directOrClose.map((row) => row.targetKey)).size,
    },
    byTier: summarizeRows(flatCandidates, (row) => row.tier),
    byCandidateBrand: summarizeRows(flatCandidates.filter((row) => row.candidateType !== "same_brand_reference"), (row) => row.candidate.brand),
    methodology: {
      scoring: [
        "产品类型最高 18 分：同类型优先，minisplit 和 other_ac 作为近似类型。",
        "容量最高 24 分：同 Ton 位是直接竞品的必要条件。",
        "电压最高 12 分，变频/定频最高 14 分，单冷/冷暖最高 14 分。",
        "价格接近最高 12 分，用于排序和价格带参照，不覆盖核心规格。",
        "系列信号最高 6 分：标题明确系列或型号族会提升可解释性。",
        "重点竞品品牌最高 6 分：Mirage、Midea、Mabe、LG、Hisense、Samsung、Whirlpool、York。",
      ],
      tierDefinitions: {
        direct: "非 Prime、容量一致、产品类型兼容、关键规格高度一致，适合作为直接竞品候选。",
        close: "非 Prime、容量一致、产品类型兼容，规格较接近，适合人工复核。",
        benchmark: "规格可参考，但存在价格或字段不确定性，适合做价格/规格参照。",
        internal_reference: "Prime 同品牌跨平台或同规格参考，不算外部竞品。",
        watch: "弱候选/观察项，暂不进入核心竞品池。",
      },
      humanGate: "A03 输出是候选竞品池，不是最终竞品名单。最终真竞品、弱竞品、不可比仍需要人工确认。",
    },
    targetGroups,
    flatCandidates,
  };

  await fs.writeFile(OUT_JSON, JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(OUT_CSV, toCsv(flatCandidates), "utf8");
  writeSqlite({ runId, generatedAt, targetBrands: TARGET_BRANDS, targetGroups, flatCandidates });

  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_CSV)}`);
  console.log(
    `Targets: ${output.summary.targetCount}; pairs: ${output.summary.candidatePairCount}; direct/close targets: ${output.summary.targetsWithDirectOrClose}`,
  );
  console.log(`Database: ${path.relative(ROOT, DB_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
