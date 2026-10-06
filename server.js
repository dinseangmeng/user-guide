const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const jobs = require('./lib/jobs');
const ai = require('./lib/ai');
const pipeline = require('./lib/pipeline');
const docstore = require('./lib/docstore');

const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const STATUSES = ['new', 'draft', 'approved', 'rejected'];
const routes = [];

function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    }) + '$'
  );
  routes.push({ method, re, keys, handler });
}

function S(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function cleanPair(v) {
  return { en: S(v && v.en), km: S(v && v.km) };
}

function cleanItems(items) {
  return items
    .filter((i) => i && typeof i.selector === 'string' && i.selector)
    .map((i) => ({
      selector: i.selector,
      title: cleanPair(i.title),
      description: cleanPair(i.description),
      needsReview: !!i.needsReview,
    }));
}

function cleanParams(params) {
  const out = {};
  if (params && typeof params === 'object') {
    Object.keys(params).forEach((k) => {
      out[k] = S(String(params[k] == null ? '' : params[k]));
    });
  }
  return out;
}

function need(pid, uid) {
  const project = store.getProject(pid);
  if (!project) throw store.httpError(404, 'Project not found');
  if (uid && !project.users.some((u) => u.id === uid)) throw store.httpError(404, 'User not found');
  return project;
}

function needFeature(pid, uid, fid) {
  need(pid, uid);
  const f = store.getFeature(pid, uid, fid);
  if (!f) throw store.httpError(404, 'Page not found');
  return f;
}

function queueFeature(pid, uid, fid, type, opts) {
  jobs.setBusy(uid, fid, true);
  return jobs.enqueue({
    type,
    pid,
    uid,
    fid,
    run: async (log) => {
      try {
        await pipeline.featureJob(pid, uid, fid, opts, log);
      } finally {
        jobs.setBusy(uid, fid, false);
      }
    },
  });
}

const U = '/api/projects/:pid/users/:uid';

route('GET', '/api/config', () => ({ ...ai.status(), dataDir: path.relative(process.cwd(), store.DATA) || store.DATA }));

route('GET', '/api/projects', () => store.listProjects());

route('POST', '/api/projects', ({ body }) => store.publicProject(store.createProject(body)));

route('GET', '/api/projects/:pid', ({ params }) => store.publicProject(need(params.pid)));

route('PUT', '/api/projects/:pid', ({ params, body }) => {
  need(params.pid);
  return store.publicProject(store.updateProject(params.pid, body));
});

route('DELETE', '/api/projects/:pid', ({ params }) => {
  need(params.pid);
  store.deleteProject(params.pid);
  return { ok: true };
});

route('POST', '/api/projects/:pid/users', ({ params, body }) => {
  need(params.pid);
  const user = store.addUser(params.pid, body);
  return { id: user.id };
});

route('PUT', U, ({ params, body }) => {
  need(params.pid, params.uid);
  store.updateUser(params.pid, params.uid, body);
  return { ok: true };
});

route('DELETE', U, ({ params }) => {
  need(params.pid, params.uid);
  store.deleteUser(params.pid, params.uid);
  return { ok: true };
});

route('GET', U + '/guide', ({ params }) => {
  need(params.pid, params.uid);
  return store.guideView(params.pid, params.uid, (fid) => jobs.isBusy(params.uid, fid));
});

route('PUT', U + '/order', ({ params, body }) => {
  need(params.pid, params.uid);
  if (!Array.isArray(body.ids)) throw store.httpError(400, 'ids must be an array');
  store.reorder(params.pid, params.uid, body.ids);
  return { ok: true };
});

route('GET', U + '/features/:fid', ({ params }) => {
  const feature = needFeature(params.pid, params.uid, params.fid);
  return { feature, elements: store.readElements(params.pid, params.uid, params.fid) };
});

route('POST', U + '/features', ({ params, body }) => {
  need(params.pid, params.uid);
  const r = S(body.route);
  if (!r.startsWith('/')) throw store.httpError(400, 'Route must start with /');
  const f = store.addFeature(params.pid, params.uid, { route: r, name: body.name, params: cleanParams(body.params) });
  queueFeature(params.pid, params.uid, f.id, 'add-page', { capture: true, draft: body.draft !== false, explore: !!body.explore });
  return { id: f.id };
});

route('PATCH', U + '/features/:fid', ({ params, body }) => {
  needFeature(params.pid, params.uid, params.fid);
  store.updateFeature(params.pid, params.uid, params.fid, (x) => {
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) throw store.httpError(400, 'Bad status');
      x.status = body.status;
    }
    if (body.name !== undefined) {
      const n = cleanPair(body.name);
      if (n.en !== x.name.en || n.km !== x.name.km) {
        x.name = n;
        x.nameLocked = true;
      }
    }
    if (body.route !== undefined) {
      const r = S(body.route);
      if (!r.startsWith('/')) throw store.httpError(400, 'Route must start with /');
      x.route = r;
    }
    if (body.params !== undefined) x.params = cleanParams(body.params);
    if (body.waitFor !== undefined) x.waitFor = S(body.waitFor);
    if (Array.isArray(body.steps)) {
      x.actions = body.steps.map(S).filter(Boolean).map((click) => ({ click }));
    }
    if (Array.isArray(body.items)) {
      x.items = cleanItems(body.items);
      if (x.status === 'new' && x.items.length && x.capturedAt) x.status = 'draft';
    }
  });
  return { ok: true };
});

