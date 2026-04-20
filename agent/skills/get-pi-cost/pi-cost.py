#!/usr/bin/env python3
"""Summarize Pi session costs for a given date, broken down by model and project."""

import json
import glob
import os
import sys
from collections import defaultdict
from datetime import date


def parse_date(s: str) -> str:
    """Accept YYYY-MM-DD or 'today'/'yesterday' and return YYYY-MM-DD."""
    if s == "today":
        return date.today().isoformat()
    if s == "yesterday":
        return (date.today().replace(day=date.today().day - 1)).isoformat()
    # validate
    date.fromisoformat(s)
    return s


def collect_costs(target_date: str):
    sessions_dir = os.path.expanduser("~/.pi/agent/sessions")
    date_prefix = target_date.replace("-", "-")  # already correct
    # Session files are named like 2026-04-03T00-11-50-339Z_<uuid>.jsonl
    # The date portion uses dashes: YYYY-MM-DD
    file_prefix = target_date  # e.g. "2026-04-03"

    files = sorted(glob.glob(os.path.join(sessions_dir, "*", f"{file_prefix}*.jsonl")))

    model_costs = defaultdict(float)
    model_tokens = defaultdict(lambda: {"input": 0, "output": 0, "cacheRead": 0})
    project_costs = defaultdict(float)
    session_details = []

    for f in files:
        session_cost = 0
        session_models = defaultdict(float)
        parent_dir = os.path.basename(os.path.dirname(f))
        # Extract project name from directory
        project = (
            parent_dir.replace("--Users-tanishqkancharla-Documents-Projects-", "")
            .replace("--Users-tanishqkancharla-", "")
            .strip("-")
        )
        if not project:
            project = "unknown"

        with open(f) as fh:
            for line in fh:
                try:
                    entry = json.loads(line)
                    if entry.get("type") == "message" and "message" in entry:
                        msg = entry["message"]
                        usage = msg.get("usage", {})
                        cost = usage.get("cost", {})
                        model = msg.get("model", "unknown")
                        if isinstance(cost, dict):
                            line_cost = sum(
                                v for v in cost.values() if isinstance(v, (int, float))
                            )
                            model_costs[model] += line_cost
                            model_tokens[model]["input"] += usage.get("input", 0)
                            model_tokens[model]["output"] += usage.get("output", 0)
                            model_tokens[model]["cacheRead"] += usage.get(
                                "cacheRead", 0
                            )
                            session_cost += line_cost
                            session_models[model] += line_cost
                except Exception:
                    pass

        project_costs[project] += session_cost
        session_details.append(
            {
                "file": os.path.basename(f)[:23],
                "project": project,
                "cost": session_cost,
                "models": dict(session_models),
            }
        )

    return {
        "date": target_date,
        "files": len(files),
        "model_costs": dict(model_costs),
        "model_tokens": {k: dict(v) for k, v in model_tokens.items()},
        "project_costs": dict(project_costs),
        "sessions": session_details,
    }


def print_report(data):
    print(f"\n  Pi Cost Report for {data['date']}")
    print(f"  {data['files']} sessions\n")

    # By model
    print(f"  {'Model':<35} {'Cost':>10}  {'Input':>12}  {'Output':>12}  {'Cache Read':>12}")
    print("  " + "-" * 85)
    for model in sorted(
        data["model_costs"], key=data["model_costs"].get, reverse=True
    ):
        c = data["model_costs"][model]
        t = data["model_tokens"].get(model, {})
        print(
            f"  {model:<35} ${c:>8.2f}"
            f"  {t.get('input', 0):>12,}"
            f"  {t.get('output', 0):>12,}"
            f"  {t.get('cacheRead', 0):>12,}"
        )
    total = sum(data["model_costs"].values())
    print("  " + "-" * 85)
    print(f"  {'TOTAL':<35} ${total:>8.2f}\n")

    # By project
    print(f"  {'Project':<50} {'Cost':>10}")
    print("  " + "-" * 62)
    for proj in sorted(
        data["project_costs"], key=data["project_costs"].get, reverse=True
    ):
        print(f"  {proj:<50} ${data['project_costs'][proj]:>8.2f}")
    print("  " + "-" * 62)
    print(f"  {'TOTAL':<50} ${total:>8.2f}\n")

    # Top sessions
    top = sorted(data["sessions"], key=lambda s: s["cost"], reverse=True)[:10]
    print(f"  Top sessions:")
    print(f"  {'Session':<25} {'Project':<40} {'Cost':>10}")
    print("  " + "-" * 77)
    for s in top:
        print(f"  {s['file']:<25} {s['project'][:40]:<40} ${s['cost']:>8.2f}")
    print()


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "today"
    try:
        target_date = parse_date(target)
    except ValueError:
        print(f"Invalid date: {target}. Use YYYY-MM-DD, 'today', or 'yesterday'.")
        sys.exit(1)

    data = collect_costs(target_date)

    if "--json" in sys.argv:
        print(json.dumps(data, indent=2))
    else:
        print_report(data)


if __name__ == "__main__":
    main()
