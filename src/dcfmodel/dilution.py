"""Diluted share count by the treasury stock method (TSM)."""

from __future__ import annotations

from collections.abc import Sequence

from .assumptions import OptionTranche


def diluted_shares_at(price: float, basic_shares: float, rsus: float = 0.0,
                      options: Sequence[OptionTranche] = ()) -> float:
    """Diluted shares at a given share price. In-the-money (strike < price) options add n * (1 - K / P)."""
    shares = basic_shares + rsus
    if price > 0:
        shares += sum(o.count * (1 - o.strike / price) for o in options if o.strike < price)
    return shares


def solve_share_price(equity_value: float, basic_shares: float, rsus: float = 0.0,
                      options: Sequence[OptionTranche] = ()) -> tuple[float, float]:
    """Solve the TSM circularity exactly. Returns ``(share_price, diluted_shares)``.

    The price P must satisfy P * D(P) = E, where D(P) depends on which options are in the money.
    P * D(P) = P * (basic + RSUs) + sum(n * max(P - K, 0)) is continuous and strictly increasing,
    so the root is unique. If tranches 1..k (sorted by strike) are in the money, then
    P = (E + sum n_i K_i) / (basic + RSUs + sum n_i), and that candidate is the answer
    when it lies in (K_k, K_{k+1}]. Checking k = 0, 1, ... in order finds it without iteration.
    """
    base = basic_shares + rsus
    if base <= 0:
        raise ValueError("basic shares plus RSUs must be positive")
    tranches = sorted((o for o in options if o.count > 0), key=lambda o: o.strike)

    price = equity_value / base
    if not tranches or price <= tranches[0].strike:
        return price, base

    cum_count = cum_proceeds = 0.0
    for i, t in enumerate(tranches):
        cum_count += t.count
        cum_proceeds += t.count * t.strike
        price = (equity_value + cum_proceeds) / (base + cum_count)
        next_strike = tranches[i + 1].strike if i + 1 < len(tranches) else float("inf")
        if t.strike < price <= next_strike:
            return price, diluted_shares_at(price, basic_shares, rsus, tranches)
    raise AssertionError("unreachable: the treasury stock method always has a solution")
