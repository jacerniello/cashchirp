"""FastAPI app bridging the core repositories to the web/ React frontend.

Routes are mounted under /api/v1 to match the web frontend's API client
(`web/src/lib/api.ts`). Endpoints are thin: each router calls a repository in
`core.backend.queries` and returns JSON. Keyed on **permaticker**, never
ticker. One router per resource lives in `core/api/routers/`.

Run:  uvicorn core.api.main:app --reload --port 8001
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.api.routers.discovery import screener, search
from core.api.routers.market import macro, short_interest, sp500
from core.api.routers.meta import setup
from core.api.routers.ownership import insiders, institutional
from core.api.routers.securities import company, etf, prices, sectors

app = FastAPI(title="Investing Research API", version="0.1.0")

# The Next dev server (web/) runs on :3000 and proxies /api/v1 here (or calls it
# directly). Allow localhost during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"
for _r in (screener, prices, company, institutional, insiders,
           short_interest, macro, search, etf, sp500, sectors, setup):
    app.include_router(_r.router, prefix=API_PREFIX)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
