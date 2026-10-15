# Aaron Raja · Product × Engineering

Three independently authored, runnable portfolio prototypes connecting product judgment, software, and data operations. Every record is synthetic; every result describes a simulation. No production adoption, customer interviews, or business impact is claimed.

**Public portfolio:** [Open all three projects](https://aaron-raja-product-lab.cheekyllama6.chatgpt.site)

- [Mission Control](https://aaron-raja-mission-control.cheekyllama6.chatgpt.site)
- [Launch Decision Lab](https://aaron-raja-product-lab.cheekyllama6.chatgpt.site/signal-lab/)
- [Relay Operations](https://aaron-raja-product-lab.cheekyllama6.chatgpt.site/pipeline-rescue/)

No sign-in is required. Hosted demos use generated data and browser-local computation; Relay and Mission Control edits stay in each visitor’s browser.

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
node --test tests/*.cjs  # optional Node.js 18+ for all hosted-adapter/export checks
```

Verified in this build: 65 Python tests and 45 JavaScript tests pass. Browser/Python metrics and dependency results match across 840 filter combinations. The tests exercise aggregation semantics, forecast behavior, experiment policies, roadmap constraints, pipeline replay, intervention budgets, and accessible exports. Signal inference matches the Python reference on 9,700 identical users; Relay matches full Python outputs across fault, repair, replay, and budget scenarios. See each guide for algorithm details and limitations.

## Architecture

`server.py` serves the portfolio and reference Python APIs under `/api/mission`, `/api/signal`, and `/api/pipeline`. The source retains a real SQLite implementation for Relay; its hosted adapter uses browser-local logical tables and localStorage. Signal’s interface uses its JavaScript engine, while the Python API remains available for reference and parity checks. Shared HTML/CSS/JavaScript keeps the interface coherent. Each project owns its domain logic and generated fixtures. Local SQLite/JSON state lives in ignored `.demo-state/`; hosted state stays in the visitor’s browser. Reset controls restore deterministic seeds.

The server binds to loopback and is intended for local demos. It is not a production multi-user service. Before internet deployment it would need authentication, authorization, tenancy, operational controls, and a deliberate persistence strategy.

## Public content boundary

Only original implementation, generated fixtures, and authored documentation belong here. Do not add employer source, screenshots, credentials, private records, original exports, or source archives. See [DATA-PROVENANCE.md](DATA-PROVENANCE.md).

## Scope

This is a focused portfolio, not a claim to replicate proprietary systems or distributed infrastructure. External production connectors, multi-user authentication, shared cloud persistence, and production scale are documented extension points. All three projects are hosted as browser-local sandboxes; backend/cloud scaling is described as a future extension, not claimed as a deployed capability. The earlier rating-tracker idea remains a [parked outline](rating-tracker/README.md), outside the featured builds.

## Rebuild the hosted Product Lab

The Site manifest and credentials stay in a separate registered Site checkout. `python3 tools/build-product-lab.py /absolute/path/to/site-checkout` packages only the public HTML, CSS, JavaScript, fixtures, and documentation. It includes both new demos and links to Mission Control. Source helper packaging/deployment follows the Sites workflow; no credential is stored in this repository.
