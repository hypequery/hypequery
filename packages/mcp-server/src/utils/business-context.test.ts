import { describe, expect, it } from 'vitest';
import { formatBusinessContext, resolveMCPBusinessContext } from './business-context.js';

describe('formatBusinessContext', () => {
  it('renders every section in document order', () => {
    expect(formatBusinessContext({
      kind: 'hypequery-business-context',
      version: 1,
      summary: 'B2B analytics platform.',
      industry: 'SaaS',
      goals: ['Grow net revenue retention'],
      kpis: [{ name: 'NRR', definition: 'Revenue retained from last year, with expansion.' }],
      glossary: [{ term: 'Workspace', meaning: 'One paying customer account.' }],
      conventions: 'USD, UTC.',
      caveats: ['Test orders have negative ids.'],
    })).toBe([
      '# Business context',
      '',
      '## About the business',
      'B2B analytics platform.',
      'Industry: SaaS',
      '',
      '## Goals',
      '- Grow net revenue retention',
      '',
      '## KPIs',
      '- **NRR**: Revenue retained from last year, with expansion.',
      '',
      '## Glossary',
      '- **Workspace**: One paying customer account.',
      '',
      '## Reporting conventions',
      'USD, UTC.',
      '',
      '## Data caveats',
      '- Test orders have negative ids.',
      '',
    ].join('\n'));
  });

  it('accepts the headerless form and skips empty sections', () => {
    expect(formatBusinessContext({ conventions: 'EUR.' })).toBe('# Business context\n\n## Reporting conventions\nEUR.\n');
  });
});

describe('resolveMCPBusinessContext', () => {
  it('drops the header and canonicalises', () => {
    expect(resolveMCPBusinessContext({
      kind: 'hypequery-business-context',
      version: 1,
      summary: '  Trimmed.  ',
      caveats: [],
    })).toEqual({ summary: 'Trimmed.' });
  });

  it('returns undefined for none or an empty document', () => {
    expect(resolveMCPBusinessContext(undefined)).toBeUndefined();
    expect(resolveMCPBusinessContext({ kind: 'hypequery-business-context', version: 1 })).toBeUndefined();
  });
});
