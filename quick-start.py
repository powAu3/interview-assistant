#!/usr/bin/env python3
"""One-click launcher: starts backend + Electron desktop window.

Usage:
    python quick-start.py              # default port 18080
    python quick-start.py --port 9090  # custom port

The backend runs on 0.0.0.0 so mobile devices on the same LAN can
also access via http://<your-ip>:<port>.  A scannable QR code is
available in the web UI settings panel.
"""
import subprocess, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
try:
    sys.exit(subprocess.call(
        [sys.executable, os.path.join(ROOT, "start.py"), "--mode", "desktop", "--no-build"] + sys.argv[1:]
    ))
except KeyboardInterrupt:
    sys.exit(0)
