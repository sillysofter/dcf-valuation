"""Command-line interface: ``dcfmodel`` / ``python -m dcfmodel``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .assumptions import load_assumptions
from .report import format_report, result_to_dict
from .sensitivity import default_tables
from .valuation import run_dcf


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="dcfmodel", description="Discounted cash flow valuation from a YAML file.")
    p.add_argument("config", help="YAML assumptions file (see configs/example.yaml).")
    p.add_argument("--excel", metavar="PATH", help="Write a formula-driven Excel model to PATH.")
    p.add_argument("--json", metavar="PATH", help="Write full results to PATH as JSON.")
    p.add_argument("--wacc-step", type=float, default=0.005, help="WACC step in sensitivity tables.")
    p.add_argument("--growth-step", type=float, default=0.005, help="Terminal growth step in sensitivity tables.")
    p.add_argument("--multiple-step", type=float, default=1.0, help="Exit multiple step in sensitivity tables.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        a = load_assumptions(args.config)
        result = run_dcf(a)
        tables = default_tables(a, result.wacc, args.wacc_step, args.growth_step, args.multiple_step)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"dcfmodel: error: {exc}", file=sys.stderr)
        return 2

    print(format_report(result, tables))
    if args.excel:
        from .excel import write_excel

        Path(args.excel).parent.mkdir(parents=True, exist_ok=True)
        write_excel(result, tables, args.excel)
        print(f"\nExcel model written to {args.excel}")
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(result_to_dict(result, tables), indent=2))
        print(f"JSON results written to {args.json}")
    return 0
