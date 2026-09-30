import type { Receipt as ReceiptFact } from '../model';
import { shortLabTime } from '../time';
import { Glyph } from './Glyph';

/**
 * The rail's answer after a commit. It exists only once the server confirmed the commit, and it
 * prints the server's time with the zone derived at that instant (rule 9).
 */
export function Receipt({ receipt }: { receipt: ReceiptFact }) {
  const at = shortLabTime(receipt.at);
  return (
    <div className={`rail__context rail__context--receipt rail__context--${receipt.kind === 'signed' ? 'sig' : 'ok'}`} role="status">
      <p className="ctx__main">
        <Glyph name={receipt.kind === 'signed' ? 'sig' : 'check'} size={18} />
        <span>{receipt.summary}</span>
      </p>
      <p className="ctx__sub">
        {receipt.kind === 'signed'
          ? `Signed and recorded in the audit trail at ${at}.`
          : `Recorded in the audit trail at ${at}. Audited, not signed.`}
      </p>
    </div>
  );
}
