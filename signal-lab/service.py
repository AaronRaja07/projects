"""Signal Lab: reproducible, synthetic product decisions. Python standard library only."""
from collections import Counter
from functools import lru_cache
import math
import random


SCHEMA_VERSION = 1
FEATURES = [
    {"id": "identity", "name": "Reliable identity stitching", "effort": 3, "value": 9, "requires": [], "evidence": "Prerequisite for cross-device activation measurement."},
    {"id": "guided", "name": "Guided first workspace", "effort": 4, "value": 17, "requires": ["identity"], "evidence": "Synthetic onboarding experiment motivates a focused next iteration."},
    {"id": "imports", "name": "Import recovery workflow", "effort": 3, "value": 12, "requires": [], "evidence": "Hypothesis: recover users after a failed first import."},
    {"id": "collaboration", "name": "Team activation prompts", "effort": 4, "value": 15, "requires": ["identity"], "evidence": "Hypothesis: team invitations improve shared workspace activation."},
    {"id": "observability", "name": "Experiment guardrail monitor", "effort": 2, "value": 8, "requires": ["identity"], "evidence": "Needed before scaling experiment exposure."},
    {"id": "templates", "name": "Role-based workspace templates", "effort": 5, "value": 19, "requires": ["guided"], "evidence": "Hypothesis: tailor first value to the user's job."},
    {"id": "export", "name": "Scheduled stakeholder exports", "effort": 2, "value": 6, "requires": [], "evidence": "Hypothesis: reduce repeated manual reporting."},
    {"id": "enterprise", "name": "Enterprise onboarding policy", "effort": 3, "value": 11, "requires": ["observability"], "evidence": "Hypothesis: governed setup supports larger workspaces."},
]


def _number(value, default, lower, upper, integer=False):
    if value is None:
        return default
    if isinstance(value, (list, tuple)):
        value = value[0] if value else default
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError("Parameters must be numeric.")
    if not math.isfinite(result) or not lower <= result <= upper:
        raise ValueError(f"Parameter must be between {lower} and {upper}.")
    if integer and result != int(result):
        raise ValueError("Expected a whole number.")
    return int(result) if integer else result


def parameters(values=None):
    values = values or {}
    return {
        "seed": _number(values.get("seed"), 42, 0, 1000000, True),
        "n": _number(values.get("n"), 2400, 100, 20000, True),
        "lift": _number(values.get("lift"), .07, -.18, .25),
        "friction": _number(values.get("friction"), 0, 0, .15),
        "allocation": _number(values.get("allocation"), .5, .1, .9),
    }


@lru_cache(maxsize=16)
def _generated(seed, n, lift, friction, allocation):
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        segment = "Enterprise" if rng.random() < .35 else "Self-serve"
        arm = "treatment" if rng.random() < allocation else "control"
        channel = "Partner" if rng.random() < .3 else "Organic"
        base = .36 if segment == "Enterprise" else .26
        effect = lift * (.65 if segment == "Enterprise" else 1.2)
        activated = rng.random() < max(0, min(1, base + (effect if arm == "treatment" else 0)))
        imported = activated or rng.random() < .30
        invited = activated and rng.random() < (.75 if segment == "Enterprise" else .35)
        support = rng.random() < (.025 + (friction if arm == "treatment" else 0))
        retained = activated and rng.random() < .63
        rows.append({"user_id": f"SYN-{seed:06d}-{i + 1:05d}", "arm": arm,
                     "segment": segment, "channel": channel, "signup_day": 1 + i % 28,
                     "import_completed": int(imported), "activated_7d": int(activated),
                     "invited_teammate": int(invited), "support_contact_7d": int(support),
                     "retained_14d": int(retained)})
    return tuple(rows)


def generate(values=None):
    p = parameters(values)
    return [dict(row) for row in _generated(**p)]


def wilson(successes, total, z=1.959963984540054):
    if not total:
        return [0., 1.]
    p = successes / total
    divisor = 1 + z * z / total
    center = (p + z * z / (2 * total)) / divisor
    radius = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / divisor
    return [max(0., center - radius), min(1., center + radius)]


