#!/usr/bin/env python3
"""
Prove the extracted gamedata + our understanding of the cost formulas by
recomputing every value in fixtures/lookups.json from packages/gamedata and
diffing against what the legacy PHP actually produced.

This is the gate before any TypeScript gets written: if the Python
reimplementation here cannot reproduce the fixture exactly, the port of
packages/rules would inherit the same misunderstanding silently.

Run from the repo root:  python3 tools/verify-gamedata.py
"""

import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GD = os.path.join(ROOT, "packages/gamedata")


def load(p):
    with open(os.path.join(GD, p), encoding="utf-8") as fh:
        return json.load(fh)


UNITS = load("units.json")
BUILDINGS = load("buildings.json")
ISLAND = load("island.json")
RESEARCH = load("research.json")
FIX = json.load(open(os.path.join(ROOT, "fixtures/lookups.json"), encoding="utf-8"))

BUILDING_FIELDS = ["wood", "wine", "marble", "crystal", "sulfur", "time"]

# Unit build-time reduction. Index = unit array index (id - 1).
# value = (building_level_key, threshold) where threshold None means the full
# level is applied with no minimum. Index 22 has no case at all.
TIME_REDUCTION = {
    0: (5, 4),   1: (5, 12),  2: (5, None), 3: (5, 6),   4: (5, 2),
    5: (5, 7),   6: (5, 13),  7: (5, 3),    8: (5, 8),   9: (5, 14),
    10: (5, 10), 11: (5, 11), 12: (5, 5),   13: (5, 9),
    14: (4, None), 15: (4, None), 16: (4, 4), 17: (4, 5), 18: (4, 2),
    19: (4, 3),  20: (4, 6),  21: (4, 7),
}


def r6(v):
    return round(float(v), 6)


def building_cost(bid, level, research, levels):
    if level < 0:
        level = 0
    tbl = BUILDINGS.get(str(bid))
    out = {}
    if tbl is None:
        for f in BUILDING_FIELDS:
            out[f] = 0
        out["max_level"] = 0
    else:
        cols = tbl["levels"]
        for f in BUILDING_FIELDS:
            arr = cols.get(f)
            if arr is None:
                out[f] = 0
                continue
            out[f] = arr[level] if level < len(arr) and arr[level] > 0 else 0
        out["max_level"] = tbl["max_level"]

    minus = 0.0
    if research.get("res2_2", 0) > 0:
        minus += 0.02
    if research.get("res2_6", 0) > 0:
        minus += 0.04
    if research.get("res2_11", 0) > 0:
        minus += 0.08
    minus_wood = minus + (0.01 * levels[21] if levels[21] > 0 else 0.0)

    for f in BUILDING_FIELDS:
        if f == "time":
            continue
        m = minus_wood if f == "wood" else minus
        out[f] = out[f] - (out[f] * m)
        if out[f] < 0:
            out[f] = 0
    return {k: r6(v) for k, v in out.items()}


def army_cost(uid, research, levels, use_research):
    t = int(math.floor(uid)) - 1
    if t < 0:
        t = 0
    u = UNITS[str(t + 1)]
    out = {k: (v if v > 0 else 0) for k, v in u.items()}

    minus_gold = 0.0
    if use_research:
        if t >= 15:
            if research.get("res1_3", 0) > 0:
                minus_gold += 0.02
            if research.get("res1_6", 0) > 0:
                minus_gold += 0.04
            if research.get("res1_11", 0) > 0:
                minus_gold += 0.08
            if research.get("res1_14", 0) > 0:
                minus_gold += 0.02 * research["res1_14"]
        if t < 15:
            if research.get("res4_2", 0) > 0:
                minus_gold += 0.02
            if research.get("res4_5", 0) > 0:
                minus_gold += 0.04
            if research.get("res4_10", 0) > 0:
                minus_gold += 0.08
            if research.get("res4_14", 0) > 0:
                minus_gold += 0.02 * research["res4_14"]
    minus_wood = 0.01 * levels[21] if levels[21] > 0 else 0.0

    out["gold"] = max(0, out["gold"] - out["gold"] * minus_gold)
    out["wood"] = max(0, out["wood"] - out["wood"] * minus_wood)

    red = TIME_REDUCTION.get(t)
    if red is not None:
        lvl_key, threshold = red
        lvl = levels[lvl_key]
        if threshold is None:
            out["time"] = out["time"] - out["time"] * lvl * 0.0455
        elif lvl >= threshold:
            out["time"] = out["time"] - out["time"] * (lvl - threshold) * 0.0455
    out["time"] = 1 if out["time"] < 0 else math.floor(out["time"])
    return {k: r6(v) for k, v in out.items()}


