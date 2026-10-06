const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FALLBACKS = [
  '"Helvetica Neue"',
  'Arial',
  '"Noto Sans Khmer"',
  '"Khmer OS Battambang"',
  '"Khmer Sangam MN"',
  '"Leelawadee UI"',
  '"Khmer UI"',
  'sans-serif',
];

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cssString(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
}

function fontFaces() {
  if (!fs.existsSync(FONT_DIR)) return { css: '', names: [] };
  const mime = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  const files = fs.readdirSync(FONT_DIR).filter((n) => mime[path.extname(n).toLowerCase()]);
  let css = '';
  files.forEach((n) => {
    const ext = path.extname(n).toLowerCase();
    const data = fs.readFileSync(path.join(FONT_DIR, n)).toString('base64');
    const weight = /bold/i.test(n) ? 700 : 400;
    css += '@font-face{font-family:"StudioFont";font-weight:' + weight + ';src:url(data:' + mime[ext] + ';base64,' + data + ');}\n';
  });
  return { css, names: files.length ? ['"StudioFont"'] : [] };
}

function logoUrl(logo) {
  if (!logo) return '';
  return 'data:image/' + (logo.ext === 'png' ? 'png' : 'jpeg') + ';base64,' + logo.buffer.toString('base64');
}

function css(model, fonts) {
  const s = model.settings;
  const stack = [...(s.font ? [cssString(s.font)] : []), ...fonts.names, ...FALLBACKS].join(',');
  const footer = cssString(s.title);
  return (
    fonts.css +
    ':root{--accent:' + s.accent + ';--font:' + stack + ';--ink:#1f2937;--muted:#6b7280;--line:#d1d5db;--mark:#e11d48}\n' +
    '@page{size:A4;margin:18mm 16mm 20mm;' +
    '@bottom-left{content:' + footer + ';font-family:' + stack + ';font-size:8.5pt;color:#6b7280}' +
    '@bottom-right{content:counter(page) " / " counter(pages);font-family:' + stack + ';font-size:8.5pt;color:#6b7280}}\n' +
    '@page:first{margin:0;@bottom-left{content:none}@bottom-right{content:none}}\n' +
    '*{box-sizing:border-box}\n' +
    'html,body{margin:0;padding:0}\n' +
    'body{font-family:var(--font);font-size:10.5pt;line-height:1.55;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}\n' +
    '.cover{position:relative;width:210mm;height:297mm;break-after:page;overflow:hidden;background:#fff}\n' +
    '.cover .top{background:var(--accent);color:#fff;height:165mm;padding:26mm 22mm 0}\n' +
    '.cover .logo{display:block;height:18mm;max-width:70mm;object-fit:contain;background:#fff;padding:3mm;border-radius:3mm}\n' +
    '.cover .kicker{margin-top:' + (model.logo ? '38mm' : '56mm') + ';font-size:11pt;letter-spacing:.14em;text-transform:uppercase;opacity:.85}\n' +
    '.cover .ctitle{font-size:34pt;font-weight:700;line-height:1.25;margin-top:6mm}\n' +
    '.cover .csub{font-size:15pt;margin-top:7mm;opacity:.92}\n' +
    '.cover .foot{padding:16mm 22mm}\n' +
    '.cover .org{font-size:15pt;font-weight:700;margin-bottom:8mm}\n' +
    '.cover .meta{display:flex;gap:16mm}\n' +
    '.cover .meta div{font-size:10.5pt}\n' +
    '.cover .meta small{display:block;color:var(--muted);font-size:8.5pt;letter-spacing:.08em;text-transform:uppercase}\n' +
    'h1,h2{font-weight:700;color:var(--accent);margin:0;line-height:1.3;break-after:avoid}\n' +
    'h1{font-size:21pt;padding-bottom:3mm;border-bottom:.8mm solid var(--accent);margin-bottom:6mm}\n' +
    'h2{font-size:15pt;margin:0 0 4mm}\n' +
    'h1 .num,h2 .num{margin-right:3mm}\n' +
    '.chapter{break-before:page}\n' +
    '.sub{break-before:page}\n' +
    '.sub.first{break-before:avoid;margin-top:2mm}\n' +
    '.chapter>h1+figure{margin-top:0}\n' +
    'figure{margin:0 0 6mm}\n' +
    'figure img{display:block;margin:0 auto;max-width:100%;max-height:128mm;height:auto;border:.3mm solid var(--line);border-radius:1.5mm}\n' +
    '.item{display:flex;gap:3.5mm;align-items:flex-start;margin:0 0 3.4mm;break-inside:avoid}\n' +
    '.badge{flex:none;width:6.2mm;height:6.2mm;margin-top:.6mm;border-radius:50%;background:var(--mark);color:#fff;font-size:8.5pt;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1}\n' +
    '.it{font-weight:700}\n' +
    '.id{color:#374151}\n' +
    '.overview p{margin:0 0 4mm;text-align:left}\n' +
    '.toc .row{display:flex;align-items:baseline;gap:2mm;color:inherit;text-decoration:none;padding:1.1mm 0}\n' +
    '.toc .lead{flex:1;border-bottom:.3mm dotted #9ca3af;transform:translateY(-1mm);min-width:6mm}\n' +
    '.toc .pg{min-width:14mm;text-align:right;font-variant-numeric:tabular-nums}\n' +
    '.toc .lvl1{font-weight:700;margin-top:1.6mm}\n' +
    '.toc .lvl2{margin-left:8mm;font-size:10pt}\n'
  );
}

