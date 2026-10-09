const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { isBlockedText, assertSafeClick } = require('./safety');
const { missingParams, resolveRoute, effectiveParams } = require('./routes');

// Runs inside the login page. Finds the username/email input, the password input
// and the submit button without any configured selectors.
function findLoginFields() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const uniq = (sel) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch (e) {
      return false;
    }
  };
  function pathOf(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      if (cur.id && uniq('#' + CSS.escape(cur.id))) {
        parts.unshift('#' + CSS.escape(cur.id));
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
  function selFor(el) {
    const tag = el.tagName.toLowerCase();
    const cands = [];
    if (el.id) cands.push('#' + CSS.escape(el.id));
    ['name', 'data-testid', 'autocomplete', 'placeholder', 'aria-label', 'type'].forEach((a) => {
      const v = el.getAttribute(a);
      if (v) cands.push(tag + '[' + a + '="' + v.replace(/"/g, '\\"') + '"]');
    });
    return cands.find(uniq) || pathOf(el);
  }

  const inputs = [...document.querySelectorAll('input')].filter(vis);
  const pass = inputs.find((i) => i.type === 'password');
  if (!pass) return null;
  const all = [...document.querySelectorAll('input, button, [role=button]')].filter(vis);
  const at = all.indexOf(pass);
  const textTypes = ['text', 'email', 'tel', 'number', 'search', ''];
  let user = null;
  for (let i = at - 1; i >= 0 && !user; i--) {
    if (all[i].tagName === 'INPUT' && textTypes.includes(all[i].type)) user = all[i];
  }
  if (!user) user = inputs.find((i) => i !== pass && textTypes.includes(i.type)) || null;

  const label = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || b.title || '').trim();
  const BAD = /forgot|reset|register|sign ?up|create|google|facebook|microsoft|apple|show|hide|cancel/i;
  const form = pass.closest('form');
  let submit = (form || document).querySelector('button[type=submit], input[type=submit]');
  if (submit && !vis(submit)) submit = null;
  if (!submit) {
    const after = all.slice(at + 1).filter((e) => e.tagName !== 'INPUT' || e.type === 'submit' || e.type === 'button');
    submit =
      after.find((b) => /log ?in|sign ?in|continue|submit|enter|next|ចូល/i.test(label(b)) && !BAD.test(label(b))) ||
      after.find((b) => label(b) && !BAD.test(label(b))) ||
      null;
  }
  return {
    userSelector: user ? selFor(user) : '',
    passSelector: selFor(pass),
    submitSelector: submit ? selFor(submit) : '',
  };
}

// For a selector returned by the AI (it may point at a UI-library wrapper),
// return a selector for the real <input> inside it.
async function realInputSelector(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return s;
    const target = el.tagName === 'INPUT' || el.tagName === 'BUTTON' ? el : el.querySelector('input,textarea,button') || el;
    const ok = (x) => {
      try {
        return document.querySelectorAll(x).length === 1;
      } catch (e) {
        return false;
      }
    };
    const tag = target.tagName.toLowerCase();
    const c = [];
    if (target.id) c.push('#' + CSS.escape(target.id));
    ['name', 'type', 'placeholder'].forEach((a) => {
      const v = target.getAttribute(a);
      if (v) c.push(tag + '[' + a + '="' + v.replace(/"/g, '\\"') + '"]');
    });
    return c.find(ok) || s;
  }, sel);
}

// Rules first; if they miss a field and AI is available, ask the supervisor model.
async function detectOnPage(page) {
  await page.waitForSelector('input[type=password]', { timeout: 15000 }).catch(() => {});
  let found = await page.evaluate(findLoginFields).catch(() => null);
  let via = 'rules';
  if (!found || !found.userSelector || !found.passSelector || !found.submitSelector) {
    const ai = require('./ai');
    if (ai.status().ready) {
      try {
        const elements = await page.evaluate(collectElements);
        const image = (await page.screenshot()).toString('base64');
        const r = await ai.detectLoginFields({ elements, image });
        const merged = {
          userSelector: (found && found.userSelector) || (r.user && (await realInputSelector(page, r.user))) || '',
          passSelector: (found && found.passSelector) || (r.pass && (await realInputSelector(page, r.pass))) || '',
          submitSelector: (found && found.submitSelector) || (r.submit && (await realInputSelector(page, r.submit))) || '',
        };
        found = merged;
        via = 'ai';
      } catch (e) {
        // keep whatever the rules found
      }
    }
  }
  if (!found) return null;
  return { ...found, via };
}

async function detectLogin(appUrl, loginPath) {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.goto(appUrl + loginPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const r = await detectOnPage(page);
    if (!r || !r.userSelector || !r.passSelector || !r.submitSelector) {
      throw new Error('Could not find the login fields automatically' + (r ? ' (found: ' + [r.userSelector && 'username', r.passSelector && 'password', r.submitSelector && 'button'].filter(Boolean).join(', ') + ')' : ''));
    }
    return r;
  } finally {
    await browser.close();
  }
}

async function openSession(project, user, dir) {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({ viewport: project.viewport, locale: 'en-US' });
  const page = await context.newPage();
  try {
    await page.goto(project.appUrl + project.loginPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
    let sel = { user: project.userSelector, pass: project.passSelector, submit: project.submitSelector };
    const configured = await page.waitForSelector(sel.user, { timeout: 8000 }).then(() => true, () => false);
    if (!configured) {
      // The saved selectors do not match this page: find the fields automatically.
      const found = await detectOnPage(page);
      if (!found || !found.userSelector || !found.passSelector || !found.submitSelector) {
        throw new Error('Login fields not found (' + sel.user + '). Use "Auto-detect login fields" in Project settings.');
      }
      sel = { user: found.userSelector, pass: found.passSelector, submit: found.submitSelector };
      try {
        require('./store').updateProject(project.id, { userSelector: sel.user, passSelector: sel.pass, submitSelector: sel.submit });
        console.log('Login selectors auto-detected for ' + project.name + ' (' + found.via + ')');
      } catch (e) {
        // not persisted; still usable for this session
      }
    }
    await page.fill(sel.user, user.username);
    await page.fill(sel.pass, user.password);
    await page.click(sel.submit);
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
  const params = effectiveParams(project, feature);
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

module.exports = { detectLogin, openSession, settle, discoverRoutes, openFeature, captureFeature, snapshot };
