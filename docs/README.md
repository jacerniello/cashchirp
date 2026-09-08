# Documentation

Where things are, and which question each document answers.

| Document | Answers |
|---|---|
| **[setup/README.md](setup/README.md)** | **Start here.** Install, keys, which tables to load, verify it worked. |
| [setup/database.md](setup/database.md) | Building the database: preflight, the build, watching a long run, resuming when a step fails. |
| [setup/sources.md](setup/sources.md) | Where every dataset comes from, and its licence. **Generated** — see below. |
| [reference/schema.md](reference/schema.md) | What is *in* the database: tables, keys, indexes, the fidelity conventions. |
| [CONFIGURATION.md](CONFIGURATION.md) | Every setting, and the screen-spec schema. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Sizing tiers, topology, the nightly job, backups. |

Two documents live outside this directory on purpose:

- [`../README.md`](../README.md) — the repo entry point.
- [`../CLAUDE.md`](../CLAUDE.md) — the project charter: mission, operating principles,
  and the database gotchas worth reading before writing a query.
- [`../core/README.md`](../core/README.md) — orientation for the `core/` package itself.
  It documents the directory it sits in, so it stays with the code.

## Setup vs reference

`setup/database.md` is **how to build** the database. `reference/schema.md` is **what is
in it** once built. They were previously one file each in two different places, which is
why the names now say which is which.

## Generated documents

`setup/sources.md` is generated from `core/backend/sources.py` — the same registry that
drives what `bootstrap` actually ingests, so the published provenance cannot claim a
source the build does not use.

```bash
# docs/setup/sources.md was generated from core/backend/sources.py; the generator has
# been removed, so keep it in step with the registry by hand.
```

Do not hand-edit it; change the registry and re-run.
