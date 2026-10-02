type Capital =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z';

/** A message the web shows as written: the compiler refuses one that does not start with a capital letter and end with a full stop. */
export type Sentence = `${Capital}${string}.`;

/** True when `text` starts with a capital letter and ends with one full stop, for a message the compiler cannot see. */
export const isSentence = (text: string): text is Sentence => /^[A-Z](?:[\s\S]*[^.])?\.$/.test(text);
