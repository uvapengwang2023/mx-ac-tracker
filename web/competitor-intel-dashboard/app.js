const data = window.COMPETITOR_DASHBOARD_DATA;

const siteColors = {
  Coppel: "#0f766e",
  Elektra: "#bd6b00",
  HomeDepotMX: "#c2412d",
  WalmartMX: "#3f7d20",
};

const state = {
  site: "all",
  category: "all",
  search: "",
  trendMetric: "medianPrice",
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

const numberFmt = new Intl.NumberFormat("zh-CN");

function $(id) {
  return document.getElementById(id);
}

function formatMoney(value) {
  return Number.isFinite(value) ? money.format(value) : "-";
}

function formatNumber(value) {
  return Number.isFinite(value) ? numberFmt.format(value) : "-";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function filteredProducts() {
  const query = state.search.trim().toLowerCase();
  return data.products.filter((product) => {
    const siteOk = state.site === "all" || product.site === state.site;
    const categoryOk = state.category === "all" || product.category === state.category;
    const queryOk =
      !query ||
      [product.brand, product.title, product.productId].some((value) =>
        String(value || "").toLowerCase().includes(query),
      );
    return siteOk && categoryOk && queryOk;
  });
}

function renderOptions() {
  const sites = ["all", ...data.sites.map((site) => site.label)];
  $("siteFilter").innerHTML = sites
    .map((site) => `<option value="${escapeHtml(site)}">${site === "all" ? "全部平台" : escapeHtml(site)}</option>`)
    .join("");

  const categories = ["all", ...new Set(data.products.map((product) => product.category).filter(Boolean))];
  $("categoryFilter").innerHTML = categories
    .map((category) => `<option value="${escapeHtml(category)}">${category === "all" ? "全部品类" : escapeHtml(category)}</option>`)
    .join("");
}

function renderKpis(products) {
  const prices = products.map((product) => product.price).filter(Number.isFinite).sort((a, b) => a - b);
  const medianPrice = prices.length
    ? prices.length % 2
      ? prices[Math.floor(prices.length / 2)]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
    : null;

  const kpis = [
    ["当前 SKU", formatNumber(products.length), `${data.summary.sitesTracked} 个平台`],
    ["价格中位数", formatMoney(medianPrice), "按当前筛选"],
    ["今日提醒", formatNumber(data.summary.dailyActionableAlerts || 0), "来自 SQLite 历史对比"],
    ["最新变价", formatNumber(data.summary.latestPriceChanges), "来自 price change 文件"],
    ["品牌识别率", `${data.summary.inferredBrandCoveragePct}%`, "标题/字段推断"],
    ["历史天数", formatNumber(data.dateRange.trackedDays), `${data.dateRange.start || "-"} 至 ${data.dateRange.end || "-"}`],
  ];

  $("kpiGrid").innerHTML = kpis
    .map(
      ([label, value, note]) => `
        <article class="kpi">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(note)}</small>
        </article>
      `,
    )
    .join("");
}

function dailyAlerts() {
  return (
    data.dailyAlerts || {
      status: "missing",
      summary: {},
      priceDrops: [],
      priceIncreases: [],
      newProducts: [],
      removedProducts: [],
      coverageAlerts: [],
      dataQuality: [],
    }
  );
}

function alertTypeLabel(type) {
  return {
    price_drop: "降价",
    price_increase: "涨价",
    new_product: "新品",
    removed_product: "下架",
    coverage_drop: "覆盖异常",
  }[type] || "提醒";
}

function alertValue(alert) {
  if (alert.type === "price_drop" || alert.type === "price_increase") {
    return `${formatMoney(alert.oldPrice)} -> ${formatMoney(alert.newPrice)} (${alert.delta > 0 ? "+" : ""}${formatMoney(alert.delta)})`;
  }
  if (alert.type === "coverage_drop") {
    return `${formatNumber(alert.previousCount)} -> ${formatNumber(alert.latestCount)} SKU`;
  }
  return formatMoney(alert.price);
}

function renderDailyAlerts() {
  const alerts = dailyAlerts();
  const summary = alerts.summary || {};
  $("alertDate").textContent = alerts.latestDate ? `${alerts.latestDate}` : alerts.status || "-";
  $("alertSummary").innerHTML = [
    ["降价", summary.priceDrops || 0],
    ["涨价", summary.priceIncreases || 0],
    ["新品", summary.newProducts || 0],
    ["下架", summary.removedProducts || 0],
    ["异常", summary.coverageAlerts || 0],
  ]
    .map(
      ([label, value]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${formatNumber(value)}</strong>
        </div>
      `,
    )
    .join("");

  const cards = [
    ...(alerts.coverageAlerts || []),
    ...(alerts.priceDrops || []).slice(0, 5),
    ...(alerts.priceIncreases || []).slice(0, 3),
    ...(alerts.newProducts || []).slice(0, 3),
    ...(alerts.removedProducts || []).slice(0, 3),
  ].slice(0, 14);

  if (!cards.length) {
    const note = alerts.dataQuality?.[0]?.message || "当前没有达到阈值的自动提醒。";
    $("alertCards").innerHTML = `<article class="alert-card empty"><h3>暂无重点提醒</h3><p>${escapeHtml(note)}</p></article>`;
    return;
  }

  $("alertCards").innerHTML = cards
    .map((alert) => {
      const title = alert.link
        ? `<a href="${escapeHtml(alert.link)}" target="_blank" rel="noreferrer">${escapeHtml(alert.title || alert.website)}</a>`
        : escapeHtml(alert.title || alert.website);
      return `
        <article class="alert-card ${escapeHtml(alert.severity || "low")}">
          <header>
            <span class="alert-type">${escapeHtml(alertTypeLabel(alert.type))}</span>
            <strong>${escapeHtml(alert.website || "-")}</strong>
          </header>
          <h3>${title}</h3>
          <p class="alert-value">${escapeHtml(alertValue(alert))}</p>
          <p>${escapeHtml(alert.reason || "")}</p>
        </article>
      `;
    })
    .join("");
}

function renderTrend() {
  const metric = state.trendMetric;
  const rows = data.trend.filter((row) => Number.isFinite(row[metric]));
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const sites = [...new Set(rows.map((row) => row.site))].sort();
  const values = rows.map((row) => row[metric]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min) * 0.08 || 1;
  const low = min - padding;
  const high = max + padding;
  const width = 900;
  const height = 310;
  const margin = { top: 18, right: 18, bottom: 42, left: 72 };
  const x = (date) => {
    const index = dates.indexOf(date);
    return margin.left + (index / Math.max(dates.length - 1, 1)) * (width - margin.left - margin.right);
  };
  const y = (value) =>
    height - margin.bottom - ((value - low) / Math.max(high - low, 1)) * (height - margin.top - margin.bottom);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => low + (high - low) * pct);
  const grid = yTicks
    .map((tick) => {
      const yy = y(tick);
      const label = metric === "productCount" ? formatNumber(Math.round(tick)) : formatMoney(tick);
      return `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${yy}" y2="${yy}"></line>
        <text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" fill="#6a7377" font-size="11">${label}</text>`;
    })
    .join("");

  const siteLines = sites
    .map((site) => {
      const siteRows = rows.filter((row) => row.site === site).sort((a, b) => a.date.localeCompare(b.date));
      const points = siteRows.map((row) => `${x(row.date)},${y(row[metric])}`).join(" ");
      const dots = siteRows
        .filter((_, index) => index === siteRows.length - 1 || index % Math.ceil(siteRows.length / 8) === 0)
        .map(
          (row) =>
            `<circle class="dot" cx="${x(row.date)}" cy="${y(row[metric])}" r="4" fill="${siteColors[site] || "#4f6673"}"></circle>`,
        )
        .join("");
      return `<polyline class="line" points="${points}" stroke="${siteColors[site] || "#4f6673"}"></polyline>${dots}`;
    })
    .join("");

  const dateLabels = dates
    .filter((_, index) => index === 0 || index === dates.length - 1 || index % Math.ceil(dates.length / 5) === 0)
    .map(
      (date) =>
        `<text x="${x(date)}" y="${height - 14}" text-anchor="middle" fill="#6a7377" font-size="11">${date.slice(5)}</text>`,
    )
    .join("");

  $("trendChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      ${grid}
      <line class="axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
      <line class="axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
      ${siteLines}
      ${dateLabels}
    </svg>
  `;

  $("trendLegend").innerHTML = sites
    .map(
      (site) => `
        <span class="legend-item">
          <i class="swatch" style="background:${siteColors[site] || "#4f6673"}"></i>${escapeHtml(site)}
        </span>
      `,
    )
    .join("");
}

function renderPriceBands() {
  const max = Math.max(...data.priceBands.map((band) => band.count), 1);
  $("priceBands").innerHTML = data.priceBands
    .map(
      (band) => `
        <div class="bar-row">
          <strong>${escapeHtml(band.label)}</strong>
          <div class="bar-track"><div class="bar-fill" style="width:${(band.count / max) * 100}%"></div></div>
          <span>${formatNumber(band.count)}</span>
        </div>
      `,
    )
    .join("");
}

function renderSites() {
  $("siteCards").innerHTML = data.sites
    .map(
      (site) => `
        <article class="site-card">
          <header>
            <h3>${escapeHtml(site.label)}</h3>
            <span class="tag">${escapeHtml(site.run?.databaseDate || "-")}</span>
          </header>
          <dl>
            <div><dt>SKU</dt><dd>${formatNumber(site.productCount)}</dd></div>
            <div><dt>中位价</dt><dd>${formatMoney(site.medianPrice)}</dd></div>
            <div><dt>变价</dt><dd>${formatNumber(site.priceChanges)}</dd></div>
          </dl>
        </article>
      `,
    )
    .join("");
}

function renderBrandLeaderboard() {
  const max = Math.max(...data.brandLeaderboard.map((brand) => brand.count), 1);
  $("brandLeaderboard").innerHTML = data.brandLeaderboard
    .map(
      (brand) => `
        <div class="rank-row">
          <strong title="${escapeHtml(brand.name)}">${escapeHtml(brand.name)}</strong>
          <span>${formatNumber(brand.count)} SKU</span>
          <span>${formatMoney(brand.medianPrice)}</span>
          <div class="bar-track" style="grid-column: 1 / -1"><div class="bar-fill" style="width:${(brand.count / max) * 100}%"></div></div>
        </div>
      `,
    )
    .join("");
}

function renderAutomation() {
  $("automationGrid").innerHTML = data.automationMatrix
    .map(
      (item) => `
        <article class="automation-card">
          <span class="level">自动化 ${escapeHtml(item.autoUpdate)}</span>
          <h3>${escapeHtml(item.area)}</h3>
          <p><strong>AI：</strong>${escapeHtml(item.aiRole)}</p>
          <p><strong>你：</strong>${escapeHtml(item.humanRole)}</p>
          <span class="tag">${escapeHtml(item.pageModule)}</span>
        </article>
      `,
    )
    .join("");
}

function renderExecutionChecklist() {
  $("executionChecklist").innerHTML = data.executionChecklist
    .map(
      (item) => `
        <article class="checklist-card">
          <header>
            <div>
              <div class="meta">
                <span class="pill">${escapeHtml(item.id)}</span>
                <span class="pill">${escapeHtml(item.priority)}</span>
              </div>
              <h3>${escapeHtml(item.title)}</h3>
            </div>
            <span class="status">${escapeHtml(item.status)}</span>
          </header>
          <p>${escapeHtml(item.objective)}</p>
          <p><strong>AI/脚本：</strong>${escapeHtml(item.aiAutomation)}</p>
          <p><strong>你：</strong>${escapeHtml(item.humanGate)}</p>
          <p class="acceptance"><strong>验收：</strong>${escapeHtml(item.acceptance)}</p>
          <span class="tag">${escapeHtml(item.pageModule)}</span>
        </article>
      `,
    )
    .join("");
}

function renderInsights() {
  $("insights").innerHTML = data.insights
    .map(
      (insight) => `
        <article class="insight">
          <header>
            <h3>${escapeHtml(insight.title)}</h3>
            <strong>${escapeHtml(insight.metric)}</strong>
          </header>
          <p>${escapeHtml(insight.body)}</p>
          <span>${escapeHtml(insight.owner)} · 置信度 ${escapeHtml(insight.confidence)}</span>
        </article>
      `,
    )
    .join("");
}

function renderHumanInputs() {
  $("humanInputs").innerHTML = data.humanInputs.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderPriceChanges() {
  $("priceChangeRows").innerHTML = data.priceChanges
    .slice(0, 28)
    .map((row) => {
      const klass = row.delta > 0 ? "price-up" : "price-down";
      const link = row.productUrl
        ? `<a href="${escapeHtml(row.productUrl)}" target="_blank" rel="noreferrer">${escapeHtml(row.title)}</a>`
        : escapeHtml(row.title);
      return `
        <tr>
          <td>${escapeHtml(row.site)}</td>
          <td>${link}</td>
          <td>${formatMoney(row.oldPrice)}</td>
          <td>${formatMoney(row.newPrice)}</td>
          <td class="${klass}">${row.delta > 0 ? "+" : ""}${formatMoney(row.delta)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderProducts() {
  const rows = filteredProducts();
  $("productCount").textContent = formatNumber(rows.length);
  $("productRows").innerHTML = rows
    .slice(0, 220)
    .map((product) => {
      const title = product.productUrl
        ? `<a href="${escapeHtml(product.productUrl)}" target="_blank" rel="noreferrer">${escapeHtml(product.title)}</a>`
        : escapeHtml(product.title);
      const image = product.imageUrl
        ? `<img class="thumb" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.brand)}" loading="lazy" />`
        : "";
      return `
        <tr>
          <td>${image}</td>
          <td>${escapeHtml(product.site)}</td>
          <td>${escapeHtml(product.brand)}</td>
          <td class="product-title">${title}</td>
          <td>${escapeHtml(product.category)}</td>
          <td>${product.capacityTon ? `${product.capacityTon}T` : "-"}</td>
          <td>${escapeHtml(product.voltage || "-")}</td>
          <td>${formatMoney(product.price)}</td>
          <td>${product.discountPct ? `${product.discountPct}%` : "-"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderMethodology() {
  $("methodology").innerHTML = `
    <p>历史来源：${escapeHtml(data.methodology.historySource)}</p>
    <p>提醒来源：${escapeHtml(data.methodology.alertsSource || "data/daily_alerts/latest_alerts.json")}</p>
    <ul>
      ${data.methodology.fieldNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
    </ul>
  `;
}

function renderAll() {
  const products = filteredProducts();
  $("generatedAt").textContent = formatDate(data.generatedAt);
  renderKpis(products);
  renderTrend();
  renderDailyAlerts();
  renderPriceBands();
  renderSites();
  renderBrandLeaderboard();
  renderExecutionChecklist();
  renderAutomation();
  renderInsights();
  renderHumanInputs();
  renderPriceChanges();
  renderProducts();
  renderMethodology();
}

function wireEvents() {
  $("siteFilter").addEventListener("change", (event) => {
    state.site = event.target.value;
    renderAll();
  });
  $("categoryFilter").addEventListener("change", (event) => {
    state.category = event.target.value;
    renderAll();
  });
  $("brandSearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderAll();
  });
  $("trendMetric").addEventListener("change", (event) => {
    state.trendMetric = event.target.value;
    renderTrend();
  });
}

renderOptions();
wireEvents();
renderAll();
