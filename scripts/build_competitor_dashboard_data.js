import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "web", "competitor-intel-dashboard");
const OUT_FILE = path.join(OUT_DIR, "data.js");
const DB_PATH = path.join(ROOT, "data", "ac_price_monitor_mexico_v2.db");
const ALERTS_PATH = "data/daily_alerts/latest_alerts.json";
const NORMALIZED_SKUS_PATH = "data/normalized_skus/latest_normalized_skus.json";

const SITE_CONFIG = [
  {
    id: "coppel",
    label: "Coppel",
    latestPath: "data/coppel/latest_products.json",
    changesPath: "data/coppel/reports/latest_price_changes.json",
    runPath: "data/coppel/runs/latest_run.json",
  },
  {
    id: "elektra",
    label: "Elektra",
    latestPath: "data/elektra/latest_products.json",
    changesPath: "data/elektra/reports/latest_price_changes.json",
    runPath: "data/elektra/runs/latest_run.json",
  },
  {
    id: "homedepotmx",
    label: "HomeDepotMX",
    latestPath: "data/homedepotmx/latest_products.json",
    changesPath: null,
    runPath: "data/homedepotmx/runs/latest_run.json",
  },
  {
    id: "walmartmx",
    label: "WalmartMX",
    latestPath: "data/walmartmx/latest_products.json",
    changesPath: null,
    runPath: "data/walmartmx/runs/latest_run.json",
  },
];

const KNOWN_BRANDS = [
  "Mirage",
  "LG",
  "Mabe",
  "Midea",
  "Hisense",
  "York",
  "Frikko",
  "Whirlpool",
  "Samsung",
  "Carrier",
  "Prime",
  "Aurus",
  "Rheem",
  "IUSA",
  "TCL",
  "Panasonic",
  "RCA",
  "HKPRO",
  "Haier",
  "Frozen",
  "Daewoo",
  "Koblenz",
  "Avera",
  "Volteck",
  "Lenomex",
  "Truper",
];

const PRICE_BANDS = [
  { id: "under-3k", label: "< $3k", min: 0, max: 3000 },
  { id: "3k-6k", label: "$3k-$6k", min: 3000, max: 6000 },
  { id: "6k-9k", label: "$6k-$9k", min: 6000, max: 9000 },
  { id: "9k-12k", label: "$9k-$12k", min: 9000, max: 12000 },
  { id: "12k-18k", label: "$12k-$18k", min: 12000, max: 18000 },
  { id: "over-18k", label: ">$18k", min: 18000, max: Number.POSITIVE_INFINITY },
];

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.products)) {
    return value.products;
  }
  if (Array.isArray(value?.items)) {
    return value.items;
  }
  return [];
}

async function readJson(relativePath, fallback = null) {
  if (!relativePath) {
    return fallback;
  }
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePrice(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sourceProductId(row) {
  return normalizeText(row.product_id || row.sku_id || row.pdp_sku || row.ldjson_sku || row.detail_model || row.product_url || row.link);
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) {
    return null;
  }
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) {
    return null;
  }
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function round(value, digits = 0) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function inferBrand(row) {
  const explicit = normalizeText(row.brand || row.ldjson_brand_name);
  if (explicit) {
    return explicit.toUpperCase();
  }

  const name = normalizeText(row.name).toUpperCase();
  const match = KNOWN_BRANDS.find((brand) => {
    const escaped = brand.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, "i").test(name);
  });
  return match ? match.toUpperCase() : "未识别";
}

function inferCategory(name) {
  const text = name.toLowerCase();
  if (/ventilador|enfriador|cooler/.test(text) && !/minisplit|mini split|aire acondicionado/.test(text)) {
    return "Ventilador/Enfriador";
  }
  if (/port[aá]til|portable/.test(text)) {
    return "Portátil";
  }
  if (/ventana/.test(text)) {
    return "Ventana";
  }
  if (/minisplit|mini split|split/.test(text)) {
    return "Minisplit";
  }
  if (/aire acondicionado|acondicionado|btu|tonelada|ton\b/.test(text)) {
    return "Aire acondicionado";
  }
  return "Otros";
}

