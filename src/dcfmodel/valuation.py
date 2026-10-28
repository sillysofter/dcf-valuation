"""Discounting, terminal value, enterprise-to-equity bridge and implied share price."""

from __future__ import annotations

from dataclasses import dataclass

from .assumptions import Assumptions
from .dilution import solve_share_price
from .projections import Projection, project
from .wacc import WACCResult, compute_wacc


@dataclass(frozen=True)
class TerminalResult:
    method: str                 # "perpetuity_growth" or "exit_multiple"
    terminal_value: float       # value of all cash flows after the last projection year
    discount_period: float      # years from the valuation date used to discount the terminal value
    pv_terminal_value: float
    enterprise_value: float
    tv_share_of_ev: float
    implied_exit_multiple: float | None    # perpetuity method: TV / final-year EBITDA
    implied_terminal_growth: float | None  # exit method: growth rate the multiple implies
    equity_value: float
    diluted_shares: float
    share_price: float
    upside: float | None        # versus the current share price, if one was given


@dataclass(frozen=True)
class DCFResult:
    assumptions: Assumptions
    wacc_detail: WACCResult
    wacc: float                 # rate actually used (equals wacc_detail.wacc unless overridden)
    terminal_growth: float
    exit_multiple: float
    projection: Projection
    discount_periods: list[float]
    discount_factors: list[float]
    pv_ufcf: list[float]
    sum_pv_ufcf: float
    perpetuity: TerminalResult
    exit: TerminalResult


def equity_value_from_ev(enterprise_value: float, a: Assumptions) -> float:
    """EV - debt - preferred - minority interest + cash + non-operating assets."""
    return (enterprise_value - a.debt - a.preferred_equity - a.minority_interest
            + a.cash + a.non_operating_assets)


def run_dcf(a: Assumptions, wacc: float | None = None, terminal_growth: float | None = None,
            exit_multiple: float | None = None) -> DCFResult:
    """Value the company. ``wacc``, ``terminal_growth`` and ``exit_multiple`` override the inputs (for sensitivities).

    The valuation date is the end of the base fiscal year. With the mid-year convention, year-t cash flow
    is discounted t - 0.5 years. The perpetuity terminal value covers cash flows that also arrive mid-year,
    so it is discounted N - 0.5 years. The exit-multiple value is a sale price at the end of year N, so it
    is discounted N years.
    """
    detail = compute_wacc(a)
    w = detail.wacc if wacc is None else wacc
    g = a.terminal_growth if terminal_growth is None else terminal_growth
    multiple = a.exit_multiple if exit_multiple is None else exit_multiple
    if w <= 0:
        raise ValueError(f"WACC must be positive (got {w:.4%})")
    if g >= w:
        raise ValueError(f"terminal growth ({g:.2%}) must be below WACC ({w:.2%})")
    if multiple <= 0:
        raise ValueError("exit multiple must be positive")

    proj = project(a)
    n = a.n_years
    shift = 0.5 if a.mid_year else 0.0
    periods = [t - shift for t in range(1, n + 1)]
    factors = [(1 + w) ** -p for p in periods]
    pv = [cf * df for cf, df in zip(proj.ufcf, factors)]
    sum_pv = sum(pv)
    fcf_n, ebitda_n = proj.ufcf[-1], proj.ebitda[-1]

    # Both terminal values restated "as of" the end of year N, so they can be compared like for like.
    perp_period, exit_period = n - shift, float(n)
    tv_perp = fcf_n * (1 + g) / (w - g)
    tv_perp_at_n = tv_perp * (1 + w) ** shift
    tv_exit = ebitda_n * multiple
    implied_multiple = tv_perp_at_n / ebitda_n if ebitda_n > 0 else None
    implied_growth = None
    if fcf_n > 0:
        # Solve tv_exit = fcf_n * (1 + g) / (w - g) * (1 + w) ** shift for g.
        ratio = tv_exit / (fcf_n * (1 + w) ** shift)
        implied_growth = (ratio * w - 1) / (ratio + 1)

    def terminal(method: str, tv: float, period: float, imp_mult: float | None,
                 imp_growth: float | None) -> TerminalResult:
        pv_tv = tv * (1 + w) ** -period
        ev = sum_pv + pv_tv
        equity = equity_value_from_ev(ev, a)
        price, shares = solve_share_price(equity, a.basic_shares, a.rsus, a.options)
        upside = price / a.current_share_price - 1 if a.current_share_price else None
        return TerminalResult(method, tv, period, pv_tv, ev, pv_tv / ev if ev else float("nan"),
                              imp_mult, imp_growth, equity, shares, price, upside)

    return DCFResult(
        assumptions=a, wacc_detail=detail, wacc=w, terminal_growth=g, exit_multiple=multiple,
        projection=proj, discount_periods=periods, discount_factors=factors, pv_ufcf=pv, sum_pv_ufcf=sum_pv,
        perpetuity=terminal("perpetuity_growth", tv_perp, perp_period, implied_multiple, None),
        exit=terminal("exit_multiple", tv_exit, exit_period, None, implied_growth),
    )
