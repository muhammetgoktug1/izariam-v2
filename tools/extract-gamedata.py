#!/usr/bin/env python3
"""
Extract the game's balance tables out of the legacy PHP into JSON.

data_model.php stores ~72% of its 1,757 lines as data wearing a function
costume: space-delimited numeric strings inside switch cases, exploded at
call time. This parses those literals straight out of the source so the
numbers are exact rather than recomputed.

Per-level curves that are written as one `return` per case (peoples_by_level
and friends) are taken from fixtures/lookups.json instead -- the fixture
already holds the evaluated curve including its tail formula.

Run from the repo root:  python3 tools/extract-gamedata.py
"""

import json
import os
import re
import sys

# The rewrite lives in v2/; the PHP it is ported from sits beside it in the
# repo root, and stays there untouched as a reference implementation.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEGACY = os.path.dirname(ROOT)
DATA_MODEL = os.path.join(LEGACY, "izariam/models/data_model.php")
ALPHA_SQL = os.path.join(LEGACY, "izariam/database/alpha.sql")
LOOKUPS = os.path.join(ROOT, "fixtures/lookups.json")
OUT = os.path.join(ROOT, "packages/gamedata")

# Unit ids are 1-based in the API but 0-based in the arrays (the function does
# floor($type)-1), so index i of every array describes unit id i+1.
UNIT_FIELDS = [
    "peoples", "wood", "sulfur", "wine", "crystal", "gold", "time",
    "defence", "health", "class", "speed", "ability", "capacity",
]
BUILDING_FIELDS = ["wood", "wine", "marble", "crystal", "sulfur", "time"]
ISLAND_FIELDS = ["wood", "workers", "time"]


def read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def func_body(src, name):
    """Return the source between `function <name>(` and its closing brace."""
    m = re.search(r"function\s+%s\s*\(" % re.escape(name), src)
    if not m:
        raise SystemExit("function not found: %s" % name)
    i = src.index("{", m.end())
    depth, j = 0, i
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
        j += 1
    raise SystemExit("unbalanced braces in %s" % name)


def nums(s):
    """'40 130 30' -> [40, 130, 30], keeping ints as ints."""
    out = []
    for tok in s.split():
        f = float(tok)
        out.append(int(f) if f.is_integer() else f)
    return out


def parse_switch_tables(body, fields):
    """
    Walk a `switch ($id) { case N: $var = '...'; ... break; }` block and return
    {case_id: {field: [values]}}. Handles fall-through (`case 1: case 2:`),
    which island_cost relies on.
    """
    tables, pending = {}, []
    for line in body.splitlines():
        line = line.strip()
        mcase = re.match(r"case\s+(\d+)\s*:", line)
        if mcase:
            pending.append(int(mcase.group(1)))
            continue
        massign = re.match(r"\$(\w+)\s*=\s*'([0-9 .]*)'\s*;", line)
        if massign and pending:
            var, val = massign.group(1), massign.group(2)
            if var in fields and val.strip():
                for cid in pending:
                    tables.setdefault(cid, {})[var] = nums(val)
            continue
        if line.startswith("break;"):
            pending = []
    return tables


def extract_units(src):
    body = func_body(src, "army_cost_by_type")
    cols = {}
    for line in body.splitlines():
        m = re.match(r"\s*\$(\w+)\s*=\s*'([0-9 .]*)'\s*;", line)
        if m and m.group(1) in UNIT_FIELDS:
            cols[m.group(1)] = nums(m.group(2))
    missing = [f for f in UNIT_FIELDS if f not in cols]
    if missing:
        raise SystemExit("units: missing columns %s" % missing)
    n = len(cols["wood"])
    if any(len(v) != n for v in cols.values()):
        raise SystemExit("units: ragged columns %s" % {k: len(v) for k, v in cols.items()})
    return {str(i + 1): {f: cols[f][i] for f in UNIT_FIELDS} for i in range(n)}


def extract_buildings(src):
    tables = parse_switch_tables(func_body(src, "building_cost"), BUILDING_FIELDS)
    out = {}
    for bid, cols in sorted(tables.items()):
        # max_level mirrors the PHP: count-1 of the last non-empty array
        # assigned, and `time` is always the last one set.
        last = None
        for f in BUILDING_FIELDS:
            if f in cols:
                last = f
        out[str(bid)] = {"max_level": len(cols[last]) - 1, "levels": cols}
    return out


def extract_island(src):
    tables = parse_switch_tables(func_body(src, "island_cost"), ISLAND_FIELDS)
    out = {}
    for iid, cols in sorted(tables.items()):
        last = None
        for f in ISLAND_FIELDS:
            if f in cols:
                last = f
        # island_cost() subtracts 1 from the level before indexing.
        out[str(iid)] = {"max_level": len(cols[last]) - 1, "level_offset": -1, "levels": cols}
    return out


def extract_research(src):
    """
    Nested switch: outer `case <way>:` at 12 spaces, inner `case <id>:` at 20.
    Each node carries a point cost and an ordered list of alternative
    prerequisites (the if/elseif chain on `res{way}_{id} == 0`).
    Repeat levels are scaled by (level + 1) in a shared tail at the end of the
    function -- recorded here as `repeat_multiplier` rather than per node.
    """
    body = func_body(src, "get_research")
    way = node = None
    out = {}
    for line in body.splitlines():
        indent = len(line) - len(line.lstrip())
        s = line.strip()
        m = re.match(r"case\s+(\d+)\s*:", s)
        if m:
            if indent <= 12:
                way, node = int(m.group(1)), None
            else:
                node = int(m.group(1))
                out["%d.%d" % (way, node)] = {
                    "way": way, "id": node, "points": 0, "requires": [],
                    "name_key": "research%d_%d_name" % (way, node),
                    "desc_key": "research%d_%d_desc" % (way, node),
                }
            continue
        if way is None or node is None:
            continue
        key = "%d.%d" % (way, node)
        mp = re.search(r"\$return\['points'\]\s*=\s*(\d+)\s*;", s)
        if mp:
            out[key]["points"] = int(mp.group(1))
        for rw, ri in re.findall(r"\$research->res(\d+)_(\d+)\s*==\s*0", s):
            out[key]["requires"].append({"way": int(rw), "id": int(ri)})
    return {"repeat_multiplier": "points * (level + 1)", "nodes": out}