function inferCapacityTon(name) {
  const text = normalizeText(name).toLowerCase().replace(",", ".");
  const tonMatch =
    text.match(/(\d+(?:\.\d+)?)\s*(?:toneladas?|tons?|ton\b)/) ||
    text.match(/(\d+(?:\.\d+)?)\s*t\b/);
  if (tonMatch) {
    const tons = Number(tonMatch[1]);
    return Number.isFinite(tons) ? round(tons, 2) : null;
  }

  const btuMatch = text.match(/(\d{1,3}(?:[., ]?\d{3})|\d{4,5})\s*(?:btus?|btu)/);
  if (btuMatch) {
    const btu = Number(btuMatch[1].replace(/[,. ]/g, ""));
    return Number.isFinite(btu) ? round(btu / 12000, 2) : null;
  }
  return null;
}

function inferVoltage(name) {
  const text = normalizeText(name);
  const match = text.match(/\b(110|115|120|127|220|230)\s*v\b/i);
  return match ? `${match[1]}V` : null;
}

function inferInverter(name) {
  return /inverter/i.test(name);
}

function coolingModeLabel(value) {
  return {
    solo_frio: "Solo frio",
    frio_calor: "Frio/calor",
  }[value] || null;
}

function discountPct(price, originalPrice) {
  if (!Number.isFinite(price) || !Number.isFinite(originalPrice) || originalPrice <= price) {
    return null;
  }
  return round(((originalPrice - price) / originalPrice) * 100, 1);
}

function compactRun(run) {
  if (!run) {
    return null;
  }
  return {
    capturedAt: run.captured_at || null,
    totalProducts: run.total_products ?? run.products_extracted ?? null,
    priceChanges: run.price_changes ?? null,
    newProducts: run.new_products ?? null,
    removedProducts: run.removed_products ?? null,
    stopReason: run.pagination?.stop_reason || run.stop_reason || null,
    manualVerificationPassed: run.manual_verification?.passed ?? null,
    proxyRequired: run.safety?.proxy_required ?? null,
    proxyEnabled: run.safety?.proxy_enabled ?? null,
    databaseDate: run.database?.date_mx || null,
  };
}

function normalizeProduct(row, site, normalized = null) {
  const name = normalizeText(row.name || row.title);
  const price = normalizePrice(row.sale_price_mxn || row.detail_sale_price_mxn || row.price);
  const originalPrice = normalizePrice(
    row.original_price_mxn || row.detail_original_price_mxn || row.list_price_mxn || row.price_without_discount_mxn,
  );
  const productId = sourceProductId(row);
  const brand = normalized?.brandNorm || inferBrand(row);
  const category = normalized?.productTypeLabel || inferCategory(name);
  const capacityTon = Number.isFinite(normalized?.capacityTon) ? normalized.capacityTon : inferCapacityTon(name);
  const voltage = normalized?.voltageClass || inferVoltage(name);
  const inverter = typeof normalized?.inverter === "boolean" ? normalized.inverter : inferInverter(name);
  const series = normalized?.productSeries || "未识别";
  const modelCode = normalized?.modelCode || null;
  const coolingMode = coolingModeLabel(normalized?.coolingMode);
  const isAirConditioner =
    typeof normalized?.isAirConditioner === "boolean"
      ? normalized.isAirConditioner
      : !["Ventilador/Enfriador", "Accesorio", "Otros"].includes(category);
  return {
    id: `${site.id}:${productId || name}`,
    siteId: site.id,
    site: site.label,
    productId,
    title: name,
    brand,
    series,
    seriesDisplay: series === "未识别" ? "未识别" : `${brand} / ${series}`,
    seriesConfidence: normalized?.seriesConfidence || "unknown",
    seriesType: normalized?.seriesType || "unknown",
    modelCode,
    category,
    capacityTon,
    voltage,
    inverter,
    coolingMode,
    isAirConditioner,
    normalizedProductType: normalized?.productType || null,
    normalizedConfidence: normalized?.confidenceScore ?? null,
    needsReview: Boolean(normalized?.reviewFlags?.length),
    reviewFlags: normalized?.reviewFlags || [],
    price,
    originalPrice,
    discountPct: discountPct(price, originalPrice),
    productUrl: row.product_url || null,
    imageUrl: row.image_url || row.image || null,
    capturedAt: row.captured_at || null,
    seller: normalizeText(row.seller_name || row.pdp_sold_by) || null,
    listingPosition: row.position_global ?? row.page_begin_index ?? null,
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
  }
  return map;
}

