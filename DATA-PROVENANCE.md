# Data provenance and publication boundary

All application code in the three featured projects was authored for this repository. The delivery application's workflows were informed by a private, read-only capability review; its source, assets, configuration, cached records, identifiers, internal terminology, and infrastructure were not copied into this repository.

## Synthetic construction

- Mission Control generates fictional teams, contributor labels, outcomes, stories, sprints, dates, and review sessions from a fixed random seed. Its illustrated burndown is a generated trajectory, not a historical time series.
- Launch Decision Lab generates individual experiment assignments and outcomes from configurable probabilities. Its findings, effect estimates, and calibration results describe generated populations.
- Relay Operations generates fictional logistics entities and event feeds, including intentional data defects. Risk scores, intervention costs, and benefits are modeled assumptions.

No pseudonymized employer dataset is used. No real private records were renamed or masked to produce fixtures. There are no external production connectors or hidden credentials.

Generated local state belongs in `.demo-state/`, which is ignored by Git. Do not replace demo fixtures with private information, including during screenshots or exports. Exports contain the selected demo records.

## Claims

No live customer research, deployment, user adoption, financial benefit, or recruiting outcome is claimed. Hypothetical product assumptions and simulation outputs are labeled. A portfolio demo is evidence of implementation and reasoning, not evidence of production impact.

## Review boundary

The current working tree was reviewed for employer identifiers, private hostnames, token patterns, emails, source archives, and accidental local state before publication. Automated pattern scanning cannot prove absence of all sensitive information; the stronger protection here is independent implementation and generated inputs. Earlier repository history contains the original generic project-outline names; no private source history was imported or rewritten.

## Hosted runtime

Hosted demos execute their domain logic in the visitor’s browser. Relay’s logical raw/accepted/quarantine tables preserve the replay contract, while its actual SQLite implementation is part of the local Python reference service. Signal’s browser and Python implementations use distinct documented seeded RNGs; mathematical parity is checked on shared user rows. Simulation outputs name their runtime so different seeds/generators are not conflated.
