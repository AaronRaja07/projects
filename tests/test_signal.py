"""Behavioral checks for the synthetic experiment and constrained decision engine."""
import importlib.util
import itertools
from pathlib import Path
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "signal-lab" / "service.py"
SPEC = importlib.util.spec_from_file_location("signal_service", SOURCE)
signal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(signal)


class SignalExperimentTests(unittest.TestCase):
    def test_reproducible_user_level_generation_and_funnel_contract(self):
        a, b = signal.generate(), signal.generate()
        self.assertEqual(a, b)
        self.assertEqual(len({r["user_id"] for r in a}), 2400)
        self.assertTrue(all(r["activated_7d"] <= r["import_completed"] for r in a))
        self.assertTrue(all(r["retained_14d"] <= r["activated_7d"] for r in a))
        a[0]["activated_7d"] = 99
        self.assertNotEqual(a, signal.generate(), "Caller mutation must not corrupt cached data")
        self.assertNotEqual(b, signal.generate({"seed": 43}))

    def test_policy_handles_healthy_harmful_and_invalid_scenarios(self):
        healthy = signal.analyze()
        self.assertEqual(healthy["decision"], "SHIP")
        self.assertTrue(all(c["passed"] for c in healthy["checks"]))
        self.assertEqual(signal.analyze({"friction": .08})["decision"], "ROLL BACK")
        self.assertEqual(signal.analyze({"allocation": .68})["decision"], "INVALID")
        self.assertEqual(signal.analyze({"lift": 0})["decision"], "HOLD")
        self.assertNotEqual(signal.analyze({"n": 100})["decision"], "SHIP")

    def test_effect_interval_reverses_when_arms_are_swapped(self):
        rows = signal.generate()
        before = signal.effect_metric(rows, "activated_7d")
        swapped = [{**r, "arm": "control" if r["arm"] == "treatment" else "treatment"} for r in rows]
        after = signal.effect_metric(swapped, "activated_7d")
        self.assertAlmostEqual(before["delta"], -after["delta"])
        self.assertAlmostEqual(before["ci"][0], -after["ci"][1])
        self.assertAlmostEqual(before["ci"][1], -after["ci"][0])
        self.assertAlmostEqual(before["p_value"], after["p_value"])

    def test_null_and_extreme_proportions_are_finite(self):
        for outcome in (0, 1):
            rows = [{"arm": arm, "x": outcome} for arm in ("control", "treatment") for _ in range(25)]
            metric = signal.effect_metric(rows, "x")
            self.assertEqual(metric["delta"], 0)
            self.assertLessEqual(metric["ci"][0], 0)
            self.assertGreaterEqual(metric["ci"][1], 0)
            self.assertEqual(metric["p_value"], 1)
        no_treatment = signal.effect_metric([{"arm": "control", "x": 1}], "x")
        self.assertIsNone(no_treatment["delta"])

    def test_sample_ratio_uses_planned_split_not_actual_assignment_parameter(self):
        balanced = [{"arm": "control"}] * 50 + [{"arm": "treatment"}] * 50
        self.assertEqual(signal.sample_ratio(balanced)["p_value"], 1)
        broken = [{"arm": "control"}] * 10 + [{"arm": "treatment"}] * 90
        self.assertTrue(signal.sample_ratio(broken)["failed"])

    def test_calibration_is_actual_reproducible_simulation(self):
        result = signal.evaluate(200, 42)
        self.assertEqual(result["false_positives"], 11)
        self.assertAlmostEqual(result["coverage"], 1 - result["false_positive_rate"])
        self.assertLessEqual(result["false_positive_rate_ci"][0], .05)
        self.assertGreaterEqual(result["false_positive_rate_ci"][1], .05)
        self.assertEqual(result, signal.evaluate(200, 42))
        self.assertNotEqual(result["mean_estimated_effect"], signal.evaluate(200, 43)["mean_estimated_effect"])

    def test_input_validation_and_parse_qs_list_values(self):
        self.assertEqual(signal.handle("GET", "/overview", {"n": ["500"], "seed": ["10"]})["n"], 500)
        for bad in ({"n": 1}, {"n": 400.5}, {"lift": float("nan")}, {"allocation": 1}, {"seed": "oops"}):
            with self.assertRaises(ValueError):
                signal.analyze(bad)
        self.assertEqual(len(signal.handle("GET", "/events", {"n": ["100"]})["rows"]), 100)


class RoadmapTests(unittest.TestCase):
    def test_dependency_and_capacity_constraints_at_every_capacity(self):
        last_value = 0
        for capacity in range(31):
            result = signal.optimize_roadmap(capacity)
            selected = [f for f in result["features"] if f["selected"]]
            ids = {f["id"] for f in selected}
            self.assertLessEqual(sum(f["effort"] for f in selected), capacity)
            self.assertTrue(all(set(f["requires"]) <= ids for f in selected))
            self.assertEqual(sum(f["value"] for f in selected), result["value"])
            self.assertGreaterEqual(result["value"], last_value)
            last_value = result["value"]
        self.assertEqual(signal.optimize_roadmap(0)["selected_ids"], [])

    def test_optimum_matches_independent_combination_search(self):
        capacity = 12
        best = 0
        for size in range(len(signal.FEATURES) + 1):
            for subset in itertools.combinations(signal.FEATURES, size):
                ids = {f["id"] for f in subset}
                if sum(f["effort"] for f in subset) <= capacity and all(set(f["requires"]) <= ids for f in subset):
                    best = max(best, sum(f["value"] for f in subset))
        self.assertEqual(signal.optimize_roadmap(capacity)["value"], best)


if __name__ == "__main__":
    unittest.main()