def effect_metric(rows, field):
    arms = {}
    for arm in ("control", "treatment"):
        group = [r for r in rows if r["arm"] == arm]
        successes = sum(r[field] for r in group)
        arms[arm] = {"n": len(group), "successes": successes,
                     "rate": successes / len(group) if group else None,
                     "ci": wilson(successes, len(group))}
    c, t = arms["control"], arms["treatment"]
    if not c["n"] or not t["n"]:
        return {**arms, "delta": None, "ci": [None, None], "p_value": None}
    delta = t["rate"] - c["rate"]
    # Newcombe hybrid score interval for independent proportions, built from Wilson limits.
    low = delta - math.sqrt((t["rate"] - t["ci"][0]) ** 2 + (c["ci"][1] - c["rate"]) ** 2)
    high = delta + math.sqrt((t["ci"][1] - t["rate"]) ** 2 + (c["rate"] - c["ci"][0]) ** 2)
    pooled = (c["successes"] + t["successes"]) / (c["n"] + t["n"])
    se = math.sqrt(pooled * (1 - pooled) * (1 / c["n"] + 1 / t["n"]))
    p_value = math.erfc(abs(delta / se) / math.sqrt(2)) if se else 1.
    return {**arms, "delta": delta, "ci": [max(-1., low), min(1., high)], "p_value": p_value}


def sample_ratio(rows):
    counts = Counter(r["arm"] for r in rows)
    expected = len(rows) / 2
    chi_square = sum((counts[arm] - expected) ** 2 / expected for arm in ("control", "treatment")) if expected else 0.
    p = math.erfc(math.sqrt(chi_square / 2))
    return {"control": counts["control"], "treatment": counts["treatment"],
            "expected_treatment": .5, "chi_square": chi_square, "p_value": p, "failed": p < .001}


def analyze(values=None):
    p = parameters(values)
    return analyze_rows(generate(p), p)


def analyze_rows(rows, values=None):
    """Analyze supplied synthetic user rows; shared-row cross-runtime parity seam."""
    p = parameters(values)
    primary = effect_metric(rows, "activated_7d")
    guardrail = effect_metric(rows, "support_contact_7d")
    srm = sample_ratio(rows)
    checks = [
        {"name": "Assignment integrity", "passed": not srm["failed"], "detail": f"50:50 sample-ratio test p={srm['p_value']:.4g}; must be ≥ 0.001."},
        {"name": "Minimum sample", "passed": min(primary["control"]["n"], primary["treatment"]["n"]) >= 400, "detail": "At least 400 complete users per arm; this is a demo threshold, not a power calculation."},
        {"name": "Evidence of activation improvement", "passed": primary["ci"][0] is not None and primary["ci"][0] > 0, "detail": "Primary metric's two-sided 95% interval must exclude zero on the positive side."},
        {"name": "Practical effect", "passed": primary["delta"] is not None and primary["delta"] >= .03, "detail": "Observed activation improvement must reach the predeclared +3 percentage-point target."},
        {"name": "Support guardrail", "passed": guardrail["ci"][1] is not None and guardrail["ci"][1] < .03, "detail": "Upper 95% interval for added support contacts must remain below +3 percentage points."},
    ]
    blocked = srm["failed"]
    harm = guardrail["ci"][0] is not None and guardrail["ci"][0] >= .03
    decision = "INVALID" if blocked else "ROLL BACK" if harm else "SHIP" if all(c["passed"] for c in checks) else "HOLD"
    explanation = {"INVALID": "Assignment is inconsistent with the planned split. Repair instrumentation and rerun before interpreting outcomes.",
                   "ROLL BACK": "Support-contact harm exceeds the predeclared tolerance. Investigate friction before another rollout.",
                   "SHIP": "This simulated result clears the predeclared checks. A staged rollout with monitoring is the next step.",
                   "HOLD": "At least one predeclared check is unmet. The evidence does not justify a full rollout."}[decision]
    segments = []
    for segment in ("Enterprise", "Self-serve"):
        group = [r for r in rows if r["segment"] == segment]
        segments.append({"segment": segment, "n": len(group), **effect_metric(group, "activated_7d")})
    funnel = []
    for key, label in ((None, "Assigned"), ("import_completed", "Import completed"), ("activated_7d", "Activated ≤7 days"), ("retained_14d", "Retained at 14 days")):
        item = {"step": label}
        for arm in ("control", "treatment"):
            group = [r for r in rows if r["arm"] == arm]
            item[arm] = sum(r[key] for r in group) if key else len(group)
            item[arm + "_rate"] = item[arm] / len(group) if group else 0
        funnel.append(item)
    return {"schema_version": SCHEMA_VERSION, "synthetic": True, "parameters": p, "n": len(rows),
            "decision": decision, "explanation": explanation, "checks": checks,
            "primary": primary, "guardrail": guardrail, "srm": srm, "segments": segments,
            "retention": effect_metric(rows, "retained_14d"), "funnel": funnel,
            "sample": rows[:12], "policy": {"target_lift_pp": 3, "support_margin_pp": 3, "srm_alpha": .001,
            "primary_alpha": .05, "complete_observation": "28 signup days; all outcomes observed through day 14 after signup."}}


