"""Screen specs — declarative, user-owned stock filters loaded from `config/screens/*.yaml`.

A *screen* is the project's unit of personalisation: which universe to consider and which
gates a company must clear. Keeping it as data rather than code means someone can define
their own filter without touching Python, and means the **live screen and the point-in-time
backtest run the identical definition** — the one way to know a backtest is testing the
thing you actually ship.

    from core.backend import screens
    spec = screens.load_screen("quality-value")   # or screens.active_screen()
    passed = screens.apply_screen(df, spec)

Spec shape (see `config/screens/quality-value.yaml` for the annotated example, and
`docs/CONFIGURATION.md` for the reference):

    id, title, description, criteria: [str]
    universe: {exclude_sectors, exclude_industries, exclude_delisted,
               include_sectors, include_industries, include_exchanges}
    gates:    {<column>: {min, max, gt, lt, on_null: drop|keep|<number>}}
    growth:   [{level, level_5y_ago, cagr, min_cagr}]

Nothing here touches the database — `apply_screen` is a pure DataFrame filter, so it works
identically on the live snapshot and on a historical as-of panel.
"""
from __future__ import annotations

import functools
import re
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from core.config import PROJECT_ROOT, settings

# config/ sits at the repo root, beside core/ and research/ — screens are user content,
# not application code, so they live outside the package.
SCREENS_DIR = PROJECT_ROOT / "config" / "screens"

_BOUNDS = {"min": "ge", "max": "le", "gt": "gt", "lt": "lt"}


class ScreenSpecError(ValueError):
    """A screen YAML file is missing, malformed, or gates a column that doesn't exist."""


def list_screens() -> list[dict[str, Any]]:
    """Every screen in `config/screens/`, as {id, title, description, path}. Files starting
    with `_` are ignored so a partial draft can sit in the folder without being offered."""
    out = []
    for p in sorted(SCREENS_DIR.glob("*.y*ml")):
        if p.name.startswith("_"):
            continue
        try:
            spec = yaml.safe_load(p.read_text()) or {}
        except yaml.YAMLError:
            continue
        out.append({
            "id": spec.get("id", p.stem),
            "title": spec.get("title", p.stem),
            "description": (spec.get("description") or "").strip(),
            "path": str(p),
        })
    return out


@functools.lru_cache(maxsize=32)
def load_screen(screen_id: str) -> dict[str, Any]:
    """Load and validate one screen spec by id (the filename stem). Cached — call
    `load_screen.cache_clear()` after editing a YAML file in a long-running process."""
    for ext in (".yaml", ".yml"):
        p = SCREENS_DIR / f"{screen_id}{ext}"
        if p.exists():
            break
    else:
        available = ", ".join(s["id"] for s in list_screens()) or "(none)"
        raise ScreenSpecError(
            f"No screen '{screen_id}' in {SCREENS_DIR}. Available: {available}"
        )
    try:
        spec = yaml.safe_load(p.read_text())
    except yaml.YAMLError as e:
        raise ScreenSpecError(f"{p} is not valid YAML: {e}") from e
    if not isinstance(spec, dict):
        raise ScreenSpecError(f"{p} must be a YAML mapping, got {type(spec).__name__}")
    spec.setdefault("id", screen_id)
    _validate(spec, p)
    return spec


def active_screen() -> dict[str, Any]:
    """The screen the API and scripts use by default — `ACTIVE_SCREEN` in core/.env."""
    return load_screen(settings.active_screen)