function priceBandFor(price) {
  return PRICE_BANDS.find((band) => price >= band.min && price < band.max) || PRICE_BANDS.at(-1);
}

function summarizeSite(site, rows, changes, run) {
  const prices = rows.map((row) => row.price).filter(Number.isFinite);
  const changeCounts = countChangeTypes(changes);
  return {
    id: site.id,
    label: site.label,
    productCount: rows.length,
    medianPrice: round(median(prices)),
    avgPrice: round(average(prices)),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    discountedCount: rows.filter((row) => Number.isFinite(row.discountPct)).length,
    inverterCount: rows.filter((row) => row.inverter).length,
    unknownBrandCount: rows.filter((row) => row.brand === "未识别").length,
    priceChanges: changeCounts.price_changed || 0,
    newProducts: changeCounts.new_product || 0,
    removedProducts: changeCounts.removed_product || 0,
    capturedAt: run?.capturedAt || rows.find((row) => row.capturedAt)?.capturedAt || null,
    run,
    sourceFiles: {
      latestProducts: site.latestPath,
      priceChanges: site.changesPath,
      run: site.runPath,
    },
  };
}

function countChangeTypes(changes) {
  return changes.reduce((acc, row) => {
    acc[row.change_type] = (acc[row.change_type] || 0) + 1;
    return acc;
  }, {});
}

