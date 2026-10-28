import pytest

from dcfmodel import default_tables, load_assumptions, run_dcf, wacc_vs_growth
from tests.conftest import EXAMPLE


def test_centre_cells_match_base_case():
    a = load_assumptions(EXAMPLE)
    base = run_dcf(a)
    growth, multiple = default_tables(a, base.wacc)
    assert growth.values[2][2] == pytest.approx(base.perpetuity.share_price)
    assert multiple.values[2][2] == pytest.approx(base.exit.share_price)


def test_monotonic_and_undefined_cells():
    a = load_assumptions(EXAMPLE)
    t = wacc_vs_growth(a, [0.03, 0.08, 0.10], [0.02, 0.03, 0.04])
    assert t.values[0][1] is None and t.values[0][2] is None   # g >= WACC
    assert t.values[1][0] < t.values[1][1] < t.values[1][2]    # value rises with g
    assert t.values[1][0] > t.values[2][0]                     # and falls with WACC
