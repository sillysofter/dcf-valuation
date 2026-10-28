"""Two-way sensitivity tables of the implied share price."""

from __future__ import annotations

from dataclasses import dataclass

from .assumptions import Assumptions
from .valuation import run_dcf


@dataclass(frozen=True)
class SensitivityTable:
    title: str
    row_label: str
    col_label: str
    rows: list[float]
    cols: list[float]
    values: list[list[float | None]]   # values[i][j] at rows[i], cols[j]; None where undefined (g >= WACC)


def centred(base: float, step: float, n_each_side: int = 2) -> list[float]:
    return [base + step * k for k in range(-n_each_side, n_each_side + 1)]


def wacc_vs_growth(a: Assumptions, waccs: list[float], growths: list[float]) -> SensitivityTable:
    values = [[run_dcf(a, wacc=w, terminal_growth=g).perpetuity.share_price if g < w else None
               for g in growths] for w in waccs]
    return SensitivityTable("Implied share price: perpetuity growth method", "WACC",
                            "Terminal growth rate", waccs, growths, values)


def wacc_vs_multiple(a: Assumptions, waccs: list[float], multiples: list[float]) -> SensitivityTable:
    # The exit method never uses g, but run_dcf still checks g < WACC, so g is capped just below each WACC.
    values = [[run_dcf(a, wacc=w, exit_multiple=m,
                       terminal_growth=min(a.terminal_growth, w - 1e-6)).exit.share_price
               for m in multiples] for w in waccs]
    return SensitivityTable("Implied share price: exit multiple method", "WACC",
                            "Exit EV/EBITDA multiple", waccs, multiples, values)


def default_tables(a: Assumptions, wacc: float, wacc_step: float = 0.005, growth_step: float = 0.005,
                   multiple_step: float = 1.0) -> list[SensitivityTable]:
    waccs = centred(wacc, wacc_step)
    return [
        wacc_vs_growth(a, waccs, centred(a.terminal_growth, growth_step)),
        wacc_vs_multiple(a, waccs, centred(a.exit_multiple, multiple_step)),
    ]
