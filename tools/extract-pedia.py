#!/usr/bin/env python3
"""
Turn izariam/views/view/{pedia,informations}.php into a topic table.

Both files are 811 lines of the same shape repeated: a `case N:` per topic,
then an <h1>, a run of <h2>/<div class="content"> pairs and <img>s, then a
prev/next navigation block. Every string is a language key, so the only thing
worth carrying over is the *order* of keys and images.

The two files differ in exactly two ways -- the case numbers and the link base
-- which is why the port renders both from one component.
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEGACY = os.path.dirname(ROOT)
OUT = os.path.join(ROOT, "packages/gamedata/pedia.json")

LINE = re.compile(
    r"""<h1[^>]*>\s*<\?=\$this->lang->line\('([^']+)'\)\?>       # h1
      | <h2[^>]*>\s*<\?=\$this->lang->line\('([^']+)'\)\?>       # h2
      | <div\s+class="content"[^>]*>\s*<\?=\$this->lang->line\('([^']+)'\)\?>
      | <img\s+src="<\?=\$this->config->item\('style_url'\)\?>([^"]+)"
    """,
    re.X,
)

def parse(path):
    src = open(path, encoding="utf-8", errors="replace").read()
    topics = {}
    # Split on `case N:` so each chunk is one topic.
    parts = re.split(r"<\?case\s+(\d+):\?>", src)
    for i in range(1, len(parts), 2):
        num = int(parts[i])
        body = parts[i + 1]
        # Drop the navigation block: its links repeat keys from other topics.
        body = re.split(r'<div class="navigation">', body)[0]
        blocks = []
        for m in LINE.finditer(body):
            h1, h2, content, img = m.groups()
            if h1:
                blocks.append({"kind": "title", "key": h1})
            elif h2:
                blocks.append({"kind": "heading", "key": h2})
            elif content:
                blocks.append({"kind": "text", "key": content})
            elif img:
                blocks.append({"kind": "image", "src": "/" + img})
        if blocks:
            topics[num] = blocks
    return topics

data = {
    "pedia": parse(os.path.join(LEGACY, "izariam/views/view/pedia.php")),
    "informations": parse(os.path.join(LEGACY, "izariam/views/view/informations.php")),
}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=1, sort_keys=True, ensure_ascii=False)
    fh.write("\n")

for name, topics in data.items():
    blocks = sum(len(b) for b in topics.values())
    print(f"{name}: {len(topics)} topics, {blocks} blocks")
