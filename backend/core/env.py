import os


def env_int(name: str, default: int, *, minimum: int = 0) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return max(minimum, default)
    try:
        value = int(raw)
    except (ValueError, TypeError):
        return max(minimum, default)
    return max(minimum, value)
