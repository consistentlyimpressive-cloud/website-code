/* global module */

const AVAILABLE_SCAN_MODELS = {
  '1': {
    label: 'Premium Ultra',
    aliases: [
      'premium',
      'ultra',
      'highest quality',
      'gemini-3.1-pro',
      'gemini-3.1-pro-preview',
      'google/gemini-3.1-pro-preview',
      'google/gemini-3.1-pro',
      'google/gemeni-3.1.pro',
      'gemeni-3.1.pro',
      'gemeni-3.1-pro-preview',
    ],
  },
  '2': {
    label: 'Fun Mode',
    aliases: [
      'fun',
      'fun mode',
      'fast',
      'flash',
      'gemini-3-flash',
      'gemini-3-flash-preview',
      'google/gemini-3-flash-preview',
    ],
  },
  '3': {
    label: 'OPTIC',
    aliases: ['optic', 'balance', 'alignment', 'basic', 'free'],
  },
  '4': {
    label: 'CORE',
    aliases: ['core', 'objective', 'objective attractiveness'],
  },
  '5': {
    label: 'GENEVA',
    aliases: ['geneva', 'mathematical beauty', 'golden ratio'],
  },
};

function compactModelKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/\bgemeni\b/g, 'gemini')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeScanModelChoice(rawChoice) {
  const raw = String(rawChoice || '').trim();
  if (!raw) return '3';

  if (Object.prototype.hasOwnProperty.call(AVAILABLE_SCAN_MODELS, raw)) {
    return raw;
  }

  const normalized = compactModelKey(raw);
  if (!normalized) return '3';

  for (const [choice, config] of Object.entries(AVAILABLE_SCAN_MODELS)) {
    if (compactModelKey(choice) === normalized) return choice;
    if (config.aliases.some((alias) => compactModelKey(alias) === normalized)) {
      return choice;
    }
  }

  if (normalized.includes('gemini31pro')) return '1';
  if (normalized.includes('gemini3flash')) return '2';
  if (normalized.includes('optic')) return '3';
  if (normalized.includes('core')) return '4';
  if (normalized.includes('geneva')) return '5';

  return null;
}

function describeAvailableScanModels() {
  return Object.entries(AVAILABLE_SCAN_MODELS)
    .map(([choice, config]) => `${choice} (${config.label})`)
    .join(', ');
}

module.exports = {
  AVAILABLE_SCAN_MODELS,
  normalizeScanModelChoice,
  describeAvailableScanModels,
};
