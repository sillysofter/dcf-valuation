"""Discounted cash flow (DCF) valuation with a formula-driven Excel export."""

from .assumptions import Assumptions, OptionTranche, assumptions_from_dict, load_assumptions
from .dilution import diluted_shares_at, solve_share_price
from .projections import Projection, project
from .sensitivity import SensitivityTable, default_tables, wacc_vs_growth, wacc_vs_multiple
from .valuation import DCFResult, TerminalResult, equity_value_from_ev, run_dcf
from .wacc import WACCResult, compute_wacc, cost_of_equity, relever_beta

__all__ = [
    "Assumptions",
    "DCFResult",
    "OptionTranche",
    "Projection",
    "SensitivityTable",
    "TerminalResult",
    "WACCResult",
    "assumptions_from_dict",
    "compute_wacc",
    "cost_of_equity",
    "default_tables",
    "diluted_shares_at",
    "equity_value_from_ev",
    "load_assumptions",
    "project",
    "relever_beta",
    "run_dcf",
    "solve_share_price",
    "wacc_vs_growth",
    "wacc_vs_multiple",
]

__version__ = "1.0.0"