function summarizeDimension(rows, key, limit = 12) {
  return [...groupBy(rows, (row) => row[key] || "未知").entries()]
    .map(([name, group]) => {
      const prices = group.map((row) => row.price).filter(Number.isFinite);
      const sites = [...new Set(group.map((row) => row.site))].sort();
      return {
        name,
        count: group.length,
        medianPrice: round(median(prices)),
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null,
        sites,
      };
    })
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

function buildPriceBands(rows) {
  return PRICE_BANDS.map((band) => {
    const bandRows = rows.filter((row) => Number.isFinite(row.price) && priceBandFor(row.price)?.id === band.id);
    const bySite = Object.fromEntries(
      SITE_CONFIG.map((site) => [site.label, bandRows.filter((row) => row.siteId === site.id).length]),
    );
    return { ...band, count: bandRows.length, bySite };
  });
}

function normalizeChange(row, site) {
  return {
    siteId: site.id,
    site: site.label,
    changeType: row.change_type || "unknown",
    productId: normalizeText(row.product_id || row.sku_id),
    title: normalizeText(row.name),
    productUrl: row.product_url || null,
    oldPrice: normalizePrice(row.old_sale_price_mxn),
    newPrice: normalizePrice(row.new_sale_price_mxn),
    delta: normalizePrice(row.delta_sale_price_mxn),
  };
}

function buildTrendRows() {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const facts = db
      .prepare(
        "SELECT date, website, price FROM price_facts WHERE price IS NOT NULL ORDER BY date ASC, website ASC",
      )
      .all();
    db.close();

    return [...groupBy(facts, (row) => `${row.date}|${row.website}`).entries()]
      .map(([key, group]) => {
        const [date, site] = key.split("|");
        const prices = group.map((row) => Number(row.price)).filter(Number.isFinite);
        return {
          date,
          site,
          productCount: group.length,
          avgPrice: round(average(prices)),
          medianPrice: round(median(prices)),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site));
  } catch (error) {
    return [];
  }
}

function buildInsights({ rows, sites, priceBands, changes, trend }) {
  const topBand = [...priceBands].sort((a, b) => b.count - a.count)[0];
  const mostChangedSite = [...sites].sort((a, b) => b.priceChanges - a.priceChanges)[0];
  const unknownBrandRate = rows.length ? rows.filter((row) => row.brand === "未识别").length / rows.length : 0;
  const latestTrendDate = trend.at(-1)?.date || null;
  const latestBySite = trend.filter((row) => row.date === latestTrendDate);
  const lowestMedian = [...latestBySite].sort((a, b) => a.medianPrice - b.medianPrice)[0];
  const highestMedian = [...latestBySite].sort((a, b) => b.medianPrice - a.medianPrice)[0];

  return [
    {
      title: "价格带优先看 6k-12k 的主战场",
      body: topBand
        ? `${topBand.label} 当前聚集 ${topBand.count} 个商品，是页面默认监控的核心价格带。`
        : "当前价格带数据不足，需要先完成更多抓取。",
      metric: topBand ? `${topBand.count} SKU` : "待补齐",
      owner: "AI 自动监控，人工定策略",
      confidence: "中",
    },
    {
      title: "价格变化可以自动预警",
      body: mostChangedSite
        ? `${mostChangedSite.label} 最近一次记录到 ${mostChangedSite.priceChanges} 个价格变化，适合设置每日变价提醒。`
        : "当前缺少 price change 文件，需先跑至少两次同源抓取。",
      metric: mostChangedSite ? `${mostChangedSite.priceChanges} changes` : "待建立",
      owner: "AI/脚本",
      confidence: mostChangedSite?.priceChanges ? "高" : "低",
    },
    {
      title: "跨平台价格口径需要人工判读",
      body:
        lowestMedian && highestMedian
          ? `${lowestMedian.site} 当前中位价约低于 ${highestMedian.site}，但是否为同规格竞争，需要人工确认 SKU 匹配。`
          : "价格历史存在，但还需要更稳定的 SKU 对齐逻辑。",
      metric:
        lowestMedian && highestMedian
          ? `${lowestMedian.site} $${lowestMedian.medianPrice} vs ${highestMedian.site} $${highestMedian.medianPrice}`
          : "待对齐",
      owner: "人主导，AI 辅助",
      confidence: "中",
    },
    {
      title: "品牌和规格识别可先自动打底",
      body: `当前约 ${round(unknownBrandRate * 100, 1)}% 商品未识别品牌。AI 可以从标题和详情页抽取，但主竞品名单仍需你确认。`,
      metric: `${round((1 - unknownBrandRate) * 100, 1)}% brand coverage`,
      owner: "AI 归类 + 人复核",
      confidence: "中",
    },
  ];
}

function buildAutomationMatrix() {
  return [
    {
      area: "商品与价格采集",
      aiRole: "按平台抓取 latest_products、识别新增/下架/变价。",
      autoUpdate: "高",
      humanRole: "决定抓取频率、目标平台、是否接受验证码/代理成本。",
      pageModule: "平台概览、价格变化、产品库",
    },
    {
      area: "标题规格抽取",
      aiRole: "从标题/详情页抽取品牌、BTU、吨位、电压、变频、冷暖类型。",
      autoUpdate: "中高",
      humanRole: "定义标准字段和容错规则，抽样复核关键型号。",
      pageModule: "产品矩阵、规格覆盖",
    },
    {
      area: "价格带与定位",
      aiRole: "自动生成价格带分布、平台中位价、折扣深度、异常降价提醒。",
      autoUpdate: "高",
      humanRole: "判断是否跟价、避开价格战，决定目标毛利和价格锚点。",
      pageModule: "价格带图、机会板",
    },
    {
      area: "竞品名单分层",
      aiRole: "按品牌、价格、规格、平台热度提出候选直接竞品和标杆竞品。",
      autoUpdate: "中",
      humanRole: "确认谁是真正竞品，排除非同类、灰牌、清仓和异常商品。",
      pageModule: "品牌榜、Watchlist",
    },
    {
      area: "Listing 内容诊断",
      aiRole: "检查标题、图片、卖点、规格完整度，生成改进建议。",
      autoUpdate: "中",
      humanRole: "确定品牌表达、卖点优先级、合规措辞和本地化口径。",
      pageModule: "Listing 诊断",
    },
    {
      area: "评论与口碑洞察",
      aiRole: "抓取/汇总评论主题，归类安装、噪音、物流、售后等痛点。",
      autoUpdate: "中",
      humanRole: "判断哪些痛点是真实机会，哪些只是个别投诉或平台偏差。",
      pageModule: "口碑雷达",
    },
    {
      area: "战略结论与取舍",
      aiRole: "整理证据、发现异常、生成备选打法。",
      autoUpdate: "低",
      humanRole: "决定市场进入、SKU 组合、渠道优先级、资源投入和风险接受度。",
      pageModule: "决策备忘录",
    },
  ];
}

function buildExecutionChecklist() {
  return [
    {
      id: "A01",
      priority: "P0",
      title: "多平台商品与价格每日更新",
      objective: "每天刷新 Coppel、Elektra、HomeDepotMX、WalmartMX 的商品池、价格、上新、下架和变价。",
      dataNeeded: "latest_products.json、latest_price_changes.json、runs/latest_run.json、SQLite price_facts",
      aiAutomation: "串联现有 crawler，本机用 LaunchAgent，云端用 GitHub Actions + PROXY_URL Secret，运行前检查代理/站点可达性。",
      output: "每日更新的数据层 + 日志 + 网页 KPI/价格趋势/重点变价 + 云端 artifact",
      acceptance: "云端 workflow 可定时触发；失败平台显示原因；至少两次抓取后能识别变价。",
      humanGate: "确认运行时间、云端代理、验证码处理方式、必须覆盖的平台和数据持久化方式。",
      status: "可云端部署",
      pageModule: "平台概览、重点变价、价格趋势",
    },
    {
      id: "A02",
      priority: "P0",
      title: "SKU 标准字段自动抽取",
      objective: "把标题和详情页转换成可比较字段：品牌、产品系列、型号、吨位/BTU、电压、变频、冷暖、安装类型。",
      dataNeeded: "商品标题、PDP 详情、pdp_specs_json/detail_specs_json、Prime 规格表",
      aiAutomation: "规则抽取标题字段，优先识别标题中的明确系列名，其次用低置信度型号族补充，生成 confidence 和待人工复核列表。",
      output: "data/normalized_skus/latest_normalized_skus.json/csv + SQLite sku_normalized_fields 表",
      acceptance: "核心字段覆盖率超过 85%；低置信度 SKU 单独列出；抽样 30 个关键 SKU 准确率可接受。",
      humanGate: "定义标准字段口径，确认 1T/12000 BTU、110/115/127V 等等价规则。",
      status: "已打底",
      pageModule: "产品库、规格覆盖、筛选器",
    },
    {
      id: "A03",
      priority: "P0",
      title: "竞品池自动分层",
      objective: "把所有商品分成直接竞品、价格标杆、功能标杆、替代品和排除项。",
      dataNeeded: "标准规格字段、价格、平台、品牌、商品链接、你指定的目标 SKU",
      aiAutomation: "按价格带、规格相似度、品牌和平台覆盖生成候选竞品分组。",
      output: "watchlist + competitor_tier 字段",
      acceptance: "每个目标 SKU 至少给出 5-10 个候选可比竞品；排除便携风扇/冷风机等非同类。",
      humanGate: "最终确认哪些是真竞品，哪些只是噪音或不可比。",
      status: "待启动",
      pageModule: "Watchlist、竞品分层",
    },
    {
      id: "A04",
      priority: "P1",
      title: "价格带与机会区间自动识别",
      objective: "自动发现高密度价格带、低竞争价格带、异常高/低价 SKU 和促销强度。",
      dataNeeded: "价格历史、标准规格、平台、品牌、折扣字段",
      aiAutomation: "按规格和价格带计算中位价、分位数、折扣深度、价格异常。",
      output: "机会板：主战场、避让区、可尝试价格锚点",
      acceptance: "能够按 1T/1.5T/2T、变频/非变频分别输出价格区间；异常项可点回商品链接。",
      humanGate: "决定是否跟价、打差异化，输入成本和毛利底线。",
      status: "已打底",
      pageModule: "价格带、机会板",
    },
    {
      id: "A05",
      priority: "P1",
      title: "Listing 内容诊断",
      objective: "自动评估竞品标题、图片、卖点、规格完整度和本地化表达。",
      dataNeeded: "商品标题、主图、详情页描述、规格表、可选评论/问答",
      aiAutomation: "生成 Listing 评分、缺失字段、卖点主题和可借鉴表达。",
      output: "listing_score、missing_fields、copywriting_notes",
      acceptance: "每个重点竞品有一页诊断；能指出标题、规格、图文、服务承诺的缺口。",
      humanGate: "确认品牌语气、合规措辞、哪些卖点能被我们真实承诺。",
      status: "待补详情页",
      pageModule: "Listing 诊断",
    },
    {
      id: "A06",
      priority: "P1",
      title: "价格变化预警",
      objective: "对重点品牌/重点 SKU 的降价、涨价、新品、下架自动提醒。",
      dataNeeded: "watchlist、latest_price_changes、price_facts",
      aiAutomation: "从 SQLite price_facts 生成每日摘要：大幅降价、涨价、新品进入、竞品下架和抓取覆盖异常。",
      output: "data/daily_alerts/latest_alerts.json + 页面提醒区",
      acceptance: "可配置品牌/SKU/价格阈值；每条提醒有原因、幅度、链接和建议动作。",
      humanGate: "定义哪些品牌/SKU 值得提醒，以及多大变化需要动作。",
      status: "已打底",
      pageModule: "提醒中心",
    },
    {
      id: "A07",
      priority: "P2",
      title: "评论与口碑主题挖掘",
      objective: "提炼用户抱怨和购买理由，尤其是安装、噪音、制冷、电费、物流、售后。",
      dataNeeded: "平台评论、评分、问答、售后反馈或手动导出评论",
      aiAutomation: "评论聚类、情绪分类、痛点趋势和典型原文摘录。",
      output: "pain_points、review_topics、opportunity_notes",
      acceptance: "每个重点品牌能输出 Top 痛点和正向卖点；低样本商品标注样本不足。",
      humanGate: "判断哪些痛点是结构性机会，哪些只是个案。",
      status: "待数据源",
      pageModule: "口碑雷达",
    },
    {
      id: "A08",
      priority: "P2",
      title: "月度竞品简报自动生成",
      objective: "把每月价格、上新、品牌变化、机会点和人工决策记录生成简报。",
      dataNeeded: "dashboard data、watchlist、人工备注、价格历史",
      aiAutomation: "自动生成摘要、图表解释、变化归因候选和下月关注项。",
      output: "monthly_competitor_brief.md/html",
      acceptance: "能回答本月谁降价、谁上新、哪个价格带变热、我们该看什么。",
      humanGate: "审定最终结论、策略建议和对外分享口径。",
      status: "待前置项",
      pageModule: "月报",
    },
  ];
}

function buildHumanInputs() {
  return [
    "目标品牌/自有产品的型号、成本、毛利底线和库存约束",
    "真正想对标的竞品品牌与价格带，而不是所有可抓到商品",
    "线下渠道、经销商政策、安装服务、保修体验等非公开信息",
    "当地消费者场景判断：高温州、用电成本敏感、房型和安装限制",
    "最终策略取舍：跟价、差异化、做套装、做服务承诺，还是避开主战场",
  ];
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const allProducts = [];
  const allChanges = [];
  const siteSummaries = [];
  const normalizedSkus = await readJson(NORMALIZED_SKUS_PATH, {
    status: "missing",
    summary: {},
    bySeries: [],
    byReviewFlag: [],
    rows: [],
  });
  const normalizedByKey = new Map(
    (normalizedSkus.rows || [])
      .filter((row) => row.siteId && row.productId)
      .map((row) => [`${row.siteId}:${row.productId}`, row]),
  );
  const dailyAlerts = await readJson(ALERTS_PATH, {
    status: "missing",
    summary: {
      actionableAlerts: 0,
      priceDrops: 0,
      priceIncreases: 0,
      newProducts: 0,
      removedProducts: 0,
      coverageAlerts: 0,
    },
    priceDrops: [],
    priceIncreases: [],
    newProducts: [],
    removedProducts: [],
    coverageAlerts: [],
    dataQuality: [],
  });

  for (const site of SITE_CONFIG) {
    const latest = asArray(await readJson(site.latestPath, []));
    const changes = asArray(await readJson(site.changesPath, []));
    const run = compactRun(await readJson(site.runPath, null));
    const rows = latest
      .map((row) => normalizeProduct(row, site, normalizedByKey.get(`${site.id}:${sourceProductId(row)}`)))
      .filter((row) => row.title && Number.isFinite(row.price));
    const normalizedChanges = changes.map((row) => normalizeChange(row, site));
    allProducts.push(...rows);
    allChanges.push(...normalizedChanges);
    siteSummaries.push(summarizeSite(site, rows, normalizedChanges, run));
  }

  const trend = buildTrendRows();
  const prices = allProducts.map((row) => row.price).filter(Number.isFinite);
  const priceBands = buildPriceBands(allProducts);
  const latestTrendDate = trend.at(-1)?.date || null;
  const oldestTrendDate = trend[0]?.date || null;
  const changeCounts = countChangeTypes(allChanges);

  const data = {
    generatedAt: new Date().toISOString(),
    sourceRoot: ROOT,
    dateRange: {
      start: oldestTrendDate,
      end: latestTrendDate,
      trackedDays: new Set(trend.map((row) => row.date)).size,
    },
    summary: {
      totalProducts: allProducts.length,
      sitesTracked: siteSummaries.length,
      medianPrice: round(median(prices)),
      avgPrice: round(average(prices)),
      latestPriceChanges: changeCounts.price_changed || 0,
      latestNewProducts: changeCounts.new_product || 0,
      latestRemovedProducts: changeCounts.removed_product || 0,
      dailyActionableAlerts: dailyAlerts.summary?.actionableAlerts || 0,
      dailyPriceDrops: dailyAlerts.summary?.priceDrops || 0,
      dailyPriceIncreases: dailyAlerts.summary?.priceIncreases || 0,
      dailyNewProducts: dailyAlerts.summary?.newProducts || 0,
      dailyRemovedProducts: dailyAlerts.summary?.removedProducts || 0,
      skuSeriesCoveragePct: normalizedSkus.summary?.seriesCoveragePct || 0,
      skuNamedSeriesCoveragePct: normalizedSkus.summary?.namedSeriesCoveragePct || 0,
      skuCapacityCoveragePct: normalizedSkus.summary?.capacityCoveragePct || 0,
      skuReviewNeeded: normalizedSkus.summary?.reviewNeeded || 0,
      inferredBrandCoveragePct: round(
        ((allProducts.length - allProducts.filter((row) => row.brand === "未识别").length) / allProducts.length) * 100,
        1,
      ),
      inferredCapacityCoveragePct: round(
        (allProducts.filter((row) => Number.isFinite(row.capacityTon)).length / allProducts.length) * 100,
        1,
      ),
    },
    sites: siteSummaries,
    products: allProducts.sort((a, b) => a.price - b.price).slice(0, 1200),
    priceChanges: allChanges
      .filter((row) => row.changeType === "price_changed")
      .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0))
      .slice(0, 60),
    priceBands,
    brandLeaderboard: summarizeDimension(allProducts, "brand", 16),
    seriesLeaderboard: summarizeDimension(
      allProducts.filter((row) => row.isAirConditioner && row.series && row.series !== "未识别"),
      "seriesDisplay",
      16,
    ),
    categoryMix: summarizeDimension(allProducts, "category", 10),
    trend,
    skuNormalization: {
      source: NORMALIZED_SKUS_PATH,
      generatedAt: normalizedSkus.generatedAt || null,
      summary: normalizedSkus.summary || {},
      byReviewFlag: normalizedSkus.byReviewFlag || [],
    },
    dailyAlerts,
    insights: buildInsights({ rows: allProducts, sites: siteSummaries, priceBands, changes: allChanges, trend }),
    executionChecklist: buildExecutionChecklist(),
    automationMatrix: buildAutomationMatrix(),
    humanInputs: buildHumanInputs(),
    methodology: {
      automaticSources: SITE_CONFIG.map((site) => ({
        site: site.label,
        products: site.latestPath,
        priceChanges: site.changesPath,
        run: site.runPath,
      })),
      historySource: "data/ac_price_monitor_mexico_v2.db: price_facts + product_master",
      alertsSource: ALERTS_PATH,
      normalizedSkuSource: NORMALIZED_SKUS_PATH,
      fieldNotes: [
        "价格使用 sale_price_mxn；original_price_mxn 仅作为折扣参考。",
        "提醒中心来自 SQLite price_facts 的最新日期与历史日期对比，可用于发现降价、涨价、上新、下架和抓取覆盖异常。",
        "SKU 标准字段来自标题和已抓取字段的规则抽取；产品系列优先使用标题中的明确系列名，其次才使用低置信度型号族。",
        "品牌、品类、吨位、电压、变频字段为标题/已抓取字段推断，适合作为候选分类，关键 SKU 仍需人工复核。",
        "现有数据不包含真实销量、广告投放、评分评论和线下渠道政策；网页会把这些标为人工/后续数据源。",
      ],
    },
  };

  const js = `window.COMPETITOR_DASHBOARD_DATA = ${JSON.stringify(data, null, 2)};\n`;
  await fs.writeFile(OUT_FILE, js, "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);
  console.log(
    `Products: ${data.summary.totalProducts}; sites: ${data.summary.sitesTracked}; trend days: ${data.dateRange.trackedDays}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
