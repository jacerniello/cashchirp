"""Registry helpers for FRED source files on disk (`core/data/fred/`).

`save_file` writes bytes to disk under the data dir and upserts a `fred_files` row,
stamping `requested_at` every call and bumping `content_updated_at` only when the
content's sha256 actually changes. This is how we keep local files fresh and know,
per file, when it was last requested vs. last actually updated.
"""
import hashlib
from datetime import datetime, timezone
from pathlib import Path

from core.backend.db.engine import session_scope
from core.backend.db.models import FredFile
from core.config import CORE_DIR

# Sibling of downloads/sharadar; gitignored via data/. Anchored on CORE_DIR rather
# than counted parents — see the note in ingest/sharadar/sharadar.py.
DATA_DIR = CORE_DIR / "data" / "downloads" / "fred"


def save_file(
    *,
    rel_path: str,
    data: bytes,
    dataset: str,
    kind: str,
    vintage: str,
    source_url: str,
) -> dict:
    """Write `data` to DATA_DIR/rel_path and upsert its fred_files row.

    Returns {"path", "bytes", "changed", "requested_at", "content_updated_at"}.
    `changed` is True when the bytes differ from what we last saw (new or updated).
    """
    sha = hashlib.sha256(data).hexdigest()
    now = datetime.now(timezone.utc)

    dest = DATA_DIR / rel_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    with session_scope() as session:
        row = session.get(FredFile, rel_path)
        changed = row is None or row.sha256 != sha
        if row is None:
            row = FredFile(path=rel_path)
            session.add(row)
        row.dataset = dataset
        row.kind = kind
        row.vintage = vintage
        row.source_url = source_url
        row.sha256 = sha
        row.n_bytes = len(data)
        row.requested_at = now
        if changed:
            row.content_updated_at = now
        content_updated_at = row.content_updated_at

    return {
        "path": rel_path,
        "bytes": len(data),
        "changed": changed,
        "requested_at": now,
        "content_updated_at": content_updated_at,
    }
