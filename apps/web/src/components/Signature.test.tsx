import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { signature } from '../dev/fixtures';
import { SignatureBlock, SignatureLine } from './Signature';

describe('SignatureBlock', () => {
  it('manifests a standing signature: meaning, name, username, role, lab time with zone, UTC, version and hash', () => {
    render(<SignatureBlock signature={signature} />);
    const block = screen.getByRole('region', { name: 'Performed signature' });
    expect(block).toHaveClass('sig--stands');
    expect(within(block).getByRole('banner')).toHaveTextContent('PerformedElectronic Signature');
    for (const text of ['Mei Chen', 'mchen', 'Analyst', '2026-07-14 10:40:12 EDT', '2026-07-14 14:40:12 UTC', 'Test T26-04175, Record Version 2']) {
      expect(within(block).getByText(text)).toBeInTheDocument();
    }
    expect(within(block).getByText('3f9a1c07').tagName).toBe('B');
  });

  it('shows "UNSIGNED — changed after signature" in place of the signature', () => {
    render(<SignatureBlock signature={{ ...signature, standing: 'changed-after-signature' }} />);
    const block = screen.getByRole('region', { name: 'Performed signature' });
    expect(within(block).getByText('UNSIGNED — changed after signature')).toBeInTheDocument();
    expect(within(block).queryByText('Electronic Signature')).not.toBeInTheDocument();
    expect(block).not.toHaveClass('sig--stands');
  });

  it('shows "SIGNATURE INVALID" in place of the signature', () => {
    render(<SignatureBlock signature={{ ...signature, standing: 'invalid' }} />);
    const block = screen.getByRole('region', { name: 'Performed signature' });
    expect(within(block).getByText('SIGNATURE INVALID')).toBeInTheDocument();
    expect(within(block).queryByText('Electronic Signature')).not.toBeInTheDocument();
    expect(block).not.toHaveClass('sig--stands');
  });
});

describe('SignatureLine', () => {
  it('prints meaning, full name, username, role and lab-local time with the zone, with no hover title', () => {
    render(<SignatureLine signature={signature} />);
    const line = screen.getByRole('button', { expanded: false });
    expect(line).toHaveTextContent('Performed');
    expect(line).toHaveTextContent('Mei Chen mchen, Analyst');
    expect(line).toHaveTextContent('10:40 EDT');
    expect(line).not.toHaveAttribute('title');
  });

  it('opens the full SignatureBlock when pressed', async () => {
    render(<SignatureLine signature={signature} />);
    expect(screen.queryByRole('region', { name: 'Performed signature' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('region', { name: 'Performed signature' })).toBeInTheDocument();
  });

  it('reads UNSIGNED in place of the meaning when the record changed after signature', () => {
    render(<SignatureLine signature={{ ...signature, standing: 'changed-after-signature' }} />);
    expect(screen.getByRole('button')).toHaveTextContent('UNSIGNED — changed after signature');
  });
});
