# Author upload — readiness check

Stage: `eds-author-upload`. Date: 2026-09-19.

## Verdict

**Nothing uploaded. Stopped at the pre-upload human gate: no `--target` or
`--token` was supplied, and the skill forbids guessing an environment.**

A candidate target exists in the shell environment (`AEM_HOST` =
`https://author-p87305-e741707.adobeaemcloud.com`, with a 1890-char
`AEM_IMPORT_API_KEY`), but an env var is not a confirmation. Uploading to the
wrong author writes content into somebody's site, which is the exact failure
this gate exists to prevent. A person must confirm the environment.

## Preconditions — what passes

| Check | State |
|---|---|
| Aggregated model JSONs current | **PASS** — re-ran `npm run build:json`; all three files byte-identical afterwards, so the importer would derive cell structure from current models |
| `flush` section style authorable | **PASS** — now present in `models/_section.json` as "Content to Edges"; this was a declared blocker from `eds-page-assemble` and is resolved |
| Component filters cover the page | **PASS** — `section` admits `hero`, `cards`, `columns`, `stats`, `fragment`; `cards`→`card`, `columns`→`column`, `stats`→`stat`. Every block the homepage uses can be added and edited in UE |
| Page assembled and verified | **PASS** — `capture/assemble/report.md`, 6 breakpoints (375/600/768/900/1200/1440), no overflow, 8/8 blocks `data-block-status="loaded"`, no console/page errors |
| Homepage transform QA'd | **PASS** — all 6 block skeletons match the fixture; cell counts asserted at import time against the models |

## Preconditions — what blocks

1. **No approved mapping.** 0 of 118 mapping entries across `capture/*/mapping.json`
   carry `approved: true`. This stage's stated input is an *approved* mapping.
2. **Bulk import is unsafe.** `QA-REPORT.md` approves the transform for the
   homepage template only. The other 13 captured pages drop 38–98% of their
   content — `/our-story/contact-us` emits nothing but a Metadata table, and
   `/our-story` emits a plausible-looking but silently incomplete page because
   the homepage selectors happen to match. 10 of 18 mapped components have no
   block and therefore no transform. Do not run the full URL list.
3. **Tooling not installed.** `aem-import-helper` is absent, and the bare name
   resolves to a **deprecated 0.8.0**. The current package is
   `@adobe/aem-import-helper` (1.6.0). Install that, not the bare name.

## Defects that would become content if uploaded now

These are not upload problems — they belong to earlier stages — but they ship
into the author environment the moment a page is installed:

- **Hero H1 is a WCAG contrast failure.** `hero.css` paints a white H1 directly
  over the photo; the source uses dark serif type in an inset white panel. The
  first line is illegible over the light left third of the real image.
  → `eds-block-authoring`.
- **5/5 images have empty `alt`.** Carried verbatim from source, never
  synthesised. Needs an authoring pass before go-live.
- **Disclosure band** is missing from `inventory.json` and has no fine-print
  styling (renders at body size against the source's 12px).

## When the gate clears

Sample-first, per the skill — one page, verified in the editor, before any
bulk run:

```sh
npx @adobe/aem-import-helper import \
  --urls urls.txt --importjs tools/importer/import.js \
  --models component-models.json \
  --filters component-filters.json \
  --definitions component-definition.json

npx @adobe/aem-import-helper aem upload \
  --zip <content-package.zip> \
  --token <token-file> --target <confirmed-author-base-url>
```

`urls.txt` should contain **only** `https://www.ppmamerica.com/` until the
remaining templates have blocks and transforms.

Note `--images-to-png` defaults to **true** and rewrites references — decide
whether that is wanted before accepting it for any bulk run.

Then verify in Universal Editor, not just on the rendered page: each block
editable in the properties rail, assets resolved to DAM references rather than
remote URLs, page metadata (title, description, theme) carried across. Capture
the editor-delivered markup per block and keep it — it is the only real sample
of that surface.
