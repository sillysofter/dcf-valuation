"""Discount rate: CAPM cost of equity, Hamada beta relevering and WACC."""

from __future__ import annotations

from dataclasses import dataclass

from .assumptions import Assumptions


@dataclass(frozen=True)
class WACCResult:
    debt_to_equity: float
    levered_beta: float
    cost_of_equity: float
    after_tax_cost_of_debt: float
    equity_weight: float
    debt_weight: float
    wacc: float


def relever_beta(unlevered_beta: float, tax_rate: float, debt_to_equity: float) -> float:
    """Hamada: beta_L = beta_U * (1 + (1 - t) * D/E)."""
    return unlevered_beta * (1 + (1 - tax_rate) * debt_to_equity)


def cost_of_equity(risk_free_rate: float, levered_beta: float, equity_risk_premium: float,
                   size_premium: float = 0.0) -> float:
    """CAPM, plus an optional size premium: r_e = r_f + beta_L * ERP + size premium."""
    return risk_free_rate + levered_beta * equity_risk_premium + size_premium


def compute_wacc(a: Assumptions) -> WACCResult:
    wd = a.target_debt_to_capital
    we = 1 - wd
    d_e = wd / we
    beta = relever_beta(a.unlevered_beta, a.tax_rate, d_e)
    ke = cost_of_equity(a.risk_free_rate, beta, a.equity_risk_premium, a.size_premium)
    kd = a.pre_tax_cost_of_debt * (1 - a.tax_rate)
    return WACCResult(
        debt_to_equity=d_e,
        levered_beta=beta,
        cost_of_equity=ke,
        after_tax_cost_of_debt=kd,
        equity_weight=we,
        debt_weight=wd,
        wacc=we * ke + wd * kd,
    )
