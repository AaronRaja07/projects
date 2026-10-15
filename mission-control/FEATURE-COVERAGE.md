# Mission Control capability coverage

An independently authored delivery dashboard with a light enterprise shell, twelve horizontal primary tabs, and two supporting views. All records are generated. This map describes the delivered UI, Python service, and static browser adapter; it does not claim full parity with another system.

## Delivered

| View | Working capabilities |
| --- | --- |
| Dashboard | Team/sprint/status/Remaining/search filters; shared metrics; points-based sprint snapshot and status donut; team scope/remaining bars; clickable snapshot drilldowns; outcome rollups and rule-based decision cards. |
| Work items — supporting view | Search the scoped story ledger; inspect owners, outcomes, points, status, and recorded age; change status and persist it. Reached through the header or snapshot drilldowns. |
| Planning & Hygiene | Adjust per-team capacity and compare utilization; add a story to Sprint 03; capture a baseline and inspect complete all-sprint outcome deltas. |
| Readiness Quality — Planning subtab | Inspect missing description, acceptance, or estimate flags; fill generated demo flags and update the shared readiness metric. |
| Reports & Analysis | Preview scoped metrics and decisions; download Markdown and story-level CSV derived from the same selected stories. |
| Gantt | Render modeled working-day bars, start/duration/finish values, zero-duration milestones, and the estimated critical chain from the dependency schedule. |
| Forecasting & Risk | Run 2,000 repeatable throughput trials for the selected team's Sprint 03; vary added scope/throughput; inspect P50/P80/P95 working days and the fraction finishing within ten working days. |
| Contributors | View generated sprint completion and cycle-time distributions; inspect scoped owner workload, completion, blockers, and readiness. |
| Dependencies | Inspect outcome prerequisites and blocked stories; compute a finish-to-start schedule; retain required upstream outcomes across team filters; reject cycles and missing references. |
| Product Reviews | Create, edit, and remove dated workspace-wide sessions with team, decision topic, and fictional facilitator; validate fields and persist edits. |
| Assistant | Answer four topic families—blocked work, capacity, readiness, and delivery summary—with deterministic rules, current counts, story evidence, and suggested discussion actions. |
| Operations | Triage blocked or aged open stories; adjust the recorded-age threshold; sort blockers first and export the current queue as JSON. |
| Platform Metrics | Run eight checks on scoped keys, outcome references, ownership, estimates, descriptions, acceptance, and workflow status; show exception identifiers and entity relationships. |
| Data Sources | Inspect generated fixture provenance, seed/date, local state behavior, and field interpretations; download the current scoped overview as JSON. |

Header controls reload the current model, show the synthetic system status, and adjust zoom. Shared filters, inline explanations, and “How to read” sections make metric behavior explicit. The audit records selected mutation actions; reset restores the starting fixture.

## Local and hosted behavior

| Edition | Computation and persistence |
| --- | --- |
| Local Python | Standard-library service through `/api/mission`; JSON edits in ignored `.demo-state/mission.json`. |
| Hosted static browser | Python-generated seed plus JavaScript adapter; edits in this browser's `localStorage`, with an in-memory fallback and warning if storage fails. No multiuser backend or cloud database. |

Both editions use the same fixture and documented aggregation rules. Tests compare overview and dependency results across 840 filter combinations. Forecasts use separate seeded Python and JavaScript random generators, so exact forecast samples and quantiles can differ. The two editions do not synchronize edits.

## Partial capabilities and limits

- **History and risk:** burndown is illustrated, age/cycle values are generated, and decision cards use simple rules. There is no observed event history, weighted/calibrated risk score, automatic escalation, or historical risk analysis.
- **Baseline and scope:** additions and capture are implemented. Removal, re-estimation controls, a scope-event ledger, imports, and historical baseline series are absent.
- **Readiness and integrity:** presence flags and scoped record checks do not judge requirement quality or certify an external database. Quality snapshots are absent.
- **Forecast:** uses two generated historical sprints and declared throughput variation. It is not backtested or calibrated. Only the team filter affects its full Sprint 03 work scope; the historical sprint/status/search selection does not.
- **Dependencies and Gantt:** outcome-level DAG and modeled day offsets, not a story-level blocking network, interactive node-link graph, resource-constrained schedule, or calendar commitment.
- **Operations:** recorded age is neither time in the current status nor a production SLA. There is no escalation delivery or service-level target engine.
- **Reviews and contributors:** no scheduling conflict detection, facilitator workload model, calendar sync, or individual productivity scoring. Contributor history bars describe selected teams across all generated sprints; the owner table uses current filters.
- **Assistant:** four local rule families only; no external language model, tool agent, or autonomous actions.

## Extensions not delivered

External issue-tracker/data adapters, live feeds, spreadsheet ingestion, scheduled digests, messaging or document publication, authentication/roles, multi-instance federation, shared cloud persistence, production operational monitoring, and tamper-proof auditing are not implemented.

No real customer adoption, production validation, measured business impact, or external integration is claimed.
