# Signal Lab

**A runnable product decision workbench: should a fictional B2B platform launch its new onboarding experience, and what should it build next?**

All users, events, businesses, requirements, and value estimates are synthetic or authored assumptions. This is original portfolio software. It does not claim real customer research, commercial impact, or production adoption.

## Run

From the repository root, run the shared Python server:

```sh
python3 server.py
```

Open `http://localhost:8000/signal-lab/`. The service uses only the Python standard library; the browser uses HTML, CSS, and JavaScript without a build step. Check the repository's root README if the shared server is configured for another port.

Run the behavioral checks from the root:

```sh
python3 -m unittest discover -s tests -p 'test_signal.py' -v
```

## A three-minute demo

1. Run **Healthy lift**. Inspect the interval, control/treatment denominators, predeclared checks, and exploratory segments.
2. Choose **Hidden friction**. Activation improves, but support-contact harm blocks the release.
3. Choose **Broken assignment**. The planned 50:50 assignment test invalidates the result even if the activation chart looks attractive.
4. Export the user-level synthetic CSV and experiment readout. Reproduce the result with the same seed.
5. Open **Roadmap tradeoffs**, move capacity from 8 to 12, and inspect which prerequisites enable new features.
6. Open **Statistical calibration** and run 200 independent A/A trials. Compare the observed false-positive rate and uncertainty to the nominal 5% rate.

## What the code does

- A seeded generator produces one row per independently assigned user, with segment, acquisition channel, import, seven-day activation, invitations, support contacts, and fourteen-day retention. Control activation is 36% for Enterprise and 26% for Self-serve. Treatment adds 0.65 × the lift input for Enterprise and 1.2 × the lift input for Self-serve (clamped to valid probabilities), so the lift control is a scenario parameter rather than an exactly equal population effect. Retention follows activation; activation follows import. Every cohort has complete fourteen-day follow-up.
- Primary analysis uses intent-to-treat activation rates and a Newcombe hybrid score interval, derived from Wilson binomial limits. The two-proportion normal-test p-value is descriptive; the decision uses the interval.
- A chi-square goodness-of-fit test with one degree of freedom compares observed assignment with the **planned** 50:50 split. Its upper-tail probability is computed exactly using `math.erfc(sqrt(chi_square / 2))`.
- The policy requires a positive 95% effect interval, observed lift of at least +3 percentage points, a support-contact upper interval below +3 percentage points, at least 400 complete users per arm, and no assignment mismatch at p < .001. The sample threshold is illustrative and does not replace a power calculation.
- Segment comparisons and retention are exploratory. There is no multiplicity adjustment or independent authorization to ship by segment.
- The roadmap solver checks all 256 feature subsets, enforces prerequisite inclusion and capacity, and chooses maximum additive hypothetical value. Ties prefer less effort and then stable feature IDs. This is exact for the small stated problem; not a scalable optimizer or revenue model.
- A/A evaluation draws independent Bernoulli outcomes at a common 30% activation probability, fixed 600/600 assignment, and zero true effect. A false positive is an interval that excludes zero.

## Actual reproducible evaluation

For `evaluate(trials=200, seed=42)`: **11/200 false positives (5.5%)**, **94.5% interval coverage**, and a **3.10%–9.58% Wilson interval** around the estimated false-positive rate. These are measured simulation results, not real user outcomes. The broad interval matters: 200 trials do not precisely establish a 5% error rate.

Tests cover reproducibility without cache mutation, user identity and funnel invariants, arm-reversal symmetry, empty/extreme proportions, assignment corruption, launch/hold/rollback decisions, actual calibration, input validation, and roadmap feasibility/optimality.

## API contract

The shared server calls `service.handle(method, stripped_path, query, body)`; query values may be `parse_qs` lists. The return is a JSON-serializable dictionary. Invalid numeric input raises `ValueError`.

| Method | Full route | Purpose |
| --- | --- | --- |
| GET | `/api/signal/overview` | Generate and analyze an experiment |
| POST | `/api/signal/analyze` | Analyze JSON parameters |
| GET | `/api/signal/events` | Downloadable user-level generated rows |
| GET/POST | `/api/signal/roadmap` | Optimize capacity-constrained feature selection |
| GET | `/api/signal/evaluate` | Run independent A/A trials |

Experiment parameters: `seed` (0–1,000,000), `n` (100–20,000), `lift` (−.18–.25 absolute probability), `friction` (0–.15), `allocation` (.1–.9 actual treatment share). The planned assignment remains .5 so changing actual allocation deliberately demonstrates instrumentation failure. Roadmap takes integer `capacity` (0–30); evaluation takes integer `trials` (20–500) and `seed`.

## Practical limits and next work

This is a local single-user prototype with no authentication or persistent customer records. Independent user outcomes, additive roadmap values, and complete fixed follow-up simplify reality. Before real use, add workspace-level randomization where interference exists, prospective power planning, delayed outcome handling, immutable event ingestion and assignments, actual discovery, preregistration, metric ownership, privacy controls, and staged rollout monitoring. Browser parameter changes are scenario exploration, not repeated looks at a live experiment.

See [PRODUCT-BRIEF.md](PRODUCT-BRIEF.md) for the authored problem framing, decision contract, user stories, tradeoffs, and relevance to target roles.
