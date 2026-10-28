import pytest

from dcfmodel import assumptions_from_dict, load_assumptions
from tests.conftest import EXAMPLE


def test_example_config_loads():
    a = load_assumptions(EXAMPLE)
    assert a.n_years == 5
    assert a.years == [2026, 2027, 2028, 2029, 2030]
    assert a.da_pct_revenue == (0.04,) * 5          # scalar broadcast to every year
    assert [o.strike for o in a.options] == [25.0, 40.0, 60.0]
    assert a.valuation_date == "2025-12-31"
    assert a.mid_year is True


def test_base_nwc_defaults_to_first_year_percentage(make_raw):
    raw = make_raw()
    del raw["base_year"]["net_working_capital"]
    a = assumptions_from_dict(raw)
    assert a.base_nwc == pytest.approx(2400.0 * 0.12)


@pytest.mark.parametrize("raw_update, message", [
    ({"projections": {"ebitda_margin": [0.2, 0.2]}}, "ebitda_margin has 2 values"),
    ({"projections": {"revenue_growth": 0.05}}, "must be a list"),
    ({"projections": {"tax_rate": 1.2}}, "tax_rate"),
    ({"wacc": {"target_debt_to_capital": 1.0}}, "target_debt_to_capital"),
    ({"shares": {"basic": 0}}, "basic shares"),
    ({"balance_sheet": {"cash": -1}}, "cash cannot be negative"),
    ({"terminal": {"exit_multiple": 0}}, "exit_multiple"),
    ({"terminal": {"growht_rate": 0.02}}, "unknown key"),
    ({"extras": {"a": 1}}, "unknown section"),
])
def test_invalid_inputs_raise(make_raw, raw_update, message):
    with pytest.raises(ValueError, match=message):
        assumptions_from_dict(make_raw(**raw_update))


def test_missing_required_input(make_raw):
    raw = make_raw()
    del raw["wacc"]["unlevered_beta"]
    with pytest.raises(ValueError, match="unlevered_beta"):
        assumptions_from_dict(raw)
