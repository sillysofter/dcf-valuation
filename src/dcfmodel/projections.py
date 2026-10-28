"""Operating projections and unlevered free cash flow."""

from __future__ import annotations

from dataclasses import dataclass

from .assumptions import Assumptions


@dataclass(frozen=True)
class Projection:
    years: list[int]
    revenue: list[float]
    ebitda: list[float]
    da: list[float]
    ebit: list[float]
    taxes: list[float]
    nopat: list[float]
    capex: list[float]
    nwc: list[float]
    change_in_nwc: list[float]
    ufcf: list[float]


def project(a: Assumptions) -> Projection:
    """Build the projection year by year.

    UFCF = EBIT - taxes + D&A - CapEx - increase in NWC, where
    taxes = tax rate * max(EBIT, 0): an operating loss pays no tax and no loss carryforward is modelled.
    """
    rows: dict[str, list[float]] = {k: [] for k in Projection.__dataclass_fields__ if k != "years"}
    revenue, nwc_prev = a.base_revenue, a.base_nwc
    for t in range(a.n_years):
        revenue = revenue * (1 + a.revenue_growth[t])
        ebitda = revenue * a.ebitda_margin[t]
        da = revenue * a.da_pct_revenue[t]
        ebit = ebitda - da
        taxes = max(ebit, 0.0) * a.tax_rate
        nopat = ebit - taxes
        capex = revenue * a.capex_pct_revenue[t]
        nwc = revenue * a.nwc_pct_revenue[t]
        change_in_nwc = nwc - nwc_prev
        nwc_prev = nwc
        for key, value in (("revenue", revenue), ("ebitda", ebitda), ("da", da), ("ebit", ebit),
                           ("taxes", taxes), ("nopat", nopat), ("capex", capex), ("nwc", nwc),
                           ("change_in_nwc", change_in_nwc),
                           ("ufcf", nopat + da - capex - change_in_nwc)):
            rows[key].append(value)
    return Projection(years=a.years, **rows)
