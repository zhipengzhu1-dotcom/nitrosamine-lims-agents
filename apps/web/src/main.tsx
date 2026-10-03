import { type ActorContext, type AuditedTable, isAuditedTable } from '@lims/domain';
import { Fragment, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type LockMode, onActorChanged, onLocked, onSignedOut, resume } from './api.ts';
import { Placeholder } from './placeholder.tsx';
import { ReportPage } from './report.tsx';
import { AuthenticatorPage, LabSwitchPage, LockScreen, PreferencesPage, SignIn, WelcomePage } from './signin.tsx';
import { TestPage, Worklist } from './tests.tsx';
import { AuditExportPage, TrailPage } from './trail.tsx';
import { type Module, modules } from './rail.tsx';
import './app.css';

type Route =
  | { page: 'tests'; open: string | null }
  | { page: 'test'; id: string }
  | { page: 'report'; id: string }
  | { page: 'switchLab' }
  | { page: 'preferences' }
  | { page: 'welcome'; token: string }
  /** `grant` is the enrolment grant's token from the link an Admin gave, or null when the page was opened without one. */
  | { page: 'authenticator'; grant: string | null }
  | { page: 'trail'; table: AuditedTable; id: string }
  | { page: 'auditExport' }
  /** A rail module; `open` names the record open beside it: the person whose Access Events the Staff module shows, or the System Incident's reference. */
  | { page: 'module'; module: Module; open: string | null };

function parse(hash: string): Route {
  const [path, query] = hash.split('?');
  const [, a, id, b] = (path ?? '').split('/');
  if (a === 'tests' && id && b === 'beside') return { page: 'tests', open: id };
  if (a === 'tests' && id) return b === 'report' ? { page: 'report', id } : { page: 'test', id };
  if (a === 'switch-lab') return { page: 'switchLab' };
  if (a === 'preferences') return { page: 'preferences' };
  if (a === 'welcome' && id) return { page: 'welcome', token: id };
  if (a === 'authenticator') return { page: 'authenticator', grant: new URLSearchParams(query).get('grant') };
  if (a === 'trails' && isAuditedTable(id) && b) return { page: 'trail', table: id, id: b };
  if (a === 'audit-export') return { page: 'auditExport' };
  const module = modules.find((m) => m.key === a && m.key !== 'tests');
  if (!module) return { page: 'tests', open: null };
  if (module.key === 'incidents') return { page: 'module', module, open: id || null };
  return { page: 'module', module, open: module.key === 'staff' && id && b === 'access-events' ? id : null };
}

function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const update = () => setHash(location.hash);
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  return parse(hash);
}

function App() {
  const [me, setMe] = useState<ActorContext | null>();
  const [notice, setNotice] = useState('');
  const [locked, setLocked] = useState<{ message: string; mode: LockMode } | null>(null);
  const route = useRoute();
  useEffect(() => {
    onActorChanged(setMe);
    onSignedOut((message) => {
      setLocked(null);
      setMe(null);
      setNotice(message);
    });
    onLocked((message, mode) => setLocked({ message, mode }));
    resume().then(setMe, () => setNotice(''));
  }, []);

  if (route.page === 'welcome') return <WelcomePage token={route.token} />;
  if (route.page === 'authenticator') return <AuthenticatorPage grant={route.grant} />;
  if (locked)
    return (
      <LockScreen
        key={locked.mode}
        message={locked.message}
        mode={locked.mode}
        onIn={(next) => {
          setLocked(null);
          setMe(next);
        }}
      />
    );
  if (me === undefined) return null;
  if (me === null) return <SignIn notice={notice} onIn={setMe} />;
  // Keyed by the Lab and the person, so that after a Lab switch or Switch user no page keeps what it read before.
  return <Fragment key={`${me.lab.id}:${me.person.id}`}>{page(route, me)}</Fragment>;
}

/** The signed-in pages; the welcome and authenticator pages render before any session, so `App` returns them first. */
function page(route: Exclude<Route, { page: 'welcome' | 'authenticator' }>, me: ActorContext) {
  switch (route.page) {
    case 'tests':
      return <Worklist me={me} open={route.open} />;
    case 'test':
      return <TestPage key={route.id} me={me} id={route.id} />;
    case 'report':
      return <ReportPage key={route.id} me={me} id={route.id} />;
    case 'switchLab':
      return <LabSwitchPage me={me} />;
    case 'preferences':
      return <PreferencesPage me={me} />;
    case 'trail':
      return <TrailPage key={`${route.table}/${route.id}`} me={me} table={route.table} id={route.id} />;
    case 'auditExport':
      return <AuditExportPage me={me} />;
    case 'module':
      return <Placeholder key={`${route.module.key}/${route.open}`} me={me} module={route.module} open={route.open} />;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
