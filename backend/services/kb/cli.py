"""python -m services.kb.cli {reindex|stats|list}"""
from __future__ import annotations

import json
import sys

from . import indexer


def main(argv: list[str] | None = None) -> int:
    argv = list(argv or sys.argv[1:])
    cmd = (argv[0] if argv else "reindex").lower()
    if cmd == "reindex":
        info = indexer.reindex()
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0
    if cmd == "stats":
        print(json.dumps(indexer.stats(), ensure_ascii=False, indent=2))
        return 0
    if cmd == "list":
        docs = indexer.list_docs()
        if not docs:
            print("(no documents indexed)")
            return 0
        for d in docs:
            chunk_n = d.get("chunk_count", 0)
            print(f"{d['status']:<7} {d['loader']:<12} {chunk_n:>4}  {d['path']}")
            if d.get("error"):
                print(f"         └─ {d['error']}")
        return 0
    print(f"unknown command: {cmd}")
    print("usage: python -m services.kb.cli {reindex|stats|list}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
