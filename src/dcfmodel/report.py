"""Plain-text summary of a DCF result and JSON-ready dictionaries."""

from __future__ import annotations

from dataclasses import asdict

from .sensitivity import SensitivityTable
from .valuation import DCFResult, TerminalResult


def _row(label: str, values: list[float], fmt: str = "{:>11,.1f}") -> str:
    return f"  {label:<26}" + "".join(fmt.format(v) for v in values)


def _pct_row(label: str, values: list[float]) -> str:
    return f"  {label:<26}" + "".join(f"{v:>11.1%}" for v in values)


def format_report(result: DCFResult, tables: list[SensitivityTable]) -> str:
    a, p, wd = result.assumptions, result.projection, result.wacc_detail
    lines = [f"{a.company}: DCF valuation ({a.currency} {a.units}, except per-share data)", ""]
    lines.append(f"  {'Fiscal year':<26}" + "".join(f"{f'FY{y}E':>11}" for y in p.years))
    lines += [
        _row("Revenue", p.revenue),
        _pct_row("  growth", list(a.revenue_growth)),
        _row("EBITDA", p.ebitda),
        _pct_row("  margin", list(a.ebitda_margin)),
        _row("EBIT", p.ebit),
        _row("Less: taxes", p.taxes),
        _row("Plus: D&A", p.da),
        _row("Less: CapEx", p.capex),
        _row("Less: increase in NWC", p.change_in_nwc),
        _row("Unlevered FCF", p.ufcf),
        _row("Discount factor", result.discount_factors, "{:>11.4f}"),
        _row("PV of UFCF", result.pv_ufcf),
        "",
        "  WACC build",
        f"    Levered beta              {wd.levered_beta:>10.2f}",
        f"    Cost of equity            {wd.cost_of_equity:>10.2%}",
        f"    After-tax cost of debt    {wd.after_tax_cost_of_debt:>10.2%}",
        f"    Debt / total capital      {wd.debt_weight:>10.1%}",
        f"    WACC                      {result.wacc:>10.2%}",
        "",
        f"  {'':<34}{'Perpetuity':>14}{'Exit multiple':>16}",
    ]
    pg, ex = result.perpetuity, result.exit

    def both(label: str, attr: str, fmt: str) -> str:
        return f"  {label:<34}{fmt.format(getattr(pg, attr)):>14}{fmt.format(getattr(ex, attr)):>16}"

    lines += [
        f"  {'Assumption':<34}{f'g = {result.terminal_growth:.2%}':>14}{f'{result.exit_multiple:.1f}x EBITDA':>16}",
        both("Terminal value", "terminal_value", "{:,.1f}"),
        both("PV of terminal value", "pv_terminal_value", "{:,.1f}"),
        f"  {'Sum of PV of UFCF':<34}{result.sum_pv_ufcf:>14,.1f}{result.sum_pv_ufcf:>16,.1f}",
        both("Enterprise value", "enterprise_value", "{:,.1f}"),
        both("PV of TV, % of EV", "tv_share_of_ev", "{:.1%}"),
        f"  {'Implied multiple / growth':<34}{_fmt_opt(pg.implied_exit_multiple, '{:.1f}x'):>14}"
        f"{_fmt_opt(ex.implied_terminal_growth, '{:.2%}'):>16}",
        both("Equity value", "equity_value", "{:,.1f}"),
        both("Diluted shares", "diluted_shares", "{:,.3f}"),
        both("Implied share price", "share_price", "{:,.2f}"),
    ]
    if a.current_share_price is not None:
        lines.append(f"  {f'Upside vs {a.current_share_price:,.2f}':<34}"
                     f"{pg.upside:>14.1%}{ex.upside:>16.1%}")
    for t in tables:
        lines += ["", f"  {t.title}  (rows: {t.row_label}, columns: {t.col_label})"]
        is_mult = "multiple" in t.col_label.lower()
        lines.append("  " + " " * 10 + "".join(f"{(f'{c:.1f}x' if is_mult else f'{c:.2%}'):>11}" for c in t.cols))
        for rv, vals in zip(t.rows, t.values):
            lines.append(f"  {rv:>8.2%}  " + "".join(_fmt_opt(x, "{:>11,.2f}", width=11) for x in vals))
    return "\n".join(lines)


def _fmt_opt(value: float | None, fmt: str, width: int = 0) -> str:
    return fmt.format(value) if value is not None else "n/a".rjust(width)


def result_to_dict(result: DCFResult, tables: list[SensitivityTable]) -> dict:
    def terminal(t: TerminalResult) -> dict:
        return asdict(t)

    return {
        "company": result.assumptions.company,
        "currency": result.assumptions.currency,
        "units": result.assumptions.units,
        "valuation_date": result.assumptions.valuation_date,
        "wacc": asdict(result.wacc_detail) | {"wacc_used": result.wacc},
        "terminal_growth": result.terminal_growth,
        "exit_multiple": result.exit_multiple,
        "projection": asdict(result.projection),
        "discount_periods": result.discount_periods,
        "discount_factors": result.discount_factors,
        "pv_ufcf": result.pv_ufcf,
        "sum_pv_ufcf": result.sum_pv_ufcf,
        "perpetuity_growth": terminal(result.perpetuity),
        "exit_multiple_method": terminal(result.exit),
        "sensitivities": [asdict(t) for t in tables],
    }
