import { useId, useMemo, useState } from 'react';
import type { AuditEntry } from '../model';
import { labTime } from '../time';
import { Glyph } from './Glyph';
import './audit.css';

type SortKey = 'when' | 'who' | 'field';
type Sort = { readonly key: SortKey; readonly dir: 'asc' | 'desc' };

const COMPARE: Record<SortKey, (a: AuditEntry, b: AuditEntry) => number> = {
  when: (a, b) => Date.parse(a.at.utc) - Date.parse(b.at.utc),
  who: (a, b) => a.actor.printedName.localeCompare(b.actor.printedName),
  field: (a, b) => `${a.record} ${a.field ?? ''}`.localeCompare(`${b.record} ${b.field ?? ''}`),
};

const COLUMNS: readonly { key: SortKey | null; label: string }[] = [
  { key: 'when', label: 'When' },
  { key: 'who', label: 'Who' },
  { key: 'field', label: 'Record and field' },
  { key: null, label: 'Old → new' },
  { key: null, label: 'Reason' },
];

function haystack(e: AuditEntry): string {
  return [e.actor.printedName, e.actor.username, e.actor.role, e.action, e.record, e.field, e.oldValue, e.newValue, e.reason]
    .filter((s) => s !== null)
    .join(' ')
    .toLowerCase();
}

/**
 * The record's Audit Trail inline (decision 13, rule 12): who with role, old → new, the reason,
 * UTC and the Lab's zone. Searchable and sortable; a change after first save is highlighted with
 * a word and a glyph, not colour alone.
 */
const distinct = (values: readonly string[]): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));

/** A filter over one facet of the trail; the empty choice shows every entry. */
function Facet(props: { label: string; all: string; options: readonly string[]; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <span className="audit__facet">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">{props.all}</option>
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </span>
  );
}

export function AuditTrailPanel({ entries, title = 'Audit Trail' }: { entries: readonly AuditEntry[]; title?: string }) {
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
  const [action, setAction] = useState('');
  const [date, setDate] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'when', dir: 'asc' });
  const searchId = useId();
  const labDate = (e: AuditEntry) => labTime(e.at).date;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const compare = COMPARE[sort.key];
    return entries
      .filter((e) => (person === '' || e.actor.printedName === person) && (action === '' || e.action === action) && (date === '' || labDate(e) === date))
      .filter((e) => q === '' || haystack(e).includes(q))
      .toSorted((a, b) => compare(a, b) * (sort.dir === 'asc' ? 1 : -1));
  }, [entries, query, sort, person, action, date]);

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const later = entries.filter((e) => e.afterFirstSave).length;

  return (
    <section className="panel audit" aria-label={title}>
      <div className="audit__head">
        <h3 className="h-sec">{title}</h3>
        <label className="audit__search" htmlFor={searchId}>
          <Glyph name="search" size={18} />
          <span className="sr-only">Search the Audit Trail</span>
          <input id={searchId} type="search" placeholder="Search who, field, value or reason" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="audit__facets">
          <Facet label="Person" all="Everyone" options={distinct(entries.map((e) => e.actor.printedName))} value={person} onChange={setPerson} />
          <Facet label="Action" all="Every action" options={distinct(entries.map((e) => e.action))} value={action} onChange={setAction} />
          <Facet label="Date" all="Every date" options={distinct(entries.map(labDate))} value={date} onChange={setDate} />
        </div>
        <p className="audit__count">
          {shown.length === entries.length ? `${entries.length} entries` : `${shown.length} of ${entries.length} entries`}
          {later > 0 && `, ${later} changed after first save`}
        </p>
      </div>
      <div className="audit__scroll">
        <table className="audit__table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  scope="col"
                  aria-sort={c.key && sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.key ? (
                    <button type="button" className="audit__sort" onClick={() => c.key && toggle(c.key)}>
                      {c.label}
                      <Glyph name={sort.key !== c.key ? 'sortNone' : sort.dir === 'asc' ? 'sortUp' : 'sortDown'} size={14} />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const t = labTime(e.at, { seconds: true });
              return (
                <tr key={e.id} className={e.afterFirstSave ? 'is-later' : undefined}>
                  <td>
                    <span className="audit__utc">
                      {t.utcDate} {t.utcTime} UTC
                    </span>
                    <span className="sub">
                      {t.date} {t.time} {t.zone}
                    </span>
                  </td>
                  <td>
                    <b>{e.actor.printedName}</b>
                    <span className="sub">
                      {e.actor.role}
                      {e.actor.username && (
                        <>
                          , <span className="mono">{e.actor.username}</span>
                        </>
                      )}
                    </span>
                  </td>
                  <td>
                    {e.record}
                    <span className="sub">{e.field ?? e.action}</span>
                  </td>
                  <td>
                    {e.afterFirstSave && (
                      <span className="audit__later">
                        <Glyph name="pencil" size={14} />
                        Changed after first save
                      </span>
                    )}
                    <span className="audit__change">
                      {e.oldValue === null ? <span className="audit__none">none</span> : <span className="audit__old">{e.oldValue}</span>}
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only"> to </span>
                      {e.newValue === null ? <span className="audit__none">none</span> : <span className="audit__new">{e.newValue}</span>}
                    </span>
                  </td>
                  <td>{e.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="audit__empty">No entry matches the search and filters. Search looks at who, the field, both values and the reason.</p>}
      </div>
    </section>
  );
}
