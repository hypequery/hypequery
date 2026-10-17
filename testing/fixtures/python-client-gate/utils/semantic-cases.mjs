/** Logical requests, independently checked against raw SQL from the gate database. */
export const semanticCases = {
  related: { dimensions: ['country', 'profile.label'], measures: ['revenue', 'profile.total', 'profile.minimum'], orderBy: [{ field: 'country', direction: 'asc' }] },
  having: { dimensions: ['country'], measures: ['revenue'], having: [{ measure: 'revenue', operator: 'gte', value: 20 }], orderBy: [{ field: 'country', direction: 'asc' }] },
  time: { dimensions: [], measures: ['revenue'], by: 'day', timezone: 'America/Los_Angeles', orderBy: [{ field: 'period', direction: 'asc' }] },
};
