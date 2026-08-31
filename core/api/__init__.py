"""HTTP API bridge — exposes the core repositories as JSON for the web/ frontend.

`core/` stays the Python backend (data + ingest + repositories); this package is a
thin FastAPI layer that calls those repositories and serves the shapes the React
components in `web/` expect. No business logic lives here — endpoints map 1:1 to
repository functions. See web/MAPPING.md for the page/endpoint mapping.

Run:  uvicorn core.api.main:app --reload --port 8001
"""
