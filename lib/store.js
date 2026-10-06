const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { slug, missingParams, resolveRoute, effectiveParams } = require('./routes');

const DATA = process.env.STUDIO_DATA || path.join(__dirname, '..', 'data');
const PROJECTS = path.join(DATA, 'projects');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function assertId(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id || '')) throw httpError(400, 'Bad id');
  return id;
}

function newId(prefix) {
  return prefix + crypto.randomBytes(4).toString('hex');
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensure(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function projectDir(pid) {
  return path.join(PROJECTS, assertId(pid));
}

function userDir(pid, uid) {
  return path.join(projectDir(pid), 'users', assertId(uid));
}

function text(v, fallback) {
  return typeof v === 'string' ? v.trim() : fallback === undefined ? '' : fallback;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 200 ? Math.round(n) : fallback;
}

function cleanUrl(u) {
  return text(u).replace(/\/+$/, '');
}

function cleanPath(p, fallback) {
  const v = text(p, fallback) || fallback;
  return v.startsWith('/') ? v : '/' + v;
}

function projectFile(pid) {
  return path.join(projectDir(pid), 'project.json');
}

function getProject(pid) {
  return readJson(projectFile(pid), null);
}

function listProjects() {
  if (!fs.existsSync(PROJECTS)) return [];
  return fs
    .readdirSync(PROJECTS)
    .map((id) => readJson(path.join(PROJECTS, id, 'project.json'), null))
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: p.name, appUrl: p.appUrl, userCount: p.users.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function publicProject(p) {
  return {
    ...p,
    users: p.users.map((u) => ({ id: u.id, name: u.name, username: u.username, hasPassword: !!u.password })),
  };
}

function cleanVariables(v) {
  const out = {};
  if (v && typeof v === 'object') {
    Object.keys(v).forEach((k) => {
      const val = typeof v[k] === 'string' ? v[k].trim() : '';
      if (/^[A-Za-z0-9_]{1,40}$/.test(k) && val) out[k] = val;
    });
  }
  return out;
}

function applyProjectInput(base, input) {
  const vp = input.viewport || {};
  const out = {
    ...base,
    name: text(input.name, base.name) || base.name,
    appUrl: input.appUrl !== undefined ? cleanUrl(input.appUrl) : base.appUrl,
    loginPath: input.loginPath !== undefined ? cleanPath(input.loginPath, '/login') : base.loginPath,
    userSelector: text(input.userSelector, base.userSelector) || base.userSelector,
    passSelector: text(input.passSelector, base.passSelector) || base.passSelector,
    submitSelector: text(input.submitSelector, base.submitSelector) || base.submitSelector,
    context: input.context !== undefined ? text(input.context) : base.context,
    variables: input.variables !== undefined ? cleanVariables(input.variables) : base.variables || {},
    viewport: {
      width: num(vp.width, base.viewport.width),
      height: num(vp.height, base.viewport.height),
    },
  };
  if (!/^https?:\/\//.test(out.appUrl)) throw httpError(400, 'App URL must start with http:// or https://');
  return out;
}

function createProject(input) {
  const name = text(input.name);
  if (!name) throw httpError(400, 'Project name is required');
  const base = {
    id: '',
    name,
    appUrl: '',
    loginPath: '/login',
    userSelector: '#username',
    passSelector: '#password',
    submitSelector: 'button[type=submit]',
    context: '',
    viewport: { width: 1440, height: 900 },
    users: [],
    createdAt: Date.now(),
  };
  const project = applyProjectInput(base, input);
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  project.id = stem + '-' + crypto.randomBytes(2).toString('hex');
  writeJson(projectFile(project.id), project);
  return project;
}

function updateProject(pid, input) {
  const current = getProject(pid);
  if (!current) throw httpError(404, 'Project not found');
  const next = applyProjectInput(current, input);
  writeJson(projectFile(pid), next);
  return next;
}

function deleteProject(pid) {
  fs.rmSync(projectDir(pid), { recursive: true, force: true });
}

function addUser(pid, input) {
  const project = getProject(pid);
  if (!project) throw httpError(404, 'Project not found');
  const name = text(input.name);
  const username = text(input.username);
  const password = typeof input.password === 'string' ? input.password : '';
  if (!name || !username || !password) throw httpError(400, 'Name, username and password are required');
  const user = { id: newId('u'), name, username, password };
  project.users.push(user);
  writeJson(projectFile(pid), project);
  return user;
}

function updateUser(pid, uid, input) {
  const project = getProject(pid);
  if (!project) throw httpError(404, 'Project not found');
  const user = project.users.find((u) => u.id === uid);
  if (!user) throw httpError(404, 'User not found');
  if (input.name !== undefined && text(input.name)) user.name = text(input.name);
  if (input.username !== undefined && text(input.username)) user.username = text(input.username);
  if (typeof input.password === 'string' && input.password) user.password = input.password;
  writeJson(projectFile(pid), project);
  return user;
}

function deleteUser(pid, uid) {
  const project = getProject(pid);
  if (!project) throw httpError(404, 'Project not found');
  project.users = project.users.filter((u) => u.id !== uid);
  writeJson(projectFile(pid), project);
  fs.rmSync(userDir(pid, uid), { recursive: true, force: true });
}

function guideFile(pid, uid) {
  return path.join(userDir(pid, uid), 'guide.json');
}

function getGuide(pid, uid) {
  const g = readJson(guideFile(pid, uid), null) || {};
  g.features = g.features || [];
  g.renders = g.renders || {};
  return g;
}

function updateGuide(pid, uid, fn) {
  const g = getGuide(pid, uid);
  const result = fn(g);
  writeJson(guideFile(pid, uid), g);
  return result;
}

function getFeature(pid, uid, fid) {
  return getGuide(pid, uid).features.find((f) => f.id === fid) || null;
}

function updateFeature(pid, uid, fid, fn) {
  return updateGuide(pid, uid, (g) => {
    const f = g.features.find((x) => x.id === fid);
    if (!f) return null;
    fn(f);
    return f;
  });
}

function addFeature(pid, uid, input) {
  return updateGuide(pid, uid, (g) => {
    const stem = input.idStem || slug(input.route);
    const ids = new Set(g.features.map((f) => f.id));
    let id = stem;
    let n = 2;
    while (ids.has(id)) id = stem + '-' + n++;
    const given = text(input.name);
    const feature = {
      id,
      name: { en: given || input.route, km: '' },
      nameLocked: !!given,
      route: input.route,
      params: input.params || {},
      status: 'new',
      waitFor: '',
      actions: [],
      items: [],
      capturedAt: 0,
      draftedAt: 0,
      error: '',
      createdAt: Date.now(),
    };
    g.features.push(feature);
    return feature;
  });
}

function rawFile(pid, uid, fid) {
  return path.join(userDir(pid, uid), 'raw', assertId(fid) + '.png');
}

function elementsFile(pid, uid, fid) {
  return path.join(userDir(pid, uid), 'elements', assertId(fid) + '.json');
}

function readElements(pid, uid, fid) {
  return readJson(elementsFile(pid, uid, fid), []);
}

function writeSnapshot(pid, uid, fid, image, elements) {
  const dir = userDir(pid, uid);
  ensure(path.join(dir, 'raw'));
  ensure(path.join(dir, 'elements'));
  fs.writeFileSync(rawFile(pid, uid, fid), image);
  writeJson(elementsFile(pid, uid, fid), elements);
}

function readRawBase64(pid, uid, fid) {
  return fs.readFileSync(rawFile(pid, uid, fid)).toString('base64');
}

function removeFeature(pid, uid, fid) {
  updateGuide(pid, uid, (g) => {
    g.features = g.features.filter((f) => f.id !== fid && f.parentId !== fid);
  });
  fs.rmSync(rawFile(pid, uid, fid), { force: true });
  fs.rmSync(elementsFile(pid, uid, fid), { force: true });
}

function resetGuide(pid, uid) {
  const dir = userDir(pid, uid);
  writeJson(guideFile(pid, uid), { features: [], renders: {} });
  ['raw', 'elements', path.join('out', 'images')].forEach((d) => fs.rmSync(path.join(dir, d), { recursive: true, force: true }));
  const docFile = path.join(dir, 'document.json');
  const doc = readJson(docFile, null);
  if (doc) writeJson(docFile, { ...doc, groups: [], outline: [] });
}

function reorder(pid, uid, ids) {
  updateGuide(pid, uid, (g) => {
    const by = new Map(g.features.map((f) => [f.id, f]));
    const out = [];
    ids.forEach((id) => {
      if (by.has(id)) {
        out.push(by.get(id));
        by.delete(id);
      }
    });
    by.forEach((f) => out.push(f));
    g.features = out;
  });
}

function guideView(pid, uid, isBusy) {
  const project = getProject(pid);
  const guide = getGuide(pid, uid);
  return {
    viewport: project.viewport,
    features: guide.features.map((f) => {
      const bySelector = new Map(readElements(pid, uid, f.id).map((e) => [e.selector, e]));
      return {
        ...f,
        resolved: resolveRoute(f.route, effectiveParams(project, f.params)),
        missingParams: missingParams(f.route, effectiveParams(project, f.params)),
        rects: f.items.map((i) => (bySelector.has(i.selector) ? bySelector.get(i.selector).rect : null)),
        busy: isBusy(f.id),
      };
    }),
  };
}

module.exports = {
  DATA,
  httpError,
  userDir,
  ensure,
  readJson,
  writeJson,
  getProject,
  listProjects,
  publicProject,
  createProject,
  updateProject,
  deleteProject,
  addUser,
  updateUser,
  deleteUser,
  getGuide,
  updateGuide,
  getFeature,
  updateFeature,
  addFeature,
  removeFeature,
  resetGuide,
  reorder,
  readElements,
  writeSnapshot,
  readRawBase64,
  rawFile,
  elementsFile,
  guideView,
};
