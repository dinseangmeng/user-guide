const PARAM = ':([A-Za-z0-9_]+)(?:\\([^)]*\\))?\\??';

function paramNames(route) {
  const names = [];
  const re = new RegExp(PARAM, 'g');
  let m;
  while ((m = re.exec(route || ''))) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

function missingParams(route, params) {
  return paramNames(route).filter((n) => !params || !String(params[n] == null ? '' : params[n]).trim());
}

function resolveRoute(route, params) {
  return (route || '').replace(new RegExp(PARAM, 'g'), (m, name) => {
    const v = params && params[name] != null ? String(params[name]).trim() : '';
    return v ? encodeURIComponent(v) : m;
  });
}

function slug(route) {
  const s = (route || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'home';
}

// A route like /product/view/:id has a real parameter name (:id) that must stay
// in the URL, plus a unique shared "ref" (product_id) used for shared variables,
// so /user/view/:id and /product/view/:id do not share one value.
// NOTE: public/app.js has a copy of heuristicRef(); keep them in sync.
const GENERIC = new Set(['id', 'uid', 'uuid', 'pk', 'key', 'slug', 'code', 'no', 'number', 'ref']);
const VERBS = new Set(['view', 'views', 'edit', 'detail', 'details', 'show', 'update', 'create', 'new', 'add', 'delete', 'remove', 'list', 'info', 'manage', 'form', 'page']);

function singular(w) {
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w) && w.length > 3) return w.slice(0, -1);
  return w;
}

function heuristicRef(route, name) {
  if (!GENERIC.has(name.toLowerCase())) return name;
  const segs = String(route || '').split('?')[0].split('/').filter(Boolean);
  const at = segs.findIndex((s) => new RegExp('^:' + name + '(\\(|\\?|$)').test(s));
  for (let i = (at < 0 ? segs.length : at) - 1; i >= 0; i--) {
    const s = segs[i].toLowerCase();
    if (s.startsWith(':') || VERBS.has(s)) continue;
    const word = singular(s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
    if (word) return word + '_' + name.toLowerCase();
  }
  return name;
}

// Ref for one parameter of a feature: supervisor override first, else heuristic.
function refFor(feature, name) {
  const own = feature && feature.alias && feature.alias[name];
  return own || heuristicRef(feature && feature.route, name);
}

function refsFor(feature) {
  return paramNames(feature && feature.route).map((name) => ({ name, ref: refFor(feature, name) }));
}

// Real values to put in the URL, keyed by the real param name (:id).
// Page values win; empty ones fall back to the project's shared variables by ref
// (or by the plain name, for variables saved before refs existed).
function effectiveParams(project, feature) {
  const vars = (project && project.variables) || {};
  const own = (feature && feature.params) || {};
  const out = {};
  paramNames(feature && feature.route).forEach((name) => {
    const mine = String(own[name] == null ? '' : own[name]).trim();
    const ref = refFor(feature, name);
    const shared = vars[ref] != null && vars[ref] !== '' ? vars[ref] : vars[name];
    if (mine) out[name] = mine;
    else if (shared != null && shared !== '') out[name] = shared;
  });
  return out;
}

module.exports = { paramNames, missingParams, resolveRoute, slug, effectiveParams, heuristicRef, refFor, refsFor };
