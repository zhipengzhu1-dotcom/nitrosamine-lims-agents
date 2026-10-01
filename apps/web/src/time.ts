/** The web's one display function for an instant: the ISO 8601 UTC string from the API, shown to the second. */
export const time = (iso: string | null) =>
  // oxlint-disable-next-line no-restricted-globals -- parses an instant to show it; reads no clock
  iso ? `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '';

/** An instant the API already put on a Lab's wall clock (ISO 8601 with its offset), shown to the second with that offset. */
export const labTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} ${iso.slice(-6)}`;