def optimize_roadmap(capacity=12):
    capacity = _number(capacity, 12, 0, 30, True)
    feasible = []
    for mask in range(1 << len(FEATURES)):
        selected = [f for i, f in enumerate(FEATURES) if mask & (1 << i)]
        ids = {f["id"] for f in selected}
        effort = sum(f["effort"] for f in selected)
        if effort <= capacity and all(set(f["requires"]) <= ids for f in selected):
            feasible.append((sum(f["value"] for f in selected), -effort, tuple(f["id"] for f in selected)))
    winner = max(feasible)
    chosen = set(winner[2])
    items = [{**f, "selected": f["id"] in chosen} for f in FEATURES]
    return {"capacity": capacity, "used": -winner[1], "value": winner[0], "selected_ids": list(winner[2]),
            "feasible_portfolios": len(feasible), "candidate_portfolios": 1 << len(FEATURES), "features": items,
            "frontier": [{"capacity": c, "value": max(v for v, neg_effort, _ in feasible if -neg_effort <= c)} for c in range(capacity + 1)],
            "method": "Exact enumeration of every subset; dependencies are hard constraints. Value points are hypothetical additive preferences, not forecast revenue."}


@lru_cache(maxsize=8)
def evaluate(trials=200, seed=42):
    trials = _number(trials, 200, 20, 500, True)
    seed = _number(seed, 42, 0, 1000000, True)
    positives = coverage = 0
    deltas = []
    for trial in range(trials):
        # Independent binomial outcomes under a true zero effect, with fixed balanced assignment.
        rng = random.Random(seed * 1009 + trial)
        rows = [{"arm": "control" if i < 600 else "treatment", "activated_7d": int(rng.random() < .3)} for i in range(1200)]
        metric = effect_metric(rows, "activated_7d")
        low, high = metric["ci"]
        positives += low > 0 or high < 0
        coverage += low <= 0 <= high
        deltas.append(metric["delta"])
    observed = positives / trials
    expected_band = wilson(positives, trials)
    return {"synthetic": True, "trials": trials, "seed": seed, "users_per_trial": 1200,
            "true_effect": 0, "false_positives": positives, "false_positive_rate": observed,
            "false_positive_rate_ci": expected_band, "coverage": coverage / trials,
            "nominal_alpha": .05, "mean_estimated_effect": sum(deltas) / trials,
            "min_estimated_effect": min(deltas), "max_estimated_effect": max(deltas),
            "interpretation": "A/A calibration of the primary interval only; this does not validate the whole launch policy, power, production instrumentation, or every data distribution."}


def handle(method, path, query=None, body=None):
    query, body = query or {}, body or {}
    path = path.rstrip("/") or "/"
    if method == "GET" and path in ("/", "/overview"):
        return analyze(query)
    if method == "POST" and path == "/analyze":
        return analyze(body)
    if path == "/roadmap" and method in ("GET", "POST"):
        return optimize_roadmap((body if method == "POST" else query).get("capacity", 12))
    if method == "GET" and path == "/evaluate":
        return evaluate(_number(query.get("trials"), 200, 20, 500, True), _number(query.get("seed"), 42, 0, 1000000, True))
    if method == "GET" and path == "/events":
        return {"synthetic": True, "parameters": parameters(query), "rows": generate(query)}
    raise ValueError("Unknown Signal Lab endpoint.")