def island_cost(iid, level):
    level = level - 1
    tbl = ISLAND.get(str(iid))
    out = {}
    if tbl is None:
        return {"wood": 0.0, "workers": 0.0, "time": 0.0, "max_level": 0.0}
    cols = tbl["levels"]
    for f in ("wood", "workers", "time"):
        arr = cols.get(f)
        if arr is None:
            out[f] = 0
            continue
        # island_cost() has no isset() guard; a level past the end is a PHP
        # notice that evaluates to 0.
        out[f] = arr[level] if 0 <= level < len(arr) and arr[level] > 0 else 0
    out["max_level"] = tbl["max_level"]
    return {k: r6(v) for k, v in out.items()}


def research_node(way, nid, research):
    key = "%d.%d" % (way, nid)
    node = RESEARCH["nodes"][key]
    out = {"need_way": 0, "need_id": 0, "points": node["points"], "id": nid}
    for req in node["requires"]:
        if research.get("res%d_%d" % (req["way"], req["id"]), 0) == 0:
            out["need_way"] = req["way"]
            out["need_id"] = req["id"]
            break
    lvl = research.get("res%d_%d" % (way, nid), 0)
    if lvl > 0:
        out["points"] = out["points"] * (lvl + 1)
    return {k: r6(v) for k, v in out.items()}


def zero_research():
    r = {}
    for way, n in ((1, 14), (2, 15), (3, 16), (4, 14)):
        for i in range(1, n + 1):
            r["res%d_%d" % (way, i)] = 0
    return r


def levels(**over):
    l = {i: 0 for i in range(31)}
    for k, v in over.items():
        l[int(k[1:])] = v          # p21=7 -> levels[21] = 7
    return l


fails, checks = [], 0


def cmp(label, got, exp):
    global checks
    checks += 1
    if isinstance(exp, dict):
        for k in exp:
            if k not in got:
                fails.append("%s: missing key %s" % (label, k))
            elif abs(float(got[k]) - float(exp[k])) > 1e-6:
                fails.append("%s.%s: got %s exp %s" % (label, k, got[k], exp[k]))
    elif abs(float(got) - float(exp)) > 1e-6:
        fails.append("%s: got %s exp %s" % (label, got, exp))


ZR, ZL = zero_research(), levels()

# --- building_cost base -------------------------------------------------
for bid, lv in FIX["building_cost"].items():
    for lvl, exp in lv.items():
        cmp("building_cost[%s][%s]" % (bid, lvl),
            building_cost(int(bid), int(lvl), ZR, ZL), exp)

# --- building_cost discount paths ---------------------------------------
BC_CASES = {
    "res2_2": ({"res2_2": 1}, {}),
    "res2_11": ({"res2_11": 1}, {}),
    "carpentry_7": ({}, {"p21": 7}),
    "all": ({"res2_2": 1, "res2_11": 1}, {"p21": 12}),
}
for name, (rset, lset) in BC_CASES.items():
    r = dict(ZR, **rset)
    l = levels(**lset)
    for key, exp in FIX["building_cost_discounts"][name].items():
        bid, lvl = key.split("@")
        cmp("bc_disc[%s][%s]" % (name, key), building_cost(int(bid), int(lvl), r, l), exp)

# --- army_cost base ------------------------------------------------------
for uid, exp in FIX["army_cost_base"].items():
    cmp("army_cost_base[%s]" % uid, army_cost(int(uid), ZR, ZL, False), exp)

# --- army_cost discount paths -------------------------------------------
AC_CASES = {
    "ship_research": ({"res1_3": 1, "res1_6": 1, "res1_11": 1, "res1_14": 3}, {}),
    "troop_research": ({"res4_2": 1, "res4_5": 1, "res4_10": 1, "res4_14": 2}, {}),
    "barracks_20": ({}, {"p5": 20}),
    "shipyard_20": ({}, {"p4": 20}),
    "carpentry_10": ({}, {"p21": 10}),
}
for name, (rset, lset) in AC_CASES.items():
    r = dict(ZR, **rset)
    l = levels(**lset)
    for uid, exp in FIX["army_cost_discounts"][name].items():
        cmp("ac_disc[%s][%s]" % (name, uid), army_cost(int(uid), r, l, True), exp)

# --- island_cost ----------------------------------------------------------
for iid, lv in FIX["island_cost"].items():
    for lvl, exp in lv.items():
        cmp("island_cost[%s][%s]" % (iid, lvl), island_cost(int(iid), int(lvl)), exp)

# --- research tree --------------------------------------------------------
all1 = {k: 1 for k in ZR}
for name, r in (("empty", ZR), ("all_level_1", all1)):
    for key, exp in FIX["research"][name].items():
        way, nid = key.split(".")
        got = research_node(int(way), int(nid), r)
        cmp("research[%s][%s]" % (name, key),
            got, {k: exp[k] for k in ("need_way", "need_id", "points", "id")})

print("checks: %d" % checks)
if fails:
    print("FAILURES: %d" % len(fails))
    for f in fails[:40]:
        print("  " + f)
    if len(fails) > 40:
        print("  ... and %d more" % (len(fails) - 40))
    sys.exit(1)
print("all extracted gamedata reproduces the legacy fixture exactly")
