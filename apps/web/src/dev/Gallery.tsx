// Dev-only component gallery at /gallery. It never ships: main.tsx imports it only under
// import.meta.env.DEV, and bundle.test.ts fails if GALLERY_MARKER reaches a production bundle.
// The "server" here is a stub that answers after a delay; it holds no credentials.
import { useState, type ReactNode } from 'react';
import { AppShell, TopBar, type NavItem } from '../components/AppShell';
import { AuditTrailPanel } from '../components/AuditTrailPanel';
import { CriticalDataChangeDialog } from '../components/CriticalDataChangeDialog';
import { FitnessAtUse, FitnessTag } from '../components/FitnessTag';
import { Keypad, applyKey } from '../components/Keypad';
import { LockScreen, SignIn } from '../components/LockScreen';
import { Rail, type RailPrimary } from '../components/Rail';
import { SignatureBlock, SignatureLine } from '../components/Signature';
import { SignaturePrompt } from '../components/SignaturePrompt';
import { DeviationTag, GxpBadge, HoldTag, StatusWord } from '../components/Status';
import { StepBar } from '../components/StepBar';
import { ValueField } from '../components/ValueField';
import { decimalString, parseFitness, type CommitOutcome, type NonEmpty, type Receipt, type Step } from '../model';
import { RoughScreen } from '../screens/rough/RoughScreen';
import { ROUGH_MODULES } from '../screens/rough/modules';
import '../styles/tokens.css';
import '../styles/base.css';
import './gallery.css';
import {
  auditEntries,
  eligibleAnswer,
  keys,
  LAB_ZONE,
  mei,
  ndmaLimit,
  notEligibleAnswer,
  omar,
  PERFORMED_STATEMENT,
  performedTestItem,
  runItem,
  signature,
} from './fixtures';

export const GALLERY_MARKER = 'lims-dev-gallery';

