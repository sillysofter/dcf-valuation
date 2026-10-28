"""Check that the Excel formulas reproduce the Python model.

openpyxl writes formulas without cached results, so the workbook is recalculated with LibreOffice
(headless). These tests are skipped when LibreOffice is not installed.
"""

import shutil
import subprocess

import pytest
from openpyxl import load_workbook

from dcfmodel import assumptions_from_dict, default_tables, run_dcf
from dcfmodel.excel import write_excel

SOFFICE = shutil.which("soffice") or shutil.which("libreoffice")

SCENARIOS = {
    "example": {},
    "no_options_no_price_end_of_year": {
        "terminal": {"mid_year_convention": False},
        "shares": {"options": [], "rsus": 0.0, "current_price": None},
    },
    "all_options_in_the_money_tied_strikes": {
        "shares": {"options": [{"count": 2.0, "strike": 10.0}, {"count": 1.0, "strike": 5.0},
                               {"count": 1.5, "strike": 10.0}]},
        "balance_sheet": {"preferred_equity": 25.0},
    },
    "operating_losses": {
        "projections": {"ebitda_margin": [-0.02, 0.0, 0.03, 0.05, 0.06]},
        "terminal": {"exit_multiple": 6.0},
    },
}


def _value(wb, ref):
    sheet, cell = ref.split("!")
    return wb[sheet][cell.replace("$", "")].value


@pytest.fixture(scope="module")
def recalculated(tmp_path_factory):
    if SOFFICE is None:
        pytest.skip("LibreOffice not installed")
    import copy

    import yaml

    from tests.conftest import EXAMPLE

    base = yaml.safe_load(EXAMPLE.read_text())
    src, out = tmp_path_factory.mktemp("src"), tmp_path_factory.mktemp("out")
    cases = {}
    for name, overrides in SCENARIOS.items():
        raw = copy.deepcopy(base)
        for section, values in overrides.items():
            raw[section].update(values)
        a = assumptions_from_dict(raw)
        result = run_dcf(a)
        refs = write_excel(result, default_tables(a, result.wacc), src / f"{name}.xlsx")
        cases[name] = (result, refs)
    profile = tmp_path_factory.mktemp("profile")
    subprocess.run([SOFFICE, f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "xlsx",
                    "--outdir", str(out), *[str(p) for p in sorted(src.glob("*.xlsx"))]],
                   check=True, capture_output=True, timeout=300)
    return {name: (result, refs, load_workbook(out / f"{name}.xlsx", data_only=True))
            for name, (result, refs) in cases.items()}


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_excel_matches_python(recalculated, name):
    result, refs, wb = recalculated[name]
    expected = {
        "wacc": result.wacc,
        "levered_beta": result.wacc_detail.levered_beta,
        "cost_of_equity": result.wacc_detail.cost_of_equity,
        "sum_pv_ufcf": result.sum_pv_ufcf,
    }
    for method, t in (("perpetuity", result.perpetuity), ("exit", result.exit)):
        expected |= {
            f"{method}_tv": t.terminal_value,
            f"{method}_pv_tv": t.pv_terminal_value,
            f"{method}_ev": t.enterprise_value,
            f"{method}_equity": t.equity_value,
            f"{method}_share_price": t.share_price,
            f"{method}_diluted_shares": t.diluted_shares,
        }
    if result.perpetuity.implied_exit_multiple is not None:
        expected["perpetuity_implied"] = result.perpetuity.implied_exit_multiple
    if result.exit.implied_terminal_growth is not None:
        expected["exit_implied"] = result.exit.implied_terminal_growth
    for key, value in expected.items():
        assert _value(wb, refs[key]) == pytest.approx(value, rel=1e-9, abs=1e-9), key
    for key in ("ufcf", "ebitda", "revenue"):
        got = [_value(wb, ref) for ref in refs[key]]
        assert got == pytest.approx(getattr(result.projection, key), rel=1e-9), key
