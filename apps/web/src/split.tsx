import type { ReactNode } from 'react';

/** A list with one record open beside it, or the record alone on a narrower screen, with Close back to the list. */
export function Split({ list, record, closeHref }: { list: ReactNode; record: ReactNode; closeHref: string }) {
  return (
    <div className="split">
      <section className="split__list">{list}</section>
      <section className="split__record">
        <a className="btn split__close" href={closeHref}>
          Close
        </a>
        {record}
      </section>
    </div>
  );
}
