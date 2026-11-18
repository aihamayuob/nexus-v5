import type { ConnectorImpl, ConnectorManifest, ConformanceSamples } from '../connectorSdk.js';

/** Reference connector (C1): a PURE text statistics tool. Shipped as the worked example for connector authors; NOT registered by default (see connectors/registry.ts). */
export const textStatsManifest: ConnectorManifest = {
  manifestVersion: 1,
  name: 'text_stats',
  version: '1.0.0',
  description: 'Counts words, characters and lines in the given text (pure computation, no I/O).',
  effect: 'pure',
  effectReason: 'Computation on the input string only; performs no I/O of any kind.',
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text to analyse.' } }, required: ['text'] },
  timeoutMs: 1000,
};

export const textStatsImpl: ConnectorImpl = {
  async execute(input) {
    const text = String(input.text ?? '');
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return `words: ${words}\nchars: ${text.length}\nlines: ${text ? text.split(/\r?\n/).length : 0}`;
  },
};

export const textStatsConformanceSamples: ConformanceSamples = {
  valid: [{ text: 'hello world foo' }, { text: '' }, { text: 'سطر أول\nسطر ثان' }],
  invalid: [{}, { text: 5 }],
};
