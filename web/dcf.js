/*
 * DCF engine: a line-for-line port of the Python package in src/dcfmodel.
 *
 * Inputs use the same nested layout as the YAML config, and results use the same snake_case field
 * names as the Python dataclasses, so tests/test_web_engine.py can compare the two implementations
 * directly. Change the Python model and this file together.
 *
 * Loaded as a classic script; everything is exposed on globalThis.DCF.
 */
(function (root) {
  "use strict";

  const DRIVERS = ["revenue_growth", "ebitda_margin", "da_pct_revenue", "capex_pct_revenue", "nwc_pct_revenue"];

  // YAML layout: section -> {yaml key: assumptions field}
  const SCHEMA = {
    company: { name: "company", currency: "currency", units: "units", valuation_date: "valuation_date" },
    base_year: { fiscal_year: "base_year", revenue: "base_revenue", net_working_capital: "base_nwc" },
    projections: Object.assign(Object.fromEntries(DRIVERS.map((d) => [d, d])), { tax_rate: "tax_rate" }),
    wacc: Object.fromEntries(["risk_free_rate", "equity_risk_premium", "unlevered_beta", "size_premium",
      "target_debt_to_capital", "pre_tax_cost_of_debt"].map((k) => [k, k])),
    terminal: { growth_rate: "terminal_growth", exit_multiple: "exit_multiple", mid_year_convention: "mid_year" },
    balance_sheet: Object.fromEntries(["debt", "cash", "minority_interest", "preferred_equity",
      "non_operating_assets"].map((k) => [k, k])),
    shares: { basic: "basic_shares", rsus: "rsus", options: "options", current_price: "current_share_price" },
  };

  const DEFAULTS = {
    size_premium: 0, mid_year: true, debt: 0, cash: 0, minority_interest: 0, preferred_equity: 0,
    non_operating_assets: 0, rsus: 0, options: [], current_share_price: null, currency: "USD",
    units: "millions", valuation_date: null,
  };

  const REQUIRED = ["company", "base_year", "base_revenue", "tax_rate", "risk_free_rate", "equity_risk_premium",
    "unlevered_beta", "target_debt_to_capital", "pre_tax_cost_of_debt", "terminal_growth", "exit_multiple",
    "basic_shares"];

  // Same inputs as configs/example.yaml (a test checks they stay identical).
  const EXAMPLE = {
    company: { name: "Meridian Industrial Corp. (illustrative)", currency: "USD", units: "millions",
      valuation_date: "2025-12-31" },
    base_year: { fiscal_year: 2025, revenue: 2400.0, net_working_capital: 285.0 },
    projections: {
      revenue_growth: [0.080, 0.075, 0.065, 0.055, 0.045],
      ebitda_margin: [0.210, 0.215, 0.220, 0.225, 0.230],
      da_pct_revenue: 0.040,
      capex_pct_revenue: [0.050, 0.048, 0.046, 0.044, 0.042],
      nwc_pct_revenue: 0.120,
      tax_rate: 0.24,
    },
    wacc: { risk_free_rate: 0.0425, equity_risk_premium: 0.0550, unlevered_beta: 0.95, size_premium: 0.0050,
      target_debt_to_capital: 0.25, pre_tax_cost_of_debt: 0.0600 },
    terminal: { growth_rate: 0.025, exit_multiple: 10.0, mid_year_convention: true },
    balance_sheet: { debt: 900.0, cash: 250.0, minority_interest: 40.0, preferred_equity: 0.0,
      non_operating_assets: 60.0 },
    shares: { basic: 120.0, rsus: 1.5, options: [
      { count: 3.0, strike: 25.00 }, { count: 2.5, strike: 40.00 }, { count: 1.0, strike: 60.00 }],
    current_price: 38.50 },
  };

  class InputError extends Error {}

  function fail(message) {
    throw new InputError(message);
  }

  function pct(x) {
    return (x * 100).toFixed(2) + "%";
  }

  function num(value, name) {
    const x = typeof value === "number" ? value : Number(value);
    if (value === null || value === "" || typeof value === "boolean" || !Number.isFinite(x)) {
      fail(`${name} must be a number`);
    }
    return x;
  }

  // ------------------------------------------------------------------ assumptions

  /** Build validated assumptions from the nested YAML-style object. Mirrors assumptions_from_dict. */
  function assumptionsFromRaw(raw) {
    if (!raw || typeof raw !== "object") fail("expected an object of inputs");
    const unknown = Object.keys(raw).filter((k) => !(k in SCHEMA)).sort();
    if (unknown.length) fail(`unknown section(s): ${unknown.join(", ")}`);
    const flat = {};
    for (const [section, fields] of Object.entries(SCHEMA)) {
      const block = raw[section] || {};
      const bad = Object.keys(block).filter((k) => !(k in fields)).sort();
      if (bad.length) fail(`unknown key(s) in '${section}': ${bad.join(", ")}`);
      for (const [key, value] of Object.entries(block)) flat[fields[key]] = value;
    }

    if (!Array.isArray(flat.revenue_growth)) {
      fail("projections.revenue_growth must be a list (it sets the number of projection years)");
    }
    const n = flat.revenue_growth.length;
    for (const name of DRIVERS) {
      if (!(name in flat)) fail(`missing projections.${name}`);
      const v = flat[name];
      flat[name] = (Array.isArray(v) ? v : Array(n).fill(v)).map((x, i) => num(x, `${name}[${i + 1}]`));
    }

    if (!("base_nwc" in flat) && "base_revenue" in flat) {
      flat.base_nwc = num(flat.base_revenue, "base revenue") * flat.nwc_pct_revenue[0];
    }
    flat.options = (flat.options || []).map((o, i) => ({
      count: num(o.count, `option tranche ${i + 1} count`),
      strike: num(o.strike, `option tranche ${i + 1} strike`),
    }));
    if (flat.valuation_date !== undefined && flat.valuation_date !== null) {
      flat.valuation_date = String(flat.valuation_date);
    }
    if ("mid_year" in flat) flat.mid_year = Boolean(flat.mid_year);
    if (flat.current_share_price === "" || flat.current_share_price === undefined) flat.current_share_price = null;
    if (flat.current_share_price !== null) flat.current_share_price = num(flat.current_share_price, "current share price");

    const missing = REQUIRED.filter((f) => !(f in flat) || flat[f] === null || flat[f] === "");
    if (missing.length) fail(`missing required input(s): ${missing.join(", ")}`);

    const a = Object.assign({}, DEFAULTS, flat);
    for (const key of ["base_year", "base_revenue", "base_nwc", "tax_rate", "risk_free_rate", "equity_risk_premium",
      "unlevered_beta", "target_debt_to_capital", "pre_tax_cost_of_debt", "terminal_growth", "exit_multiple",
      "basic_shares", "size_premium", "debt", "cash", "minority_interest", "preferred_equity",
      "non_operating_assets", "rsus"]) {
      a[key] = num(a[key], key.replace(/_/g, " "));
    }
    a.company = String(a.company);
    validate(a);
    a.n_years = n;
    a.years = Array.from({ length: n }, (_, t) => a.base_year + t + 1);
    return a;
  }

  /** Same checks, in the same order, as Assumptions.__post_init__. */
  function validate(a) {
    const n = a.revenue_growth.length;
    if (n === 0) fail("revenue_growth needs at least one projection year");
    for (const name of DRIVERS) {
      if (a[name].length !== n) fail(`${name} has ${a[name].length} values but revenue_growth has ${n}`);
    }
    if (a.revenue_growth.some((g) => g <= -1)) fail("revenue_growth values must be greater than -100%");
    if (a.ebitda_margin.some((m) => m >= 1)) fail("ebitda_margin values must be below 100%");
    for (const name of ["da_pct_revenue", "capex_pct_revenue"]) {
      if (a[name].some((v) => v < 0)) fail(`${name} values cannot be negative`);
    }
    if (a.base_revenue <= 0) fail("base revenue must be positive");
    if (!(a.tax_rate >= 0 && a.tax_rate < 1)) fail("tax_rate must be in [0, 1)");
    if (!(a.target_debt_to_capital >= 0 && a.target_debt_to_capital < 1)) {
      fail("target_debt_to_capital must be in [0, 1)");
    }
    if (a.unlevered_beta < 0) fail("unlevered_beta cannot be negative");
    if (a.pre_tax_cost_of_debt < 0) fail("pre_tax_cost_of_debt cannot be negative");
    if (a.exit_multiple <= 0) fail("exit_multiple must be positive");
    if (a.basic_shares <= 0) fail("basic shares must be positive");
    for (const name of ["debt", "cash", "minority_interest", "preferred_equity", "non_operating_assets", "rsus"]) {
      if (a[name] < 0) fail(`${name} cannot be negative`);
    }
    if (a.options.some((o) => o.count < 0 || o.strike < 0)) fail("option counts and strikes cannot be negative");
    if (a.current_share_price !== null && a.current_share_price <= 0) fail("current share price must be positive");
  }

  // ------------------------------------------------------------------ WACC

  function releverBeta(unleveredBeta, taxRate, debtToEquity) {
    return unleveredBeta * (1 + (1 - taxRate) * debtToEquity);
  }

  function costOfEquity(riskFree, leveredBeta, erp, sizePremium = 0) {
    return riskFree + leveredBeta * erp + sizePremium;
  }

  function computeWacc(a) {
    const wd = a.target_debt_to_capital;
    const we = 1 - wd;
    const de = wd / we;
    const beta = releverBeta(a.unlevered_beta, a.tax_rate, de);
    const ke = costOfEquity(a.risk_free_rate, beta, a.equity_risk_premium, a.size_premium);
    const kd = a.pre_tax_cost_of_debt * (1 - a.tax_rate);
    return {
      debt_to_equity: de, levered_beta: beta, cost_of_equity: ke, after_tax_cost_of_debt: kd,
      equity_weight: we, debt_weight: wd, wacc: we * ke + wd * kd,
    };
  }

  // ------------------------------------------------------------------ projections

  function project(a) {
    const p = { years: a.years.slice(), revenue: [], ebitda: [], da: [], ebit: [], taxes: [], nopat: [], capex: [],
      nwc: [], change_in_nwc: [], ufcf: [] };
    let revenue = a.base_revenue;
    let nwcPrev = a.base_nwc;
    for (let t = 0; t < a.n_years; t++) {
      revenue = revenue * (1 + a.revenue_growth[t]);
      const ebitda = revenue * a.ebitda_margin[t];
      const da = revenue * a.da_pct_revenue[t];
      const ebit = ebitda - da;
      const taxes = Math.max(ebit, 0) * a.tax_rate;
      const nopat = ebit - taxes;
      const capex = revenue * a.capex_pct_revenue[t];
      const nwc = revenue * a.nwc_pct_revenue[t];
      const changeInNwc = nwc - nwcPrev;
      nwcPrev = nwc;
      p.revenue.push(revenue); p.ebitda.push(ebitda); p.da.push(da); p.ebit.push(ebit); p.taxes.push(taxes);
      p.nopat.push(nopat); p.capex.push(capex); p.nwc.push(nwc); p.change_in_nwc.push(changeInNwc);
      p.ufcf.push(nopat + da - capex - changeInNwc);
    }
    return p;
  }

  // ------------------------------------------------------------------ treasury stock method

  function dilutedSharesAt(price, basicShares, rsus = 0, options = []) {
    let shares = basicShares + rsus;
    if (price > 0) {
      for (const o of options) if (o.strike < price) shares += o.count * (1 - o.strike / price);
    }
    return shares;
  }

  /** Exact TSM solution; see dilution.py for the derivation. Returns [price, dilutedShares]. */
  function solveSharePrice(equityValue, basicShares, rsus = 0, options = []) {
    const base = basicShares + rsus;
    if (base <= 0) fail("basic shares plus RSUs must be positive");
    const tranches = options.filter((o) => o.count > 0).sort((x, y) => x.strike - y.strike);
    let price = equityValue / base;
    if (!tranches.length || price <= tranches[0].strike) return [price, base];
    let cumCount = 0;
    let cumProceeds = 0;
    for (let i = 0; i < tranches.length; i++) {
      const t = tranches[i];
      cumCount += t.count;
      cumProceeds += t.count * t.strike;
      price = (equityValue + cumProceeds) / (base + cumCount);
      const nextStrike = i + 1 < tranches.length ? tranches[i + 1].strike : Infinity;
      if (t.strike < price && price <= nextStrike) return [price, dilutedSharesAt(price, basicShares, rsus, tranches)];
    }
    throw new Error("unreachable: the treasury stock method always has a solution");
  }

  // ------------------------------------------------------------------ valuation

  function equityValueFromEv(ev, a) {
    return ev - a.debt - a.preferred_equity - a.minority_interest + a.cash + a.non_operating_assets;
  }

  /** Mirrors valuation.run_dcf. ``overrides`` may set wacc, terminal_growth and exit_multiple. */
  function runDcf(a, overrides = {}) {
    const detail = computeWacc(a);
    const w = overrides.wacc ?? detail.wacc;
    const g = overrides.terminal_growth ?? a.terminal_growth;
    const multiple = overrides.exit_multiple ?? a.exit_multiple;
    if (w <= 0) fail(`WACC must be positive (got ${(w * 100).toFixed(4)}%)`);
    if (g >= w) fail(`terminal growth (${pct(g)}) must be below WACC (${pct(w)})`);
    if (multiple <= 0) fail("exit multiple must be positive");

    const proj = project(a);
    const n = a.n_years;
    const shift = a.mid_year ? 0.5 : 0;
    const periods = proj.ufcf.map((_, i) => i + 1 - shift);
    const factors = periods.map((p) => (1 + w) ** -p);
    const pv = proj.ufcf.map((cf, i) => cf * factors[i]);
    const sumPv = pv.reduce((s, x) => s + x, 0);
    const fcfN = proj.ufcf[n - 1];
    const ebitdaN = proj.ebitda[n - 1];

    const perpPeriod = n - shift;
    const exitPeriod = n;
    const tvPerp = (fcfN * (1 + g)) / (w - g);
    const tvPerpAtN = tvPerp * (1 + w) ** shift;
    const tvExit = ebitdaN * multiple;
    const impliedMultiple = ebitdaN > 0 ? tvPerpAtN / ebitdaN : null;
    let impliedGrowth = null;
    if (fcfN > 0) {
      const ratio = tvExit / (fcfN * (1 + w) ** shift);
      impliedGrowth = (ratio * w - 1) / (ratio + 1);
    }

    function terminal(method, tv, period, impMult, impGrowth) {
      const pvTv = tv * (1 + w) ** -period;
      const ev = sumPv + pvTv;
      const equity = equityValueFromEv(ev, a);
      const [price, shares] = solveSharePrice(equity, a.basic_shares, a.rsus, a.options);
      return {
        method, terminal_value: tv, discount_period: period, pv_terminal_value: pvTv, enterprise_value: ev,
        tv_share_of_ev: ev ? pvTv / ev : NaN, implied_exit_multiple: impMult, implied_terminal_growth: impGrowth,
        equity_value: equity, diluted_shares: shares, share_price: price,
        upside: a.current_share_price ? price / a.current_share_price - 1 : null,
      };
    }

    return {
      assumptions: a, wacc_detail: detail, wacc: w, terminal_growth: g, exit_multiple: multiple, projection: proj,
      discount_periods: periods, discount_factors: factors, pv_ufcf: pv, sum_pv_ufcf: sumPv,
      perpetuity: terminal("perpetuity_growth", tvPerp, perpPeriod, impliedMultiple, null),
      exit: terminal("exit_multiple", tvExit, exitPeriod, null, impliedGrowth),
    };
  }

  // ------------------------------------------------------------------ sensitivity

  function centred(base, step, nEachSide = 2) {
    const out = [];
    for (let k = -nEachSide; k <= nEachSide; k++) out.push(base + step * k);
    return out;
  }

  function waccVsGrowth(a, waccs, growths) {
    return {
      title: "Implied share price: perpetuity growth method", row_label: "WACC", col_label: "Terminal growth rate",
      rows: waccs, cols: growths,
      values: waccs.map((w) => growths.map((g) => (g < w
        ? runDcf(a, { wacc: w, terminal_growth: g }).perpetuity.share_price : null))),
    };
  }

  function waccVsMultiple(a, waccs, multiples) {
    // The exit method never uses g, but runDcf still checks g < WACC, so g is capped just below each WACC.
    return {
      title: "Implied share price: exit multiple method", row_label: "WACC", col_label: "Exit EV/EBITDA multiple",
      rows: waccs, cols: multiples,
      values: waccs.map((w) => multiples.map((m) => runDcf(a, {
        wacc: w, exit_multiple: m, terminal_growth: Math.min(a.terminal_growth, w - 1e-6),
      }).exit.share_price)),
    };
  }

  function defaultTables(a, wacc, waccStep = 0.005, growthStep = 0.005, multipleStep = 1.0) {
    const waccs = centred(wacc, waccStep);
    return [
      waccVsGrowth(a, waccs, centred(a.terminal_growth, growthStep)),
      waccVsMultiple(a, waccs, centred(a.exit_multiple, multipleStep)),
    ];
  }

  // ------------------------------------------------------------------ export

  /** Serialise raw inputs as YAML in the layout of configs/example.yaml, readable by the Python CLI. */
  function toYaml(raw) {
    const scalar = (v) => {
      if (v === null || v === undefined || v === "") return "null";
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
      return JSON.stringify(String(v)); // JSON strings are valid double-quoted YAML scalars
    };
    const lines = ["# DCF inputs exported from the web app. Run with: dcfmodel this-file.yaml --excel model.xlsx",
      "# Money in the stated units; shares in the same units; rates as decimals (0.05 = 5%).", ""];
    for (const [section, fields] of Object.entries(SCHEMA)) {
      const block = raw[section];
      if (!block) continue;
      lines.push(`${section}:`);
      for (const key of Object.keys(fields)) {
        if (!(key in block)) continue;
        const v = block[key];
        if (key === "options") {
          if (!v || !v.length) {
            lines.push("  options: []");
          } else {
            lines.push("  options:");
            for (const o of v) lines.push(`    - {count: ${scalar(o.count)}, strike: ${scalar(o.strike)}}`);
          }
        } else if (Array.isArray(v)) {
          lines.push(`  ${key}: [${v.map(scalar).join(", ")}]`);
        } else {
          lines.push(`  ${key}: ${scalar(v)}`);
        }
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  root.DCF = {
    DRIVERS, EXAMPLE, InputError, assumptionsFromRaw, computeWacc, releverBeta, costOfEquity, project,
    dilutedSharesAt, solveSharePrice, equityValueFromEv, runDcf, centred, waccVsGrowth, waccVsMultiple,
    defaultTables, toYaml,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
