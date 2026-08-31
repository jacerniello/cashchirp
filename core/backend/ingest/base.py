"""Reusable ingestion pattern.

Every data source becomes a small subclass implementing three steps:

    fetch()      -> pull raw data from the source
    transform()  -> shape it into rows ready for storage
    load()       -> upsert into Postgres (returns count)

`run()` wires them together. New source = new subclass, nothing else changes.
"""
from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy.orm import Session


class BaseIngestor(ABC):
    #: human-readable label for logs
    name: str = "ingestor"

    @abstractmethod
    def fetch(self) -> Any:
        """Pull raw data from the external source."""

    @abstractmethod
    def transform(self, raw: Any) -> Any:
        """Shape raw data into storage-ready rows."""

    @abstractmethod
    def load(self, session: Session, data: Any) -> int:
        """Persist rows; return how many were written."""

    def run(self, session: Session) -> int:
        return self.load(session, self.transform(self.fetch()))
