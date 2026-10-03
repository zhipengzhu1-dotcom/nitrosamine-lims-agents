import { type ChecklistView, checklistRefusal, routes, type Ticks } from '@lims/domain';
import { Fragment } from 'react';
import { api } from './api.ts';
import { type RailAction, readAgainIfMoved, type SigningView, stepAction } from './rail.tsx';

/** The ticks of the items this version still holds, so a tick of a superseded version is never sent. */
const ticksOn = (checklist: ChecklistView, ticks: Ticks): Ticks =>
  Object.fromEntries(Object.entries(ticks).filter(([key]) => checklist.items.some((i) => i.ticked && i.key === key)));

/** The Test Review Checklist in force: evidence the LIMS shows as label and value, and the items the Reviewer ticks. */
export function ChecklistPanel({
  checklist,
  ticks,
  onChange,
}: {
  checklist: ChecklistView;
  ticks: Ticks;
  onChange: (ticks: Ticks) => void;
}) {
  return (
    <section className="card checklist" aria-labelledby="checklist-title">
      <h2 id="checklist-title">Test Review Checklist, version {checklist.version}</h2>
      {checklist.items.map((item) =>
        item.ticked ? (
          <div key={item.key} className="checklist__item">
            <label className="check">
              <input
                type="checkbox"
                checked={item.key in ticks}
                onChange={(e) => {
                  const { [item.key]: _, ...rest } = ticks;
                  onChange(e.target.checked ? { ...rest, [item.key]: { comment: null } } : rest);
                }}
              />
              {item.text}
            </label>
            {item.needsComment && (
              <label>
                Comment on “{item.text}”
                <textarea
                  disabled={!(item.key in ticks)}
                  value={ticks[item.key]?.comment ?? ''}
                  onChange={(e) => onChange({ ...ticks, [item.key]: { comment: e.target.value } })}
                />
              </label>
            )}
          </div>
        ) : (
          <div key={item.key} className="checklist__item">
            <h3>{item.text}</h3>
            <dl className="facts">
              {Object.entries(item.value).map(([label, value]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        ),
      )}
    </section>
  );
}

/**
 * The Review press: blocked with the first missing tick or comment, it saves the Test Review when pressed, and the sheet
 * then signs that review's Record Version, listing the checklist version and each tick with its comment.
 */
export function reviewAction(
  testId: string,
  what: string[],
  checklist: ChecklistView,
  ticks: Ticks,
  onDone: () => Promise<void>,
  signing: SigningView | null,
): RailAction {
  const sent = ticksOn(checklist, ticks);
  return {
    ...stepAction('review', testId, what, onDone, signing),
    blocked: checklistRefusal(checklist.items, sent),
    async prepare() {
      const saved = await api(routes.saveReview, { testId, checklistVersion: checklist.version, ticks: sent }).catch(
        readAgainIfMoved(onDone),
      );
      // The press is blocked until every item is ticked, so the sheet names the count and each comment, and stays short
      // enough to show whole on a phone held sideways.
      const ticked = checklist.items.filter((i) => i.ticked);
      const comments = ticked.flatMap((i) => (sent[i.key]?.comment ? [`${i.text}: ${sent[i.key]?.comment}`] : []));
      return stepAction(
        'review',
        testId,
        [
          ...what,
          `Test Review Checklist, version ${checklist.version}, all ${ticked.length} items ticked`,
          ...comments,
        ],
        onDone,
        signing && { recordVersion: saved.recordVersion, statement: signing.statement },
        { review: saved.review },
      );
    },
  };
}
