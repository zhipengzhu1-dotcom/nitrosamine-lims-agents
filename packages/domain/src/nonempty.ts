export type NonEmpty<T> = readonly [T, ...T[]];

export function nonEmpty<T>(xs: readonly T[]): NonEmpty<T> | undefined {
  const [first, ...rest] = xs;
  return xs.length === 0 ? undefined : [first as T, ...rest];
}

export function mapNonEmpty<T, U>(xs: NonEmpty<T>, f: (x: T, index: number) => U): NonEmpty<U> {
  const [first, ...rest] = xs;
  return [f(first, 0), ...rest.map((x, i) => f(x, i + 1))];
}
