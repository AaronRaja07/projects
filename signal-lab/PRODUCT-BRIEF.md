# Signal Lab — authored product brief

Status: working portfolio prototype. Business, personas, discovery statements, metrics, and roadmap values below are hypothetical. No customer interviews or business impact are claimed.

## Problem and user

A fictional B2B data workspace company is testing guided onboarding. Its product lead sees higher activation, while support sees more help requests. The release meeting needs one shared account of the evidence, its quality, and the cost of being wrong.

The primary user is a product lead deciding whether to stage a rollout. Secondary users are the analyst checking assignment/denominators, the engineering lead negotiating capacity and prerequisites, and the support lead protecting the customer experience.

Hypotheses to validate through actual discovery: teams spend time reconciling incompatible experiment readouts; support harm is considered too late; roadmap scoring often ignores prerequisites. These are testable assumptions, not findings.

## Product objective and metric tree

Enable a reproducible release decision whose evidence and assumptions can be inspected in one place.

| Layer | Metric | Role |
| --- | --- | --- |
| Desired customer value | Users reaching useful workspace work | Requires future real-world definition and validation |
| Primary experiment metric | Seven-day activation / all assigned users | Measures intended onboarding benefit |
| Guardrail | Support contacts in seven days / all assigned users | Detects added customer friction |
| Diagnostic | Import completion and invitations | Explains workflow progression |
| Exploratory outcome | Fourteen-day retention / all assigned users | Tests whether first value persists |
| Integrity | Sample-ratio p-value and arm denominators | Protects interpretation before business decisions |

Primary rollout checks were chosen for this fictional scenario: positive 95% activation interval, observed lift ≥3 percentage points, support-harm upper interval <3 percentage points, at least 400 users per arm, and assignment p ≥.001 against the planned 50:50 split. The sample threshold is a demo choice rather than a prospective power result. A defensible real experiment would choose minimum detectable effects, power, margins, assignment unit, observation window, and stopping rule before enrollment.

## Scope and user stories

- As a product lead, I can see a ship/hold/rollback/invalid recommendation with every failed check. Acceptance: assignment mismatch overrides apparent lift; demonstrated support harm blocks rollout.
- As an analyst, I can export every generated user and reproduce the result with a seed. Acceptance: repeated parameters produce identical outcomes, and both arms use all assigned users in the denominator.
- As a support lead, I can introduce friction and see its uncertainty. Acceptance: the support limit uses an interval, rather than only the point estimate.
- As an engineering lead, I can change capacity and inspect a dependency-valid optimal roadmap. Acceptance: selected effort never exceeds capacity and selected features always include prerequisites.
- As a skeptical reviewer, I can run A/A trials and examine uncertainty in the false-positive rate. Acceptance: the evaluation actually draws independent outcomes and exposes its seed, denominator, and limitations.

The prototype excludes real identity data, live experiment ingestion, multitenant collaboration, automated production rollout, and commercial forecasting.

## Discovery plan

Interview product, analyst, engineering, and support partners separately. Ask each to reconstruct a recent release decision, show the evidence they trusted, identify conflicting metrics, and describe the cost of a wrong decision. Observe an actual release review with consent. Look for repeated behavior before committing to the above hypotheses. Do not ask leading questions that assume this workbench is needed.

Initial usability tasks: explain why the harmful variant is blocked; locate an assignment problem; reproduce an exported readout; choose a roadmap under a smaller capacity. Measure unassisted task completion, interpretation errors, and decision time. No measured usability results exist yet.

## Tradeoff log

| Choice | Rationale | Cost / next step |
| --- | --- | --- |
| Transparent policy with uncertainty | Shows how evidence affects a decision | Policy needs validation for each real context |
| Fixed horizon and complete follow-up | Keeps the demonstration interpretable | Add delayed/censored outcomes before live use |
| Independent user randomization | Simple, inspectable statistical model | Shared workspaces may require cluster randomization |
| Exploratory segment table | Reveals heterogeneous outcomes | No corrected subgroup inference is claimed |
| Exact small roadmap solver | Makes dependencies and opportunity cost concrete | Add uncertainty, interactions, and larger-scale optimization if justified |
| Standard library backend | Easy local reproduction and code review | Not a claim of distributed or production architecture |
| No LLM decision layer | Every numerical recommendation is independently inspectable | An assistant could explain results later, with verified source grounding |

## Launch and learning plan

First validate the workflow with actual target users, then connect a read-only anonymized event source with explicit authorization. Shadow existing decisions before automating recommendations. Run a prospective A/A experiment to inspect real assignment and instrumentation; review workspace interference and missingness. Gate any production rollout through accountable product and engineering owners. Monitor activation, support burden, retention, and incident signals after staged exposure.

For this portfolio version, evaluation is a local simulation and test suite. There are no claims of saved hours, increased revenue, customer adoption, or validated product-market fit.

## Why this is relevant to target roles

These are capability mappings, not endorsements or claims of employment readiness. Listings were reviewed October 14, 2026; roles and requirements can change.

- **Palantir forward deployed engineering:** a current posting emphasizes end-to-end execution, architecture, custom applications, data, and engagement with technical users and executives. Signal Lab demonstrates turning an ambiguous operating decision into working software with inspectable evidence. [Official Palantir FDSE posting](https://jobs.lever.co/palantir/dab396d4-2f14-4796-aac0-0d82883dccf0)
- **Palantir deployment strategy:** the role includes understanding workflows, identifying relevant data, building demos, and communicating results across stakeholder levels. The problem brief, decision contract, and demo supply complementary evidence. [Official Palantir Deployment Strategist posting](https://jobs.lever.co/palantir/1a53939d-8ffa-4570-b31a-6d0bc53fdb59)
- **Databricks product management:** the reviewed posting emphasizes product vision, customer needs, roadmap priorities, and measuring success to iterate. This prototype makes assumptions, metrics, evidence, and prioritization tradeoffs explicit. [Official Databricks PM posting](https://www.databricks.com/company/careers/product/sr-product-manager-lakebase-lakehouse-8811265002)
- **Databricks field engineering:** the reviewed Solutions Architect role emphasizes Python/SQL, architecture, custom working solutions, and a build/demo/pitch interview. This runnable demo supports that conversation while its README candidly states the gap between local simulation and scalable data systems. [Official Databricks Solutions Architect posting](https://www.databricks.com/company/careers/field-engineering---other/solutions-architect---retail-consumer-goods-travel--hospitality--8615016002)
