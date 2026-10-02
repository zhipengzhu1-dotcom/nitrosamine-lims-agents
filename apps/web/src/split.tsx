import type { ReactNode } from 'react';

/** A list with one record open beside it at desktop width, the record taking about 60%; narrower, the record alone, with Close back to the list. */
export function Split({ list, record, close }: { list: ReactNode; record: ReactNode; close: string }) {
  return (
    <div className="split">
      <section className="split__list">{list}</section>
      <section className="split__record">
        <a className="btn split__close" href={close}>
          Close
        </a>
        {record}
      </section>
    </div>
  );
}
