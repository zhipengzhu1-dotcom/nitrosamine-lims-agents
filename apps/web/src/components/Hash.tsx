import type { Sha256Hex } from '../model';

/** The full SHA-256 in 8-character groups, the first 8 highlighted. Copying it yields the plain hex. */
export function Hash({ value }: { value: Sha256Hex }) {
  const groups = value.match(/.{1,8}/g) ?? [value];
  return (
    <span className="hash mono">
      {groups.map((g, i) => (i === 0 ? <b key={i}>{g}</b> : <span key={i}>{g}</span>))}
    </span>
  );
}
