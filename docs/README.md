# Documentation

Where things are, and which question each document answers.

| Document | Answers |
|---|---|
| **[setup/README.md](setup/README.md)** | **Start here.** Install, keys, which tables to load, verify it worked. |
| [setup/database.md](setup/database.md) | Building the database: preflight, the build, watching a long run, resuming when a step fails. |
| [reference/schema.md](reference/schema.md) | What is *in* the database: tables, keys, indexes, the fidelity conventions. |
| [reference/sources.md](reference/sources.md) | Each provider: licence, credentials, access patterns, coverage, caveats. |
| [reference/nasdaq-data-link.md](reference/nasdaq-data-link.md) | How the Nasdaq Data Link API works — auth, bulk export vs the query API, the row cap, and how the loader uses each. |
| [CONFIGURATION.md](CONFIGURATION.md) | Every setting, and the screen-spec schema. |
| [RESEARCH.md](RESEARCH.md) | The research folder and backtests: what is stored where, the AI workflow, the DD standard. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Sizing tiers, topology, the nightly job, backups. |

Three documents live outside this directory on purpose:

- [`../README.md`](../README.md) — the repo entry point.
- `../CLAUDE.md` — the project charter: mission, operating principles, and the database
  gotchas worth reading before writing a query. It is gitignored, so it exists only in a
  local checkout that has one.
- [`../core/README.md`](../core/README.md) — orientation for the `core/` package itself.
  It documents the directory it sits in, so it stays with the code.

## Setup vs reference

`setup/database.md` is **how to build** the database. `reference/schema.md` is **what is
in it** once built. They were previously one file each in two different places, which is
why the names now say which is which.

## The dataset list

There is no hand-kept table of datasets. The registry in `core/backend/sources.py` is the
list, and `python -m core.setup.bootstrap --sources` prints it: every dataset, its
provider, endpoint, licence, credential, the tables it writes and its refresh mode. The
Setup page in the app shows the same registry. A copy in the docs drifted every time the
registry changed, so it was removed.
