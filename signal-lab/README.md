# Signal Lab

**A runnable product decision workbench: should a fictional B2B platform launch its new onboarding experience, and what should it build next?**

All users, events, businesses, requirements, and value estimates are synthetic or authored assumptions. This is original portfolio software. It does not claim real customer research, commercial impact, or production adoption.

## Run the browser app

The hosted app runs entirely in the browser: experiment generation, inference, roadmap optimization, and A/A evaluation are computed from scratch. It needs no backend, account, API key, external dependencies, or network request for a simulation. Serve the repository root over HTTP so the shared `/assets/` paths resolve:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/signal-lab/`. For static hosting, publish `signal-lab/` and the root `assets/` directory on the same origin, retaining these paths. Include this README and `PRODUCT-BRIEF.md` so the footer links work. Assets must first load from the host; the app does not install a service worker or promise offline reopening.

`index.html` loads the shared UI helpers, `browser-service.js`, and then `app.js`. The browser adapter intercepts only same-origin `/api/signal` calls and computes their responses locally. Other API namespaces and external URLs are delegated unchanged. It installs once even if its script is accidentally loaded twice. No generated user records are uploaded or saved to browser storage.

## Python reference and verification

The original `service.py` remains a standard-library reference implementation. To expose its HTTP API, run `python3 server.py` from the repository root. The served page still uses the browser engine; a direct HTTP request to `/api/signal/overview` on this Python server uses the Python engine. This deliberate distinction makes static hosting possible while retaining an independently executable reference.

Run both behavioral suites from the root (Node.js and Python 3 required; no package installation):

```sh
node --test tests/test_signal_browser.cjs
python3 -m unittest discover -s tests -p 'test_signal.py' -v
```

## A three-minute demo

1. Run **Healthy lift**. Inspect the interval, control/treatment denominators, predeclared checks, and exploratory segments.
2. Choose **Hidden friction**. Activation improves, but support-contact harm blocks the release.
3. Choose **Broken assignment**. The planned 50:50 assignment test invalidates the result even if the activation chart looks attractive.
4. Prepare the user-level synthetic CSV and experiment readout exports. The shared export preview supports saving or copying their contents. Reproduce the result with the same seed **and runtime/RNG version**, recorded in the readout.
5. Open **Roadmap tradeoffs**, move capacity from 8 to 12, and inspect which prerequisites enable new features.
6. Open **Statistical calibration** and run 200 independent A/A trials. Compare the observed false-positive rate and uncertainty to the nominal 5% rate.

## What the code does

- A seeded generator produces one row per independently assigned user, with segment, acquisition channel, import, seven-day activation, invitations, support contacts, and fourteen-day retention. Control activation is 36% for Enterprise and 26% for Self-serve. Treatment adds 0.65 × the lift input for Enterprise and 1.2 × the lift input for Self-serve (clamped to valid probabilities), so the lift control is a scenario parameter rather than an exactly equal population effect. Retention follows activation; activation follows import. Every cohort has complete fourteen-day follow-up.
- Primary analysis uses intent-to-treat activation rates and a Newcombe hybrid score interval, derived from Wilson binomial limits. The two-proportion normal-test p-value is descriptive; the decision uses the interval.
- A chi-square goodness-of-fit test with one degree of freedom compares observed assignment with the **planned** 50:50 split. Its upper-tail probability is `erfc(sqrt(chi_square / 2))`. Python uses `math.erfc`; the browser evaluates the equivalent regularized gamma function using a convergent series near zero and a continued fraction in the tail.
- The policy requires a positive 95% effect interval, observed lift of at least +3 percentage points, a support-contact upper interval below +3 percentage points, at least 400 complete users per arm, and no assignment mismatch at p < .001. The sample threshold is illustrative and does not replace a power calculation.
- Segment comparisons and retention are exploratory. There is no multiplicity adjustment or independent authorization to ship by segment.
- The roadmap solver checks all 256 feature subsets, enforces prerequisite inclusion and capacity, and chooses maximum additive hypothetical value. Ties prefer less effort and then stable feature IDs. This is exact for the small stated problem; not a scalable optimizer or revenue model.
- A/A evaluation draws independent Bernoulli outcomes at a common 30% activation probability, fixed 600/600 assignment, and zero true effect. A false positive is an interval that excludes zero.

## Actual reproducible evaluation

The browser uses documented **Mulberry32 v1** with unsigned 32-bit state. Python uses `random.Random` (Mersenne Twister). Both are deterministic within their stated runtime; the same numeric seed intentionally does **not** mean identical generated users across different RNGs. These generators are for synthetic simulations, not secure assignment or cryptography.

Measured results for `evaluate(200, 42)`:

| Runtime | False positives | Interval coverage | 95% Wilson interval for false-positive rate |
| --- | --- | --- | --- |
| Hosted browser / Mulberry32 v1 | 8/200 (4.0%) | 96.0% | 2.04%–7.69% |
| Python reference / Mersenne Twister | 11/200 (5.5%) | 94.5% | 3.10%–9.58% |

These are actual measured simulation results, not real user outcomes. The broad intervals matter: 200 trials do not precisely establish a 5% error rate. The browser's default experiment produces an observed activation effect of **+6.19 percentage points**, a **+2.42 to +9.94 point interval**, and `SHIP` under the documented policy; the other three scenario buttons produce `ROLL BACK`, `INVALID`, and `HOLD` as appropriate.

The browser test suite passes the **same 9,700 Python-generated user rows** across five scenarios into both engines, then compares the full inference/decision results numerically. It compares roadmap results at **all 31 capacities** as well, including tie-breaking and frontier values. This tests mathematical parity independently of RNG differences. Tail probabilities are checked from `erfc(0)` through `erfc(10)`; the browser adapter is exercised without any `fetch` function.

Additional tests cover reproducibility without cache mutation, user identity and funnel invariants, arm-reversal symmetry, empty/extreme proportions, assignment corruption, launch/hold/rollback decisions, actual calibration, bounded input validation, and roadmap feasibility/optimality. UI request sequencing prevents an older scenario response from replacing a newer result.

## API contract

Both engines implement `handle(method, stripped_path, query, body)`; query values may be `parse_qs`-style lists. The browser CommonJS entry point is `require('./browser-service.js').createSignalService()`. In a hosted page, `UI.api` invokes this service directly. The return is JSON-serializable data; invalid input raises a JavaScript `Error` or Python `ValueError`. Browser experiment/event/evaluation responses include the engine and RNG metadata. Pure `analyzeRows`, `effectMetric`, `sampleRatio`, `wilson`, and `erfc` methods provide explicit seams for independent verification.

| Method | Full route | Purpose |
| --- | --- | --- |
| GET | `/api/signal/overview` | Generate and analyze an experiment |
| POST | `/api/signal/analyze` | Analyze JSON parameters |
| GET | `/api/signal/events` | Downloadable user-level generated rows |
| GET/POST | `/api/signal/roadmap` | Optimize capacity-constrained feature selection |
| GET | `/api/signal/evaluate` | Run independent A/A trials |

Experiment parameters: `seed` (0–1,000,000), `n` (100–20,000), `lift` (−.18–.25 absolute probability), `friction` (0–.15), `allocation` (.1–.9 actual treatment share). The planned assignment remains .5 so changing actual allocation deliberately demonstrates instrumentation failure. Roadmap takes integer `capacity` (0–30); evaluation takes integer `trials` (20–500) and `seed`.

## Practical limits and next work

This is a single-user simulation with no authentication or persistent customer records. Independent user outcomes, additive roadmap values, and complete fixed follow-up simplify reality. Before real use, add workspace-level randomization where interference exists, prospective power planning, delayed outcome handling, immutable event ingestion and assignments, actual discovery, preregistration, metric ownership, privacy controls, and staged rollout monitoring. Browser parameter changes are scenario exploration, not repeated looks at a live experiment. Bounded simulations run on the main browser thread; larger production studies would require a different execution and storage model.

See [PRODUCT-BRIEF.md](PRODUCT-BRIEF.md) for the authored problem framing, decision contract, user stories, tradeoffs, and relevance to target roles.
