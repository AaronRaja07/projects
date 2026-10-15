# Recruiter walkthrough

Launch with `python3 server.py`. All scenarios use fictional records and deterministic generation.

## A short first pass

1. **Mission Control:** update a story status and observe the completion totals change. Add scope and inspect the baseline delta. Change forecast throughput and explain why the percentile window moves. Discuss why epics must not double-count stories.
2. **Launch Decision Lab:** compare a clean launch candidate with a friction or assignment-quality failure. Explain the difference between a positive estimate, a confidence interval, and a defensible launch policy. Change roadmap capacity and inspect dependency constraints.
3. **Relay Operations:** inject a disruption, inspect lineage and quarantine, repair records, and replay. Verify that repeated replay leaves serving results unchanged. Allocate a finite intervention budget and inspect the baseline comparison.

## What to discuss

- Which user decision each interface improves, and which discovery assumptions still need validation.
- A metric definition or invariant that was easy to get wrong.
- The smallest experiment that would test usefulness with actual users.
- What changes when a loopback prototype becomes a multi-user cloud service.
- A limitation of the forecast, statistical analysis, and operations benefit model.

## Evidence that should be shown

Run the unittest suite, read the domain code, inspect generated records, and export a readout. Use the applications' labels honestly: these demonstrate engineering and product reasoning, not proven customer impact.
