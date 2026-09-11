# venn-diagram-generator

[中文說明](./README.zh-TW.md) · Live: <https://venn.applepig.net>

A single-page WYSIWYG Venn diagram generator. Pick an arrangement (ring or row) and 2–6 circles, click any region on the canvas to type, drag text around, tune font sizes, then download a PNG you can paste anywhere. The whole editor state is compressed into the URL's `s` parameter, so a share link *is* the picture: paste it into a chat app and `og:image` renders a preview. No login, no account, stateless server. UI available in Traditional Chinese and English.

## Architecture

SVG is the single source of truth for rendering. `engine/render-svg.ts` exposes a pure `renderSvg(state, options)`; the browser drops its output straight into the DOM as a live preview, and the server hands the very same output to `@resvg/resvg-js` to get a PNG — what you preview is what you download. Text layout never measures the DOM: widths are estimated from character classes (CJK 1em, other 0.62em, whitespace 0.3em) so front end and back end lay out identically.

```
engine/   types, defaults, shapes/ (ring & row registry), layout, region-geometry,
          render-svg, state-codec — pure geometry, layout and codec, zero product copy
content/  palette, templates/, strings/, locale, state-presets — default memes and UI strings
ui/       Vite + vanilla TS editor
server/   Hono: static files, og meta injection for GET /, GET /api/png and /api/og.png
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
  "style": "flat",            // translucent | flat | outline
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
    "3": { "t": "Tomorrow", "fs": 0.09, "dx": 0.01, "dy": -0.02 }
  }
}
```

`fs` (font size, fraction of canvas width), `dx` / `dy` (offset from the region box centre) and `fill` (per-region colour override, `flat` only) exist only once the user has adjusted them; absent means automatic. Each text slot is capped at 80 characters.

Which slots a shape offers is derived from its default geometry (a region gets a slot when it has a non-null inscribed box): 3 slots for 2 circles, 7 for 3, 13 for the 2×2 four-circle petal arrangement (4 singles + 4 adjacent pairs + 4 triples + 1 centre; the diagonal pairs have no region at the default overlap). Rings of 5–6 and all rows only ship single-circle labels by default.

Without `s`, every shape falls back to a default template (in the current UI language). If you have not edited any text yet, switching shape or language swaps the whole template; once you have typed something, your text is kept.

## API

`GET /api/png?s=<state>` returns `image/png` sized to `state.size`, with `Cache-Control: public, max-age=31536000, immutable` (the parameter *is* the content). A missing, undecodable or invalid `s` returns a 400 JSON body `{ "error": "..." }`. API error messages are always English — it is a machine interface and does not follow the UI language.

`GET /api/og.png?v=<n>&s=<state>&lang=<zh-TW|en>` is the 1200 × 630 social banner: the branded base image with the diagram composited on top. Without `s` it renders the home-page sample; `lang` only comes from the query string (never `Accept-Language`) so a cached URL cannot be poisoned by whichever crawler arrives first. `v` is the layout cache version, bumped when the base image or composition changes. Invalid `s` returns 400 JSON with `Cache-Control: no-store`.

The home page ships a pre-baked static OG image (`pnpm build` writes `dist/og-default-<hash>.png`); share pages point `og:image` at `/api/og.png` with their own `s`.

```bash
# Build a state with Node, or just copy a link out of the editor
S=$(pnpm exec tsx -e "
import { encodeState } from './engine/state-codec-node';
import { sampleState } from './content/state-presets';
process.stdout.write(encodeState(sampleState()));")

curl -o venn.png "http://localhost:3000/api/png?s=$S"
curl -o og.png   "http://localhost:3000/api/og.png?v=5&s=$S&lang=en"
```

## Local development

```bash
pnpm install
pnpm dev          # Hono on 3000; Vite runs in middlewareMode on the same port (HMR included)
pnpm test         # Vitest
pnpm typecheck    # tsc --noEmit
pnpm build        # ui → dist/, baked OG image → dist/, server → dist-server/
pnpm start        # run the built server, single port 3000
```

