from __future__ import annotations

from pathlib import Path

import yaml

_DATA_DIR = Path(__file__).parent.parent / "data"
_CORE_PATH = _DATA_DIR / "core.yaml"
_NASDAQ100_PATH = _DATA_DIR / "nasdaq100.yaml"
_LEVERAGED_ETFS_PATH = _DATA_DIR / "leveraged_etfs.yaml"


def _load_yaml_list(path: Path) -> list[str]:
    with open(path) as f:
        data = yaml.safe_load(f)
    return [str(s).upper() for s in data] if data else []


def load_universe() -> list[str]:
    core = _load_yaml_list(_CORE_PATH)
    return sorted(set(core))


def get_all_available_symbols() -> dict[str, list[str]]:
    core = _load_yaml_list(_CORE_PATH)
    nasdaq100 = _load_yaml_list(_NASDAQ100_PATH)
    leveraged_etfs = _load_yaml_list(_LEVERAGED_ETFS_PATH)
    return {
        "core": sorted(set(core)),
        "nasdaq100": sorted(set(nasdaq100)),
        "leveraged_etfs": sorted(set(leveraged_etfs)),
    }
