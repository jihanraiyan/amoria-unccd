"""Pytest setup for the geodata tests: import paths and shared fixtures.

Run from the repo root:
    scripts/geodata/.venv/bin/python -m pytest scripts/geodata/tests -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from helpers import WORLD  # noqa: E402


@pytest.fixture(scope="module")
def world():
    """The exported real-data world JSON, parsed once per module."""
    return json.loads(WORLD.read_text())
