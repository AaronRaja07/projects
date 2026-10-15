"""Behavior checks for the synthetic delivery model; no source-system fixtures."""
import csv
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("mission_under_test", ROOT / "mission-control" / "service.py")
mission = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mission)


class MissionModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_store = mission.STORE
        mission.STORE = Path(self.temp.name) / "mission.json"
        self.data = mission.seeded()

    def tearDown(self):
        mission.STORE = self.original_store
        self.temp.cleanup()

    def test_seed_is_deterministic_and_has_unique_stories(self):
        self.assertEqual(self.data, mission.seeded())
        self.assertEqual(144, len(self.data["tickets"]))
        self.assertEqual(144, len({row["id"] for row in self.data["tickets"]}))
        self.assertEqual(set(mission.TEAMS), {row["team"] for row in self.data["tickets"]})

    def test_empty_metrics_have_defined_denominators(self):
        self.assertEqual(
            {"tickets": 0, "points": 0, "done": 0, "completion": 0, "blocked": 0, "hygiene": 100, "gaps": 0},
            mission.metrics([]),
        )

    def test_metrics_count_points_and_readiness_independently(self):
        tickets = [dict(self.data["tickets"][0]), dict(self.data["tickets"][1])]
        tickets[0].update(points=8, status="Done", description=True, acceptance=True, estimated=True)
        tickets[1].update(points=2, status="Blocked", description=False, acceptance=False, estimated=True)
        result = mission.metrics(tickets)
        self.assertEqual((2, 10, 8, 80.0, 1, 50.0, 1), tuple(result[k] for k in ["tickets", "points", "done", "completion", "blocked", "hygiene", "gaps"]))

    def test_scope_is_a_true_intersection(self):
        rows = mission.scoped(self.data, {"team": ["Platform"], "sprint": ["S-02"]})
        self.assertEqual(12, len(rows))
        self.assertTrue(all(t["team"] == "Platform" and t["sprint"] == "S-02" for t in rows))

    def test_unknown_filters_are_rejected(self):
        for query in [{"team": ["Unknown"]}, {"sprint": ["S-99"]}, {"status": ["Unknown"]}]:
            with self.subTest(query=query), self.assertRaises(ValueError):
                mission.scoped(self.data, query)

    def test_status_and_search_filters_intersect_and_cover_search_fields(self):
        for key in ['id', 'title', 'team', 'owner', 'epic']:
            target = self.data['tickets'][0]
            query = {'sprint': ['All'], 'status': [target['status']], 'q': ['  ' + str(target[key]).upper() + '  ']}
            result = mission.scoped(self.data, query)
            self.assertIn(target, result)
            self.assertTrue(all(t['status'] == target['status'] for t in result))
        self.assertEqual([], mission.scoped(self.data, {'q': ['no-such-story']}))

    def test_filtered_report_and_metrics_share_scope_but_history_and_baseline_remain_full(self):
        query = {'team': ['Platform'], 'sprint': ['All'], 'status': ['Done'], 'q': ['catalog']}
        result = mission.overview(self.data, query)
        report = mission.handle('GET', '/report', query, {})
        rows = list(csv.DictReader(io.StringIO(report['csv'])))
        self.assertEqual(result['metrics']['tickets'], len(rows))
        self.assertEqual(result['metrics']['points'], sum(int(t['points']) for t in rows))
        self.assertTrue(all(t['status'] == 'Done' and 'catalog' in t['title'].lower() for t in rows))
        unfiltered = mission.overview(self.data, {'team': ['Platform'], 'sprint': ['All']})
        self.assertEqual(unfiltered['history'], result['history'])
        self.assertEqual(unfiltered['baseline'], result['baseline'])
        for epic in result['epics']:
            self.assertEqual(next(e['current_total'] for e in unfiltered['epics'] if e['id'] == epic['id']), epic['current_total'])

    def test_epics_teams_and_contributors_reconcile_without_double_counting(self):
        overview = mission.overview(self.data, {"sprint": ["All"]})
        for group in ["epics", "capacity", "contributors"]:
            with self.subTest(group=group):
                for key in ["tickets", "points", "done", "blocked", "gaps"]:
                    self.assertEqual(overview["metrics"][key], sum(row[key] for row in overview[group]))
        self.assertEqual(sum(t["points"] for t in self.data["tickets"]), overview["metrics"]["points"])

    def test_capacity_scales_with_selected_sprints_and_team(self):
        for sprint, multiplier in [("S-03", 1), ("All", 3)]:
            result = mission.overview(self.data, {"team": ["Platform"], "sprint": [sprint]})
            self.assertEqual(1, len(result["capacity"]))
            self.assertEqual("Platform", result["capacity"][0]["team"])
            self.assertEqual(mission.CAPACITIES["Platform"] * multiplier, result["capacity"][0]["capacity"])

    def test_empty_overview_is_finite_and_serializable(self):
        import json
        self.data["tickets"] = []
        result = mission.overview(self.data, {})
        self.assertEqual(0, result["metrics"]["points"])
        self.assertEqual([], result["epics"])
        json.dumps(result, allow_nan=False)

    def test_ticket_status_persists_and_updates_rollup(self):
        target = next(t for t in self.data["tickets"] if t["sprint"] == "S-03" and t["status"] != "Done")
        before = mission.overview(self.data, {})["metrics"]["done"]
        self.assertEqual({"ok": True}, mission.handle("POST", "/ticket", {}, {"id": target["id"], "status": "Done"}))
        self.assertTrue(mission.STORE.exists())
        loaded = mission.load()
        self.assertEqual("Done", next(t for t in loaded["tickets"] if t["id"] == target["id"])["status"])
        self.assertEqual(before + target["points"], mission.overview(loaded, {})["metrics"]["done"])
        self.assertEqual("Status updated", loaded["audit"][-1]["action"])

    def test_bad_mutation_does_not_create_state(self):
        for path, body in [
            ("/ticket", {"id": "WK-999", "status": "Done"}),
            ("/ticket", {"id": "WK-001", "status": "Invalid"}),
            ("/capacity", {"team": "Platform", "capacity": 0}),
            ("/capacity", {"team": "Unknown", "capacity": 80}),
            ("/scope", {"epic": "EP-01", "points": 22}),
        ]:
            with self.subTest(path=path, body=body), self.assertRaises(ValueError):
                mission.handle("POST", path, {}, body)
            self.assertFalse(mission.STORE.exists())

    def test_capacity_update_persists(self):
        mission.handle("POST", "/capacity", {}, {"team": "Platform", "capacity": 100})
        result = mission.handle("GET", "/overview", {"team": ["Platform"]}, {})
        self.assertEqual(100, result["capacity"][0]["capacity"])

    def test_readiness_mutation_fills_exact_story_and_updates_gap_count(self):
        target = next(t for t in self.data["tickets"] if t["sprint"] == "S-03" and not all(t[k] for k in ["description", "acceptance", "estimated"]))
        before = mission.overview(self.data, {})["metrics"]["gaps"]
        mission.handle("POST", "/hygiene", {}, {"id": target["id"]})
        loaded = mission.load()
        changed = [t["id"] for t, old in zip(loaded["tickets"], self.data["tickets"]) if t != old]
        self.assertEqual([target["id"]], changed)
        self.assertEqual(before - 1, mission.overview(loaded, {})["metrics"]["gaps"])
        with self.assertRaises(ValueError):
            mission.handle("POST", "/hygiene", {}, {"id": "WK-999"})

    def test_added_scope_is_counted_once_and_baseline_changes_only_on_save(self):
        before = mission.overview(self.data, {})
        mission.handle("POST", "/scope", {}, {"epic": "EP-01", "points": 5})
        after = mission.handle("GET", "/overview", {}, {})
        self.assertEqual(before["metrics"]["points"] + 5, after["metrics"]["points"])
        self.assertEqual(before["baseline"], after["baseline"])
        self.assertEqual(after["metrics"]["points"], sum(e["points"] for e in after["epics"]))
        mission.handle("POST", "/baseline", {}, {})
        self.assertEqual(before["baseline"]["EP-01"] + 5, mission.load()["baseline"]["EP-01"])

    def test_reset_restores_deterministic_seed(self):
        mission.handle("POST", "/scope", {}, {"epic": "EP-01", "points": 5})
        mission.handle("POST", "/reset", {}, {})
        self.assertEqual(self.data, mission.load())

    def test_report_csv_reconciles_with_filtered_metrics_and_markdown(self):
        query = {"team": ["Intelligence"], "sprint": ["S-02"]}
        metrics = mission.overview(self.data, query)["metrics"]
        report = mission.handle("GET", "/report", query, {})
        rows = list(csv.DictReader(io.StringIO(report["csv"])))
        self.assertEqual(metrics["tickets"], len(rows))
        self.assertEqual(metrics["points"], sum(int(t["points"]) for t in rows))
        self.assertEqual(metrics["done"], sum(int(t["points"]) for t in rows if t["status"] == "Done"))
        self.assertIn(f"{metrics['tickets']} stories; {metrics['done']}/{metrics['points']} points complete", report["markdown"])
        self.assertTrue(all(t["team"] == "Intelligence" and t["sprint"] == "S-02" for t in rows))

    def test_forecast_is_repeatable_and_quantiles_are_ordered(self):
        result = mission.forecast(self.data, {"trials": 500})
        self.assertEqual(result, mission.forecast(self.data, {"trials": 500}))
        self.assertLessEqual(result["p50"], result["p80"])
        self.assertLessEqual(result["p80"], result["p95"])
        self.assertEqual(500, sum(bucket["count"] for bucket in result["histogram"]))

    def test_forecast_scope_and_staffing_have_monotonic_effects(self):
        base = mission.forecast(self.data, {"trials": 500})
        bigger = mission.forecast(self.data, {"scope": 50, "trials": 500})
        faster = mission.forecast(self.data, {"staffing": 1.5, "trials": 500})
        for percentile in ["p50", "p80", "p95"]:
            self.assertGreaterEqual(bigger[percentile], base[percentile])
            self.assertLessEqual(faster[percentile], base[percentile])
        self.assertLessEqual(bigger["within_10_days"], base["within_10_days"])
        self.assertGreaterEqual(faster["within_10_days"], base["within_10_days"])

    def test_forecast_rejects_nonfinite_and_out_of_range_scenarios(self):
        for body in [
            {"staffing": float("nan")}, {"staffing": float("inf")}, {"staffing": 0.2},
            {"scope": float("inf")}, {"scope": -1}, {"scope": 201},
            {"trials": 99}, {"trials": 10001}, {"team": "Unknown"},
        ]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                mission.forecast(self.data, body)

    def test_zero_remaining_forecast_preserves_all_trials(self):
        for row in self.data["tickets"]:
            row["status"] = "Done"
        result = mission.forecast(self.data, {"trials": 100})
        self.assertEqual((0, 0, 0, 0), (result["remaining"], result["p50"], result["p80"], result["p95"]))
        self.assertEqual(100, result["within_10_days"])
        self.assertEqual(100, sum(bucket["count"] for bucket in result["histogram"]))

    def dependency_fixture(self):
        data = mission.seeded()
        data["epics"] = [dict(e, depends_on=[]) for e in data["epics"][:3]]
        data["epics"][0]["team"] = "Platform"
        data["epics"][1].update(team="Experience", depends_on=["EP-01"])
        data["epics"][2]["team"] = "Intelligence"
        data["tickets"] = [dict(data["tickets"][i], epic=e["id"], team=e["team"], points=p, status="Ready", sprint="S-03") for i, (e, p) in enumerate(zip(data["epics"], [5, 3, 6]))]
        data["capacity"] = {team: 10 for team in mission.TEAMS}
        return data

    def test_dependency_longest_path_obeys_precedence(self):
        result = mission.dependencies(self.dependency_fixture(), {})
        nodes = {row["id"]: row for row in result["nodes"]}
        self.assertEqual(["EP-01", "EP-02"], result["critical_path"])
        self.assertEqual(8, result["total_days"])
        self.assertEqual(nodes["EP-01"]["finish"], nodes["EP-02"]["start"])
        self.assertEqual(6, nodes["EP-03"]["finish"])

    def test_dependency_team_filter_keeps_required_upstream_work(self):
        result = mission.dependencies(self.dependency_fixture(), {"team": ["Experience"]})
        self.assertEqual(["EP-01", "EP-02"], result["critical_path"])
        self.assertEqual(8, result["total_days"])

    def test_dependency_search_and_status_filters_do_not_remove_prerequisite_work(self):
        data = self.dependency_fixture()
        data['tickets'][0]['status'] = 'Blocked'
        result = mission.dependencies(data, {'team': ['Experience'], 'status': ['Ready'], 'q': ['WK-002']})
        self.assertEqual(['EP-01', 'EP-02'], result['critical_path'])
        self.assertEqual(8, result['total_days'])

    def test_dependencies_reject_cycles_and_missing_references(self):
        data = self.dependency_fixture()
        data["epics"][0]["depends_on"] = ["EP-02"]
        with self.assertRaisesRegex(ValueError, "cycle"):
            mission.dependencies(data, {})
        data["epics"][0]["depends_on"] = ["EP-99"]
        with self.assertRaisesRegex(ValueError, "Missing"):
            mission.dependencies(data, {})

    def test_empty_dependency_scope_is_defined(self):
        data = self.dependency_fixture()
        data["tickets"] = []
        result = mission.dependencies(data, {})
        self.assertEqual([], result["nodes"])
        self.assertEqual([], result["critical_path"])
        self.assertEqual(0, result["total_days"])


if __name__ == "__main__":
    unittest.main()
