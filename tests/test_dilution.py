import random

import pytest

from dcfmodel import OptionTranche, diluted_shares_at, solve_share_price


def bisect_price(equity, basic, rsus, options):
    """Independent check: solve P * D(P) = E by bisection."""
    lo, hi = -1e6, 1e6
    for _ in range(300):
        mid = (lo + hi) / 2
        if mid * diluted_shares_at(mid, basic, rsus, options) < equity:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def test_no_options():
    assert solve_share_price(1000.0, 100.0, 5.0) == (pytest.approx(1000 / 105), 105.0)


def test_hand_example():
    # E = 1,000, 100 basic shares, 10 options at 5. P = (1,000 + 50) / 110 = 9.545 > 5, so all ITM.
    price, shares = solve_share_price(1000.0, 100.0, 0.0, [OptionTranche(10, 5.0)])
    assert price == pytest.approx(1050 / 110)
    assert shares == pytest.approx(100 + 10 * (1 - 5 / price))
    assert price * shares == pytest.approx(1000.0)


def test_out_of_the_money_options_ignored():
    price, shares = solve_share_price(1000.0, 100.0, 0.0, [OptionTranche(10, 50.0)])
    assert price == pytest.approx(10.0) and shares == 100.0


def test_negative_equity():
    price, shares = solve_share_price(-50.0, 100.0, 0.0, [OptionTranche(10, 1.0)])
    assert price == pytest.approx(-0.5) and shares == 100.0


def test_random_cases_match_bisection():
    rng = random.Random(0)
    for _ in range(500):
        options = [OptionTranche(rng.uniform(0, 20), rng.choice([rng.uniform(0, 80), 30.0]))
                   for _ in range(rng.randint(0, 5))]
        equity, basic, rsus = rng.uniform(-500, 8000), rng.uniform(50, 200), rng.uniform(0, 5)
        price, shares = solve_share_price(equity, basic, rsus, options)
        assert price == pytest.approx(bisect_price(equity, basic, rsus, options), abs=1e-7)
        assert price * shares == pytest.approx(equity, abs=1e-6)
        assert shares == pytest.approx(diluted_shares_at(price, basic, rsus, options))
