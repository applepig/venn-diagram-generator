# venn-diagram-generator

[中文說明](./README.zh-TW.md) · Live: <https://venn.applepig.net>

A single-page WYSIWYG Venn diagram generator. Pick 2, 3 or 4 circles (extra shapes such as rows and 5–6 circle flowers live in a dropdown next to them), give the picture a title, click any region on the canvas to type, tune font sizes, recolour individual regions, then download a PNG you can paste anywhere. The whole editor state is compressed into the URL's `s` parameter, so a share link *is* the picture: paste it into a chat app and `og:image` renders a preview. No login, no account, stateless server. UI available in Traditional Chinese, English and Japanese, picked from the language dropdown in the panel (remembered in the `venn.lang` cookie), `?lang=`, or `Accept-Language`.

## Architecture

SVG is the single source of truth for rendering. `engine/render-svg.ts` exposes a pure `renderSvg(state, options)`; the browser drops its output straight into the DOM as a live preview, and the server hands the very same output to `@resvg/resvg-js` to get a PNG — what you preview is what you download. Text layout never measures the DOM: widths are estimated from character classes (CJK 1em, other 0.62em, whitespace 0.3em) so front end and back end lay out identically.

```
engine/   types, defaults, shapes/ (ring & row registry), layout, region-geometry,
          render-svg, state-codec — pure geometry, layout and codec, zero product copy
content/  palette, templates/, strings/, locale, state-presets — default memes and UI strings
ui/       Vite + vanilla TS editor
server/   Hono: static files, og meta injection for GET /, GET /api/png and /api/og.png
cli/      the `venn` command: spec (letters <-> masks), flags (merging), venn (I/O shell)
skills/   Claude Code skill shipped by the plugin in .claude-plugin/
deploy/   Dockerfile, compose.yml, compose.dev.yml, deploy.sh
```

Circle positions are always derived from `arr` / `n` / `overlap` / `radius` — coordinates are never stored. `ring(n)` keeps a frozen angle table per circle count so links shared by older versions keep rendering byte-for-byte identically.

## URL state format

`?s=` holds `base64url(deflate-raw(JSON))`. The browser uses `CompressionStream('deflate-raw')`, Node uses `zlib.deflateRawSync` — same format both ways. Anything that fails to inflate or does not match the schema is a 400.

```jsonc
{
  "v": 1,                     // state version, must be 1
  "arr": "row",               // "ring" | "row"; omitted means "ring"
  "n": 2,                     // circle count: ring 2–6, row 3–6
  "title": "My diagram",      // image title, drawn in a band above the diagram;
                              // omitted or empty means no title (same 80-char cap as a slot)
  "title_fill": "#e04848",    // title text colour; omitted means automatic black or white.
                              // Never encoded when there is no title
  "style": "flat",            // translucent | flat | outline
  "stroke_width": 0.01,       // circle outline width as a fraction of canvas width, 0–0.03;
                              // omitted means the style default (0.006 for outline, 0 otherwise)
  "stroke": "#ff0000",        // outline colour; omitted means #000000.
                              // Never encoded when the resolved width is 0
  "opacity": 0.6,             // 0–1, only used by translucent
  "overlap": 1.2,             // centre distance / r, 0.6–1.6
  "radius": 0.3,              // circle radius as a fraction of canvas width
                              // (ring 0.2–0.35, row 0.1–0.35)
  "colors": ["#2e9be6", "#e6a92e"],  // length must equal n
  "bg": "#fafafa",
  "size": 1200,               // integer, 400–2000
  "texts": {                  // key is the member-circle bitmask, as a decimal string
    "1": { "t": "Things I\nshould do" },  // circle i = bit i, so 3 = circle 0 ∩ circle 1
    "2": { "t": "Things I\nwant to do" },
    "3": { "t": "Tomorrow", "fs": 0.09 }
  }
}
```

`fs` (font size, fraction of canvas width) and `fill` (per-region colour override, `flat` only) exist only once the user has adjusted them; absent means automatic. Region text is always drawn at the centre of its region box. Each text slot is capped at 80 characters. Older links may still carry `dx` / `dy` text offsets; those are ignored rather than rejected, so the link keeps working.

With a `title`, the top 18% of the canvas becomes a title band and the diagram (circles and every region text) is scaled down by the same factor, centred horizontally and pushed to the bottom edge — so the output stays square and nothing overflows. Without a title the layout is untouched, byte for byte. The title font size is fitted automatically, manual `\n` and automatic wrapping both work, and the colour flips between black and white with the background's luminance unless `title_fill` pins it. On a share page the title also becomes the `og:title` and `<title>`.