def _validate(spec: dict, path: Path) -> None:
    """Fail loudly on a malformed spec at load time. A screen that silently ignores a
    misspelled gate is worse than one that won't start: it returns a plausible basket that
    isn't the filter you wrote."""
    gates = spec.get("gates") or {}
    if not isinstance(gates, dict):
        raise ScreenSpecError(f"{path}: `gates` must be a mapping of column -> bounds")
    for col, rule in gates.items():
        if not isinstance(rule, dict):
            raise ScreenSpecError(f"{path}: gate `{col}` must be a mapping, e.g. {{min: 0}}")
        unknown = set(rule) - set(_BOUNDS) - {"on_null"}
        if unknown:
            raise ScreenSpecError(
                f"{path}: gate `{col}` has unknown key(s) {sorted(unknown)}; "
                f"allowed: {sorted(set(_BOUNDS) | {'on_null'})}"
            )
        if not set(rule) & set(_BOUNDS):
            raise ScreenSpecError(f"{path}: gate `{col}` sets no bound (min/max/gt/lt)")
        for key in set(rule) & set(_BOUNDS):
            if isinstance(rule[key], str):
                raise ScreenSpecError(
                    f"{path}: gate `{col}.{key}` = {rule[key]!r} is a string, not a number. "
                    "In YAML, write 3.0e+8 (signed exponent) or 300000000 — bare `3.0e8` "
                    "parses as text."
                )
        on_null = rule.get("on_null", "drop")
        if isinstance(on_null, str) and on_null not in ("drop", "keep"):
            raise ScreenSpecError(
                f"{path}: gate `{col}.on_null` must be 'drop', 'keep', or a number"
            )
    for i, g in enumerate(spec.get("growth") or []):
        missing = {"level", "level_5y_ago", "cagr", "min_cagr"} - set(g or {})
        if missing:
            raise ScreenSpecError(f"{path}: growth rule #{i} missing {sorted(missing)}")


def _grows(level: pd.Series, base: pd.Series, cagr: pd.Series, min_cagr: float) -> pd.Series:
    """Multi-year growth gate that doesn't silently drop turnarounds. Pass if the CAGR clears
    `min_cagr`, OR the company recovered from a non-positive base (loss/negative 5y ago →
    positive now) — a recovery makes the CAGR mathematically undefined (NaN), but it is
    unambiguously strong growth, so it should qualify rather than disqualify."""
    return (cagr >= min_cagr) | ((level > 0) & (base <= 0))


def apply_screen(
    df: pd.DataFrame, spec: dict[str, Any], *, drop_delisted: bool | None = None
) -> pd.DataFrame:
    """Apply a screen spec to a metrics snapshot and return the surviving rows.

    Pure pandas — the same function serves the live idea board and the point-in-time
    backtest. `drop_delisted` overrides `universe.exclude_delisted`: the backtest passes
    False because `isdelisted` is *today's* flag (the wrong vintage for a historical as-of),
    where survivorship is instead handled by only including names trading at the as-of date.
    """
    uni = spec.get("universe") or {}
    d = df

    if drop_delisted is None:
        drop_delisted = bool(uni.get("exclude_delisted", True))
    if drop_delisted and "isdelisted" in d.columns:
        d = d[d["isdelisted"] != "Y"]
    if (sectors := uni.get("exclude_sectors")) and "sector" in d.columns:
        d = d[~d["sector"].isin(set(sectors))]
    if (inds := uni.get("exclude_industries")) and "industry" in d.columns:
        d = d[~d["industry"].isin(set(inds))]
    # Positive selections, so a filter saved from the UI ("Technology only") round-trips
    # instead of being silently widened back to the whole market.
    if (only := uni.get("include_sectors")) and "sector" in d.columns:
        d = d[d["sector"].isin(set(only))]
    if (only := uni.get("include_industries")) and "industry" in d.columns:
        d = d[d["industry"].isin(set(only))]
    if (only := uni.get("include_exchanges")) and "exchange" in d.columns:
        d = d[d["exchange"].isin(set(only))]

    for col, rule in (spec.get("gates") or {}).items():
        if col not in d.columns:
            raise ScreenSpecError(
                f"Screen '{spec.get('id')}' gates `{col}`, which is not a snapshot column. "
                "Run `python -m core.scripts.screen.run_screen --columns` to list what's available."
            )
        series = d[col]
        on_null = rule.get("on_null", "drop")
        if not isinstance(on_null, str):          # numeric default
            series = series.fillna(on_null)
        keep_null = on_null == "keep"

        mask = pd.Series(True, index=d.index)
        for key, op in _BOUNDS.items():
            if key in rule:
                mask &= getattr(series, op)(rule[key])
        if keep_null:
            mask |= series.isna()
        d = d[mask]

    for g in spec.get("growth") or []:
        for key in ("level", "level_5y_ago", "cagr"):
            if g[key] not in d.columns:
                raise ScreenSpecError(
                    f"Screen '{spec.get('id')}' growth rule references `{g[key]}`, "
                    "which is not a snapshot column."
                )
        d = d[_grows(d[g["level"]], d[g["level_5y_ago"]], d[g["cagr"]], g["min_cagr"])]

    return d


