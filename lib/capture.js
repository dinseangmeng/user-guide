const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { isBlockedText, assertSafeClick } = require('./safety');
const { missingParams, resolveRoute, effectiveParams } = require('./routes');

async function openSession(project, user, dir) {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({ viewport: project.viewport, locale: 'en-US' });
  const page = await context.newPage();
  try {
    await page.goto(project.appUrl + project.loginPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(project.userSelector, { timeout: 20000 });
    await page.fill(project.userSelector, user.username);
    await page.fill(project.passSelector, user.password);
    await page.click(project.submitSelector);
    await page.waitForURL(
      (u) => u.href.startsWith(project.appUrl) && !u.pathname.startsWith(project.loginPath),
      { timeout: 30000, waitUntil: 'commit' }
    );
  } catch (err) {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'login-failed.png') }).catch(() => {});
    await browser.close();
    throw new Error('Login failed for ' + user.username + ': ' + String(err.message).split('\n')[0]);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  return { browser, context, page };
}

async function settle(page, waitFor) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  if (waitFor) {
    await page.waitForSelector(waitFor, { timeout: 15000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
}

function collectElements() {
  const selectors = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[role=tab]',
    '[role=button]',
    '[role=menuitem]',
    '.v-btn',
    '.v-tab',
    '.v-select',
    '.v-data-table',
    '.v-card-title',
    'h1',
    'h2',
    'th',
    '[data-testid]',
  ].join(',');

  const esc = (s) => CSS.escape(s);

  function pathOf(el) {
    const tid = el.getAttribute('data-testid');
    if (tid) return '[data-testid="' + tid + '"]';
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      if (cur.id && document.querySelectorAll('#' + esc(cur.id)).length === 1) {
        parts.unshift('#' + esc(cur.id));
        break;
      }
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function labelOf(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref) return ref.innerText;
    }
    if (el.id) {
      const lab = document.querySelector('label[for="' + esc(el.id) + '"]');
      if (lab) return lab.innerText;
    }
    const wrap = el.closest('.v-input');
    if (wrap) {
      const lab = wrap.querySelector('label');
      if (lab) return lab.innerText;
    }
    return el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.value || '';
  }

  const seen = new Set();
  const out = [];

  for (const raw of document.querySelectorAll(selectors)) {
    const el = raw.closest('.v-input') || raw;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    if (r.right < 0 || r.left > window.innerWidth) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;

    const selector = pathOf(el);
    if (seen.has(selector)) continue;
    seen.add(selector);

    out.push({
      selector,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: raw.getAttribute('role') || '',
      href: raw.tagName === 'A' ? raw.getAttribute('href') || '' : '',
      label: labelOf(raw).replace(/\s+/g, ' ').trim().slice(0, 80),
      rect: {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
    });
  }

  return out.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).slice(0, 80);
}

async function discoverRoutes(page) {
  let routes = await page.evaluate(() => {
    try {
      const app = document.querySelector('#app').__vue_app__;
      return app.config.globalProperties.$router.getRoutes().map((r) => r.path);
    } catch (e) {
      return null;
    }
  });

  if (!routes || !routes.length) {
    routes = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && h.startsWith('/'))
    );
  }

  return [...new Set(routes.map((r) => r.split('?')[0].split('#')[0]))]
    .filter((r) => r && !r.includes('*'))
    .filter((r) => !/logout|login|callback|404/i.test(r))
    .sort();
}

async function openFeature(page, project, feature) {
  const params = effectiveParams(project, feature.params);
  const missing = missingParams(feature.route, params);
  if (missing.length) throw new Error('Needs sample values for: ' + missing.join(', '));

  await page.goto(project.appUrl + resolveRoute(feature.route, params), { waitUntil: 'domcontentloaded' });
  await settle(page, feature.waitFor);

  if (new URL(page.url()).pathname.startsWith(project.loginPath)) {
    throw new Error('Redirected to the login page (no permission, or the session was lost)');
  }

  for (const action of feature.actions || []) {
    if (action.click) {
      await assertSafeClick(page, action.click);
      await page.click(action.click);
      await settle(page, action.waitFor);
    }
  }
}

async function captureFeature(page, project, dir, feature) {
  await openFeature(page, project, feature);

  const elements = (await page.evaluate(collectElements)).map((e) => ({
    ...e,
    unsafe: isBlockedText(e.label),
  }));

  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'elements'), { recursive: true });
  await page.screenshot({ path: path.join(dir, 'raw', feature.id + '.png') });
  fs.writeFileSync(path.join(dir, 'elements', feature.id + '.json'), JSON.stringify(elements, null, 2));
  return elements;
}

async function snapshot(page) {
  const elements = (await page.evaluate(collectElements)).map((e) => ({ ...e, unsafe: isBlockedText(e.label) }));
  const image = await page.screenshot();
  return { elements, image };
}

module.exports = { openSession, settle, discoverRoutes, openFeature, captureFeature, snapshot };
