#!/usr/bin/env python3
"""Quick launcher for Electron desktop mode."""
import subprocess, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.exit(subprocess.call(
    [sys.executable, os.path.join(ROOT, "start.py"), "--mode", "desktop", "--no-build"] + sys.argv[1:]
))
