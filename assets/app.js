(function () {
  "use strict";

  const DATA_URL = "./data/finished-stock-count.csv";
  const numberFormat = new Intl.NumberFormat("en-US");
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

  const state = {
    rows: [],
    view: [],
    base: [],
    query: "",
    status: "all",
    brand: "all",
    category: "all",
    sortKey: "variance",
    sortDir: "asc",
    page: 1,
    pageSize: 25,
    selectedSku: null
  };

  const els = {};
  let toastTimer = null;
  let lastFocused = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      "sourceDot", "sourceLabel", "themeToggle", "exportTop",
      "kpiSkus", "kpiSkusFoot", "kpiCounted", "kpiCountedFoot",
      "kpiExpected", "kpiExpectedFoot", "kpiVariance", "kpiVarianceFoot",
      "varianceKpi", "varianceDirection", "compareScope",
      "countedValue", "countedBar", "countedPct",
      "expectedValue", "expectedBar", "expectedPct",
      "varianceDot", "varianceSentence", "coverageNote",
      "matchBadge", "matchRate", "mixTrack",
      "mixMatch", "mixUnder", "mixOver",
      "mixMatchCount", "mixUnderCount", "mixOverCount",
      "viewCount", "search", "searchHint", "searchClear", "brandFilter",
      "categoryFilter", "resetFilters", "countAll", "countMatch",
      "countUnder", "countOver", "resultSummary", "sortNote",
      "tableBody", "emptyState", "emptyTitle", "emptyCopy", "emptyReset",
      "pagination", "pageLabel", "prevPage", "nextPage", "pageSize",
      "drawer", "drawerBackdrop", "drawerTitle", "drawerBody", "drawerClose",
      "toast", "tableTitle"
    ].forEach((id) => {
      els[id] = byId(id);
    });
    els.searchField = els.search.closest(".search-field");
    els.tableScroll = document.querySelector(".table-scroll");
    els.statusButtons = Array.from(document.querySelectorAll(".status-pill"));
    els.mixButtons = Array.from(document.querySelectorAll(".mix-item"));
    els.sortButtons = Array.from(document.querySelectorAll("th button[data-sort]"));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function formatNumber(value) {
    return numberFormat.format(value);
  }

  function formatSigned(value) {
    if (!value) return "0";
    return (value > 0 ? "+" : "\u2212") + formatNumber(Math.abs(value));
  }

  function formatPercent(value, digits) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "\u2014";
    return (value.toFixed(digits === undefined ? 1 : digits) + "%").replace(/^-/, "\u2212");
  }

  function highlight(text) {
    const raw = String(text == null ? "" : text);
    const tokens = state.query.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return escapeHtml(raw);
    const pattern = new RegExp("(" + tokens.map(escapeRegExp).join("|") + ")", "gi");
    let output = "";
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      output += escapeHtml(raw.slice(lastIndex, match.index));
      output += "<mark>" + escapeHtml(match[0]) + "</mark>";
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    output += escapeHtml(raw.slice(lastIndex));
    return output;
  }

  function parseCsv(text) {
    const records = [];
    let record = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];

      if (inQuotes) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += character;
        }
        continue;
      }

      if (character === '"') {
        inQuotes = true;
      } else if (character === ",") {
        record.push(field);
        field = "";
      } else if (character === "\n") {
        record.push(field);
        records.push(record);
        record = [];
        field = "";
      } else if (character !== "\r") {
        field += character;
      }
    }

    if (field.length > 0 || record.length > 0) {
      record.push(field);
      records.push(record);
    }

    return records;
  }

  function toNumber(value) {
    const parsed = Number.parseInt(String(value == null ? "" : value).trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function buildRows(csvRecords) {
    if (!csvRecords.length) return [];
    const headers = csvRecords[0].map((header) => header.replace(/^\uFEFF/, "").trim());
    const column = {};
    headers.forEach((header, index) => {
      column[header] = index;
    });

    const required = ["Sku", "Description", "Brand", "Counted", "External Expected"];
    if (required.some((name) => column[name] === undefined)) {
      throw new Error("Count file is missing required columns.");
    }

    const rows = [];
    for (let index = 1; index < csvRecords.length; index += 1) {
      const record = csvRecords[index];
      const sku = (record[column.Sku] || "").trim();
      if (!sku) continue;

      const counted = toNumber(record[column.Counted]);
      const expected = toNumber(record[column["External Expected"]]);
      const variance = counted - expected;
      const description = (record[column.Description] || "").trim();
      const brand = (record[column.Brand] || "").trim();
      const barcode = (record[column.Barcode] !== undefined ? record[column.Barcode] : sku).trim();
      const style = (record[column.Style] || "").trim();
      const size = (record[column.Size] || "").trim();
      const category = (record[column.Category] || "").trim();
      const segment = (record[column["Category Description"]] || "").trim();

      rows.push({
        sku: sku,
        barcode: barcode,
        brand: brand,
        description: description,
        style: style,
        size: size,
        category: category,
        segment: segment,
        counted: counted,
        expected: expected,
        variance: variance,
        absVariance: Math.abs(variance),
        status: variance > 0 ? "over" : variance < 0 ? "under" : "match",
        clarityExpected: toNumber(record[column["Clarity Expected"]]),
        overs: toNumber(record[column.Overs]),
        unders: toNumber(record[column.Unders]),
        sold: toNumber(record[column.Sold]),
        missing: toNumber(record[column.Missing]),
        ghost: toNumber(record[column.Ghost]),
        drift: toNumber(record[column.Drift]),
        newItems: toNumber(record[column.New]),
        previouslyNotCounted: toNumber(record[column["Previously Not Counted"]]),
        haystack: [
          sku, barcode, description, style, brand, size, category, segment
        ].join(" ").toLowerCase()
      });
    }
    return rows;
  }

  function matchesQuery(row, tokens) {
    return tokens.every((token) => row.haystack.includes(token));
  }

  function filterRows(options) {
    const settings = options || {};
    const tokens = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);

    return state.rows.filter((row) => {
      if (state.brand !== "all" && row.brand !== state.brand) return false;
      if (state.category !== "all" && row.segment !== state.category) return false;
      if (tokens.length && !matchesQuery(row, tokens)) return false;
      if (!settings.ignoreStatus && state.status !== "all" && row.status !== state.status) return false;
      return true;
    });
  }

  function sortRows(rows) {
    const key = state.sortKey;
    const direction = state.sortDir === "asc" ? 1 : -1;

    return rows.slice().sort((a, b) => {
      let result = 0;
      switch (key) {
        case "sku":
          result = collator.compare(a.sku, b.sku);
          break;
        case "description":
          result = collator.compare(a.description, b.description);
          break;
        case "counted":
          result = a.counted - b.counted;
          break;
        case "expected":
          result = a.expected - b.expected;
          break;
        case "variance":
          result = a.variance - b.variance;
          break;
        default:
          result = a.absVariance - b.absVariance;
          break;
      }
      if (result === 0) {
        result = a.sku.localeCompare(b.sku, "en", { numeric: true });
      }
      return result * direction;
    });
  }

  function summarize(rows) {
    const summary = {
      skus: rows.length,
      counted: 0,
      expected: 0,
      variance: 0,
      matched: 0,
      under: 0,
      over: 0,
      countedSkus: 0,
      expectedSkus: 0
    };

    rows.forEach((row) => {
      summary.counted += row.counted;
      summary.expected += row.expected;
      summary.variance += row.variance;
      if (row.status === "match") summary.matched += 1;
      if (row.status === "under") summary.under += 1;
      if (row.status === "over") summary.over += 1;
      if (row.counted !== 0) summary.countedSkus += 1;
      if (row.expected !== 0) summary.expectedSkus += 1;
    });

    summary.matchRate = summary.skus ? (summary.matched / summary.skus) * 100 : null;
    summary.variancePct = summary.expected ? (summary.variance / Math.abs(summary.expected)) * 100 : null;
    summary.coverage = summary.expected ? (summary.counted / summary.expected) * 100 : null;
    return summary;
  }

  function updateAnalysis(summary) {
    const maxUnits = Math.max(summary.counted, summary.expected, 1);
    const countedWidth = Math.max(0, (summary.counted / maxUnits) * 100);
    const expectedWidth = Math.max(0, (summary.expected / maxUnits) * 100);

    els.countedValue.textContent = formatNumber(summary.counted);
    els.expectedValue.textContent = formatNumber(summary.expected);
    els.countedBar.style.width = countedWidth + "%";
    els.expectedBar.style.width = expectedWidth + "%";
    els.countedPct.textContent = formatPercent(countedWidth, 0);
    els.expectedPct.textContent = formatPercent(expectedWidth, 0);

    const isBalanced = summary.variance === 0;
    const isPositive = summary.variance > 0;
    const varianceClass = isBalanced ? "is-neutral" : isPositive ? "pos" : "";
    const varianceLabel = isBalanced ? "Balanced" : isPositive ? "Surplus" : "Shortfall";

    els.varianceDot.className = "variance-dot " + varianceClass;
    els.varianceSentence.innerHTML =
      "Net variance <strong class=\"" + varianceClass + "\">" +
      formatSigned(summary.variance) + " units</strong> vs external expected" +
      (summary.variancePct === null ? "" : " (" + formatPercent(summary.variancePct, 1) + ")") + ".";

    if (summary.coverage === null) {
      els.coverageNote.textContent = "No expected units in view";
    } else {
      els.coverageNote.textContent = "Counted covers " + formatPercent(summary.coverage, 1) + " of expected units";
    }

    els.matchRate.textContent = summary.matchRate === null ? "\u2014" : formatPercent(summary.matchRate, 1);
    els.matchBadge.textContent = summary.matched
      ? formatNumber(summary.matched) + " exact matches"
      : "No exact matches";

    const total = summary.skus || 1;
    const segments = [
      [els.mixMatch, summary.matched],
      [els.mixUnder, summary.under],
      [els.mixOver, summary.over]
    ];
    segments.forEach(([element, count]) => {
      element.style.flexGrow = String(count / total);
      element.style.flexBasis = "0%";
      element.style.display = count ? "block" : "none";
    });

    els.mixMatchCount.textContent = formatNumber(summary.matched);
    els.mixUnderCount.textContent = formatNumber(summary.under);
    els.mixOverCount.textContent = formatNumber(summary.over);

    els.compareScope.textContent = summary.skus === state.rows.length
      ? "All SKUs"
      : formatNumber(summary.skus) + " SKUs";
  }

  function updateKpis(summary) {
    const total = state.rows.length;
    els.kpiSkus.textContent = formatNumber(summary.skus);
    els.kpiSkusFoot.innerHTML = summary.skus === total
      ? "All <strong>" + formatNumber(total) + "</strong> SKUs in the count file"
      : "<strong>" + formatPercent(total ? (summary.skus / total) * 100 : 0, 1) + "</strong> of " + formatNumber(total) + " SKUs in file";

    els.kpiCounted.textContent = formatNumber(summary.counted);
    els.kpiCountedFoot.innerHTML = "<strong>" + formatNumber(summary.countedSkus) + "</strong> SKUs with counted units";

    els.kpiExpected.textContent = formatNumber(summary.expected);
    els.kpiExpectedFoot.innerHTML = "<strong>" + formatNumber(summary.expectedSkus) + "</strong> SKUs with expected units";

    els.kpiVariance.textContent = formatSigned(summary.variance);
    els.kpiVarianceFoot.innerHTML = summary.variancePct === null
      ? "Counted \u2212 external expected"
      : "<strong class=\"" + (summary.variance > 0 ? "pos" : summary.variance < 0 ? "neg" : "") + "\">" +
        formatPercent(summary.variancePct, 1) + "</strong> of external expected";

    els.varianceDirection.textContent = summary.variance === 0
      ? "Balanced"
      : summary.variance > 0 ? "Surplus" : "Shortfall";

    els.varianceKpi.classList.toggle("is-positive", summary.variance > 0);
    els.varianceKpi.classList.toggle("is-neutral", summary.variance === 0);
  }

  function updateStatusCounts() {
    const base = state.base;
    const counts = { all: base.length, match: 0, under: 0, over: 0 };
    base.forEach((row) => {
      counts[row.status] += 1;
    });
    els.countAll.textContent = formatNumber(counts.all);
    els.countMatch.textContent = formatNumber(counts.match);
    els.countUnder.textContent = formatNumber(counts.under);
    els.countOver.textContent = formatNumber(counts.over);
  }

  function updateFilterChrome() {
    const hasFilters = Boolean(state.query.trim()) ||
      state.status !== "all" ||
      state.brand !== "all" ||
      state.category !== "all";

    els.resetFilters.hidden = !hasFilters;
    els.searchClear.hidden = !state.query;
    els.searchField.classList.toggle("has-value", Boolean(state.query));

    els.statusButtons.forEach((button) => {
      const active = button.dataset.status === state.status;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    els.brandFilter.value = state.brand;
    els.categoryFilter.value = state.category;
  }

  function sortLabel() {
    const labels = {
      gap: "Largest gaps first",
      variance: state.sortDir === "asc" ? "Largest shortfalls first" : "Largest surpluses first",
      counted: state.sortDir === "asc" ? "Counted low to high" : "Counted high to low",
      expected: state.sortDir === "asc" ? "Expected low to high" : "Expected high to low",
      sku: state.sortDir === "asc" ? "SKU A to Z" : "SKU Z to A",
      description: state.sortDir === "asc" ? "Item A to Z" : "Item Z to A"
    };
    return labels[state.sortKey] || "Largest gaps first";
  }

  function updateSortIndicators() {
    els.sortButtons.forEach((button) => {
      const th = button.closest("th");
      if (button.dataset.sort === state.sortKey) {
        th.setAttribute("aria-sort", state.sortDir === "asc" ? "ascending" : "descending");
      } else {
        th.removeAttribute("aria-sort");
      }
    });
    els.sortNote.textContent = sortLabel();
  }

  function rowMarkup(row, maxGap) {
    const varianceClass = row.variance > 0 ? "pos" : row.variance < 0 ? "neg" : "zero";
    const meterWidth = maxGap ? Math.min(100, (row.absVariance / maxGap) * 100) : 0;
    const statusLabel = row.status === "match" ? "Match" : row.status === "under" ? "Under" : "Over";
    const subLine = row.style || row.barcode;
    const meta = [row.brand, row.size, row.segment].filter(Boolean).join(" \u00b7 ");
    const selected = state.selectedSku === row.sku ? " is-selected" : "";

    return (
      "<tr class=\"data-row" + selected + "\" data-sku=\"" + escapeHtml(row.sku) + "\" tabindex=\"0\" " +
        "aria-label=\"Open details for SKU " + escapeHtml(row.sku) + "\">" +
        "<td class=\"c-sku\"><div class=\"cell-sku\">" +
          "<span class=\"sku-value\">" + highlight(row.sku) + "</span>" +
          "<span class=\"sku-sub\">" + escapeHtml(subLine || "\u2014") + "</span>" +
        "</div></td>" +
        "<td class=\"c-item\"><div class=\"cell-item\">" +
          "<div class=\"item-name\">" + highlight(row.description || "Untitled item") + "</div>" +
          "<div class=\"item-meta\">" + highlight(meta || "\u2014") + "</div>" +
        "</div></td>" +
        "<td class=\"c-count cell-num\"><span class=\"num-value\">" + formatNumber(row.counted) + "</span></td>" +
        "<td class=\"c-expected cell-num\"><span class=\"num-value\">" + formatNumber(row.expected) + "</span></td>" +
        "<td class=\"c-variance cell-num\"><div class=\"variance-wrap\">" +
          "<span class=\"num-value " + varianceClass + "\">" + formatSigned(row.variance) + "</span>" +
          "<span class=\"variance-meter\" aria-hidden=\"true\"><i class=\"" + varianceClass + "\" style=\"width:" + meterWidth.toFixed(1) + "%\"></i></span>" +
        "</div></td>" +
        "<td class=\"c-status\"><span class=\"chip " + row.status + "\">" + statusLabel + "</span></td>" +
      "</tr>"
    );
  }

  function renderTable() {
    const total = state.view.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), totalPages);

    const start = (state.page - 1) * state.pageSize;
    const end = Math.min(start + state.pageSize, total);
    const pageRows = state.view.slice(start, end);
    const maxGap = state.view.reduce((maximum, row) => Math.max(maximum, row.absVariance), 0);

    els.tableBody.innerHTML = pageRows.map((row) => rowMarkup(row, maxGap)).join("");
    els.emptyState.hidden = total !== 0;
    els.tableScroll.hidden = total === 0;
    els.pagination.hidden = total === 0;

    if (total === 0) {
      els.emptyTitle.textContent = "No matching SKUs";
      els.emptyCopy.textContent = "Try a different SKU, description, or filter combination.";
      els.emptyReset.textContent = "Clear all filters";
      els.emptyReset.onclick = resetAllFilters;
    }

    els.resultSummary.textContent = total
      ? "Showing " + formatNumber(start + 1) + "\u2013" + formatNumber(end) + " of " + formatNumber(total) + " SKUs"
      : "No SKUs match the current filters";

    els.pageLabel.textContent = "Page " + state.page + " of " + totalPages;
    els.prevPage.disabled = state.page <= 1;
    els.nextPage.disabled = state.page >= totalPages;
    els.viewCount.textContent = state.view.length === state.rows.length
      ? formatNumber(total) + " SKUs"
      : formatNumber(total) + " of " + formatNumber(state.rows.length) + " SKUs";
  }

  function render() {
    state.base = filterRows({ ignoreStatus: true });
    state.view = sortRows(filterRows());
    updateStatusCounts();
    updateFilterChrome();
    updateSortIndicators();

    const summary = summarize(state.view);
    updateKpis(summary);
    updateAnalysis(summary);
    renderTable();
  }

  function populateFilters() {
    const brands = Array.from(new Set(state.rows.map((row) => row.brand).filter(Boolean)))
      .sort((a, b) => collator.compare(a, b));
    const categories = Array.from(new Set(state.rows.map((row) => row.segment).filter(Boolean)))
      .sort((a, b) => collator.compare(a, b));

    brands.forEach((brand) => {
      const option = document.createElement("option");
      option.value = brand;
      option.textContent = brand;
      els.brandFilter.appendChild(option);
    });

    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category === "NA" ? "NA / unassigned" : category;
      els.categoryFilter.appendChild(option);
    });
  }

  function resetAllFilters() {
    state.query = "";
    state.status = "all";
    state.brand = "all";
    state.category = "all";
    state.page = 1;
    els.search.value = "";
    render();
    els.search.focus();
  }

  function openDrawer(sku) {
    const row = state.rows.find((item) => item.sku === sku);
    if (!row) return;

    state.selectedSku = sku;
    lastFocused = document.activeElement;
    els.drawerTitle.textContent = row.sku;
    els.drawerBody.innerHTML = drawerMarkup(row);
    els.drawer.classList.add("is-open");
    els.drawer.setAttribute("aria-hidden", "false");
    els.drawerBackdrop.hidden = false;
    requestAnimationFrame(() => {
      els.drawerBackdrop.classList.add("is-open");
      document.body.style.overflow = "hidden";
      window.setTimeout(() => els.drawerClose.focus(), 30);
    });

    const copyButton = byId("copySku");
    if (copyButton) {
      copyButton.addEventListener("click", () => copyText(row.sku, "SKU copied"));
    }
    const footerClose = byId("drawerFooterClose");
    if (footerClose) footerClose.addEventListener("click", closeDrawer);

    document.querySelectorAll("#tableBody tr.is-selected").forEach((element) => {
      element.classList.remove("is-selected");
    });
    const selectedRow = document.querySelector('#tableBody tr[data-sku="' + CSS.escape(sku) + '"]');
    if (selectedRow) selectedRow.classList.add("is-selected");
  }

  function closeDrawer() {
    if (!els.drawer.classList.contains("is-open")) return;
    els.drawer.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    els.drawerBackdrop.classList.remove("is-open");
    document.body.style.overflow = "";
    state.selectedSku = null;
    document.querySelectorAll("#tableBody tr.is-selected").forEach((element) => {
      element.classList.remove("is-selected");
    });
    window.setTimeout(() => {
      if (!els.drawer.classList.contains("is-open")) els.drawerBackdrop.hidden = true;
    }, 240);
    if (lastFocused && document.contains(lastFocused)) {
      lastFocused.focus();
    }
  }

  function drawerMarkup(row) {
    const maxUnits = Math.max(row.counted, row.expected, 1);
    const countedWidth = Math.max(0, (row.counted / maxUnits) * 100);
    const expectedWidth = Math.max(0, (row.expected / maxUnits) * 100);
    const varianceClass = row.variance > 0 ? "pos" : row.variance < 0 ? "neg" : "zero";
    const statusLabel = row.status === "match" ? "Match" : row.status === "under" ? "Under" : "Over";

    const metrics = [
      ["Clarity expected", row.clarityExpected],
      ["Missing", row.missing],
      ["Sold", row.sold],
      ["Drift", row.drift],
      ["New", row.newItems],
      ["Previously not counted", row.previouslyNotCounted],
      ["Overs", row.overs],
      ["Unders", row.unders]
    ];

    const details = [
      ["Barcode", row.barcode || "\u2014"],
      ["Style", row.style || "\u2014"],
      ["Brand", row.brand || "\u2014"],
      ["Size", row.size || "\u2014"],
      ["Segment", row.segment || "\u2014"],
      ["Category", row.category || "\u2014"]
    ];

    return (
      "<div class=\"drawer-intro\">" +
        "<div class=\"drawer-status-row\"><span class=\"chip " + row.status + "\">" + statusLabel + "</span>" +
        "<span class=\"drawer-status-note\">Counted vs external expected</span></div>" +
        "<p class=\"drawer-desc\">" + escapeHtml(row.description || "Untitled item") + "</p>" +
        "<div class=\"drawer-tags\">" +
          (row.brand ? "<span class=\"tag\">" + escapeHtml(row.brand) + "</span>" : "") +
          (row.size ? "<span class=\"tag\">Size " + escapeHtml(row.size) + "</span>" : "") +
          (row.style ? "<span class=\"tag\">" + escapeHtml(row.style) + "</span>" : "") +
        "</div>" +
      "</div>" +
      "<section class=\"drawer-section\">" +
        "<h3 class=\"drawer-section-title\">Unit comparison</h3>" +
        "<div class=\"drawer-compare\">" +
          "<div class=\"drawer-bars\">" +
            "<div class=\"drawer-bar-row\">" +
              "<span>Counted</span><strong>" + formatNumber(row.counted) + "</strong>" +
              "<div class=\"drawer-bar-track\"><i class=\"is-counted\" style=\"width:" + countedWidth.toFixed(1) + "%\"></i></div>" +
            "</div>" +
            "<div class=\"drawer-bar-row\">" +
              "<span>External expected</span><strong>" + formatNumber(row.expected) + "</strong>" +
              "<div class=\"drawer-bar-track\"><i style=\"width:" + expectedWidth.toFixed(1) + "%\"></i></div>" +
            "</div>" +
          "</div>" +
          "<div class=\"drawer-variance\"><span>Variance</span>" +
            "<strong class=\"" + varianceClass + "\">" + formatSigned(row.variance) + " units</strong>" +
          "</div>" +
        "</div>" +
      "</section>" +
      "<section class=\"drawer-section\">" +
        "<h3 class=\"drawer-section-title\">Reconciliation metrics</h3>" +
        "<div class=\"metric-grid\">" +
          metrics.map(([label, value]) =>
            "<div class=\"metric\"><span>" + escapeHtml(label) + "</span><strong>" + formatNumber(value) + "</strong></div>"
          ).join("") +
        "</div>" +
      "</section>" +
      "<section class=\"drawer-section\">" +
        "<h3 class=\"drawer-section-title\">Record details</h3>" +
        "<dl class=\"detail-list\">" +
          details.map(([label, value]) =>
            "<div><dt>" + escapeHtml(label) + "</dt><dd title=\"" + escapeHtml(value) + "\">" + escapeHtml(value) + "</dd></div>"
          ).join("") +
        "</dl>" +
      "</section>" +
      "<div class=\"drawer-actions\">" +
        "<button class=\"button button-primary\" id=\"copySku\" type=\"button\">Copy SKU</button>" +
        "<button class=\"button button-secondary\" id=\"drawerFooterClose\" type=\"button\">Close</button>" +
      "</div>"
    );
  }

  function copyText(text, message) {
    const done = () => showToast(message);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (error) {}
    document.body.removeChild(textarea);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 2200);
  }

  function exportView() {
    if (!state.view.length) {
      showToast("No rows to export");
      return;
    }

    const headers = [
      "Sku", "Barcode", "Brand", "Description", "Style", "Size", "Category",
      "Category Description", "Counted", "External Expected", "Variance",
      "Status", "Clarity Expected", "Missing", "Sold", "Drift", "New",
      "Previously Not Counted"
    ];
    const statusNames = { match: "Match", under: "Under", over: "Over" };
    const escapeCell = (value) => {
      const text = String(value == null ? "" : value);
      return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };

    const lines = [headers.join(",")];
    state.view.forEach((row) => {
      lines.push([
        row.sku, row.barcode, row.brand, row.description, row.style, row.size,
        row.category, row.segment, row.counted, row.expected, row.variance,
        statusNames[row.status], row.clarityExpected, row.missing, row.sold,
        row.drift, row.newItems, row.previouslyNotCounted
      ].map(escapeCell).join(","));
    });

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "finished-stock-count-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Exported " + formatNumber(state.view.length) + " SKUs");
  }

  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    els.themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    try {
      localStorage.setItem("count-theme", theme);
    } catch (error) {}
  }

  function bindEvents() {
    els.search.addEventListener("input", () => {
      state.query = els.search.value;
      state.page = 1;
      render();
    });

    els.search.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.search.value) {
        event.stopPropagation();
        els.search.value = "";
        state.query = "";
        state.page = 1;
        render();
      }
    });

    els.searchClear.addEventListener("click", () => {
      els.search.value = "";
      state.query = "";
      state.page = 1;
      render();
      els.search.focus();
    });

    els.brandFilter.addEventListener("change", () => {
      state.brand = els.brandFilter.value;
      state.page = 1;
      render();
    });

    els.categoryFilter.addEventListener("change", () => {
      state.category = els.categoryFilter.value;
      state.page = 1;
      render();
    });

    els.resetFilters.addEventListener("click", resetAllFilters);

    els.statusButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.status = button.dataset.status;
        state.page = 1;
        render();
      });
    });

    els.mixButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.status = state.status === button.dataset.status ? "all" : button.dataset.status;
        state.page = 1;
        render();
      });
    });

    els.sortButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.sort;
        const numeric = key === "counted" || key === "expected" || key === "variance";
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = numeric ? "desc" : "asc";
        }
        state.page = 1;
        render();
      });
    });

    els.pageSize.addEventListener("change", () => {
      state.pageSize = Number.parseInt(els.pageSize.value, 10) || 25;
      state.page = 1;
      renderTable();
    });

    els.prevPage.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        renderTable();
      }
    });

    els.nextPage.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(state.view.length / state.pageSize));
      if (state.page < totalPages) {
        state.page += 1;
        renderTable();
      }
    });

    els.tableBody.addEventListener("click", (event) => {
      const row = event.target.closest("tr.data-row");
      if (row) openDrawer(row.dataset.sku);
    });

    els.tableBody.addEventListener("keydown", (event) => {
      const row = event.target.closest("tr.data-row");
      if (!row) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDrawer(row.dataset.sku);
      }
    });

    els.drawerClose.addEventListener("click", closeDrawer);
    els.drawerBackdrop.addEventListener("click", closeDrawer);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.drawer.classList.contains("is-open")) {
        event.preventDefault();
        closeDrawer();
        return;
      }

      if (event.key === "Tab" && els.drawer.classList.contains("is-open")) {
        const focusable = Array.from(els.drawer.querySelectorAll(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      if (els.drawer.classList.contains("is-open")) return;

      const target = event.target;
      const typing = target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "/" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) && !typing) {
        event.preventDefault();
        els.search.focus();
        els.search.select();
      }
    });

    els.themeToggle.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme === "dark";
      applyTheme(dark ? "light" : "dark");
    });

    els.exportTop.addEventListener("click", exportView);
  }

  function showLoadError(error) {
    console.error(error);
    els.sourceDot.classList.add("is-error");
    els.sourceLabel.textContent = "Count file unavailable";
    els.tableBody.innerHTML = "";
    els.tableScroll.hidden = true;
    els.pagination.hidden = true;
    els.emptyState.hidden = false;
    els.emptyTitle.textContent = "Could not load count data";
    els.emptyCopy.textContent = "The count file could not be read. Retry to load the dashboard again.";
    els.emptyReset.textContent = "Retry";
    els.emptyReset.onclick = () => window.location.reload();
    els.resultSummary.textContent = "Count data unavailable";
  }

  async function init() {
    cacheElements();
    bindEvents();
    updateFilterChrome();

    try {
      const response = await fetch(DATA_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error("HTTP " + response.status + " loading " + DATA_URL);
      const text = await response.text();
      state.rows = buildRows(parseCsv(text));
      if (!state.rows.length) throw new Error("No SKU records found in count file.");

      populateFilters();
      els.sourceDot.classList.add("is-ready");
      els.sourceLabel.textContent = formatNumber(state.rows.length) + " SKUs loaded";
      els.exportTop.disabled = false;
      document.body.dataset.ready = "true";
      render();
    } catch (error) {
      document.body.dataset.ready = "error";
      showLoadError(error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
