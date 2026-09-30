import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { auditEntries } from '../dev/fixtures';
import { AuditTrailPanel } from './AuditTrailPanel';

const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('AuditTrailPanel', () => {
  it('shows who with role, old → new, the reason, and UTC with the Lab zone', () => {
    render(<AuditTrailPanel entries={auditEntries} />);
    const row = bodyRows()[1];
    if (!row) throw new Error('no row');
    expect(row).toHaveTextContent('2026-07-14 13:09:10 UTC');
    expect(row).toHaveTextContent('2026-07-14 09:09:10 EDT');
    expect(row).toHaveTextContent('Mei ChenAnalyst, mchen');
    expect(row).toHaveTextContent('100.12 mg → to 100.21 mg');
    expect(row).toHaveTextContent('Transcription error');
  });

  it('highlights a change after first save with a word, not colour alone', () => {
    render(<AuditTrailPanel entries={auditEntries} />);
    const later = bodyRows().filter((r) => within(r).queryByText('Changed after first save'));
    expect(later).toHaveLength(1);
    expect(later[0]).toHaveClass('is-later');
  });

  it('searches across who, field, values and reason', async () => {
    render(<AuditTrailPanel entries={auditEntries} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the Audit Trail' }), 'transcription');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('1 of 4 entries, 1 changed after first save')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'ohaddad');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Omar Haddad');
  });

  it('sorts by time, newest first on a second press, and by who', async () => {
    render(<AuditTrailPanel entries={auditEntries} />);
    const when = screen.getByRole('columnheader', { name: 'When' });
    expect(when).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(within(when).getByRole('button'));
    expect(when).toHaveAttribute('aria-sort', 'descending');
    expect(bodyRows()[0]).toHaveTextContent('Omar Haddad');
    await userEvent.click(screen.getByRole('button', { name: 'Who' }));
    expect(screen.getByRole('columnheader', { name: 'Who' })).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyRows()[0]).toHaveTextContent('Mei Chen');
    expect(bodyRows()[3]).toHaveTextContent('Omar Haddad');
  });
});
