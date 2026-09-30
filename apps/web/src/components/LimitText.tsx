import type { Limit } from '../model';

/**
 * A limit exactly as stored, with its operator and unit (rule 20). Every part is a string the
 * server wrote; nothing here parses or formats a number, so "0.0300" keeps its written zeros.
 */
export function limitText(limit: Limit): string {
  switch (limit.kind) {
    case 'NMT':
      return `NMT ≤ ${limit.value} ${limit.unit}`;
    case 'NLT':
      return `NLT ≥ ${limit.value} ${limit.unit}`;
    case 'range':
      return `NLT ≥ ${limit.low} and NMT ≤ ${limit.high} ${limit.unit}`;
    default: {
      const unhandled: never = limit;
      return unhandled;
    }
  }
}

export function LimitText({ limit }: { limit: Limit }) {
  return <span className="limit">{limitText(limit)}</span>;
}