const nextKey = keys();
const workstation = { name: 'Bench PC RD-102-02', room: 'RD-102 Preparation lab' };
const nowAt = () => ({ utc: new Date().toISOString(), zone: LAB_ZONE });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const steps: NonEmpty<Step> = [
  { name: 'Preparations', state: 'done', note: '3 recorded' },
  { name: 'Run', state: 'done', note: 'R26-0412' },
  { name: 'Import', state: 'done', note: 'imported 09:58 EDT' },
  { name: 'Check drafts', state: 'current', note: '4 left' },
  {
    name: 'Sign Performed',
    state: 'blocked',
    note: null,
    reasons: [
      { text: 'Hold H-26-0031, Equipment Deviation DEV-26-0094 on BAL-04' },
      { text: 'Run Check Failure DEV-26-0097 on Run R26-0412' },
    ],
  },
  { name: 'Review', state: 'next', note: null },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="gal__section" id={id} aria-labelledby={`${id}-h`}>
      <h2 className="gal__h" id={`${id}-h`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SigningDemo({ onReceipt }: { onReceipt: (r: Receipt) => void }) {
  const [open, setOpen] = useState<'eligible' | 'refused' | 'failing' | null>(null);
  const [key, setKey] = useState(nextKey);
  const [attempts, setAttempts] = useState(5);
  const [refusal, setRefusal] = useState<string | null>(null);

  const onSign = async (): Promise<CommitOutcome> => {
    await wait(700);
    setKey(nextKey());
    if (attempts > 3) {
      setAttempts((a) => a - 1);
      setRefusal('Wrong user ID, password or code.');
      return 'refused';
    }
    setRefusal(null);
    onReceipt({ summary: 'Signed Test T26-04175 as Performed.', at: nowAt(), kind: 'signed' });
    return 'done';
  };

  return (
    <>
      <p className="gal__note">The stub refuses the first two attempts, then signs. Any credentials work; none are stored.</p>
      <div className="gal__row">
        <button type="button" className="btn" onClick={() => setOpen('eligible')}>
          Open the signature prompt
        </button>
        <button type="button" className="btn" onClick={() => setOpen('failing')}>
          Open it for a failed Check
        </button>
        <button type="button" className="btn" onClick={() => setOpen('refused')}>
          Open it for an ineligible signer
        </button>
      </div>
      {open && (
        <SignaturePrompt
          meaning="Performed"
          statement={PERFORMED_STATEMENT}
          items={open === 'failing' ? [performedTestItem] : [performedTestItem, runItem]}
          consequences={
            open === 'failing'
              ? ['Opens Equipment Deviation DEV-26-0094, Risk Level Major.', 'Places 14 Holds: T26-04161 to T26-04174.', 'Suspends BAL-04.']
              : ['Test T26-04175 moves to Submitted for Review.', 'The imported values become ink.']
          }
          signer={mei}
          lab="RD Newark"
          workstation={workstation.name}
          eligibility={open === 'refused' ? notEligibleAnswer : eligibleAnswer}
          attemptsLeft={attempts}
          refusal={refusal}
          actionLabel={open === 'failing' ? 'Sign failed Check as Performed' : 'Sign Test T26-04175 as Performed'}
          failing={open === 'failing'}
          passkeyAllowed
          commitKey={key}
          onSign={onSign}
          onClosed={() => setOpen(null)}
        />
      )}
    </>
  );
}

function CdcDemo() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(nextKey);
  return (
    <div className="gal__row">
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Change a weight after its first save
      </button>
      {open && (
        <CriticalDataChangeDialog
          record="Preparation 1 of Test T26-04175"
          changes={[{ field: 'Net weight', from: '100.12', to: '100.21', unit: 'mg' }]}
          reasons={[
            { code: 'transcription-error', label: 'Transcription error' },
            { code: 'wrong-unit', label: 'Wrong unit' },
            { code: 'wrong-item-selected', label: 'Wrong item selected' },
          ]}
          refusal={null}
          commitKey={key}
          onSubmit={async () => {
            await wait(600);
            setKey(nextKey());
            return 'done';
          }}
          onClosed={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function EntryDemo() {
  const [value, setValue] = useState('');
  return (
    <div className="gal__entry">
      <ValueField
        label="Room temperature, RD-102"
        unit="°C"
        value={value}
        onChange={setValue}
        limits={[
          { label: 'Limit', limit: { kind: 'range', low: decimalString('15.0'), high: decimalString('25.0'), unit: '°C' } },
          { label: 'Plausible', limit: { kind: 'range', low: decimalString('5.0'), high: decimalString('40.0'), unit: '°C' } },
        ]}
      />
      <ValueField label="NDMA in Preparation 1" unit="ppm" value="0.0112" onChange={() => {}} limits={[{ label: 'Limit', limit: ndmaLimit }]} />
      <Keypad label="Reading keypad" decimal onKey={(k) => k !== 'next' && setValue((v) => applyKey(v, k))} />
    </div>
  );
}

function ShellDemo({ receipt }: { receipt: Receipt | null }) {
  const [module, setModule] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lockKey, setLockKey] = useState(nextKey);
  const blocked: RailPrimary = {
    kind: 'blocked',
    label: 'Sign Performed',
    reason: 'Hold H-26-0031 (Equipment Deviation DEV-26-0094 on BAL-04) blocks it. Run Check Failure DEV-26-0097 is open.',
  };
  const nav: NavItem[] = ROUGH_MODULES.map((m, i) => ({ label: m.title, href: `#${m.slug}`, current: i === module }));
  const current = ROUGH_MODULES[module];
  return (
    <div className="gal__frame">
      <AppShell
        top={<TopBar workstation={workstation} now={nowAt()} nav={nav} />}
        rail={
          <Rail
            identity={{ person: mei, signedInAt: { utc: '2026-09-30T12:02:00Z', zone: LAB_ZONE }, idleLockAt: { utc: '2026-09-30T14:55:00Z', zone: LAB_ZONE }, idleSecondsLeft: null }}
            context={{ main: 'Test T26-04175, NDMA, NDEA, NMBA', sub: 'Method RD-M-017 version 4, Run R26-0412' }}
            receipt={receipt}
            primary={blocked}
            onSwitchUser={() => setLocked(true)}
            onLock={() => setLocked(true)}
          />
        }
      >
        <div className="gal__navrow">
          {ROUGH_MODULES.map((m, i) => (
            <button key={m.slug} type="button" className="btn btn--small" onClick={() => setModule(i)}>
              {m.title}
            </button>
          ))}
        </div>
        {current && <RoughScreen module={current} />}
      </AppShell>
      {locked && (
        <LockScreen
          workstation={workstation}
          now={nowAt()}
          owner={mei}
          reason="manual"
          lockedAt={nowAt()}
          refusal={null}
          passkeyAllowed
          commitKey={lockKey}
          onUnlock={async () => {
            await wait(500);
            setLockKey(nextKey());
            setLocked(false);
            return 'done';
          }}
          onTakeover={async () => {
            await wait(500);
            setLockKey(nextKey());
            return 'refused';
          }}
        />
      )}
    </div>
  );
}

export function Gallery() {
  const [receipt, setReceipt] = useState<Receipt | null>({
    summary: 'Assigned T26-04175 to Mei Chen.',
    at: { utc: '2026-07-14T14:40:12Z', zone: LAB_ZONE },
    kind: 'audited',
  });
  const [screen, setScreen] = useState<'components' | 'shell' | 'signin'>('components');
  const [signInKey] = useState(nextKey);

  if (screen === 'signin') {
    return (
      <div data-gallery={GALLERY_MARKER}>
        <SignIn
          workstation={workstation}
          now={nowAt()}
          destination="Test T26-04175"
          refusal={null}
          passkeyAllowed={false}
          commitKey={signInKey}
          onSignIn={async () => {
            await wait(500);
            setScreen('components');
            return 'done';
          }}
        />
      </div>
    );
  }

  return (
    <div className="gal" data-gallery={GALLERY_MARKER}>
      <header className="gal__top">
        <b>Component gallery</b>
        <span>Dev only. Fictional data. Nothing saves.</span>
        <div className="gal__row">
          <button type="button" className="btn btn--small" onClick={() => setScreen('components')}>
            Components
          </button>
          <button type="button" className="btn btn--small" onClick={() => setScreen('shell')}>
            Shell, rail and rough screens
          </button>
          <button type="button" className="btn btn--small" onClick={() => setScreen('signin')}>
            Sign-in screen
          </button>
        </div>
      </header>
      {screen === 'shell' ? (
        <ShellDemo receipt={receipt} />
      ) : (
        <div className="gal__body">
          <Section id="status" title="Status words, tags and badges">
            <div className="gal__row">
              <StatusWord word="Conforms" tone="ok" />
              <StatusWord word="Provisional" tone="provisional" />
              <StatusWord word="Failed" tone="bad" />
              <StatusWord word="Missing" tone="bad" />
              <StatusWord word="Due tomorrow" tone="warn" />
              <StatusWord word="Not used today" tone="idle" />
              <GxpBadge gxpClass="GMP" />
              <GxpBadge gxpClass="non-GMP" />
            </div>
            <div className="gal__row gal__row--top">
              <HoldTag holds={[{ id: 'H-26-0031', kind: 'Equipment Deviation', reason: 'BAL-04 failed its before-use Check.', blocks: ['Sign Performed'] }]} />
              <HoldTag compact holds={[{ id: 'H-26-0031', kind: 'Equipment Deviation', reason: '', blocks: [] }, { id: 'H-26-0033', kind: 'Customer query', reason: '', blocks: [] }]} />
              <DeviationTag deviation={{ id: 'DEV-26-0094', kind: 'Equipment', riskLevel: 'Minor' }} />
              <DeviationTag deviation={{ id: 'DEV-26-0095', kind: 'OOS', riskLevel: 'Major' }} />
              <DeviationTag deviation={{ id: 'DEV-26-0096', kind: 'Data Integrity', riskLevel: 'Critical' }} />
            </div>
          </Section>
          <Section id="fitness" title="FitnessTag (rule 19)">
            <div className="gal__row">
              <FitnessTag fitness={{ status: 'In use', note: 'calibrated until 2026-11-30' }} />
              <FitnessTag fitness={{ status: 'Quarantined', note: 'awaiting CoA review' }} />
              <FitnessTag fitness={{ status: 'Suspended', note: 'DEV-26-0094' }} />
              <FitnessTag fitness={{ status: 'Expired', note: 'expired 2026-09-01' }} />
              <FitnessTag fitness={{ status: 'Retired', note: 'retired 2025-12-18' }} />
              <FitnessTag fitness={parseFitness('Out for repair', 'since Monday')} />
            </div>
            <div className="gal__row">
              <FitnessTag compact fitness={{ status: 'In use', note: 'calibrated until 2026-11-30' }} />
              <FitnessAtUse
                atUse={{ status: 'In use', note: 'calibrated until 2026-11-30' }}
                changedSince={{ now: { status: 'Suspended', note: 'failed Check 2026-09-29' }, deviationId: 'DEV-26-0094' }}
              />
            </div>
          </Section>
          <Section id="steps" title="StepBar with Blocked reasons">
            <StepBar steps={steps} />
          </Section>
          <Section id="signatures" title="SignatureLine and SignatureBlock">
            <div className="gal__stack">
              <SignatureLine signature={signature} />
              <SignatureLine signature={{ ...signature, meaning: 'Reviewed', signer: omar, standing: 'changed-after-signature' }} />
              <SignatureLine signature={{ ...signature, standing: 'invalid' }} />
            </div>
            <div className="gal__grid3">
              <SignatureBlock signature={signature} />
              <SignatureBlock signature={{ ...signature, standing: 'changed-after-signature' }} />
              <SignatureBlock signature={{ ...signature, standing: 'invalid' }} />
            </div>
          </Section>
          <Section id="signing" title="SignaturePrompt">
            <SigningDemo onReceipt={setReceipt} />
          </Section>
          <Section id="cdc" title="Critical Data Change dialog">
            <CdcDemo />
          </Section>
          <Section id="entry" title="ValueField and Keypad">
            <EntryDemo />
          </Section>
          <Section id="audit" title="AuditTrailPanel">
            <AuditTrailPanel entries={auditEntries} />
          </Section>
        </div>
      )}
    </div>
  );
}