# --------------------------------------------------------------- saving from the UI

# Screener query params that describe *presentation*, not the filter itself. Dropping
# these on save is correct and silent; anything else unrecognised is reported back.
_NON_FILTER = {"sort", "page", "per_page", "snapshot_date", "limit", "offset",
               "preset", "range", "from"}

# URL spelling -> API spelling for the three exclusion toggles.
_TOGGLE_ALIASES = {
    "excl_commod": "exclude_commodities",
    "excl_biotech": "exclude_biotech",
    "incl_delisted": "include_delisted",
}

# The toggle -> universe-rule mapping the /filter grid uses, so a saved screen expresses
# the same intent as the checkbox rather than a copy of its implementation.
_COMMODITY_SECTORS = ["Energy", "Basic Materials"]
_BIOTECH_INDUSTRIES = [
    "Biotechnology",
    "Drug Manufacturers - Specialty & Generic",
    "Drug Manufacturers - General",
    "Drug Manufacturers - Major",
]


def _truthy(v: Any) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def spec_from_params(
    screen_id: str, params: dict[str, Any], *,
    title: str = "", description: str = "", criteria: list[str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Turn a `/screener` query into a screen spec.

    Returns ``(spec, unsupported)``. **`unsupported` is the important half**: a saved
    filter that quietly drops a constraint is worse than a failed save, because you would
    go on believing the screen you backtest is the screen you looked at. Callers must
    surface it rather than discard it.
    """
    spec: dict[str, Any] = {
        "id": screen_id,
        "title": title or screen_id.replace("-", " ").replace("_", " ").title(),
    }
    if description:
        spec["description"] = description
    if criteria:
        spec["criteria"] = list(criteria)

    universe: dict[str, Any] = {}
    gates: dict[str, dict[str, float]] = {}
    unsupported: list[str] = []

    # The same three toggles have two vocabularies: the API query (`exclude_commodities`)
    # and the /filter URL (`excl_commod`). Accept both, because a converter that silently
    # ignores the other spelling drops the exclusion instead of failing - the screen saves
    # looking complete and quietly matches a wider universe.
    for key, value in {_TOGGLE_ALIASES.get(k, k): v for k, v in (params or {}).items()}.items():
        if value in (None, "", []) or key in _NON_FILTER:
            continue
        if key.endswith("_min") or key.endswith("_max"):
            col, bound = key.rsplit("_", 1)
            try:
                gates.setdefault(col, {})[bound] = float(value)
            except (TypeError, ValueError):
                unsupported.append(f"{key}={value!r} (not a number)")
        elif key == "exclude_commodities":
            if _truthy(value):
                universe["exclude_sectors"] = list(_COMMODITY_SECTORS)
        elif key == "exclude_biotech":
            if _truthy(value):
                universe["exclude_industries"] = list(_BIOTECH_INDUSTRIES)
        elif key == "include_delisted":
            universe["exclude_delisted"] = not _truthy(value)
        elif key == "is_active":
            universe["exclude_delisted"] = _truthy(value)
        elif key == "sector":
            universe["include_sectors"] = [value]
        elif key == "industry":
            universe["include_industries"] = [value]
        elif key == "exchange":
            universe["include_exchanges"] = [value]
        elif key == "market_cap_range":
            # A named band ("mid"), not a number - the grid resolves it against
            # /screener/stats. Saving the label would produce a screen that filters on
            # nothing, so report it instead of writing a lie.
            unsupported.append(
                f"market_cap_range={value!r} - save it as marketcap_min / marketcap_max"
            )
        elif _truthy(value) or not isinstance(value, bool):
            unsupported.append(f"{key}={value!r}")

    if universe:
        spec["universe"] = universe
    if gates:
        spec["gates"] = gates
    return spec, unsupported


def save_screen(spec: dict[str, Any], *, overwrite: bool = False) -> Path:
    """Write a screen spec to ``config/screens/<id>.yaml`` and return the path.

    Validated before writing, so a screen that could never load is never saved. The file
    is plain YAML you can then edit, diff and commit - the point of saving from the UI is
    to get a filter into the *same* format the backtest harness runs, not into a private
    store the rest of the tooling cannot see.
    """
    screen_id = str(spec.get("id") or "").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", screen_id):
        raise ScreenSpecError(
            f"Invalid screen id {screen_id!r}: use lowercase letters, digits, '-' or '_' "
            "(it becomes a filename)."
        )
    if not (spec.get("gates") or spec.get("universe") or spec.get("growth")):
        raise ScreenSpecError(
            "Refusing to save a screen with no filters - it would match the whole market."
        )

    SCREENS_DIR.mkdir(parents=True, exist_ok=True)
    path = SCREENS_DIR / f"{screen_id}.yaml"
    if path.exists() and not overwrite:
        raise ScreenSpecError(
            f"Screen {screen_id!r} already exists. Pass overwrite to replace it."
        )

    _validate(spec, path)          # never write something that cannot be loaded back
    header = (
        "# " + str(spec.get("title", screen_id)) + "\n"
        "#\n"
        "# Saved from the screener UI. This is the SAME format the idea board and the\n"
        "# point-in-time backtest read, so you can now run:\n"
        "#   python -m core.scripts.screen.run_screen " + screen_id + "\n"
        "#   python -m core.scripts.screen.screen_portfolio_backtest " + screen_id + "\n"
        "# Edit it by hand freely - see docs/CONFIGURATION.md for every option.\n"
    )
    path.write_text(header + yaml.safe_dump(spec, sort_keys=False, allow_unicode=True))
    load_screen.cache_clear()      # the on-disk set just changed
    return path


def delete_screen(screen_id: str) -> bool:
    """Remove a saved screen. Returns False if it was not there."""
    for ext in (".yaml", ".yml"):
        p = SCREENS_DIR / f"{screen_id}{ext}"
        if p.exists():
            p.unlink()
            load_screen.cache_clear()
            return True
    return False


# URL params the /filter page reads. Its exclusion toggles are not symmetric — commodities
# are excluded BY DEFAULT (`excl_commod !== '0'`), so a screen that does not exclude them
# has to say so explicitly or the UI will silently re-apply the exclusion.
def params_from_spec(spec: dict[str, Any]) -> tuple[dict[str, str], list[str]]:
    """Turn a saved screen back into `/screener` URL params, so clicking it loads the
    filter you saved rather than merely naming it.

    Returns ``(params, lossy)``. ``lossy`` lists everything the grid cannot represent —
    exclusive bounds, multi-value selections, growth rules. Those constraints stay in the
    YAML and still apply when the screen is *run*; they just aren't shown as widgets, and
    saying so is the difference between "here is your screen" and "here is most of it".
    """
    uni = spec.get("universe") or {}
    params: dict[str, str] = {}
    lossy: list[str] = []

    for col, rule in (spec.get("gates") or {}).items():
        for bound in ("min", "max"):
            if bound in rule:
                # The URL carries API units (0.15), which the grid scales for display.
                params[f"{col}_{bound}"] = str(rule[bound])
        for excl, near in (("gt", "min"), ("lt", "max")):
            if excl in rule:
                lossy.append(
                    f"{col} {excl} {rule[excl]} — the grid has no exclusive bound; "
                    f"showing it as {near} would change the result, so it is not loaded"
                )

    def _one(key: str, values: list, label: str) -> None:
        if not values:
            return
        params[key] = str(values[0])
        if len(values) > 1:
            lossy.append(f"{label}: only {values[0]!r} loaded of {len(values)} "
                         f"({', '.join(map(str, values))}) — the grid takes one")

    _one("sector", list(uni.get("include_sectors") or []), "include_sectors")
    _one("industry", list(uni.get("include_industries") or []), "include_industries")
    _one("exchange", list(uni.get("include_exchanges") or []), "include_exchanges")

    # Commodities: ON by default in the grid, so absence of the rule must be stated.
    excl_sectors = set(uni.get("exclude_sectors") or [])
    params["excl_commod"] = "1" if excl_sectors >= set(_COMMODITY_SECTORS) else "0"
    if excl_sectors and not excl_sectors >= set(_COMMODITY_SECTORS):
        lossy.append(f"exclude_sectors {sorted(excl_sectors)} — the grid only has the "
                     "commodities toggle; this exclusion still applies when run")

    excl_inds = set(uni.get("exclude_industries") or [])
    if excl_inds >= set(_BIOTECH_INDUSTRIES):
        params["excl_biotech"] = "1"
        excl_inds -= set(_BIOTECH_INDUSTRIES)
    if excl_inds:
        lossy.append(f"exclude_industries {sorted(excl_inds)} — the grid only has the "
                     "biotech toggle; this exclusion still applies when run")

    if uni.get("exclude_delisted") is False:
        params["incl_delisted"] = "1"

    if spec.get("growth"):
        lossy.append(
            f"{len(spec['growth'])} growth rule(s) — recovery-aware multi-year gates have "
            "no widget; they still apply when the screen is run"
        )
    return params, lossy


def merge_unrepresentable(
    base: dict[str, Any], spec: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    """Carry the parts of `base` the grid cannot express into a spec saved from the grid.

    Without this, load-a-screen -> tweak -> save is **silent data loss**: the widgets can
    show `roic >= 0.12` but not `fcf > 0` or a recovery-aware growth rule, so re-saving
    would write a spec missing constraints the user never chose to remove and could not
    see. Warning at load time is not enough - the destructive step is the save.

    What is carried is exactly what has no widget:
      * `growth` rules (wholesale),
      * exclusive `gt`/`lt` bounds,
      * sector/industry exclusions beyond the two toggles the grid owns.

    What is NOT carried is anything the grid *did* show, because there the user's edit is
    authoritative - including narrowing a multi-value `include_*` to the one the dropdown
    displayed. Returns ``(spec, carried)``; `carried` is reported, never silent.
    """
    carried: list[str] = []
    spec = {k: (dict(v) if isinstance(v, dict) else v) for k, v in spec.items()}

    # -- growth rules: invisible in the grid, so they can only be lost by accident.
    if base.get("growth") and not spec.get("growth"):
        spec["growth"] = [dict(g) for g in base["growth"]]
        carried.append(f"{len(base['growth'])} growth rule(s)")

    # -- exclusive bounds and null handling: the grid has neither.
    #
    # `on_null` matters more than it looks. `gross_margin: {on_null: keep}` is what stops
    # the screen dropping every industrial that doesn't break out COGS - losing it doesn't
    # error, it just quietly returns a smaller, biased basket (21 names -> 17 on the
    # example screen). It is invisible in the grid, so it can only be lost by accident.
    gates = dict(spec.get("gates") or {})
    for col, rule in (base.get("gates") or {}).items():
        invisible = {k: v for k, v in rule.items() if k in ("gt", "lt", "on_null")}
        if not invisible:
            continue
        merged = dict(gates.get(col) or {})
        for k, v in invisible.items():
            merged.setdefault(k, v)      # never override something the grid did set
        gates[col] = merged
        carried.append(f"{col} " + ", ".join(f"{k} {v}" for k, v in invisible.items()))
    if gates:
        spec["gates"] = gates

    # -- exclusions the two toggles cannot express.
    uni = dict(spec.get("universe") or {})
    base_uni = base.get("universe") or {}
    for key, owned in (("exclude_sectors", _COMMODITY_SECTORS),
                       ("exclude_industries", _BIOTECH_INDUSTRIES)):
        extra = [x for x in (base_uni.get(key) or []) if x not in owned]
        if not extra:
            continue
        uni[key] = sorted(set(uni.get(key) or []) | set(extra))
        carried.append(f"{key}: {', '.join(extra)}")
    if uni:
        spec["universe"] = uni

    return spec, carried
