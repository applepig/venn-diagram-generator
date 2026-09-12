---
name: venn
description: Draw a Venn diagram as a real PNG plus an editable share link, using the venn CLI instead of hand-written SVG. Use whenever the user wants to show how two to six groups overlap — comparing options, mapping trade-offs, or the classic "X and Y but not Z" joke. Triggers on 'venn diagram', '文氏圖', '集合關係圖', '交集圖', 'overlap diagram', 'set diagram'.
---

# Venn Diagrams

Generate the diagram with the `venn` CLI. **Never hand-write SVG for this** — the CLI
lays out circles, picks contrasting text colours, and fits text inside each region,
which is tedious and error-prone to reproduce by hand.

```bash
npx -y venn-diagram-generator@1 png --json - -o diagram.png
```

No network access is needed after the package downloads: fonts ship inside it and
rasterization happens locally.

## Describing a diagram

Circles are letters. `A` is the first circle, `B` the second, up to `F`. A text slot is
named by the set of circles it sits in, so `AB` is the overlap of the first two.

Always pipe the spec through stdin with `--json -`. It avoids shell quoting problems
with CJK text, apostrophes, and newlines.

```bash
cat <<'EOF' | npx -y venn-diagram-generator@1 png --json - -o diagram.png
{
  "arr": "ring",
  "sets": ["Fast", "Cheap", "Good"],
  "texts": { "AB": "Sloppy", "AC": "Expensive", "BC": "Slow", "ABC": "Pick two" },
  "title": "Project management",
  "style": "flat",
  "size": 1200
}
EOF
```

Fields, all optional except `sets`:

| Field | Meaning |
|---|---|
| `sets` | Label of each circle, in order. Its length is the circle count (2-6). Use `""` for a circle with no label. |
| `texts` | Text inside an overlap, keyed by letters. Case and letter order do not matter, so `ba` equals `AB`. |
| `arr` | `ring` (default) or `row`. `row` lines the circles up horizontally and needs 3-6 circles. |
| `title` | Drawn in a band above the diagram. |
| `style` | `translucent` (default), `flat`, or `outline`. |
| `size` | Canvas pixels, 400-2000. Default 1200. Square output. |
| `bg`, `colors` | `#rrggbb` background, and one `#rrggbb` per circle. |
| `opacity`, `overlap`, `radius` | Fill opacity 0-1, how far circles reach into each other 0.6-1.6, circle radius as a fraction of the canvas. |
| `titleFill`, `titleFs` | Title colour, and title size as a fraction of canvas width. |

A slot value may also be an object, `{"t": "text", "fs": 0.08, "fill": "#ffffff"}`, pinning
a manual font size or recolouring that one region. Write the plain string form yourself.

## Not every overlap exists

This is the one thing to get right. Four circles in a ring means `A` and `D` never touch,
so `AD` is not a slot and the CLI rejects it. Pick slot names from this table:

```
ring(2) A B AB
ring(3) A B C AB AC BC ABC
ring(4) A B C D AB AC BD CD ABC ABD ACD BCD ABCD
ring(5) A B C D E AB BC CD AE DE ABC BCD ABE ADE CDE ABCD ABCE ABDE ACDE BCDE ABCDE
ring(6) A B C D E F AB BC CD DE AF EF ABC BCD CDE ABF AEF DEF
row(3)  A B C AB BC
row(4)  A B C D AB BC CD
row(5)  A B C D E AB BC CD DE
row(6)  A B C D E F AB BC CD DE EF
```

Only `ring(2)` and `ring(3)` contain every possible combination. If the idea
needs a slot that is not on the list, either reorder the circles so the ones that must
overlap are adjacent, or drop to three circles. When a slot name is wrong, the CLI exits
non-zero and prints the full legal list for that combination — read it and fix the key.

## Commands

| Command | Result |
|---|---|
| `png [-o file]` | Writes a PNG. Default `venn.png`. |
| `svg [-o file]` | Writes an SVG. Default `venn.svg`. |
| `url` | Prints the share URL only, no file. |
| `decode <url-or-s>` | Prints the JSON spec behind an existing share URL. |

Individual flags work too and override the JSON: `--set A=Work`, `--text AB=No sleep`,
`--json`, `--arr`, `--style`, `--title`, `--size`, `-o`, `--base-url`.

## Reporting back

`png` and `svg` print two lines: the file path with its pixel size, then a share URL.
**Give the user both.** The file is the image; the URL opens the same diagram in a
WYSIWYG editor where they can edit the text, adjust font sizes, recolour individual
regions, and re-export. Dropping the URL throws away the only way for them to tweak
the result without another round trip.

## Editing an existing diagram

When the user pastes a share link, decode it, edit the JSON, and render again.

```bash
npx -y venn-diagram-generator@1 decode 'https://venn.applepig.net/?s=...' > spec.json
# edit spec.json
npx -y venn-diagram-generator@1 png --json spec.json -o updated.png
```

`decode` round-trips exactly, including any manual text sizes and region colours, so editing
one label leaves the rest of their tuning untouched.

## Exit codes

`0` success, `1` bad arguments or an invalid spec (message on stderr), `2` rasterization
failed. On `1`, the message names the problem field — fix the spec rather than retrying.
