const fs = require('fs');
const path = require('path');
const store = require('./store');
const { resolveRoute, effectiveParams } = require('./routes');

const DEFAULT_ACCENT = '#1d4ed8';
const LOGO = /^logo\.(png|jpg)$/;

function docFile(pid, uid) {
  return path.join(store.userDir(pid, uid), 'document.json');
}

function readRaw(pid, uid) {
  const raw = store.readJson(docFile(pid, uid), {});
  return {
    settings: raw.settings || {},
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    outline: Array.isArray(raw.outline) ? raw.outline : [],
  };
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function pair(v, max) {
  return { en: str(v && v.en, max), km: str(v && v.km, max) };
}

function cleanFont(v) {
  return str(v, 80).replace(/["'\\;{}<>]/g, '');
}

function sanitizeSettings(input, base) {
  const out = { ...base };
  if (!input || typeof input !== 'object') return out;
  if (input.title !== undefined) out.title = pair(input.title, 200);
  if (input.subtitle !== undefined) out.subtitle = pair(input.subtitle, 200);
  if (input.org !== undefined) out.org = pair(input.org, 200);
  if (input.overview !== undefined) out.overview = pair(input.overview, 8000);
  if (input.version !== undefined) out.version = str(input.version, 40);
  if (input.date !== undefined) out.date = str(input.date, 40);
  if (input.font !== undefined) out.font = cleanFont(input.font);
  if (input.accent !== undefined) out.accent = /^#[0-9a-fA-F]{6}$/.test(input.accent) ? input.accent : DEFAULT_ACCENT;
  return out;
}

function idOk(v) {
  return typeof v === 'string' && /^[\w-]{1,60}$/.test(v);
}

function sanitizeStructure(input) {
  const groups = [];
  (Array.isArray(input.groups) ? input.groups : []).forEach((g) => {
    if (!g || !idOk(g.id)) return;
    groups.push({
      id: g.id,
      name: pair(g.name, 120),
      pageIds: (Array.isArray(g.pageIds) ? g.pageIds : []).filter(idOk),
    });
  });
  const outline = [];
  (Array.isArray(input.outline) ? input.outline : []).forEach((o) => {
    if (o && (o.t === 'g' || o.t === 'p') && idOk(o.id)) outline.push({ t: o.t, id: o.id });
  });
  return { groups, outline };
}

function normalize(raw, ids) {
  const valid = new Set(ids);
  const placed = new Set();
  const groups = [];
  const seenGroups = new Set();

  raw.groups.forEach((g) => {
    if (seenGroups.has(g.id)) return;
    seenGroups.add(g.id);
    const pageIds = [];
    g.pageIds.forEach((id) => {
      if (valid.has(id) && !placed.has(id)) {
        placed.add(id);
        pageIds.push(id);
      }
    });
    groups.push({ id: g.id, name: g.name || { en: '', km: '' }, pageIds });
  });

  const byId = new Set(groups.map((g) => g.id));
  const outline = [];
  const seenNodes = new Set();

  raw.outline.forEach((o) => {
    if (o.t === 'g') {
      if (byId.has(o.id) && !seenNodes.has('g' + o.id)) {
        seenNodes.add('g' + o.id);
        outline.push({ t: 'g', id: o.id });
      }
    } else if (valid.has(o.id) && !placed.has(o.id)) {
      placed.add(o.id);
      outline.push({ t: 'p', id: o.id });
    }
  });

  groups.forEach((g) => {
    if (!seenNodes.has('g' + g.id)) outline.push({ t: 'g', id: g.id });
  });

  ids.forEach((id) => {
    if (!placed.has(id)) {
      placed.add(id);
      outline.push({ t: 'p', id });
    }
  });

  return { groups, outline };
}

function defaults(project, user) {
  return {
    title: { en: project.name + ' User Guide', km: 'ការណែនាំអ្នកប្រើប្រាស់ ' + project.name },
    subtitle: { en: 'For ' + user.name, km: 'សម្រាប់ ' + user.name },
    org: { en: '', km: '' },
    overview: { en: '', km: '' },
    version: '1.0',
    date: '',
    accent: DEFAULT_ACCENT,
    font: '',
  };
}

function findLogo(pid, uid) {
  const dir = store.userDir(pid, uid);
  if (!fs.existsSync(dir)) return null;
  const name = fs.readdirSync(dir).find((n) => LOGO.test(n));
  return name ? { name, file: path.join(dir, name) } : null;
}

function listOutputs(pid, uid) {
  const dir = path.join(store.userDir(pid, uid), 'out', 'documents');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /\.(pdf|docx)$/.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, at: st.mtimeMs };
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);
}

function approvedFeatures(pid, uid) {
  return store.getGuide(pid, uid).features.filter((f) => f.status === 'approved' && f.capturedAt);
}

function projectAndUser(pid, uid) {
  const project = store.getProject(pid);
  if (!project) throw store.httpError(404, 'Project not found');
  const user = project.users.find((u) => u.id === uid);
  if (!user) throw store.httpError(404, 'User not found');
  return { project, user };
}

function view(pid, uid) {
  const { project, user } = projectAndUser(pid, uid);
  const approved = approvedFeatures(pid, uid);
  const raw = readRaw(pid, uid);
  const structure = normalize(raw, approved.map((f) => f.id));
  const logo = findLogo(pid, uid);
  return {
    settings: sanitizeSettings(raw.settings, defaults(project, user)),
    groups: structure.groups,
    outline: structure.outline,
    pages: approved.map((f) => ({
      id: f.id,
      name: f.name,
      route: resolveRoute(f.route, effectiveParams(project, f)),
      capturedAt: f.capturedAt,
    })),
    logo: logo ? logo.name : '',
    logoAt: logo ? fs.statSync(logo.file).mtimeMs : 0,
  };
}

function fullView(pid, uid) {
  return { ...view(pid, uid), outputs: listOutputs(pid, uid) };
}

function save(pid, uid, input) {
  const { project, user } = projectAndUser(pid, uid);
  const raw = readRaw(pid, uid);
  const settings = input.settings !== undefined ? sanitizeSettings(input.settings, sanitizeSettings(raw.settings, defaults(project, user))) : raw.settings;
  let groups = raw.groups;
  let outline = raw.outline;
  if (input.groups !== undefined || input.outline !== undefined) {
    const s = sanitizeStructure(input);
    groups = s.groups;
    outline = s.outline;
  }
  store.writeJson(docFile(pid, uid), { settings, groups, outline });
  return fullView(pid, uid);
}

function removeLogo(pid, uid) {
  const dir = store.userDir(pid, uid);
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir)
    .filter((n) => LOGO.test(n))
    .forEach((n) => fs.rmSync(path.join(dir, n), { force: true }));
}

function saveLogo(pid, uid, dataUrl) {
  projectAndUser(pid, uid);
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw store.httpError(400, 'Logo must be a PNG or JPEG image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw store.httpError(400, 'Logo must be smaller than 2 MB');
  removeLogo(pid, uid);
  store.ensure(store.userDir(pid, uid));
  fs.writeFileSync(path.join(store.userDir(pid, uid), m[1] === 'png' ? 'logo.png' : 'logo.jpg'), buf);
}

function readLogo(pid, uid) {
  const logo = findLogo(pid, uid);
  if (!logo) return null;
  return { buffer: fs.readFileSync(logo.file), ext: logo.name.endsWith('png') ? 'png' : 'jpg' };
}

module.exports = {
  DEFAULT_ACCENT,
  view,
  fullView,
  save,
  saveLogo,
  removeLogo,
  readLogo,
  listOutputs,
  projectAndUser,
};
