const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const capture = require('./capture');
const { effectiveParams } = require('./routes');

async function drawOverlays(page, items) {
  return page.evaluate((list) => {
    document.querySelectorAll('.doc-overlay').forEach((n) => n.remove());
    const missing = [];
    list.forEach((item, i) => {
      const el = document.querySelector(item.selector);
      if (!el) {
        missing.push(item.selector);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        missing.push(item.selector);
        return;
      }
      const box = document.createElement('div');
      box.className = 'doc-overlay';
      box.style.cssText =
        'position:fixed;left:' + (r.left - 3) + 'px;top:' + (r.top - 3) + 'px;width:' +
        (r.width + 6) + 'px;height:' + (r.height + 6) +
        'px;border:3px solid #e11d48;border-radius:4px;z-index:2147483647;pointer-events:none;box-sizing:border-box';
      const badge = document.createElement('div');
      badge.textContent = String(i + 1);
      badge.style.cssText =
        'position:absolute;top:-14px;left:-14px;width:22px;height:22px;border-radius:50%;background:#e11d48;color:#fff;font:bold 12px sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.3)';
      box.appendChild(badge);
      document.body.appendChild(box);
    });
    return missing;
  }, items);
}

function renderHash(f, project) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({ r: f.route, p: effectiveParams(project, f.params), w: f.waitFor, a: f.actions, s: f.items.map((i) => i.selector), c: f.capturedAt }))
    .digest('hex');
}

function imagePath(dir, id) {
  return path.join(dir, 'out', 'images', id + '.png');
}

async function renderPages(project, user, dir, features, log) {
  fs.mkdirSync(path.join(dir, 'out', 'images'), { recursive: true });
  const results = {};
  if (!features.length) return results;

  const session = await capture.openSession(project, user, dir);
  try {
    for (const f of features) {
      try {
        await capture.openFeature(session.page, project, f);
        const missing = await drawOverlays(session.page, f.items);
        await session.page.screenshot({ path: imagePath(dir, f.id) });
        results[f.id] = { ok: true, missing };
        log('Rendered ' + f.id + (missing.length ? ' (' + missing.length + ' element(s) not found)' : ''));
      } catch (err) {
        results[f.id] = { ok: false, error: err.message };
        log('FAILED render ' + f.id + ': ' + err.message);
      }
    }
  } finally {
    await session.browser.close();
  }
  return results;
}

module.exports = { renderPages, renderHash, imagePath };
