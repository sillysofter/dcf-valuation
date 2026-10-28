"""Check that the website's JavaScript engine (web/dcf.js) matches the Python model.

The JS file runs in an embedded V8 (the ``mini-racer`` package). Every number the website shows is
compared with the Python result for several scenarios.
"""

import copy
import json
import math
import random
from dataclasses import asdict
from pathlib import Path

import pytest
import yaml

from dcfmodel import assumptions_from_dict, default_tables, run_dcf
from tests.conftest import EXAMPLE

py_mini_racer = pytest.importorskip("py_mini_racer")

ENGINE = Path(__file__).resolve().parents[1] / "web" / "dcf.js"

SCENARIOS = {
    "example": {},
    "no_options_no_price_end_of_year": {
        "terminal": {"mid_year_convention": False},
        "shares": {"options": [], "rsus": 0.0, "current_price": None},
    },
    "tied_strikes_all_in_the_money": {
        "shares": {"options": [{"count": 2.0, "strike": 10.0}, {"count": 1.0, "strike": 5.0},
                               {"count": 1.5, "strike": 10.0}]},
        "balance_sheet": {"preferred_equity": 25.0},
    },
    "operating_losses_and_negative_fcf": {
        "projections": {"ebitda_margin": [-0.10, -0.05, 0.0, 0.01, 0.02]},
        "terminal": {"exit_multiple": 6.0},
    },
    "seven_years_scalar_drivers": {
        "projections": {"revenue_growth": [0.12, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03],
                        "ebitda_margin": 0.3, "capex_pct_revenue": 0.03},
    },
    "negative_equity": {"balance_sheet": {"debt": 20000.0}},
}


@pytest.fixture(scope="module")
def js():
    ctx = py_mini_racer.MiniRacer()
    ctx.eval(ENGINE.read_text())
    return ctx


def raw_for(overrides):
    raw = yaml.safe_load(EXAMPLE.read_text())
    raw["company"]["valuation_date"] = str(raw["company"]["valuation_date"])
    for section, values in overrides.items():
        raw[section].update(copy.deepcopy(values))
    return raw


def js_call(js, expr, raw):
    return json.loads(js.eval(f"JSON.stringify((() => {{ const raw = {json.dumps(raw)}; {expr} }})())"))


def assert_close(py, jsv, path="result"):
    if isinstance(py, dict):
        for key, value in py.items():
            assert key in jsv, f"{path}.{key} missing in JS"
            assert_close(value, jsv[key], f"{path}.{key}")
    elif isinstance(py, (list, tuple)):
        assert len(py) == len(jsv), path
        for i, (p, j) in enumerate(zip(py, jsv)):
            assert_close(p, j, f"{path}[{i}]")
    elif isinstance(py, float) and math.isnan(py):
        assert jsv is None, path  # JSON.stringify turns NaN into null
    elif isinstance(py, (int, float)) and not isinstance(py, bool):
        assert jsv == pytest.approx(py, rel=1e-12, abs=1e-12), path
    else:
        assert py == jsv, path


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_engine_matches_python(js, name):
    raw = raw_for(SCENARIOS[name])
    result = run_dcf(assumptions_from_dict(copy.deepcopy(raw)))
    tables = default_tables(result.assumptions, result.wacc)
    out = js_call(js, """
        const a = DCF.assumptionsFromRaw(raw);
        const r = DCF.runDcf(a);
        delete r.assumptions;
        return {result: r, tables: DCF.defaultTables(a, r.wacc)};""", raw)
    expected = asdict(result)
    del expected["assumptions"]
    assert_close(expected, out["result"])
    assert_close([asdict(t) for t in tables], out["tables"], "tables")


def test_overrides_match_python(js):
    raw = raw_for({})
    a = assumptions_from_dict(copy.deepcopy(raw))
    expected = asdict(run_dcf(a, wacc=0.0875, terminal_growth=0.031, exit_multiple=8.5))
    del expected["assumptions"]
    out = js_call(js, """
        const r = DCF.runDcf(DCF.assumptionsFromRaw(raw),
                             {wacc: 0.0875, terminal_growth: 0.031, exit_multiple: 8.5});
        delete r.assumptions; return r;""", raw)
    assert_close(expected, out)


def test_tsm_solver_matches_python(js):
    from dcfmodel import OptionTranche, solve_share_price

    rng = random.Random(1)
    for _ in range(200):
        opts = [{"count": rng.uniform(0, 20), "strike": rng.choice([rng.uniform(0, 80), 30.0])}
                for _ in range(rng.randint(0, 5))]
        equity, basic, rsus = rng.uniform(-500, 8000), rng.uniform(50, 200), rng.uniform(0, 5)
        py = solve_share_price(equity, basic, rsus, [OptionTranche(**o) for o in opts])
        out = json.loads(js.eval(
            f"JSON.stringify(DCF.solveSharePrice({equity}, {basic}, {rsus}, {json.dumps(opts)}))"))
        assert out == pytest.approx(list(py), rel=1e-12, abs=1e-12)


@pytest.mark.parametrize("overrides, message", [
    ({"projections": {"ebitda_margin": [0.2, 0.2]}}, "ebitda_margin has 2 values"),
    ({"projections": {"revenue_growth": 0.05}}, "must be a list"),
    ({"projections": {"tax_rate": 1.2}}, "tax_rate"),
    ({"wacc": {"target_debt_to_capital": 1.0}}, "target_debt_to_capital"),
    ({"shares": {"basic": 0}}, "basic shares"),
    ({"balance_sheet": {"cash": -1}}, "cash cannot be negative"),
    ({"terminal": {"exit_multiple": 0}}, "exit_multiple"),
    ({"terminal": {"growth_rate": 0.2}}, "below WACC"),
    ({"terminal": {"growht_rate": 0.02}}, "unknown key"),
])
def test_engine_rejects_same_inputs_as_python(js, overrides, message):
    raw = raw_for(overrides)
    with pytest.raises(ValueError, match=message):
        run_dcf(assumptions_from_dict(copy.deepcopy(raw)))
    out = js_call(js, """
        try { DCF.runDcf(DCF.assumptionsFromRaw(raw)); return null; }
        catch (e) { return {name: e.constructor.name, message: e.message}; }""", raw)
    assert out is not None and out["name"] == "InputError"
    assert message in out["message"]


def test_embedded_example_matches_config(js):
    assert json.loads(js.eval("JSON.stringify(DCF.EXAMPLE)")) == raw_for({})


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_yaml_export_loads_in_python(js, name):
    raw = raw_for(SCENARIOS[name])
    text = js.eval(f"DCF.toYaml({json.dumps(raw)})")
    assert yaml.safe_load(text) == raw
    assumptions_from_dict(yaml.safe_load(text))
