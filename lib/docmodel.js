const path = require('path');
const store = require('./store');
const docstore = require('./docstore');
const { LABELS, formatDate } = require('./labels');

function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

function build(pid, uid, lang) {
  const view = docstore.view(pid, uid);
  const guide = store.getGuide(pid, uid);
  const features = new Map(guide.features.map((f) => [f.id, f]));
  const pick = (p) => (p && (p[lang] || p.en)) || '';
  const labels = LABELS[lang];
  const imageDir = path.join(store.userDir(pid, uid), 'out', 'images');

  const rendered = (id) => {
    const f = features.get(id);
    const r = guide.renders[id];
    return f && r && r.ok ? f : null;
  };

  const pageEntry = (f, num, level, first) => {
    const missing = new Set((guide.renders[f.id] || {}).missing || []);
    return {
      kind: 'page',
      id: f.id,
      anchor: 's-' + f.id,
      num,
      level,
      first: !!first,
      title: pick(f.name) || f.route,
      image: path.join(imageDir, f.id + '.png'),
      items: f.items
        .map((it, i) => ({ n: i + 1, selector: it.selector, title: pick(it.title), description: pick(it.description) }))
        .filter((it) => !missing.has(it.selector) && (it.title || it.description)),
    };
  };

  const entries = [];
  let n = 0;
  view.outline.forEach((o) => {
    if (o.t === 'g') {
      const g = view.groups.find((x) => x.id === o.id);
      const pages = g.pageIds.map(rendered).filter(Boolean);
      if (!pages.length) return;
      n++;
      entries.push({ kind: 'group', id: g.id, anchor: 's-' + g.id, num: String(n), level: 1, title: pick(g.name) || labels.untitledGroup });
      pages.forEach((f, i) => entries.push(pageEntry(f, n + '.' + (i + 1), 2, i === 0)));
    } else {
      const f = rendered(o.id);
      if (!f) return;
      n++;
      entries.push(pageEntry(f, String(n), 1, false));
    }
  });

  const s = view.settings;
  const logo = docstore.readLogo(pid, uid);
  return {
    lang,
    labels,
    settings: {
      title: pick(s.title) || labels.guide,
      subtitle: pick(s.subtitle),
      org: pick(s.org),
      version: s.version,
      date: s.date || formatDate(lang),
      accent: s.accent,
      font: s.font,
      overview: paragraphs(pick(s.overview)),
    },
    logo,
    entries,
  };
}

module.exports = { build };
