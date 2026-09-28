import type { TimeGrain } from '../types.js';

const INTERVAL_FUNCTIONS: Record<TimeGrain, string> = {
  minute: 'Minutes', hour: 'Hours', day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters', year: 'Years',
};

export function addTimeSql(time: string, amount: string | number, grain: TimeGrain): string {
  return `add${INTERVAL_FUNCTIONS[grain]}(${time}, ${amount})`;
}

export function subtractTimeSql(time: string, amount: number, grain: TimeGrain): string {
  return `subtract${INTERVAL_FUNCTIONS[grain]}(${time}, ${amount})`;
}
