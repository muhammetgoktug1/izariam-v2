#!/usr/bin/env python3
"""
Confirm the tick fixture is reproducible.

Absolute unix timestamps inside a scenario are only meaningful relative to the
instant the tick ran, so every known timestamp column is rebased onto that
scenario's `now` before two dumps are compared. Anything still differing after
that is genuine nondeterminism and would make the golden test flaky.

Usage:  python3 tools/check-tick-fixture.py a.json b.json [c.json ...]
"""

import json
import sys

TIMESTAMP_KEYS = {
    "last_update",
    "build_start",
    "army_start",
    "ships_start",
    "spyes_start",
    "wood_start",
    "trade_start",
    "premium_account",
    "premium_wood",
    "premium_wine",
    "premium_marble",
    "premium_crystal",
    "premium_sulfur",
    "premium_capacity",
}


def rebase(node, now, key=None):
    if isinstance(node, dict):
        return {k: rebase(v, now, k) for k, v in node.items()}
    if isinstance(node, list):
        return [rebase(v, now) for v in node]
    if key in TIMESTAMP_KEYS and isinstance(node, (int, float)) and node > 0:
        return f"now{node - now:+d}"
    return node


def normalise(scenarios):
    out = {}
    for name, s in scenarios.items():
        now = s.get("now")
        if now is None:
            now = s["before"]["town"]["last_update"] + s["elapsed"]
        body = {k: v for k, v in s.items() if k != "now"}
        out[name] = rebase(body, now)
    return out


def main(paths):
    runs = [normalise(json.load(open(p))["scenarios"]) for p in paths]
    names = sorted(runs[0])
    bad = []
    for n in names:
        first = runs[0][n]
        if any(r.get(n) != first for r in runs[1:]):
            bad.append(n)

    leaves = 0

    def count(o):
        nonlocal leaves
        if isinstance(o, dict):
            for v in o.values():
                count(v)
        elif isinstance(o, list):
            for v in o:
                count(v)
        else:
            leaves += 1

    count(runs[0])

    print(f"runs: {len(paths)}  scenarios: {len(names)}  locked values: {leaves}")
    if bad:
        print(f"NOT reproducible: {bad}")
        for n in bad[:3]:
            a, b = runs[0][n], runs[1][n]
            diff(a, b, n)
        return 1
    print("reproducible across all runs")
    return 0


def diff(x, y, path):
    if isinstance(x, dict):
        for k in x:
            diff(x[k], y.get(k) if isinstance(y, dict) else None, f"{path}/{k}")
    elif x != y:
        print(f"    {path}: {x!r} vs {y!r}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
