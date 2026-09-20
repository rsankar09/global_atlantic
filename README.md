# Your Project's Title...
Your project's description...

## Environments
- Preview: https://main--{repo}--{owner}.aem.page/
- Live: https://main--{repo}--{owner}.aem.live/

## Documentation

Before using the aem-boilerplate, we recommend you to go through the documentation on [www.aem.live](https://www.aem.live/docs/), more specifically:
1. [AEM Authoring](https://www.aem.live/docs/aem-authoring)
2. [Universal Editor Tutorial](https://www.aem.live/developer/ue-tutorial)
3. [Component Model Definitions](https://www.aem.live/developer/component-model-definitions)
4. [Authoring Path Mapping](https://www.aem.live/developer/authoring-path-mapping)

## Prerequisites

- nodejs 20 or newer
- AEM Cloud Service release 2026.4 or newer

## Installation

```sh
npm i
```

## Linting

```sh
npm run lint
```


## Approved & built (13)

| id | source component | → target | reach |
|---|---|---|---|
| cmp-003 | `herotitle` | hero `banner` variant | 115 pages (68%) |
| cmp-005 | `staticcard` | `cards` | 96 pages (57%) |
| cmp-006 | `staticcard-left/right` | `columns` | section landings |
| cmp-007 | `biocard` | `cards` | 51 pages (30%) |
| cmp-008 | `report-links` | `cards` | 1 page |
| cmp-009 | `breadcrumb` | **breadcrumbs** (new) | 167 pages (99%) |
| cmp-011 | `staticcard-cta` | **cta-banner** (new) | 76 pages (45%) |
| cmp-012 | `biodetail` | **bio-detail** (new) | 52 pages (31%) |
| cmp-013 | `newsinsightsdate` | page metadata | 55 pages (33%) |
| cmp-014 | `dynamic-card-list` | **card-list** (new) | listing pages |
| cmp-016 | `link-list` | header / footer | 169 pages (100%) |
| cmp-017 | `intro-text-columns` | section `split-33-66` | 8 pages |
| cmp-023 | `button` | default content | 36 pages (21%) |
| cmp-024 | `separator` | section `divided` | 4 instances |

That's 14 rows — cmp-024 was DOM-derived and carries no data-layer entry, which is why the original type sweep missed it entirely.

## Not approved / not built (10)

| id | source component | verdict | why it's still open |
|---|---|---|---|
| cmp-001 | `ppm-header-nav` | extend → header | not approved; needs sticky-on-scroll, clickable parent links, search slot |
| cmp-002 | `ppm-footer` | extend → footer | not approved; block is single-column, source is multi-column |
| cmp-004 | `hero` | reuse | only 2 instances (1%) |
| cmp-010 | `numbertext` | reuse → stats | 48 instances, 8 pages |
| cmp-015 | `disclosureagreement` | new → modal | **unresolved** — needs a legal/compliance owner, not a block decision |
| cmp-018 | `assetclass-list` | **deferred** | capture failed — occluded by the disclosure interstitial, needs recapture |
| cmp-019 | `text-logo` | reuse → columns | 1 page |
| cmp-020 | `text` / article body | reuse | default content, 100% of pages |
| cmp-021 | `image` | reuse | default content `<picture>`, 100% of pages |
| cmp-022 | `title` | reuse | default content heading, 48% of pages |