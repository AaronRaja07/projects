# Aaron Raja · Product × Engineering

Three independently authored, runnable portfolio prototypes connecting product judgment, software, and data operations. Every record is synthetic; every result describes a simulation. No production adoption, customer interviews, or business impact is claimed.

**Live dashboard:** [Mission Control](https://aaron-raja-mission-control.cheekyllama6.chatgpt.site) · public, no sign-in required. Hosted edits stay in the visitor’s browser.

## Run the portfolio

Requires Python 3.10+; no third-party packages, API keys, or cloud accounts.

```bash
git clone https://github.com/AaronRaja07/projects.git
cd projects
python3 server.py
```

Open **http://127.0.0.1:8000**. Use `python3 server.py --port 8001` if needed. Stop with Ctrl+C. Run from the repository root so all three demos share the same assets and server.

| Project | Decision it supports | Working capability | Start here |
| --- | --- | --- | --- |
| [Mission Control](mission-control/) | What should a delivery lead unblock, re-scope, or review? | Story-level rollups, capacity/scope changes, Monte Carlo forecast, dependency analysis, report export, editable reviews | [Guide](mission-control/README.md) |
| [Launch Decision Lab](signal-lab/) | Should a PM ship an onboarding change, and what fits next? | User-level synthetic experiments, intervals, assignment checks, guardrails, dependency-constrained roadmap | [Guide](signal-lab/README.md) |
| [Relay Operations](pipeline-rescue/) | Which data failures and shipment risks deserve intervention? | SQLite validation/quarantine, lineage, idempotent replay, disruption recovery, budget allocation | [Guide](pipeline-rescue/README.md) |

[Portfolio design and role relevance](PORTFOLIO.md) · [Data provenance](DATA-PROVENANCE.md) · [Recruiter walkthrough](DEMO.md)

## Verification

```bash
python3 -m unittest discover -s tests -v
node tests/test_browser_service.cjs  # optional Node.js 18+ for hosted adapter checks
```

Verified in this build: 63 Python tests and 14 browser-service tests pass. Browser/Python metrics and dependency results match across 840 filter combinations. The tests exercise aggregation semantics, forecast behavior, experiment policies, roadmap constraints, pipeline replay, and intervention budgets. See each guide for algorithm details and limitations.

## Architecture

`server.py` serves the portfolio and dispatches `/api/mission`, `/api/signal`, and `/api/pipeline` to small project services. Shared HTML/CSS/JavaScript keeps the interface coherent. Each project owns its domain logic and generated fixtures. SQLite and JSON state live in ignored `.demo-state/`; reset controls restore deterministic seeds.

The server binds to loopback and is intended for local demos. It is not a production multi-user service. Before internet deployment it would need authentication, authorization, tenancy, operational controls, and a deliberate persistence strategy.

## Public content boundary

Only original implementation, generated fixtures, and authored documentation belong here. Do not add employer source, screenshots, credentials, private records, original exports, or source archives. See [DATA-PROVENANCE.md](DATA-PROVENANCE.md).

## Scope

This is a focused portfolio, not a claim to replicate proprietary systems or distributed infrastructure. External production connectors, multi-user authentication, shared cloud persistence, and production scale are documented extension points. Mission Control is hosted as a browser-local sandbox. The earlier rating-tracker idea remains a [parked outline](rating-tracker/README.md), outside the featured builds.
