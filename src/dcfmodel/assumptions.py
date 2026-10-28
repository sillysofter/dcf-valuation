"""Model inputs: the ``Assumptions`` dataclass and the YAML loader."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

# Per-year operating drivers. Each one is a list with one value per projection year;
# a single number in the YAML file is repeated for every year.
DRIVERS = ("revenue_growth", "ebitda_margin", "da_pct_revenue", "capex_pct_revenue", "nwc_pct_revenue")


@dataclass(frozen=True)
class OptionTranche:
    count: float   # options outstanding, in the same units as shares
    strike: float  # exercise price per share


@dataclass(frozen=True)
class Assumptions:
    company: str
    base_year: int
    base_revenue: float
    base_nwc: float
    revenue_growth: tuple[float, ...]
    ebitda_margin: tuple[float, ...]
    da_pct_revenue: tuple[float, ...]
    capex_pct_revenue: tuple[float, ...]
    nwc_pct_revenue: tuple[float, ...]
    tax_rate: float
    risk_free_rate: float
    equity_risk_premium: float
    unlevered_beta: float
    target_debt_to_capital: float
    pre_tax_cost_of_debt: float
    terminal_growth: float
    exit_multiple: float
    basic_shares: float
    size_premium: float = 0.0
    mid_year: bool = True
    debt: float = 0.0
    cash: float = 0.0
    minority_interest: float = 0.0
    preferred_equity: float = 0.0
    non_operating_assets: float = 0.0
    rsus: float = 0.0
    options: tuple[OptionTranche, ...] = ()
    current_share_price: float | None = None
    currency: str = "USD"
    units: str = "millions"
    valuation_date: str | None = None

    def __post_init__(self) -> None:
        n = len(self.revenue_growth)
        if n == 0:
            raise ValueError("revenue_growth needs at least one projection year")
        for name in DRIVERS:
            values = getattr(self, name)
            if len(values) != n:
                raise ValueError(f"{name} has {len(values)} values but revenue_growth has {n}")
            if not all(math.isfinite(v) for v in values):
                raise ValueError(f"{name} contains a non-finite value")
        if any(g <= -1 for g in self.revenue_growth):
            raise ValueError("revenue_growth values must be greater than -100%")
        if any(m >= 1 for m in self.ebitda_margin):
            raise ValueError("ebitda_margin values must be below 100%")
        for name in ("da_pct_revenue", "capex_pct_revenue"):  # NWC may legitimately be negative
            if any(v < 0 for v in getattr(self, name)):
                raise ValueError(f"{name} values cannot be negative")
        if self.base_revenue <= 0:
            raise ValueError("base revenue must be positive")
        if not 0 <= self.tax_rate < 1:
            raise ValueError("tax_rate must be in [0, 1)")
        if not 0 <= self.target_debt_to_capital < 1:
            raise ValueError("target_debt_to_capital must be in [0, 1)")
        if self.unlevered_beta < 0:
            raise ValueError("unlevered_beta cannot be negative")
        if self.pre_tax_cost_of_debt < 0:
            raise ValueError("pre_tax_cost_of_debt cannot be negative")
        if self.exit_multiple <= 0:
            raise ValueError("exit_multiple must be positive")
        if self.basic_shares <= 0:
            raise ValueError("basic shares must be positive")
        for name in ("debt", "cash", "minority_interest", "preferred_equity", "non_operating_assets", "rsus"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} cannot be negative")
        for t in self.options:
            if t.count < 0 or t.strike < 0:
                raise ValueError("option counts and strikes cannot be negative")
        if self.current_share_price is not None and self.current_share_price <= 0:
            raise ValueError("current share price must be positive")

    @property
    def n_years(self) -> int:
        return len(self.revenue_growth)

    @property
    def years(self) -> list[int]:
        return [self.base_year + t for t in range(1, self.n_years + 1)]


# YAML layout: section -> {yaml key: Assumptions field}
_SCHEMA: dict[str, dict[str, str]] = {
    "company": {"name": "company", "currency": "currency", "units": "units",
                "valuation_date": "valuation_date"},
    "base_year": {"fiscal_year": "base_year", "revenue": "base_revenue",
                  "net_working_capital": "base_nwc"},
    "projections": {**{d: d for d in DRIVERS}, "tax_rate": "tax_rate"},
    "wacc": {k: k for k in ("risk_free_rate", "equity_risk_premium", "unlevered_beta", "size_premium",
                            "target_debt_to_capital", "pre_tax_cost_of_debt")},
    "terminal": {"growth_rate": "terminal_growth", "exit_multiple": "exit_multiple",
                 "mid_year_convention": "mid_year"},
    "balance_sheet": {k: k for k in ("debt", "cash", "minority_interest", "preferred_equity",
                                     "non_operating_assets")},
    "shares": {"basic": "basic_shares", "rsus": "rsus", "options": "options",
               "current_price": "current_share_price"},
}


def assumptions_from_dict(raw: dict[str, Any]) -> Assumptions:
    """Build ``Assumptions`` from the nested YAML structure. Unknown keys are errors, so typos fail loudly."""
    unknown = set(raw) - set(_SCHEMA)
    if unknown:
        raise ValueError(f"unknown section(s): {', '.join(sorted(unknown))}")
    flat: dict[str, Any] = {}
    for section, fields in _SCHEMA.items():
        block = raw.get(section) or {}
        bad = set(block) - set(fields)
        if bad:
            raise ValueError(f"unknown key(s) in '{section}': {', '.join(sorted(bad))}")
        for key, value in block.items():
            flat[fields[key]] = value

    n = len(_as_list(flat.get("revenue_growth"), 0, "revenue_growth"))
    for name in DRIVERS:
        if name not in flat:
            raise ValueError(f"missing projections.{name}")
        flat[name] = tuple(float(v) for v in _as_list(flat[name], n, name))

    if "base_nwc" not in flat and "base_revenue" in flat:
        # Default: base-year NWC at the first projection year's % of revenue.
        flat["base_nwc"] = float(flat["base_revenue"]) * flat["nwc_pct_revenue"][0]
    flat["options"] = tuple(
        OptionTranche(count=float(o["count"]), strike=float(o["strike"])) for o in flat.get("options") or ()
    )
    if flat.get("valuation_date") is not None:
        flat["valuation_date"] = str(flat["valuation_date"])
    if "mid_year" in flat:
        flat["mid_year"] = bool(flat["mid_year"])
    if flat.get("current_share_price") is not None:
        flat["current_share_price"] = float(flat["current_share_price"])

    required = [f for f in ("company", "base_year", "base_revenue", "tax_rate", "risk_free_rate",
                            "equity_risk_premium", "unlevered_beta", "target_debt_to_capital",
                            "pre_tax_cost_of_debt", "terminal_growth", "exit_multiple", "basic_shares")
                if f not in flat]
    if required:
        raise ValueError(f"missing required input(s): {', '.join(required)}")
    return Assumptions(**flat)


def load_assumptions(path: str | Path) -> Assumptions:
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: expected a YAML mapping at the top level")
    return assumptions_from_dict(raw)


def _as_list(value: Any, n: int, name: str) -> list[float]:
    if isinstance(value, (list, tuple)):
        return list(value)
    if name == "revenue_growth":
        raise ValueError("projections.revenue_growth must be a list (it sets the number of projection years)")
    return [value] * n
