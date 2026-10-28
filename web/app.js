/* UI for the DCF engine in dcf.js: form binding, rendering, charts, sharing and downloads. */
(function () {
  "use strict";

  const DCF = window.DCF;
  const MAX_YEARS = 15;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$", AUD: "A$" };
  const DRIVER_SHORT = {
    revenue_growth: "Growth", ebitda_margin: "EBITDA", da_pct_revenue: "D&A",
    capex_pct_revenue: "CapEx", nwc_pct_revenue: "NWC",
  };
  const DRIVER_LABELS = {
    revenue_growth: "Revenue growth",
    ebitda_margin: "EBITDA margin",
    da_pct_revenue: "D&A / revenue",
    capex_pct_revenue: "CapEx / revenue",
    nwc_pct_revenue: "NWC / revenue",
  };

  const $ = (sel) => document.querySelector(sel);
  const form = $("#inputs");
  const outputs = document.querySelector(".outputs");
  const tooltip = $("#tooltip");

  let state = loadState();
  let last = null; // {a, result, tables} from the most recent successful run

  // ================================================================== state

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  /** Make every driver a list with one value per year, so the drivers table can edit each cell. */
  function normalise(raw) {
    const s = clone(raw);
    for (const key of ["company", "base_year", "projections", "wacc", "terminal", "balance_sheet", "shares"]) {
      if (!s[key] || typeof s[key] !== "object") s[key] = {};
    }
    const p = s.projections;
    const n = Array.isArray(p.revenue_growth) && p.revenue_growth.length ? p.revenue_growth.length : 5;
    for (const d of DCF.DRIVERS) {
      const v = p[d];
      p[d] = Array.isArray(v) ? v.slice(0, n) : Array(n).fill(v ?? 0);
      while (p[d].length < n) p[d].push(p[d][p[d].length - 1] ?? 0);
    }
    if (!Array.isArray(s.shares.options)) s.shares.options = [];
    return s;
  }

  function encodeState(s) {
    const bytes = new TextEncoder().encode(JSON.stringify(s));
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeState(text) {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  }

  function loadState() {
    const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)$/);
    if (m) {
      try {
        const s = decodeState(m[1]);
        if (s && typeof s === "object" && !Array.isArray(s)) return normalise(s);
      } catch (e) { /* malformed link: fall back to the example */ }
    }
    return normalise(DCF.EXAMPLE);
  }

  let hashTimer = null;
  function saveStateToUrl() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      history.replaceState(null, "", "#s=" + encodeState(state));
    }, 250);
  }

  function getPath(path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), state);
  }

  function setPath(path, value) {
    const keys = path.split(".");
    const leaf = keys.pop();
    keys.reduce((o, k) => (o[k] ??= {}), state)[leaf] = value;
  }

  // ================================================================== formatting

  const nf = (d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF1 = nf(1);
  const NF2 = nf(2);
  const NF3 = nf(3);

  function paren(v, f) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
    const s = f.format(Math.abs(v));
    return v < 0 && Number(s.replace(/,/g, "")) !== 0 ? `(${s})` : s;
  }
  const money = (v) => paren(v, NF1);
  const shares = (v) => paren(v, NF3);
  const pct = (v, d = 1) => (v === null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(d)}%`);
  const mult = (v) => (v === null || !Number.isFinite(v) ? "n/a" : `${v.toFixed(1)}x`);
  function sym() {
    const c = String(state.company.currency || "").toUpperCase();
    return CURRENCY_SYMBOLS[c] ?? (c ? c + " " : "");
  }
  const price = (v) => (v === null || !Number.isFinite(v) ? "n/a" : (v < 0 ? `(${sym()}${NF2.format(-v)})` : `${sym()}${NF2.format(v)}`));
  const signedPct = (v) => (v === null || !Number.isFinite(v) ? "n/a" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`);

  /** Shows a stored decimal as a percentage without float noise (0.0425 -> "4.25"). */
  function toPctInput(v) {
    return v === null || v === undefined || !Number.isFinite(Number(v)) ? "" : String(Number((Number(v) * 100).toFixed(8)));
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ================================================================== form

  function readInput(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "text") return input.value;
    if (input.value.trim() === "") return null;
    const v = Number(input.value);
    if (!Number.isFinite(v)) return null;
    return "pct" in input.dataset ? Number((v / 100).toPrecision(15)) : v;
  }

  function writeInput(input, value) {
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (input.type === "text") input.value = value ?? "";
    else input.value = "pct" in input.dataset ? toPctInput(value) : (value ?? "");
  }

  function fillForm() {
    for (const input of form.querySelectorAll("input[name]")) writeInput(input, getPath(input.name));
    renderDriversTable();
    renderOptionsTable();
  }

  function markValidity(input) {
    const bad = input.type === "number" && input.value.trim() !== "" && !Number.isFinite(Number(input.value));
    input.setAttribute("aria-invalid", bad || input.validity.badInput ? "true" : "false");
  }

  form.addEventListener("input", (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    markValidity(input);
    if (input.name) {
      setPath(input.name, readInput(input));
      if (input.name === "base_year.fiscal_year") delete state.company.valuation_date; // now stale
    } else if (input.dataset.driver) {
      state.projections[input.dataset.driver][Number(input.dataset.year)] = readInput(input);
      if (input.dataset.driver === "revenue_growth") renderYearHeaders();
    } else if (input.dataset.option) {
      state.shares.options[Number(input.dataset.index)][input.dataset.option] = readInput(input);
    }
    update();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  function yearLabel(t) {
    const base = Number(state.base_year.fiscal_year);
    return Number.isFinite(base) ? `FY${base + t + 1}E` : `Year ${t + 1}`;
  }

  function renderYearHeaders() {
    form.querySelectorAll("#drivers tbody th[data-year]").forEach((th) => {
      th.textContent = yearLabel(Number(th.dataset.year));
    });
  }

  function renderDriversTable() {
    const n = state.projections.revenue_growth.length;
    const table = $("#drivers");
    table.replaceChildren();
    const head = table.createTHead().insertRow();
    head.appendChild(document.createElement("th")).textContent = "Year";
    for (const d of DCF.DRIVERS) {
      const th = head.appendChild(document.createElement("th"));
      th.textContent = DRIVER_SHORT[d];
      th.title = DRIVER_LABELS[d];
    }
    const body = table.createTBody();
    for (let t = 0; t < n; t++) {
      const tr = body.insertRow();
      const th = tr.appendChild(document.createElement("th"));
      th.scope = "row";
      th.dataset.year = t;
      for (const d of DCF.DRIVERS) {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "any";
        input.inputMode = "decimal";
        input.dataset.pct = "";
        input.dataset.driver = d;
        input.dataset.year = t;
        input.setAttribute("aria-label", `${DRIVER_LABELS[d]}, projection year ${t + 1} (%)`);
        writeInput(input, state.projections[d][t]);
        tr.insertCell().appendChild(input);
      }
    }
    renderYearHeaders();
    $("#add-year").disabled = n >= MAX_YEARS;
    $("#remove-year").disabled = n <= 1;
  }

  function renderOptionsTable() {
    const table = $("#options");
    table.replaceChildren();
    const opts = state.shares.options;
    if (!opts.length) return;
    const head = table.createTHead().insertRow();
    for (const h of ["Tranche", "Count", `Strike (${sym().trim() || "per share"})`, ""]) {
      head.appendChild(document.createElement("th")).textContent = h;
    }
    const body = table.createTBody();
    opts.forEach((o, i) => {
      const tr = body.insertRow();
      tr.insertCell().textContent = String(i + 1);
      for (const key of ["count", "strike"]) {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "any";
        input.inputMode = "decimal";
        input.dataset.option = key;
        input.dataset.index = i;
        input.setAttribute("aria-label", `Option tranche ${i + 1} ${key}`);
        writeInput(input, o[key]);
        tr.insertCell().appendChild(input);
      }
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "remove";
      rm.textContent = "✕";
      rm.setAttribute("aria-label", `Remove option tranche ${i + 1}`);
      rm.addEventListener("click", () => {
        state.shares.options.splice(i, 1);
        renderOptionsTable();
        update();
      });
      tr.insertCell().appendChild(rm);
    });
  }

  $("#add-year").addEventListener("click", () => {
    for (const d of DCF.DRIVERS) {
      const arr = state.projections[d];
      arr.push(arr[arr.length - 1] ?? 0);
    }
    renderDriversTable();
    update();
  });

  $("#remove-year").addEventListener("click", () => {
    for (const d of DCF.DRIVERS) state.projections[d].pop();
    renderDriversTable();
    update();
  });

  $("#add-option").addEventListener("click", () => {
    const opts = state.shares.options;
    opts.push({ count: 1, strike: opts.length ? opts[opts.length - 1].strike : 10 });
    renderOptionsTable();
    update();
  });

  $("#reset").addEventListener("click", () => {
    state = normalise(DCF.EXAMPLE);
    fillForm();
    update();
  });

  // ================================================================== compute

  let frame = 0;
  function update() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(run);
    saveStateToUrl();
  }

  function run() {
    const errorBox = $("#error");
    try {
      const a = DCF.assumptionsFromRaw(clone(state));
      const result = DCF.runDcf(a);
      const tables = DCF.defaultTables(a, result.wacc);
      last = { a, result, tables };
      errorBox.hidden = true;
      outputs.classList.remove("stale");
      render();
    } catch (e) {
      errorBox.textContent = e instanceof DCF.InputError
        ? `Check the inputs: ${e.message}.`
        : `Unexpected error: ${e.message}`;
      errorBox.hidden = false;
      outputs.classList.add("stale");
    }
  }

  // ================================================================== render

  function render() {
    const { a, result: r, tables } = last;
    $("#subtitle").textContent = `${a.company} · ${a.currency} in ${a.units}, except per-share data · `
      + `valued at FY${a.base_year} year end`;
    document.title = `${a.company}: DCF valuation`;
    renderTiles(a, r);
    renderFootball(a, r, tables);
    renderFcf(a, r);
    renderValuationTable(a, r);
    renderWaccTable(r);
    renderSensitivity(a, r, tables);
  }

  function upsideHtml(u, cur) {
    if (u === null) return "";
    return `<span class="${u >= 0 ? "up" : "down"}">${signedPct(u)}</span> vs ${esc(price(cur))} current`;
  }

  function renderTiles(a, r) {
    const tile = (label, value, sub) =>
      `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
    $("#tiles").innerHTML = [
      tile("Share price · perpetuity growth", esc(price(r.perpetuity.share_price)),
        upsideHtml(r.perpetuity.upside, a.current_share_price) || `g = ${pct(r.terminal_growth, 2)}`),
      tile("Share price · exit multiple", esc(price(r.exit.share_price)),
        upsideHtml(r.exit.upside, a.current_share_price) || `${mult(r.exit_multiple)} EBITDA`),
      tile("Enterprise value · perpetuity", money(r.perpetuity.enterprise_value),
        `Exit method ${money(r.exit.enterprise_value)}`),
      tile("WACC", pct(r.wacc, 2), `Cost of equity ${pct(r.wacc_detail.cost_of_equity, 2)}`),
    ].join("");
  }

  function rowsHtml(rows, cols) {
    return rows.map((row) => {
      if ("header" in row) {
        return `<thead><tr><th>${esc(row.header)}</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>`;
      }
      return `<tr class="${row.cls || ""}"><td>${esc(row.label)}</td>${row.values.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`;
    }).join("");
  }

  function renderFcf(a, r) {
    const p = r.projection;
    const cols = p.years.map((y) => `FY${y}E`);
    const m = (arr) => arr.map(money);
    $("#fcf-table").innerHTML = rowsHtml([
      { header: `${a.currency} ${a.units}` },
      { label: "Revenue", values: m(p.revenue), },
      { label: "growth", values: a.revenue_growth.map((v) => pct(v)), cls: "sub" },
      { label: "EBITDA", values: m(p.ebitda) },
      { label: "margin", values: a.ebitda_margin.map((v) => pct(v)), cls: "sub" },
      { label: "Less: D&A", values: m(p.da) },
      { label: "EBIT", values: m(p.ebit) },
      { label: "Less: taxes", values: m(p.taxes) },
      { label: "NOPAT", values: m(p.nopat) },
      { label: "Plus: D&A", values: m(p.da) },
      { label: "Less: CapEx", values: m(p.capex) },
      { label: "Less: increase in NWC", values: m(p.change_in_nwc) },
      { label: "Unlevered free cash flow", values: m(p.ufcf), cls: "total" },
      { label: "Discount period", values: r.discount_periods.map((v) => v.toFixed(1)), cls: "gap" },
      { label: "Discount factor", values: r.discount_factors.map((v) => v.toFixed(4)) },
      { label: "PV of UFCF", values: m(r.pv_ufcf), cls: "total" },
    ], cols);
    $("#fcf-note").textContent = a.mid_year
      ? "Mid-year convention: year-t cash flow is discounted t − 0.5 years."
      : "End-of-year discounting: year-t cash flow is discounted t years.";
    drawFcfChart(a, r);
  }

  function renderValuationTable(a, r) {
    const P = r.perpetuity;
    const X = r.exit;
    const both = (label, f, key, cls) => ({ label, values: [f(P[key]), f(X[key])], cls });
    const rows = [
      { header: "" },
      { label: "Assumption", values: [`g = ${pct(r.terminal_growth, 2)}`, `${mult(r.exit_multiple)} EBITDA`] },
      both("Terminal value", money, "terminal_value"),
      both("Discount period (years)", (v) => v.toFixed(1), "discount_period"),
      both("PV of terminal value", money, "pv_terminal_value"),
      { label: "Sum of PV of UFCF", values: [money(r.sum_pv_ufcf), money(r.sum_pv_ufcf)] },
      both("Enterprise value", money, "enterprise_value", "total"),
      both("PV of TV, % of EV", (v) => pct(v), "tv_share_of_ev", "sub"),
      { label: "Implied multiple / growth", values: [mult(P.implied_exit_multiple), pct(X.implied_terminal_growth, 2)], cls: "sub" },
      { label: "Less: debt", values: [money(a.debt), money(a.debt)], cls: "gap" },
      { label: "Less: preferred equity", values: [money(a.preferred_equity), money(a.preferred_equity)] },
      { label: "Less: minority interest", values: [money(a.minority_interest), money(a.minority_interest)] },
      { label: "Plus: cash", values: [money(a.cash), money(a.cash)] },
      { label: "Plus: non-operating assets", values: [money(a.non_operating_assets), money(a.non_operating_assets)] },
      both("Equity value", money, "equity_value", "total"),
      both("Diluted shares (TSM)", shares, "diluted_shares"),
      both("Implied share price", price, "share_price", "total"),
    ];
    if (a.current_share_price !== null) {
      rows.push({ label: `Upside vs ${price(a.current_share_price)}`, values: [signedPct(P.upside), signedPct(X.upside)] });
    }
    $("#valuation-table").innerHTML = rowsHtml(rows, ["Perpetuity", "Exit multiple"]);
  }

  function renderWaccTable(r) {
    const w = r.wacc_detail;
    const a = last.a;
    $("#wacc-table").innerHTML = rowsHtml([
      { label: "Risk-free rate", values: [pct(a.risk_free_rate, 2)] },
      { label: "Unlevered beta", values: [a.unlevered_beta.toFixed(2)] },
      { label: "Target debt / equity", values: [pct(w.debt_to_equity)] },
      { label: "Levered beta  βU × (1 + (1 − t) × D/E)", values: [w.levered_beta.toFixed(2)] },
      { label: "Equity risk premium", values: [pct(a.equity_risk_premium, 2)] },
      { label: "Size premium", values: [pct(a.size_premium, 2)] },
      { label: "Cost of equity", values: [pct(w.cost_of_equity, 2)], cls: "total" },
      { label: "Pre-tax cost of debt", values: [pct(a.pre_tax_cost_of_debt, 2)], cls: "gap" },
      { label: "After-tax cost of debt", values: [pct(w.after_tax_cost_of_debt, 2)] },
      { label: "Equity weight", values: [pct(w.equity_weight)], cls: "gap" },
      { label: "Debt weight", values: [pct(w.debt_weight)] },
      { label: "WACC", values: [pct(r.wacc, 2)], cls: "total" },
    ], [""]);
  }

  // ------------------------------------------------------------------ sensitivity heatmaps

  function renderSensitivity(a, r, tables) {
    const ref = a.current_share_price ?? r.perpetuity.share_price;
    const refLabel = a.current_share_price !== null ? "current price" : "base-case perpetuity price";
    $("#sens-note").textContent = `Shaded by upside versus the ${refLabel} (${price(ref)}). Outlined cell = base case. `
      + "Steps: WACC ±0.5%, growth ±0.5%, multiple ±1.0x.";
    const host = $("#sensitivity");
    host.replaceChildren();
    for (const t of tables) {
      const isMult = /multiple/i.test(t.col_label);
      const table = document.createElement("table");
      table.className = "heat";
      table.createCaption().textContent = isMult ? "Exit multiple method" : "Perpetuity growth method";
      const head = table.createTHead().insertRow();
      const corner = head.appendChild(document.createElement("th"));
      corner.className = "corner";
      corner.textContent = `WACC ↓  ${isMult ? "EV/EBITDA" : "g"} →`;
      for (const c of t.cols) head.appendChild(document.createElement("th")).textContent = isMult ? mult(c) : pct(c, 2);
      const body = table.createTBody();
      const mid = Math.floor(t.rows.length / 2);
      const midC = Math.floor(t.cols.length / 2);
      t.rows.forEach((w, i) => {
        const tr = body.insertRow();
        tr.appendChild(document.createElement("th")).textContent = pct(w, 2);
        t.values[i].forEach((v, j) => {
          const td = tr.insertCell();
          td.textContent = v === null ? "n/a" : price(v);
          if (i === mid && j === midC) td.className = "base";
          if (v !== null && ref > 0) {
            const u = v / ref - 1;
            const share = Math.min(Math.abs(u) / 0.3, 1) * 55;
            td.style.backgroundColor = `color-mix(in oklab, var(${u >= 0 ? "--div-pos" : "--div-neg"}) ${share.toFixed(1)}%, var(--div-mid))`;
          } else {
            td.style.backgroundColor = "var(--div-mid)";
          }
          td.dataset.tip = JSON.stringify({
            title: v === null ? "Undefined (g ≥ WACC)" : price(v),
            rows: [["WACC", pct(w, 2)], [isMult ? "Exit multiple" : "Terminal growth", isMult ? mult(t.cols[j]) : pct(t.cols[j], 2)]]
              .concat(v !== null && ref > 0 ? [[`vs ${refLabel}`, signedPct(v / ref - 1)]] : []),
          });
        });
      });
      const wrap = document.createElement("div");
      wrap.appendChild(table);
      host.appendChild(wrap);
    }
    const legend = document.createElement("div");
    legend.className = "heat-legend";
    const ramp = document.createElement("span");
    ramp.className = "ramp";
    ramp.style.background = "linear-gradient(90deg, color-mix(in oklab, var(--div-neg) 55%, var(--div-mid)), var(--div-mid), color-mix(in oklab, var(--div-pos) 55%, var(--div-mid)))";
    legend.append("−30% or below", ramp, "+30% or above");
    host.appendChild(legend);
  }

  // ------------------------------------------------------------------ SVG helpers

  function svgEl(name, attrs = {}, text) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function niceTicks(lo, hi, count = 5) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo;
    const step0 = span / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const start = Math.floor(lo / step) * step;
    const end = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
  }

  /** Bar with 4px rounded corners on the data end only; the baseline end stays square. */
  function barPath(x, w, y0, y1) {
    const h = Math.abs(y1 - y0);
    const r = Math.min(4, w / 2, h);
    if (h === 0) return "";
    if (y1 < y0) {
      return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    }
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  function showTip(e, data) {
    tooltip.innerHTML = `<strong>${esc(data.title)}</strong>`
      + data.rows.map(([k, v]) => `<div class="tt-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
    tooltip.hidden = false;
    const pad = 14;
    const { innerWidth: W, innerHeight: H } = window;
    const rect = tooltip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + rect.width > W - 8) x = e.clientX - rect.width - pad;
    if (y + rect.height > H - 8) y = e.clientY - rect.height - pad;
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }

  function hideTip() {
    tooltip.hidden = true;
  }

  document.addEventListener("pointermove", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
    if (target) showTip(e, JSON.parse(target.dataset.tip));
    else if (!tooltip.hidden) hideTip();
  });
  document.addEventListener("scroll", hideTip, { passive: true });

  // ------------------------------------------------------------------ football field

  function renderFootball(a, r, tables) {
    const host = $("#football");
    const width = Math.max(host.clientWidth, 280);
    const rows = tables.map((t, i) => {
      const vals = t.values.flat().filter((v) => v !== null);
      return {
        label: i === 0 ? "Perpetuity growth" : "Exit multiple",
        detail: i === 0 ? "WACC ±1.0% × g ±1.0%" : "WACC ±1.0% × multiple ±2.0x",
        lo: Math.min(...vals), hi: Math.max(...vals),
        base: i === 0 ? r.perpetuity.share_price : r.exit.share_price,
        cls: i === 0 ? "s1" : "s2",
      };
    });
    const cur = a.current_share_price;
    let lo = Math.min(...rows.map((x) => x.lo), cur ?? Infinity);
    let hi = Math.max(...rows.map((x) => x.hi), cur ?? -Infinity);
    const padV = (hi - lo || Math.abs(hi) || 1) * 0.04;
    const ticks = niceTicks(lo - padV, hi + padV, width < 420 ? 3 : width < 640 ? 4 : 7);
    const tickLabel = (t) => (ticks.every(Number.isInteger) ? `${sym()}${t.toLocaleString("en-US")}` : price(t));
    lo = ticks[0];
    hi = ticks[ticks.length - 1];
    const m = { l: 62, r: 62, t: 22, b: 26 }; // side margins hold the end-of-bar labels
    const rowH = 54;
    const height = m.t + rows.length * rowH + m.b;
    const x = (v) => m.l + ((v - lo) / (hi - lo)) * (width - m.l - m.r);

    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img",
      "aria-label": "Valuation range by method: " + rows.map((x2) => `${x2.label} ${price(x2.lo)} to ${price(x2.hi)}`).join("; ") });
    const axisY = m.t + rows.length * rowH;
    for (const t of ticks) {
      svg.appendChild(svgEl("line", { x1: x(t), x2: x(t), y1: m.t - 6, y2: axisY, class: "gridline" }));
      svg.appendChild(svgEl("text", { x: x(t), y: axisY + 17, "text-anchor": "middle", class: "tick" }, tickLabel(t)));
    }
    rows.forEach((row, i) => {
      const y = m.t + i * rowH;
      const label = svgEl("text", { x: 8, y: y + 8, class: "row-label" }, row.label);
      if (width >= 480) label.appendChild(svgEl("tspan", { class: "row-detail", dx: 8 }, row.detail));
      svg.appendChild(label);
      const by = y + 16;
      const bh = 18;
      const x0 = x(row.lo);
      const x1 = Math.max(x(row.hi), x0 + 2);
      svg.appendChild(svgEl("rect", { x: x0, y: by, width: x1 - x0, height: bh, rx: 4, class: `bar ${row.cls}` }));
      svg.appendChild(svgEl("circle", { cx: x(row.base), cy: by + bh / 2, r: 4.5, class: "base-dot" }));
      const loLabel = svgEl("text", { x: x0 - 6, y: by + 13, "text-anchor": "end", class: "end-label" }, price(row.lo));
      const hiLabel = svgEl("text", { x: x1 + 6, y: by + 13, class: "end-label" }, price(row.hi));
      svg.append(loLabel, hiLabel);
      const hit = svgEl("rect", { x: x0 - 4, y: by - 6, width: x1 - x0 + 8, height: bh + 12, class: "hit" });
      hit.dataset.tip = JSON.stringify({ title: `${row.label} method`, rows: [
        ["Low", price(row.lo)], ["Base case", price(row.base)], ["High", price(row.hi)], ["Grid", row.detail]] });
      svg.appendChild(hit);
    });
    if (cur !== null) {
      const cx = x(cur);
      svg.appendChild(svgEl("line", { x1: cx, x2: cx, y1: m.t - 8, y2: axisY, class: "current-line" }));
      const anchor = cx > width - 120 ? "end" : cx < 120 ? "start" : "middle";
      svg.appendChild(svgEl("text", { x: cx, y: m.t - 11, "text-anchor": anchor, class: "current-label" },
        `Current ${price(cur)}`));
    }
    host.replaceChildren(svg);
  }

  // ------------------------------------------------------------------ FCF chart

  function drawFcfChart(a, r) {
    const host = $("#fcf-chart");
    const width = Math.max(host.clientWidth, 280);
    const height = 220;
    const m = { l: 56, r: 8, t: 8, b: 26 };
    const p = r.projection;
    const all = p.ufcf.concat(r.pv_ufcf, [0]);
    const ticks = niceTicks(Math.min(...all), Math.max(...all), 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (height - m.t - m.b);
    const n = p.years.length;
    const band = (width - m.l - m.r) / n;
    const barW = Math.max(3, Math.min(28, (band * 0.62 - 2) / 2));

    const legend = document.createElement("div");
    legend.className = "legend";
    const swatch = (label, cssVar) => {
      const s = document.createElement("span");
      s.textContent = label;
      s.style.setProperty("--swatch", `var(${cssVar})`);
      return s;
    };
    legend.append(swatch("Unlevered FCF", "--series-1"), swatch("Present value", "--series-2"));

    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img",
      "aria-label": "Unlevered free cash flow and its present value by year; values are in the table below" });
    for (const t of ticks) {
      svg.appendChild(svgEl("line", { x1: m.l, x2: width - m.r, y1: y(t), y2: y(t), class: t === 0 ? "zero" : "gridline" }));
      svg.appendChild(svgEl("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end", class: "tick" }, NF1.format(t).replace(/\.0$/, "")));
    }
    for (let i = 0; i < n; i++) {
      const cx = m.l + band * (i + 0.5);
      const x0 = cx - barW - 1;
      const x1 = cx + 1;
      svg.appendChild(svgEl("path", { d: barPath(x0, barW, y(0), y(p.ufcf[i])), class: "s1" }));
      svg.appendChild(svgEl("path", { d: barPath(x1, barW, y(0), y(r.pv_ufcf[i])), class: "s2" }));
      svg.appendChild(svgEl("text", { x: cx, y: height - 8, "text-anchor": "middle", class: "tick" },
        n > 8 && width < 600 ? `'${String(p.years[i]).slice(-2)}` : `FY${p.years[i]}`));
      const hit = svgEl("rect", { x: m.l + band * i, y: m.t, width: band, height: height - m.t - m.b, class: "hit" });
      hit.dataset.tip = JSON.stringify({ title: `FY${p.years[i]}E`, rows: [
        ["Unlevered FCF", money(p.ufcf[i])], ["Discount factor", r.discount_factors[i].toFixed(4)],
        ["Present value", money(r.pv_ufcf[i])]] });
      svg.appendChild(hit);
    }
    host.replaceChildren(legend, svg);
  }

  // ================================================================== sharing and downloads

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slug() {
    return String(state.company.name || "dcf").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dcf";
  }

  function csvCell(v) {
    const s = typeof v === "number" ? String(v) : String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const downloads = {
    yaml: () => download(`${slug()}.yaml`, DCF.toYaml(state), "text/yaml"),
    csv: () => {
      if (!last) return;
      const { a, result: r } = last;
      const p = r.projection;
      const rows = [["Line item", ...p.years.map((y) => `FY${y}E`)],
        ["Revenue growth", ...a.revenue_growth], ["Revenue", ...p.revenue], ["EBITDA margin", ...a.ebitda_margin],
        ["EBITDA", ...p.ebitda], ["D&A", ...p.da], ["EBIT", ...p.ebit], ["Taxes", ...p.taxes], ["NOPAT", ...p.nopat],
        ["CapEx", ...p.capex], ["Net working capital", ...p.nwc], ["Increase in NWC", ...p.change_in_nwc],
        ["Unlevered FCF", ...p.ufcf], ["Discount period", ...r.discount_periods],
        ["Discount factor", ...r.discount_factors], ["PV of UFCF", ...r.pv_ufcf]];
      download(`${slug()}-projections.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n", "text/csv");
    },
    json: () => {
      if (!last) return;
      const { a, result: r, tables } = last;
      const out = {
        company: a.company, currency: a.currency, units: a.units, valuation_date: a.valuation_date,
        wacc: Object.assign({}, r.wacc_detail, { wacc_used: r.wacc }), terminal_growth: r.terminal_growth,
        exit_multiple: r.exit_multiple, projection: r.projection, discount_periods: r.discount_periods,
        discount_factors: r.discount_factors, pv_ufcf: r.pv_ufcf, sum_pv_ufcf: r.sum_pv_ufcf,
        perpetuity_growth: r.perpetuity, exit_multiple_method: r.exit, sensitivities: tables,
      };
      download(`${slug()}-summary.json`, JSON.stringify(out, null, 2), "application/json");
    },
  };

  document.querySelectorAll("[data-download]").forEach((btn) => {
    btn.addEventListener("click", () => {
      downloads[btn.dataset.download]();
      btn.closest("details").open = false;
    });
  });
  document.addEventListener("click", (e) => {
    const menu = document.querySelector("details.menu[open]");
    if (menu && !menu.contains(e.target)) menu.open = false;
  });

  $("#share").addEventListener("click", async () => {
    clearTimeout(hashTimer);
    history.replaceState(null, "", "#s=" + encodeState(state));
    const btn = $("#share");
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = "Link copied";
    } catch (e) {
      btn.textContent = "Copy the address bar";
    }
    setTimeout(() => { btn.textContent = "Copy share link"; }, 1800);
  });

  $("#theme").addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme")
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("dcf-theme", next); } catch (e) { /* not persisted */ }
  });

  window.addEventListener("hashchange", () => {
    if (location.hash === "#s=" + encodeState(state)) return;
    state = loadState();
    fillForm();
    update();
  });

  // Redraw charts when their width changes.
  let lastWidth = 0;
  new ResizeObserver(() => {
    const w = $("#football").clientWidth;
    if (last && Math.abs(w - lastWidth) > 1) {
      lastWidth = w;
      renderFootball(last.a, last.result, last.tables);
      drawFcfChart(last.a, last.result);
    }
  }).observe(outputs);

  fillForm();
  run();
})();