def extract_curves(lookups):
    """Per-level curves already evaluated in the golden fixture."""
    keys = [
        "peoples_by_level", "scientists_by_level", "wine_by_tavern_level",
        "speed_by_port_level", "spyes_time_by_level", "transport_cost_by_count",
        "branchOffice_capacity_by_level", "branchOffice_radius_by_level",
        "action_points_by_level", "wall_data_by_level",
        "spy_risk_by_mission", "spy_gold_by_mission", "premium_cost",
    ]
    return {k: lookups[k] for k in keys if k in lookups}


def extract_maps(lookups):
    return {k: lookups[k] for k in [
        "building_class_by_type", "building_type_by_class", "army_class_by_type",
        "resource_class_by_type", "island_building_by_resource", "good_class_by_count",
    ] if k in lookups}


def extract_islands_seed(sql):
    """The 200 seeded islands. Column order comes from the CREATE TABLE."""
    m = re.search(r"CREATE TABLE `alpha_islands` \((.*?)\n\)", sql, re.S)
    cols = re.findall(r"^\s*`(\w+)`", m.group(1), re.M)
    rows = []
    for vals in re.findall(r"INSERT INTO `alpha_islands` VALUES \((.*?)\);", sql):
        parts = [p.strip().strip("'") for p in vals.split(",")]
        row = {}
        for c, v in zip(cols, parts):
            row[c] = int(v) if re.fullmatch(r"-?\d+", v) else v
        rows.append(row)
    return rows


def extract_lang(path):
    """$lang['key'] = "value"; -> {key: value}"""
    out = {}
    for m in re.finditer(r"\$lang\['([^']+)'\]\s*=\s*(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')\s*;",
                         read(path)):
        raw = m.group(2)
        body = raw[1:-1]
        body = body.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")
        out[m.group(1)] = body
    return out


# The eight wonders' per-level effects.
#
# The legacy's `wonderN_levelM` strings are an older, weaker balance -- half
# the magnitudes, and windows that do not match the durations and cooldowns the
# port ships. The numbers live in packages/rules/src/temple.ts (MIRACLES); these
# sentences are written from that table, and overriding them here is what keeps
# a re-extraction from putting the 2012 figures back.
WONDER_EFFECTS_EN = {
    1: ["All your combat units gain %s more armour and deal %s%% more damage." % a
        for a in ((0, "7.5"), (10, "7.5"), (10, "10"), (20, "12.5"), (20, "15"))],
    2: ["%s%% of the resource cost of every unit that dies defending your towns "
        "is repaid in marble." % v for v in (20, 30, 40, 50, 80)],
    3: ["Population in your towns grows by %s per hour." % v
        for v in (6, 12, 18, 24, 36)],
    4: ["+%s%% secure resources in all warehouses" % v
        for v in (40, 80, 160, 240, 400)],
    5: ["Loading speed for goods is increased by %s%%." % v
        for v in (40, 80, 120, 160, 200)],
    6: ["+%s morale per round for every army stationed in your towns -- for your "
        "enemy's too!" % v for v in (100, 200, 400, 600, 2000)],
    7: ["%s%% more speed for warships and transports." % v
        for v in (10, 30, 50, 70, 100)],
    8: ["%s%% of the enemy units and ships fighting your troops in your towns are "
        "routed. Their %s-minute dispersal is extended." % a
        for a in ((10, 10), (20, 20), (30, 30), (50, 40), (100, 60))],
}


def apply_wonder_effects(lang):
    """Replace the 40 wonderN_levelM strings with the port's own balance."""
    for wonder, levels in WONDER_EFFECTS_EN.items():
        for i, text in enumerate(levels, start=1):
            lang["wonder%d_level%d" % (wonder, i)] = text
    return lang


def write(rel, obj):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    size = os.path.getsize(path)
    n = len(obj) if isinstance(obj, (dict, list)) else 1
    print("  %-28s %6d entries  %8.1f KB" % (rel, n, size / 1024.0))


def main():
    src = read(DATA_MODEL)
    lookups = json.load(open(LOOKUPS, encoding="utf-8"))

    print("extracting ->", os.path.relpath(OUT, ROOT))
    write("units.json", extract_units(src))
    write("buildings.json", extract_buildings(src))
    write("island.json", extract_island(src))
    write("research.json", extract_research(src))
    write("curves.json", extract_curves(lookups))
    write("maps.json", extract_maps(lookups))
    write("islands.seed.json", extract_islands_seed(read(ALPHA_SQL)))
    for lang in ("english", "spanish"):
        p = os.path.join(LEGACY, "izariam/language/%s/izariam_lang.php" % lang)
        if os.path.exists(p):
            write(
                "i18n/%s.json" % {"english": "en", "spanish": "es"}[lang],
                apply_wonder_effects(extract_lang(p)),
            )


if __name__ == "__main__":
    main()
