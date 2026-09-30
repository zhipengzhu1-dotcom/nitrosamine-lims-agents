import type { NonEmpty, Step } from '../model';
import { Glyph } from './Glyph';
import './stepbar.css';

/**
 * The Test's steps from one server step model. A blocked step reads "Blocked" and prints every
 * reason as text, such as a Hold or the Run Check Failure Deviation ID (rules 15 and 17).
 */
export function StepBar({ steps, label = 'Steps' }: { steps: NonEmpty<Step>; label?: string }) {
  return (
    <ol className="stepbar" aria-label={label}>
      {steps.map((step, i) => (
        <li
          key={step.name}
          className={`stepbar__step is-${step.state}`}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span className="stepbar__n" aria-hidden="true">
            {step.state === 'done' ? <Glyph name="tick" size={14} /> : step.state === 'blocked' ? <Glyph name="noentry" size={16} /> : i + 1}
          </span>
          <span className="stepbar__t">
            <b>{step.name}</b>
            <span className="stepbar__sub">
              {step.state === 'blocked' ? 'Blocked' : step.state === 'done' ? 'Done' : step.state === 'current' ? 'Now' : 'Next'}
              {step.note && `, ${step.note}`}
            </span>
            {step.state === 'blocked' && (
              <ul className="stepbar__why">
                {step.reasons.map((r) => (
                  <li key={r.text}>{r.text}</li>
                ))}
              </ul>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
