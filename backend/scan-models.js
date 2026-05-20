/* global module */

const AVAILABLE_SCAN_MODELS = {
  '1': { label: 'Premium Model', aliases: ['premium', 'ultra', 'highest quality'] },
  '2': { label: 'Backup Model', aliases: ['backup', 'fast', 'fun mode', 'fun'] },
  '3': { label: 'OPTIC', aliases: ['optic', 'balance', 'alignment', 'basic', 'free'] },
  '4': { label: 'CORE', aliases: ['core', 'objective', 'objective attractiveness'] },
  '5': { label: 'GENEVA', aliases: ['geneva', 'mathematical beauty', 'golden ratio'] },
  '6': { label: 'Premium Model', aliases: ['gemma-4-31b-it', 'google/gemma-4-31b-it'] },
  '7': { label: 'Gemini 3.1 Pro', aliases: ['gemini-3.1-pro', 'gemini-3.1-pro-preview', 'models/gemini-3.1-pro-preview'] },
  '8': { label: 'Gemini 3.1 Pro', aliases: ['gemini 3.1 pro'] },
  '9': { label: 'Premium Model', aliases: ['premium fallback'] },
  '10': { label: 'Qwen model (Testing)', aliases: ['qwen', 'qwen/qwen2.5-vl-72b-instruct'] },
  '11': { label: 'anthropic/claude-sonnet-4.6', aliases: ['claude', 'anthropic/claude-sonnet-4.6'] },
  '12': { label: 'openai/gpt-5.4', aliases: ['gpt-5.4', 'openai/gpt-5.4'] },
  '13': {
    label: 'google/gemini-3.1-pro-preview',
    aliases: [
      'google/gemini-3.1-pro-preview',
      'google/gemini-3.1-pro',
      'google/gemeni-3.1.pro',
      'google/gemeni-3.1-pro-preview',
      'gemini.3.1pro.preview',
      'gemeni.3.1pro.preview',
      'gemini-3.1-pro-preview',
      'gemeni-3.1-pro-preview',
    ],
  },
  '14': { label: 'Haiiii', aliases: ['haiiii', 'openrouter haiiii', 'google/gemma-4-31b-it:free'] },
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

  if (normalized.includes('googlegemini31propreview')) return '13';
  if (normalized.includes('gemini31propreview')) return '13';
  if (normalized.includes('googlegemini31pro')) return '13';
  if (normalized.includes('gemini31pro')) return '7';
  if (normalized.includes('anthropicclaudesonnet46') || normalized.includes('claude')) return '11';
  if (normalized.includes('openaigpt54') || normalized.includes('gpt54')) return '12';
  if (normalized.includes('haiiii') || normalized.includes('googlegemma431bitfree')) return '14';
  if (normalized.includes('qwen')) return '10';
  if (normalized.includes('premium') || normalized.includes('ultra')) return '1';
  if (normalized.includes('backup') || normalized.includes('fast') || normalized.includes('fun')) return '2';
  if (normalized.includes('optic') || normalized.includes('balance') || normalized.includes('free')) return '3';
  if (normalized.includes('core') || normalized.includes('objective')) return '4';
  if (normalized.includes('geneva') || normalized.includes('goldenratio')) return '5';

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
