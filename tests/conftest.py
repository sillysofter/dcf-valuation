import copy
from pathlib import Path

import pytest
import yaml

EXAMPLE = Path(__file__).resolve().parents[1] / "configs" / "example.yaml"


@pytest.fixture
def example_raw():
    return yaml.safe_load(EXAMPLE.read_text())


@pytest.fixture
def make_raw(example_raw):
    """Return a deep copy of the example config with nested overrides applied."""
    def _make(**sections):
        raw = copy.deepcopy(example_raw)
        for section, values in sections.items():
            if values is None:
                raw.pop(section, None)
            else:
                raw.setdefault(section, {}).update(values)
        return raw
    return _make