Noto Sans TC Bold (OFL) lives in `assets/fonts/`. The front-end `@font-face` and resvg's `fontFiles` point at the same file, and the image installs no system fonts.

## Docker

The Dockerfile lives in `deploy/` but expects the repository root as its build context:

```bash
pnpm docker:build   # docker build -f deploy/Dockerfile -t venn-diagram-generator .
docker run --rm -p 3000:3000 -e VENN_WATERMARK=venn.example.com venn-diagram-generator
```

`deploy/compose.yml` builds that image and publishes it behind a reverse proxy (Traefik labels, external network `web`, TLS terminated upstream). Every site-specific value in it is an environment variable — it will refuse to start until you supply `VENN_PUBLIC_HOST`. `deploy/compose.dev.yml` skips the image entirely: it mounts the source into `node:24-slim` and runs `tsx watch server/index.ts`, so both front-end HMR and server restarts work without rebuilding.

`deploy/deploy.sh` is the whole deployment story — there is no registry. It rsyncs the working tree to a host over ssh (skipping `.env`, so the host keeps its own) and runs compose there with `--env-file .env`:

```bash
VENN_DEPLOY_HOST=my-host VENN_DEPLOY_PATH=/srv/apps/venn ./deploy/deploy.sh
```

## Environment variables

Copy `.env.example` to `.env` in the repository root and fill it in — on the deployment host, that is the file compose reads. Nothing in this repository has a baked-in default pointing at someone else's infrastructure: no hostname, no analytics id, no watermark.

| Variable | Used by | Required | Meaning |
|---|---|---|---|
| `VENN_PUBLIC_HOST` | `deploy/compose.yml` | **yes** | Public hostname of your instance. Becomes `PUBLIC_ORIGIN` and the Traefik `Host()` rule; compose errors out when it is missing. |
| `VENN_WATERMARK` | server | no | Watermark text at the bottom right of generated images. Unset or empty draws no watermark. |
| `VENN_GTM_ID` | server | no | Google Tag Manager container id. Unset injects no GTM snippet at all — leave it unset unless it is *your* container. |
| `PUBLIC_ORIGIN` | server, build | no | Absolute origin for `og:image` / `og:url`. Unset falls back to the request headers; `deploy/compose.yml` derives it from `VENN_PUBLIC_HOST`. |
| `PORT` | server | no | Listen port, default 3000. |
| `VENN_DEPLOY_HOST` | `deploy/deploy.sh` | **yes** | ssh target of the deployment host. The script exits 1 and names the missing variable. |
| `VENN_DEPLOY_PATH` | `deploy/deploy.sh` | **yes** | Directory on that host to rsync into. |
| `VENN_DEV_HOST` | `deploy/compose.dev.yml` | **yes** | Hostname of the source-mounted dev site; compose refuses to start without it. |

## Forking

The visual branding is not generic, so swap these before you publish your own instance:

- **`ui/public/og-base.png`** — the 1200 × 630 social base image with the original project's branding on it. Replace it with your own artwork (same dimensions), then run `pnpm build` to re-bake `dist/og-default-<hash>.png`.
- **`VENN_WATERMARK`** — set it to your own hostname, or leave it unset for no watermark.
- **`VENN_GTM_ID`** — set your own container id, or leave it unset so no analytics load at all. Never inherit someone else's.
- **`VENN_PUBLIC_HOST`** / **`VENN_DEV_HOST`** — your own hostnames. There are no defaults to forget to change.

## Notes

- "Copy image" uses `ClipboardItem` and needs a secure context (HTTPS or localhost). Where that is unavailable the UI suggests "Download PNG" instead.
- How much text fits in a region is bounded by its inscribed rectangle. The centre region of a four-circle diagram is especially tight: past roughly four full-width characters the text overflows even at the minimum font size (2.5% of canvas width). Put long sentences in single-circle or two-circle slots.

## Licence

Code is MIT — see [LICENSE](./LICENSE).

The bundled font Noto Sans TC Bold is licensed under the SIL Open Font License; its terms are in [`assets/fonts/OFL.txt`](./assets/fonts/OFL.txt) and travel with the font file.
