"""JSON serialization helpers shared by the API routers."""
from __future__ import annotations

import math
from typing import Any

import pandas as pd


def json_safe(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """NaN/inf → null (JSON has no NaN), in place. Returns the same list."""
    for row in records:
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                row[k] = None
    return records


def df_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """DataFrame → JSON-safe list of dicts."""
    return json_safe(df.to_dict("records"))
