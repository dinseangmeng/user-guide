const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const htmlBuilder = require('./html');

function pdfLib() {
  try {
    return require('pdf-lib');
  } catch (e) {
    return null;
  }
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function outlinePages(buffer) {
  const lib = pdfLib();
  if (!lib) return null;
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } = lib;
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i + 1]));
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!root) return [];
  const out = [];

  const destPage = (item) => {
    let dest = item.get(PDFName.of('Dest'));
    if (!dest) {
      const action = item.lookupMaybe(PDFName.of('A'), PDFDict);
      dest = action ? action.get(PDFName.of('D')) : null;
    }
    if (dest instanceof PDFRef) dest = doc.context.lookup(dest);
    if (!(dest instanceof PDFArray)) return 0;
    const first = dest.get(0);
    return first ? pageIndex.get(first.toString()) || 0 : 0;
  };

  const walk = (item) => {
    let cur = item;
    while (cur) {
      const title = cur.lookupMaybe(PDFName.of('Title'), lib.PDFString, lib.PDFHexString);
      out.push({ title: norm(title ? title.decodeText() : ''), page: destPage(cur) });
      const child = cur.lookupMaybe(PDFName.of('First'), PDFDict);
      if (child) walk(child);
      cur = cur.lookupMaybe(PDFName.of('Next'), PDFDict);
    }
  };

  const first = root.lookupMaybe(PDFName.of('First'), PDFDict);
  if (first) walk(first);
  return out;
}

function matchNumbers(outline, headings) {
  const numbers = {};
  let cursor = 0;
  let missing = 0;
  headings.forEach((h) => {
    const want = norm(h.text);
    let found = -1;
    for (let i = cursor; i < outline.length; i++) {
      if (outline[i].page && norm(outline[i].title).endsWith(want)) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      if (h.anchor) missing++;
      return;
    }
    cursor = found + 1;
    if (h.anchor) numbers[h.anchor] = outline[found].page;
  });
  return { numbers, missing };
}

async function build(model, outFile, log) {
  const buildDir = path.join(path.dirname(outFile), '_build');
  fs.mkdirSync(buildDir, { recursive: true });
  const htmlFile = path.join(buildDir, 'index.html');

  const browser = await chromium.launch();
  let pdf;
  try {
    const page = await browser.newPage();
    let numbers = {};
    let numbered = !!pdfLib();
    if (!numbered) log('pdf-lib is not installed, so the table of contents will have no page numbers. Run npm install.');

    for (let pass = 0; pass < 4; pass++) {
      const built = htmlBuilder.build(model, numbers);
      fs.writeFileSync(htmlFile, built.html);
      await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
      if (!numbered) break;

      const outline = await outlinePages(pdf);
      const match = matchNumbers(outline, built.headings);
      if (match.missing) {
        log('Could not read ' + match.missing + ' page number(s) from the PDF outline');
      }
      if (JSON.stringify(match.numbers) === JSON.stringify(numbers)) break;
      numbers = match.numbers;
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(outFile, pdf);
  fs.rmSync(buildDir, { recursive: true, force: true });
}

module.exports = { build, outlinePages };
