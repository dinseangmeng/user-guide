const LABELS = {
  en: {
    guide: 'User Guide',
    contents: 'Table of Contents',
    overview: 'System Overview',
    version: 'Version',
    date: 'Date',
    untitledGroup: 'Untitled section',
  },
  km: {
    guide: 'ការណែនាំអ្នកប្រើប្រាស់',
    contents: 'មាតិកា',
    overview: 'ទិដ្ឋភាពទូទៅនៃប្រព័ន្ធ',
    version: 'កំណែ',
    date: 'កាលបរិច្ឆេទ',
    untitledGroup: 'ផ្នែកគ្មានចំណងជើង',
  },
};

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  km: ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'],
};

function formatDate(lang, d) {
  const date = d || new Date();
  return date.getDate() + ' ' + MONTHS[lang][date.getMonth()] + ' ' + date.getFullYear();
}

module.exports = { LABELS, formatDate };
