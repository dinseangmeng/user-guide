const fs = require('fs');
const D = require('docx');
const JSZip = require('jszip');

const CONTENT_WIDTH = 9638;
const MAX_IMAGE_PX = 590;

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function bookmarkId(anchor) {
  return 'b_' + anchor.replace(/[^A-Za-z0-9]+/g, '_');
}

function hex(color) {
  return color.replace('#', '').toUpperCase();
}

async function build(model, outFile) {
  const s = model.settings;
  const L = model.labels;
  const accent = hex(s.accent);
  const kh = s.font || 'Noto Sans Khmer';
  const font = { ascii: 'Arial', hAnsi: 'Arial', cs: kh, eastAsia: kh };

  const run = (text, opts) => new D.TextRun({ text, font, ...(opts || {}) });

  const heading = (level, num, title, anchor, breakBefore) =>
    new D.Paragraph({
      heading: level === 1 ? D.HeadingLevel.HEADING_1 : D.HeadingLevel.HEADING_2,
      pageBreakBefore: !!breakBefore,
      children: [new D.Bookmark({ id: bookmarkId(anchor), children: [run((num ? num + '  ' : '') + title)] })],
    });

  const cover = [];
  if (model.logo) {
    const size = model.logo.ext === 'png' ? pngSize(model.logo.buffer) : { width: 300, height: 100 };
    const h = 70;
    const w = Math.min(240, Math.round((size.width / size.height) * h));
    cover.push(
      new D.Paragraph({
        spacing: { after: 1400 },
        children: [new D.ImageRun({ type: model.logo.ext === 'png' ? 'png' : 'jpg', data: model.logo.buffer, transformation: { width: w, height: Math.round((w / size.width) * size.height) } })],
      })
    );
  } else {
    cover.push(new D.Paragraph({ spacing: { after: 2200 }, children: [] }));
  }
  cover.push(
    new D.Paragraph({ spacing: { after: 160 }, children: [run(L.guide.toUpperCase(), { size: 22, color: '6B7280', characterSpacing: 40 })] }),
    new D.Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 18, color: accent, space: 12 } },
      children: [run(s.title, { size: 68, bold: true, color: accent })],
    })
  );
  if (s.subtitle) cover.push(new D.Paragraph({ spacing: { before: 200, after: 200 }, children: [run(s.subtitle, { size: 30, color: '374151' })] }));
  cover.push(new D.Paragraph({ spacing: { before: 2600 }, children: [] }));
  if (s.org) cover.push(new D.Paragraph({ spacing: { after: 200 }, children: [run(s.org, { size: 30, bold: true })] }));
  cover.push(
    new D.Paragraph({ children: [run(L.version + ': ', { color: '6B7280' }), run(s.version, { bold: true }), run('      ' + L.date + ': ', { color: '6B7280' }), run(s.date, { bold: true })] })
  );

  const main = [];
  main.push(new D.Paragraph({ style: 'TocTitle', children: [run(L.contents)] }));

  const tocRows = [];
  if (s.overview.length) tocRows.push({ anchor: 's-overview', text: L.overview, level: 1 });
  model.entries.forEach((e) => tocRows.push({ anchor: e.anchor, text: e.num + '  ' + e.title, level: e.level }));

  tocRows.forEach((r) => {
    main.push(
      new D.Paragraph({
        spacing: { before: r.level === 1 ? 140 : 40, after: 40 },
        indent: { left: r.level === 2 ? 480 : 0 },
        tabStops: [{ type: D.TabStopType.RIGHT, position: CONTENT_WIDTH, leader: D.LeaderType.DOT }],
        children: [
          new D.InternalHyperlink({ anchor: bookmarkId(r.anchor), children: [run(r.text, { bold: r.level === 1, color: '1F2937' })] }),
          run('\t'),
          new D.PageReference(bookmarkId(r.anchor)),
        ],
      })
    );
  });

  if (s.overview.length) {
    main.push(heading(1, '', L.overview, 's-overview', true));
    s.overview.forEach((p) => main.push(new D.Paragraph({ spacing: { after: 160, line: 320 }, children: [run(p)] })));
  }

  const pageBlock = (e) => {
    const out = [];
    const buf = fs.readFileSync(e.image);
    const size = pngSize(buf);
    const width = Math.min(MAX_IMAGE_PX, size.width);
    const height = Math.round((width / size.width) * size.height);
    out.push(
      new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        spacing: { before: 80, after: 200 },
        keepNext: true,
        children: [new D.ImageRun({ type: 'png', data: buf, transformation: { width, height } })],
      })
    );
    e.items.forEach((it) => {
      out.push(
        new D.Paragraph({
          spacing: { after: 100 },
          indent: { left: 420, hanging: 420 },
          keepLines: true,
          children: [
            run(it.n + '.', { bold: true, color: 'E11D48' }),
            run('\t'),
            run(it.title, { bold: true }),
            ...(it.description ? [run(' – ' + it.description, { color: '374151' })] : []),
          ],
          tabStops: [{ type: D.TabStopType.LEFT, position: 420 }],
        })
      );
    });
    return out;
  };

  model.entries.forEach((e) => {
    if (e.kind === 'group') {
      main.push(heading(1, e.num, e.title, e.anchor, true));
    } else if (e.level === 2) {
      main.push(heading(2, e.num, e.title, e.anchor, !e.first));
      pageBlock(e).forEach((p) => main.push(p));
    } else {
      main.push(heading(1, e.num, e.title, e.anchor, true));
      pageBlock(e).forEach((p) => main.push(p));
    }
  });

  const footer = new D.Footer({
    children: [
      new D.Paragraph({
        tabStops: [{ type: D.TabStopType.RIGHT, position: CONTENT_WIDTH }],
        children: [
          run(s.title, { size: 17, color: '6B7280' }),
          run('\t'),
          new D.TextRun({ children: [D.PageNumber.CURRENT], font, size: 17, color: '6B7280' }),
        ],
      }),
    ],
  });

  const page = { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } };

  const doc = new D.Document({
    creator: s.org || 'Guide Studio',
    title: s.title,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font, size: 21 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font, size: 42, bold: true, color: accent },
          paragraph: { spacing: { before: 0, after: 240 }, outlineLevel: 0, keepNext: true, border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: accent, space: 6 } } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font, size: 30, bold: true, color: accent },
          paragraph: { spacing: { before: 120, after: 160 }, outlineLevel: 1, keepNext: true },
        },
        {
          id: 'TocTitle',
          name: 'Contents Title',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font, size: 42, bold: true, color: accent },
          paragraph: { spacing: { after: 240 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: accent, space: 6 } } },
        },
      ],
    },
    sections: [
      { properties: { page: { size: page.size, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: cover },
      { properties: { page: { ...page, pageNumbers: { start: 1 } } }, footers: { default: footer }, children: main },
    ],
  });

  const zip = await JSZip.loadAsync(await D.Packer.toBuffer(doc));
  const xml = await zip.file('word/document.xml').async('string');
  let n = 0;
  const fixed = xml.replace(/<w:bookmarkStart ([^>]*?)w:id="\d+"([^>]*)\/>|<w:bookmarkEnd w:id="\d+"\/>/g, (m, a, b) => {
    if (a === undefined) return '<w:bookmarkEnd w:id="' + n + '"/>';
    n++;
    return '<w:bookmarkStart ' + a + 'w:id="' + n + '"' + b + '/>';
  });
  zip.file('word/document.xml', fixed);
  fs.writeFileSync(outFile, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

module.exports = { build };
