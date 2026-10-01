/** The web's one display function for an instant: the ISO 8601 UTC string from the API, shown to the second. */
export const time = (iso: string | null) =>
  // oxlint-disable-next-line no-restricted-globals -- it reads no clock, and it puts any instant the date-time format admits, offsets included, into UTC
  iso ? `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '';
