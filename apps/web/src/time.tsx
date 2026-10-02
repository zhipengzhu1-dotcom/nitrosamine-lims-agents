/** An instant in UTC only, shown to the second: a company record's time, or the time an action ran, such as an Audit Export's Generated. */
export const time = (iso: string | null) =>
  // oxlint-disable-next-line no-restricted-globals -- parses an instant to show it; reads no clock
  iso ? `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '';

const labTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} ${iso.slice(-6)}`;

/** A Lab record's instant as text: UTC, then the Lab's wall clock that the API rendered, when it sent one. */
export const whenText = (at: string, atLab: string | null) => (atLab ? `${time(at)} · ${labTime(atLab)}` : time(at));

/** A Lab record's instant as `whenText` reads, with the Lab's wall clock muted beside the UTC, in one element so a stacked cell keeps it in its value column. */
export function When({ at, atLab }: { at: string; atLab: string | null }) {
  return (
    <span>
      <span className="when">{time(at)}</span>
      {atLab && (
        <span className="muted">
          {' '}
          · <span className="when">{labTime(atLab)}</span>
        </span>
      )}
    </span>
  );
}
