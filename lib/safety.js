const BLOCKED = /(delete|remove|destroy|approve|reject|submit|discharge|cancel|logout|log out|sign out|confirm|archive|purge|reset|លុប|យល់ព្រម|ចាកចេញ|បោះបង់|បញ្ជូន|បដិសេធ|Supprimer|Valider|Annuler|Déconnexion)/i;

function isBlockedText(text) {
  return BLOCKED.test(text || '');
}

async function assertSafeClick(page, selector) {
  const locator = page.locator(selector).first();
  const text = [
    await locator.innerText().catch(() => ''),
    (await locator.getAttribute('aria-label').catch(() => '')) || '',
    (await locator.getAttribute('title').catch(() => '')) || '',
  ].join(' ');
  if (isBlockedText(text)) {
    throw new Error('Blocked click on "' + selector + '" (unsafe text: ' + text.trim().slice(0, 60) + ')');
  }
}

module.exports = { isBlockedText, assertSafeClick };