route('DELETE', U + '/features/:fid', ({ params }) => {
  needFeature(params.pid, params.uid, params.fid);
  store.removeFeature(params.pid, params.uid, params.fid);
  return { ok: true };
});

route('POST', U + '/features/:fid/recapture', ({ params, body }) => {
  needFeature(params.pid, params.uid, params.fid);
  const job = queueFeature(params.pid, params.uid, params.fid, 'capture', { capture: true, draft: !!body.draft, explore: !!body.explore });
  return { jobId: job.id };
});

route('POST', U + '/features/:fid/explore', ({ params }) => {
  needFeature(params.pid, params.uid, params.fid);
  const job = queueFeature(params.pid, params.uid, params.fid, 'explore', { explore: true });
  return { jobId: job.id };
});

route('POST', U + '/discover', ({ params, body }) => {
  need(params.pid, params.uid);
  const active = jobs.findActive(params.uid, 'discover');
  if (active) return { jobId: active.id };
  const job = jobs.enqueue({
    type: 'discover',
    pid: params.pid,
    uid: params.uid,
    run: (log) => pipeline.discover(params.pid, params.uid, { draft: body.draft !== false, explore: !!body.explore }, log),
  });
  return { jobId: job.id };
});

route('POST', U + '/restart', ({ params, body }) => {
  need(params.pid, params.uid);
  if (body.confirm !== true) throw store.httpError(400, 'Confirmation required');
  if (jobs.hasActive(params.uid)) throw store.httpError(409, 'Wait for the running jobs to finish first');
  const job = jobs.enqueue({
    type: 'restart',
    pid: params.pid,
    uid: params.uid,
    run: (log) => pipeline.restart(params.pid, params.uid, { draft: body.draft !== false, explore: !!body.explore }, log),
  });
  return { jobId: job.id };
});

route('POST', U + '/draft-all', ({ params, body }) => {
  need(params.pid, params.uid);
  const active = jobs.findActive(params.uid, 'draft-all');
  if (active) return { jobId: active.id };
  const scope = body.scope === 'all' ? 'all' : 'new';
  const job = jobs.enqueue({
    type: 'draft-all',
    pid: params.pid,
    uid: params.uid,
    run: (log) => pipeline.draftMany(params.pid, params.uid, scope, log),
  });
  return { jobId: job.id };
});