function build(model, numbers) {
  const s = model.settings;
  const L = model.labels;
  const nums = numbers || {};
  const fonts = fontFaces();
  const headings = [];
  const body = [];

  const logo = logoUrl(model.logo);
  const meta =
    '<div><small>' + esc(L.version) + '</small>' + esc(s.version) + '</div>' +
    '<div><small>' + esc(L.date) + '</small>' + esc(s.date) + '</div>';
  body.push(
    '<section class="cover"><div class="top">' + (logo ? '<img class="logo" src="' + logo + '" alt="">' : '') +
    '<div class="kicker">' + esc(L.guide) + '</div><div class="ctitle">' + esc(s.title) + '</div>' +
    (s.subtitle ? '<div class="csub">' + esc(s.subtitle) + '</div>' : '') +
    '</div><div class="foot">' + (s.org ? '<div class="org">' + esc(s.org) + '</div>' : '') + '<div class="meta">' + meta + '</div></div></section>'
  );

  const tocRows = [];
  if (s.overview.length) tocRows.push({ anchor: 's-overview', text: L.overview, level: 1 });
  model.entries.forEach((e) => tocRows.push({ anchor: e.anchor, text: e.num + '  ' + e.title, level: e.level }));

  headings.push({ anchor: null, text: L.contents });
  body.push(
    '<section class="chapter toc"><h1>' + esc(L.contents) + '</h1>' +
    tocRows
      .map(
        (r) =>
          '<a class="row lvl' + r.level + '" href="#' + esc(r.anchor) + '"><span class="txt">' + esc(r.text) +
          '</span><span class="lead"></span><span class="pg">' + (nums[r.anchor] || '') + '</span></a>'
      )
      .join('') +
    '</section>'
  );

  if (s.overview.length) {
    headings.push({ anchor: 's-overview', text: L.overview });
    body.push(
      '<section class="chapter overview"><h1 id="s-overview">' + esc(L.overview) + '</h1>' +
      s.overview.map((p) => '<p>' + esc(p) + '</p>').join('') + '</section>'
    );
  }

  const pageBody = (e) =>
    '<figure><img src="' + pathToFileURL(e.image).href + '" alt=""></figure>' +
    e.items
      .map(
        (it) =>
          '<div class="item"><span class="badge">' + it.n + '</span><div><div class="it">' + esc(it.title) + '</div>' +
          (it.description ? '<div class="id">' + esc(it.description) + '</div>' : '') + '</div></div>'
      )
      .join('');

  let open = false;
  model.entries.forEach((e) => {
    headings.push({ anchor: e.anchor, text: e.title });
    if (e.kind === 'group') {
      if (open) body.push('</section>');
      body.push('<section class="chapter"><h1 id="' + esc(e.anchor) + '"><span class="num">' + esc(e.num) + '</span>' + esc(e.title) + '</h1>');
      open = true;
    } else if (e.level === 2) {
      body.push(
        '<section class="sub' + (e.first ? ' first' : '') + '"><h2 id="' + esc(e.anchor) + '"><span class="num">' + esc(e.num) + '</span>' +
        esc(e.title) + '</h2>' + pageBody(e) + '</section>'
      );
    } else {
      if (open) {
        body.push('</section>');
        open = false;
      }
      body.push(
        '<section class="chapter"><h1 id="' + esc(e.anchor) + '"><span class="num">' + esc(e.num) + '</span>' + esc(e.title) + '</h1>' +
        pageBody(e) + '</section>'
      );
    }
  });
  if (open) body.push('</section>');

  const html =
    '<!doctype html><html lang="' + model.lang + '"><head><meta charset="utf-8"><title>' + esc(s.title) + '</title><style>' +
    css(model, fonts) + '</style></head><body>' + body.join('\n') + '</body></html>';
  return { html, headings };
}

module.exports = { build };
