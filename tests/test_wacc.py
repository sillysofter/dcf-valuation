import pytest

from dcfmodel import compute_wacc, cost_of_equity, load_assumptions, relever_beta
from tests.conftest import EXAMPLE


def test_relever_beta_hamada():
    assert relever_beta(1.0, 0.25, 0.5) == pytest.approx(1.375)
    assert relever_beta(0.8, 0.3, 0.0) == pytest.approx(0.8)


def test_cost_of_equity_capm():
    assert cost_of_equity(0.04, 1.2, 0.05, 0.01) == pytest.approx(0.04 + 0.06 + 0.01)


def test_example_wacc_by_hand():
    w = compute_wacc(load_assumptions(EXAMPLE))
    # D/E = 0.25 / 0.75; beta_L = 0.95 * (1 + 0.76 / 3); Ke = 4.25% + beta_L * 5.5% + 0.5%
    beta = 0.95 * (1 + 0.76 / 3)
    ke = 0.0425 + beta * 0.055 + 0.005
    assert w.debt_to_equity == pytest.approx(1 / 3)
    assert w.levered_beta == pytest.approx(beta)
    assert w.cost_of_equity == pytest.approx(ke)
    assert w.after_tax_cost_of_debt == pytest.approx(0.0456)
    assert w.wacc == pytest.approx(0.75 * ke + 0.25 * 0.0456)
    assert w.wacc == pytest.approx(0.09614, abs=1e-6)
