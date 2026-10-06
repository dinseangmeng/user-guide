# Guide Studio

Local web app for building annotated user guides as PDF or Word. One project per web app, one guide per user (role) inside it.

## Install

```
cd studio
npm install
npm run setup
cp .env.example .env
npm start
```

Open http://localhost:4000. `npm start` reads the parent folder's `.env` first, then `studio/.env`, which wins on any overlap.

## .env (AI settings only)

```
ALLOW_CLOUD_AI=true
OPENROUTER_API_KEY=sk-or-...
DRAFT_MODEL=google/gemini-2.5-flash
PORT=4000
```

Login settings (URL, field selectors, viewport) are set per project in the UI. With `ALLOW_CLOUD_AI` not true, everything works except AI drafting.

## Workflow

1. **New project**: name, app URL, login path, the three login selectors.
2. **Add user**: label, username, password. Each user gets a tab and their own guide.
3. **Review tab**: Discover pages, then approve or reject each page, edit text and callouts, add dynamic routes (`/view/:id` with a sample value), Re-shoot or Re-draft single pages.
4. **Document tab** (only approved pages appear):
   - Drag the handle to reorder pages and sections. Drop a page on a section to put it inside. The numbers are the chapter numbers in the document (1, 1.1, 1.2, 2...).
   - `+ Add section` creates a group. `Auto-group by URL` creates sections from pages that share the first part of their URL. The "Move to..." menu and the arrow buttons do the same as dragging.
   - Fill in the cover (title, subtitle, organization, version, date, accent color, logo) and the System overview. `Draft with AI` writes a first overview from your page list.
   - Choose PDF and/or Word, English and/or Khmer, then `Generate`. One file is made per format and language.
5. Files appear under **Files** and are saved in `studio/data/projects/<project>/users/<user>/out/documents/`.

Generating only re-shoots pages that changed since the last time. Tick "Re-shoot every page first" to refresh all of them.

## What is in the document

Cover, table of contents, System overview, then one chapter per section or page, each with the annotated screenshot and the numbered callout list.

- **PDF**: the table of contents is clickable and shows page numbers, the PDF has bookmarks, A4, footer with title and page number (none on the cover).
- **Word**: the table of contents is clickable, headings use Word's Heading 1 and 2 (Navigation Pane works). The page numbers in the contents are fields: when Word asks to update fields on opening, answer Yes.

## Khmer text

PDFs are made with the Chromium that Playwright installs, so Khmer needs a Khmer font on the computer that runs the studio. Mac has "Khmer Sangam MN". For the same look everywhere, put a font file (for example `NotoSansKhmer-Regular.ttf`, and a file with `Bold` in its name for bold) into `studio/fonts/`. It is embedded into every PDF.

For Word, type a font name that is installed on the reader's computer in "Khmer font name" (default `Noto Sans Khmer`; Windows has `Khmer UI`, Mac has `Khmer Sangam MN`).

The fixed words (Table of Contents, System Overview, Version, Date) are in `lib/labels.js` if you want to change the Khmer wording.

## Notes

- The server only listens on 127.0.0.1. Passwords are stored in plain text in `data/`, which is git-ignored. Use dedicated staging accounts with fake data.
- A callout marked "element not found" in Review, or missing from the document, means the element is gone after a re-shoot.
- Clicks on delete, approve, submit and logout style buttons are blocked.
- A wrong password takes about 30 seconds to fail. The failed login screen is saved as `login-failed.png` in the user folder.
