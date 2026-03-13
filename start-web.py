#!/usr/bin/env python3
"""Quick launcher for network (web) mode."""
import subprocess, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.exit(subprocess.call(
    [sys.executable, os.path.join(ROOT, "start.py"), "--mode", "network", "--no-build"] + sys.argv[1:]
))
