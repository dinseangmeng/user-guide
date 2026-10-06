# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Guide Studio: a local web app that logs into a target web app with Playwright, screenshots pages, drafts annotated callouts (optionally via AI), and exports user guides as PDF and/or Word, in English and/or Khmer. One project per target web app, one guide per user/role inside it. See `README.md` for the user-facing workflow.

## Commands

```
npm install
npm run setup     # playwright install chromium
cp .env.example .env
npm start         # node --env-file-if-exists=../.env --env-file-if-exists=.env server.js
```

Serves on http://127.0.0.1:4000 (`PORT` env). There is no build step, linter, or test suite. Note: `npm start` also reads `../.env` (parent folder) before `.env`; the README refers to this directory as `studio/`.

Useful env: `HEADLESS=false` shows the capture browser; `STUDIO_DATA` overrides the data dir (default `data/`); AI needs both `ALLOW_CLOUD_AI=true` and `OPENROUTER_API_KEY` (model via `DRAFT_MODEL`, OpenRouter; optional `EXPLORE_MODEL`, `REVIEW_MODEL`, `EXPLORE_MAX` for the planner/supervisor).

## Architecture

Plain Node (CommonJS), no framework, no bundler. Frontend is vanilla JS in `public/` (`app.js` = projects/review UI, `doc.js` = Document tab).

- `server.js` — hand-rolled HTTP server with a tiny `route(method, pattern, handler)` registry (`:param` patterns), all under `/api/projects/:pid/users/:uid/...`; also serves `public/`, generated files, and screenshots. Long operations (discover, draft-all, generate, recapture) are enqueued as jobs and polled via `/api/jobs`.
- `lib/store.js` — JSON-file persistence. Layout: `data/projects/<pid>/project.json` and `users/<uid>/{guide.json,document.json,raw/,elements/,out/images/,out/documents/}`. Writes are atomic (tmp + rename). IDs are validated by `assertId` (path-traversal guard). Passwords are stored in plain text (data/ is git-ignored).
- `lib/jobs.js` — single-worker in-memory FIFO queue; also tracks per-feature "busy" flags so the UI can disable items mid-capture.
- `lib/pipeline.js` — orchestrates the job bodies: capture → AI draft → render → build documents. Generation only re-shoots pages whose render hash changed (`render.js` `renderHash`) unless "re-shoot all" is set.
- `lib/capture.js` — Playwright: logs in with the project's three selectors, loads each route (`routes.js` resolves `/view/:id` params), takes the raw screenshot and collects interactive elements/selectors.
- `lib/explore.js` — click exploration: an AI "planner" (`ai.planClicks`) picks buttons/tabs worth clicking; each is clicked on a fresh page load, and if the screen changes (and the URL doesn't) it is saved as a child feature (`parentId`, `trigger`, `actions` = parent actions + the click) with `isNew` flags on elements, then drafted. Depth is 1; unsafe/navigating/input elements are skipped. After every draft, `ai.superviseFeature` (a "supervisor" model, disable with `REVIEW=false`) corrects the callouts and stores notes in `feature.review`.
- `lib/render.js` — draws numbered red overlay boxes onto the live page for each callout selector and screenshots to `out/images`; selectors that no longer resolve are recorded as `missing` (shown as "element not found", dropped from output).
- `lib/ai.js` — OpenRouter calls: per-page draft (screenshot + element list → 3–8 callouts, bilingual en/km, must use only supplied selectors) and System Overview draft.
- `lib/docstore.js` / `lib/docmodel.js` — document structure (cover, sections, page order/nesting, chapter numbering) and `docmodel.build(pid, uid, lang)`, which produces the language-specific model consumed by both exporters. Only approved, successfully rendered pages are included.
- `lib/html.js` + `lib/pdf.js` — PDF: model → HTML → Chromium print (A4, bookmarks/page numbers via pdf-lib); embeds fonts from `fonts/`. `lib/docx.js` — Word via `docx` + `jszip` (TOC page numbers are fields). `lib/labels.js` holds fixed bilingual UI/document strings.
- `lib/safety.js` — blocks capture clicks on destructive-looking text (delete, submit, logout, approve, Khmer equivalents). Keep this in mind when adding any auto-click behavior.

All user-visible text is stored as `{en, km}` pairs; `docmodel` falls back to `en` when `km` is empty.

## Notes

- Khmer PDFs need a Khmer font on the host or a `.ttf/.otf/.woff` in `fonts/` (a filename containing "Bold" is used for bold).
- `.env`, `.env_back` and `data/` contain credentials; do not print or commit them. `.gitignore` currently only lists `data`.
