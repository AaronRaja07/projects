# Delivery dashboard case study

Mission Control is my personal portfolio implementation of a sprint review dashboard. It uses fictional work items, teams, and sprint history to show how a delivery lead can turn a status review into a decision about scope, capacity, or blockers.

[Open the live dashboard](https://aaron-raja-mission-control.cheekyllama6.chatgpt.site) · [Read the implementation guide](README.md)

## The problem

A sprint review needs to answer three questions. What changed? Why did it change? What can the team do about it? A completion percentage alone can hide a blocked dependency or make a change in scope look like a drop in throughput. The dashboard puts the underlying stories and review decisions next to the headline metrics.

## What I built

- **Traceable sprint metrics.** Review completion by team or outcome and inspect the stories behind each rollup.
- **Scope and capacity analysis.** Change planning inputs and compare the resulting delivery forecast. The forecast displays a range of possible outcomes.
- **Dependency and review workflows.** See which work is blocked, record an intervention, and export a review summary.

## Walkthrough

1. Pick a team or outcome and inspect the stories that explain its sprint metrics.
2. Review the blockers and dependencies before deciding what to change.
3. Adjust scope or capacity and compare the forecast. Record the decision and export the review.

The code and fixtures for this demo were authored for the portfolio. Its scenarios and results are simulated. See the [data provenance notes](../DATA-PROVENANCE.md) for details.
