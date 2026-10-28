import pytest

from dcfmodel import assumptions_from_dict, load_assumptions, project
from tests.conftest import EXAMPLE


def test_first_year_by_hand():
    p = project(load_assumptions(EXAMPLE))
    revenue = 2400 * 1.08
    ebit = revenue * 0.21 - revenue * 0.04
    ufcf = ebit * (1 - 0.24) + revenue * 0.04 - revenue * 0.05 - (revenue * 0.12 - 285)
    assert p.revenue[0] == pytest.approx(2592.0)
    assert p.ebit[0] == pytest.approx(ebit)
    assert p.change_in_nwc[0] == pytest.approx(26.04)
    assert p.ufcf[0] == pytest.approx(ufcf)
    assert p.ufcf[0] == pytest.approx(282.9264)


def test_identities_hold_every_year():
    p = project(load_assumptions(EXAMPLE))
    for t in range(len(p.years)):
        assert p.ebit[t] == pytest.approx(p.ebitda[t] - p.da[t])
        assert p.nopat[t] == pytest.approx(p.ebit[t] - p.taxes[t])
        assert p.ufcf[t] == pytest.approx(p.nopat[t] + p.da[t] - p.capex[t] - p.change_in_nwc[t])
    assert sum(p.change_in_nwc) == pytest.approx(p.nwc[-1] - 285.0)


def test_operating_loss_pays_no_tax(make_raw):
    p = project(assumptions_from_dict(make_raw(projections={"ebitda_margin": -0.05})))
    assert all(e < 0 for e in p.ebit)
    assert all(t == 0 for t in p.taxes)
    assert p.nopat == p.ebit
