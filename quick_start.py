#!/usr/bin/env python3
"""Compatibility entry point for users who type `python quick_start.py`."""

import runpy
import sys
from pathlib import Path


if __name__ == "__main__":
    target = Path(__file__).with_name("quick-start.py")
    sys.argv[0] = str(target)
    runpy.run_path(str(target), run_name="__main__")
