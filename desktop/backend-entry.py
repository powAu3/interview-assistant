"""Start the bundled backend without requiring Python, uv, npm or the source launcher."""

import os
from pathlib import Path
import sys

import uvicorn


if __name__ == "__main__":
    backend = Path(__file__).resolve().parent / "backend"
    sys.path.insert(0, str(backend))
    os.environ.setdefault("IA_AUTH_ENABLE", "1")
    os.environ["PORT"] = sys.argv[1]
    uvicorn.run("main:app", host="0.0.0.0", port=int(sys.argv[1]), log_level="info")
