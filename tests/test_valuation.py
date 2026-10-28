import pytest

from dcfmodel import assumptions_from_dict, load_assumptions, run_dcf
from tests.conftest import EXAMPLE


def steady_state(make_raw, g=0.03, mid_year=False):
    """Revenue grows at g from the base year with constant ratios, so UFCF grows at exactly g every year."""
    return assumptions_from_dict(make_raw(
        base_year={"revenue": 1000.0, "net_working_capital": 100.0},
        projections={"revenue_growth": [g] * 5, "ebitda_margin": 0.2, "da_pct_revenue": 0.05,
                     "capex_pct_revenue": 0.06, "nwc_pct_revenue": 0.10},
        terminal={"growth_rate": g, "mid_year_convention": mid_year},
    ))


@pytest.mark.parametrize("mid_year", [False, True])
def test_steady_state_ev_equals_growing_perpetuity(make_raw, mid_year):
    a = steady_state(make_raw, mid_year=mid_year)
    r = run_dcf(a, wacc=0.09)
    ufcf1 = r.projection.ufcf[0]
    for t in range(1, 5):
        assert r.projection.ufcf[t] == pytest.approx(ufcf1 * 1.03 ** t)
    expected = ufcf1 / (0.09 - 0.03) * (1.09 ** 0.5 if mid_year else 1.0)
    assert r.perpetuity.enterprise_value == pytest.approx(expected)


@pytest.mark.parametrize("mid_year", [False, True])
def test_methods_agree_at_implied_multiple(make_raw, mid_year):
    a = steady_state(make_raw, mid_year=mid_year)
    base = run_dcf(a)
    consistent = run_dcf(a, exit_multiple=base.perpetuity.implied_exit_multiple)
    assert consistent.exit.enterprise_value == pytest.approx(base.perpetuity.enterprise_value)
    assert consistent.exit.implied_terminal_growth == pytest.approx(a.terminal_growth)
    assert consistent.exit.share_price == pytest.approx(base.perpetuity.share_price)


def test_example_by_hand():
    r = run_dcf(load_assumptions(EXAMPLE))
    w, n = r.wacc, 5
    assert r.discount_periods == [0.5, 1.5, 2.5, 3.5, 4.5]
    assert r.discount_factors[0] == pytest.approx(1 / (1 + w) ** 0.5)
    tv = r.projection.ufcf[-1] * 1.025 / (w - 0.025)
    assert r.perpetuity.terminal_value == pytest.approx(tv)
    assert r.perpetuity.pv_terminal_value == pytest.approx(tv / (1 + w) ** 4.5)
    assert r.exit.pv_terminal_value == pytest.approx(r.projection.ebitda[-1] * 10 / (1 + w) ** n)
    ev = r.perpetuity.enterprise_value
    assert ev == pytest.approx(sum(r.pv_ufcf) + tv / (1 + w) ** 4.5)
    assert r.perpetuity.equity_value == pytest.approx(ev - 900 - 0 - 40 + 250 + 60)
    # Options at 25 and 40 are in the money, the one at 60 is not.
    price = (r.perpetuity.equity_value + 3 * 25 + 2.5 * 40) / (120 + 1.5 + 3 + 2.5)
    assert r.perpetuity.share_price == pytest.approx(price)
    assert r.perpetuity.upside == pytest.approx(price / 38.5 - 1)
    assert r.perpetuity.share_price == pytest.approx(41.44, abs=0.005)
    assert r.exit.share_price == pytest.approx(45.18, abs=0.005)


def test_growth_must_be_below_wacc():
    a = load_assumptions(EXAMPLE)
    with pytest.raises(ValueError, match="below WACC"):
        run_dcf(a, wacc=0.02)


def test_higher_wacc_lowers_value():
    a = load_assumptions(EXAMPLE)
    assert run_dcf(a, wacc=0.08).perpetuity.share_price > run_dcf(a, wacc=0.11).perpetuity.share_price