A large `radius` combined with a large `overlap` can push the circles past the canvas edge — most easily on `ring(5)` / `ring(6)` and the rows. When that happens the whole diagram (circles, every region text, and the title transform already applied) is scaled down about the canvas centre and nudged back inside, leaving a margin of half the outline width — and never less than 0.3% of the canvas width — so the stroke is not clipped either. It only ever shrinks, never enlarges: geometry that already fits comes out byte for byte identical. Layout still runs on the untransformed geometry, so which slots exist and where their text sits are unaffected — the fit is applied at the very end, on top of the title transform.

Which slots a shape offers is derived from its default geometry (a region gets a slot when it has a non-null inscribed box): 3 slots for 2 circles, 7 for 3, 13 for the 2×2 four-circle petal arrangement (4 singles + 4 adjacent pairs + 4 triples + 1 centre; the diagonal pairs have no region at the default overlap). Rings of 5–6 and all rows only ship single-circle labels by default. The shape dropdown lists row(3), row(4), ring(5) and ring(6); row(5) and row(6) stay decodable so older links keep working, and the menu adds the current one as a temporary entry when you open such a link.

Without `s` the editor starts empty: every shape ships a default template (in the current UI language), but it is only shown as a placeholder — in the text fields and, faintly, on the canvas preview itself (`renderSvg`'s `ghosts` option, which only the editor canvas passes). Nothing is written into the state, so you never have to clear a sample before typing your own, and no download, `/api/png` or og:image ever contains the ghost text. Switching shape while nothing is typed also switches to that template's style; once you have typed something, your text and style are kept. The og:image for the bare home page still renders the 2-circle template, so the social card is not an empty diagram.

## API

`GET /api/png?s=<state>` returns `image/png` sized to `state.size`, with `Cache-Control: public, max-age=31536000, immutable` (the parameter *is* the content). A missing, undecodable or invalid `s` returns a 400 JSON body `{ "error": "..." }`. API error messages are always English — it is a machine interface and does not follow the UI language.

`POST /api/png` takes the same diagram as a raw `VennState` JSON body, so a caller does not have to deflate and base64url a state itself. The response is the PNG plus an `X-Venn-Url` header holding the editable share link for that diagram. Same validation and the same concurrency limit as the GET; a body that is not JSON, a state that fails validation, or a body over 32 KB return 400 / 400 / 413 as JSON.

The trade-off is caching. `GET /api/png?s=` is content-addressed and served `immutable`, so a repeated diagram never re-rasterizes; a POST cannot be cached and is answered `Cache-Control: no-store`, meaning every request pays for a render. Use POST to *produce* a diagram, then hand out the `s` from `X-Venn-Url` for anything that will be fetched more than once.

`GET /api/og.png?v=<n>&s=<state>&lang=<zh-TW|en|ja>` is the 1200 × 630 social banner: the branded base image with the diagram composited on top. Without `s` it renders the home-page sample; `lang` only comes from the query string (never `Accept-Language`) so a cached URL cannot be poisoned by whichever crawler arrives first. `v` is the layout cache version, bumped when the base image or composition changes. Invalid `s` returns 400 JSON with `Cache-Control: no-store`.

The home page ships a pre-baked static OG image (`pnpm build` writes `dist/og-default-<hash>.png`); share pages point `og:image` at `/api/og.png` with their own `s`.

```bash
# Build a state with Node, or just copy a link out of the editor
S=$(pnpm exec tsx -e "
import { encodeState } from './engine/state-codec-node';
import { sampleState } from './content/state-presets';
process.stdout.write(encodeState(sampleState()));")

curl -o venn.png "http://localhost:3000/api/png?s=$S"
curl -o og.png   "http://localhost:3000/api/og.png?v=5&s=$S&lang=en"

# Or skip the encoding step and POST the state itself
curl -sD headers.txt -o venn.png -H 'content-type: application/json' \
  --data '{"v":1,"n":2,"style":"translucent","opacity":0.6,"overlap":1,"radius":0.26,
           "colors":["#4285f4","#ea4335"],"bg":"#ffffff","size":1200,
           "texts":{"3":{"t":"No sleep"}}}' \
  http://localhost:3000/api/png
grep -i x-venn-url headers.txt
```

## Command line

```bash
npx -y venn-diagram-generator@1 png --set A=Fast --set B=Cheap --set C=Good \
  --text ABC="Pick two" -o pick-two.png
```

Nothing is fetched at render time: the fonts ship inside the package and `@resvg/resvg-js` rasterizes locally. Four subcommands — `url` prints the share link, `svg` and `png` write a file, `decode <url-or-s>` prints the JSON behind an existing link (`--raw` prints the `VennState` documented above instead of the friendly format). `svg` and `png` print two lines: the absolute path with its pixel size, then the share URL for the same picture.

The CLI never asks you to write a bitmask. Circles are letters (`A` is the first circle, up to `F`) and a text slot is named by the set of circles it belongs to, so `AB` is the overlap of the first two. Letter case and order do not matter, `ba` is `AB`. Which slots exist depends on the arrangement: four circles in a ring means `A` and `D` never touch, so `AD` is rejected — and the error lists every legal slot for that combination.

The whole spec can arrive as JSON instead, which is the only sane way to pass CJK text, apostrophes and newlines through a shell. `--json` takes either format and tells them apart by which key is present — `sets` means the friendly spec, `v` means a raw `VennState`, the exact object the URL carries and `decode --raw` prints. An object with both or neither is rejected rather than guessed at, and so is a misspelt top-level field — `"text"` for `"texts"` would otherwise silently produce a diagram with the overlaps missing.

```bash
cat <<'EOF' | npx -y venn-diagram-generator@1 png --json - -o life.png
{
  "sets": ["工作", "生活", "睡眠"],
  "texts": { "AB": "沒有睡眠", "ABC": "都想要" },
  "title": "選三個",
  "style": "flat"
}
EOF
```

Every state field has a flag, so nothing is JSON-only. `--arr`, `--style`, `--title`, `--title-fill`, `--title-fs`, `--size`, `--bg`, `--opacity`, `--overlap`, `--radius`, `--stroke-width`, `--stroke` and `--colors '#aabbcc,#ddeeff'` map to the fields documented above, and the per-slot ones take the same letter keys: `--fs AB=0.09` and `--fill AB=#ffffff`. All of them override whatever `--json` supplied, and `--set` / `--text` replace only the text, leaving that slot's existing size and fill alone — `--text AB=` clears the words without discarding the region's colour.

The share link's host comes from `--base-url`, then `VENN_BASE_URL`, then `https://venn.applepig.net`. Exit codes: `0` success, `1` bad arguments or an invalid spec, `2` rasterization failed.

`decode` round-trips exactly, including manual font sizes and region colours, so you can paste a link from the editor, edit one label in JSON and re-render everything else untouched.

```bash
npx -y venn-diagram-generator@1 decode 'https://venn.applepig.net/?s=...' > spec.json
npx -y venn-diagram-generator@1 png --json spec.json -o updated.png
```

## Claude Code plugin

This repo is also a Claude Code plugin, so Claude can draw a real diagram instead of guessing at hand-written SVG.

```
/plugin marketplace add applepig/venn-diagram-generator
/plugin install venn@venn-diagram-generator
```

The skill teaches the CLI, carries the table of legal slots for every arrangement, and tells Claude to hand back both the PNG and the editable share URL. Then just ask for a Venn diagram.

## Local development

```bash
pnpm install
pnpm dev          # Hono on 3000; Vite runs in middlewareMode on the same port (HMR included)
pnpm test         # Vitest
pnpm typecheck    # tsc --noEmit
pnpm build        # ui → dist/, baked OG image → dist/, server → dist-server/
pnpm start        # run the built server, single port 3000
```

Two fonts live in `assets/fonts/`: Noto Sans TC Bold is the one the SVG asks for by name, and Noto Sans JP Bold only fills in glyphs TC does not have (Japanese kanji such as 盗). The front end lists both in a CSS `font-family` on `svg text`, the server hands both to resvg's `fontFiles` while `defaultFontFamily` stays `Noto Sans TC` — the `font-family` written into the SVG never changes, so shared links keep rendering byte-for-byte identically. The image installs no system fonts.

## Docker

The Dockerfile lives in `deploy/` but expects the repository root as its build context:

```bash
pnpm docker:build   # docker build -f deploy/Dockerfile -t venn-diagram-generator .
docker run --rm -p 3000:3000 -e VENN_WATERMARK=venn.example.com venn-diagram-generator
```

`deploy/compose.yml` builds that image and publishes it behind a reverse proxy (Traefik labels, external network `web`, TLS terminated upstream). Every site-specific value in it is an environment variable — it will refuse to start until you supply `VENN_PUBLIC_HOST`. `deploy/compose.dev.yml` skips the image entirely: it mounts the source into `node:24-slim` and runs `tsx watch server/index.ts`, so both front-end HMR and server restarts work without rebuilding.

Running compose by hand: it only auto-loads the `.env` sitting next to the compose file (`deploy/.env`), so pass the repository-root one explicitly — `docker compose --env-file .env -f deploy/compose.yml up -d --build`.

`deploy/deploy.sh` is the whole deployment story — there is no registry. It rsyncs the working tree to a host over ssh (skipping `.env`, so the host keeps its own) and runs compose there with `--env-file .env`:

```bash
VENN_DEPLOY_HOST=my-host VENN_DEPLOY_PATH=/srv/apps/venn ./deploy/deploy.sh
```

The script sources the repository-root `.env` first, so those two variables can live there instead of being typed every time (values in `.env` win over ones already exported).

Prerequisites on that host: the ssh user must be able to run Docker without an interactive password — either in the `docker` group or with passwordless sudo — and `${VENN_DEPLOY_PATH}/.env` must already exist. The script checks that the file declares `VENN_PUBLIC_HOST`, `VENN_GTM_ID` and `VENN_WATERMARK` (empty values are fine, missing keys are not) and exits 1 naming the missing ones before touching anything: a silently dropped watermark would be baked into a year-long cached `og:image`.

## Environment variables

Copy `.env.example` to `.env` in the repository root and fill it in — on the deployment host, that is the file compose reads. Nothing the *server* does has a baked-in default pointing at someone else's infrastructure: no hostname, no analytics id, no watermark. The one exception is the CLI's share link, which falls back to this project's public instance (see `VENN_BASE_URL` below) because a link has to point somewhere.

| Variable | Used by | Required | Meaning |
|---|---|---|---|
| `VENN_PUBLIC_HOST` | `deploy/compose.yml` | **yes** | Public hostname of your instance. Becomes `PUBLIC_ORIGIN` and the Traefik `Host()` rule; compose errors out when it is missing. |
| `VENN_WATERMARK` | server | no | Watermark text at the bottom right of generated images. Unset or empty draws no watermark. |
| `VENN_GTM_ID` | server | no | Google Tag Manager container id. Unset injects no GTM snippet at all — leave it unset unless it is *your* container. |
| `PUBLIC_ORIGIN` | server, build | no | Absolute origin for `og:image` / `og:url`. Unset falls back to the request headers; `deploy/compose.yml` derives it from `VENN_PUBLIC_HOST`. |
| `PORT` | server | no | Listen port, default 3000. |
| `VENN_BASE_URL` | `venn` CLI | no | Origin the CLI puts in share links. `--base-url` wins over it; unset falls back to `https://venn.applepig.net`. Point it at your own instance after forking. |
| `VENN_DEPLOY_HOST` | `deploy/deploy.sh` | **yes** | ssh target of the deployment host. The script exits 1 and names the missing variable. |
| `VENN_DEPLOY_PATH` | `deploy/deploy.sh` | **yes** | Directory on that host to rsync into. |
| `VENN_DEV_HOST` | `deploy/compose.dev.yml` | **yes** | Hostname of the source-mounted dev site; compose refuses to start without it. |
| `VENN_DIST` | server, build | no | Internal — do not set in production. Build output directory, default `dist`. |
| `VENN_FONT` | server | no | Internal — do not set in production. Comma-separated font files for resvg, default `assets/fonts/NotoSansTC-Bold.otf,assets/fonts/NotoSansJP-Bold.otf`. The first one is the family the SVG names; the rest only fill in missing glyphs. |
| `VENN_DEV` | server | no | Internal — do not set in production. `1` runs Vite in middlewareMode instead of serving `dist/`. |

## Forking

The visual branding is not generic, so swap these before you publish your own instance:

- **`ui/public/og-base.png`** — the 1200 × 630 social base image with the original project's branding on it. Replace it with your own artwork (same dimensions), then run `pnpm build` to re-bake `dist/og-default-<hash>.png`.
- **`VENN_WATERMARK`** — set it to your own hostname, or leave it unset for no watermark.
- **`VENN_GTM_ID`** — set your own container id, or leave it unset so no analytics load at all. Never inherit someone else's.
- **`VENN_PUBLIC_HOST`** / **`VENN_DEV_HOST`** — your own hostnames. There are no defaults to forget to change.
- **`VENN_BASE_URL`** and `package.json`'s `homepage` — the CLI's share links point at this project's instance unless you change both.

## Notes

- "Copy image" uses `ClipboardItem` and needs a secure context (HTTPS or localhost). Where that is unavailable the UI suggests "Download PNG" instead.
- "Share image" only appears where `navigator.canShare({ files })` accepts a PNG file — on iPadOS and iOS Safari that share sheet is the only way to get the image into Photos ("Save Image"); `<a download>` stops at Files. Closing the sheet does nothing; any other failure falls back to opening the PNG inline, which you can long-press to add to Photos.
- How much text fits in a region is bounded by its inscribed rectangle. The centre region of a four-circle diagram is especially tight: past roughly four full-width characters the text overflows even at the minimum font size (2.5% of canvas width). Put long sentences in single-circle or two-circle slots.

## Licence

Code is MIT — see [LICENSE](./LICENSE).

The bundled fonts Noto Sans TC Bold and Noto Sans JP Bold are licensed under the SIL Open Font License; its terms are in [`assets/fonts/OFL.txt`](./assets/fonts/OFL.txt) (one copy covers both) and travel with the font files.
