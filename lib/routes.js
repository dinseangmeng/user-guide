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

// Page values win; empty ones fall back to the project's shared variables.
function effectiveParams(project, params) {
  const out = { ...((project && project.variables) || {}) };
  Object.keys(params || {}).forEach((k) => {
    if (String(params[k] == null ? '' : params[k]).trim()) out[k] = params[k];
  });
  return out;
}

module.exports = { paramNames, missingParams, resolveRoute, slug, effectiveParams };