route('POST', U + '/approve-all', ({ params }) => {
  need(params.pid, params.uid);
  let count = 0;
  store.updateGuide(params.pid, params.uid, (g) => {
    g.features.forEach((f) => {
      if (f.status === 'draft') {
        f.status = 'approved';
        count++;
      }
    });
  });
  return { count };
});

route('GET', U + '/document', ({ params }) => {
  need(params.pid, params.uid);
  return docstore.fullView(params.pid, params.uid);
});

route('PUT', U + '/document', ({ params, body }) => {
  need(params.pid, params.uid);
  return docstore.save(params.pid, params.uid, body);
});

route('POST', U + '/document/logo', ({ params, body }) => {
  need(params.pid, params.uid);
  docstore.saveLogo(params.pid, params.uid, body.dataUrl);
  return docstore.fullView(params.pid, params.uid);
});

route('DELETE', U + '/document/logo', ({ params }) => {
  need(params.pid, params.uid);
  docstore.removeLogo(params.pid, params.uid);
  return docstore.fullView(params.pid, params.uid);
});

route('POST', U + '/document/overview', async ({ params }) => {
  const project = need(params.pid, params.uid);
  const v = docstore.view(params.pid, params.uid);
  if (!v.pages.length) throw store.httpError(400, 'Approve some pages first');
  return ai.draftOverview({ context: project.context, name: project.name, titles: v.pages.map((p) => p.name.en || p.route) });
});

route('POST', U + '/generate', ({ params, body }) => {
  need(params.pid, params.uid);
  const active = jobs.findActive(params.uid, 'generate');
  if (active) return { jobId: active.id };
  const formats = ['pdf', 'docx'].filter((f) => (body.formats || []).includes(f));
  const langs = ['en', 'km'].filter((l) => (body.langs || []).includes(l));
  if (!formats.length) throw store.httpError(400, 'Choose PDF, Word or both');
  if (!langs.length) throw store.httpError(400, 'Choose at least one language');
  const job = jobs.enqueue({
    type: 'generate',
    pid: params.pid,
    uid: params.uid,
    run: (log) => pipeline.generate(params.pid, params.uid, { formats, langs, force: !!body.force }, log),
  });
  return { jobId: job.id };
});

route('GET', '/api/jobs', ({ query }) => jobs.listForUser(query.get('uid') || ''));

const FILE_PATTERN = /^(raw\/[\w-]+\.png|out\/images\/[\w-]+\.png|out\/documents\/[\w-]+\.(pdf|docx)|logo\.(png|jpg)|login-failed\.png)$/;

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const headers = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    };
    if (path.extname(file) === '.docx') headers['Content-Disposition'] = 'attachment; filename="' + path.basename(file) + '"';
    res.writeHead(200, headers);
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(store.httpError(413, 'Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(store.httpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      const match = routes
        .map((r) => ({ r, m: r.method === req.method ? r.re.exec(pathname) : null }))
        .find((x) => x.m);
      if (!match) throw store.httpError(404, 'Unknown endpoint');
      const params = {};
      match.r.keys.forEach((k, i) => {
        params[k] = match.m[i + 1];
      });
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      sendJson(res, 200, await match.r.handler({ params, body, query: url.searchParams }));
      return;
    }

    if (pathname.startsWith('/files/')) {
      const m = /^\/files\/([\w-]+)\/([\w-]+)\/(.+)$/.exec(pathname);
      if (!m || !FILE_PATTERN.test(m[3])) throw store.httpError(404, 'Not found');
      sendFile(res, path.join(store.userDir(m[1], m[2]), m[3]));
      return;
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) throw store.httpError(404, 'Not found');
    sendFile(res, file);
  } catch (err) {
    sendJson(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const s = ai.status();
  console.log('Guide Studio running at http://localhost:' + PORT);
  console.log('Data folder: ' + store.DATA);
  console.log('AI drafting: ' + (s.ready ? 'on (' + s.model + ')' : 'off (set ALLOW_CLOUD_AI=true and OPENROUTER_API_KEY)'));
});
