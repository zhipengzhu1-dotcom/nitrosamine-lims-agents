import { type ActorContext, type AuditedTable, isAuditedTable } from '@lims/domain';
import { Fragment, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type LockMode, onActorChanged, onLocked, onSignedOut, resume } from './api.ts';
import { Placeholder } from './placeholder.tsx';
import { ReportPage } from './report.tsx';
import { LabSwitchPage, LockScreen, PreferencesPage, SignIn, WelcomePage } from './signin.tsx';
import { TestPage, Worklist } from './tests.tsx';
import { AuditExportPage, TrailPage } from './trail.tsx';
import { type Module, modules } from './rail.tsx';
import './app.css';

type Route =
  | { page: 'tests' }
  | { page: 'test'; id: string }
  | { page: 'report'; id: string }
  | { page: 'switchLab' }
  | { page: 'preferences' }
  | { page: 'welcome'; token: string }
  | { page: 'trail'; table: AuditedTable; id: string }
  | { page: 'auditExport' }
  | { page: 'module'; module: Module };

function parse(hash: string): Route {
  const [, a, id, b] = hash.split('/');
  if (a === 'tests' && id) return b === 'report' ? { page: 'report', id } : { page: 'test', id };
  if (a === 'switch-lab') return { page: 'switchLab' };
  if (a === 'preferences') return { page: 'preferences' };
  if (a === 'welcome' && id) return { page: 'welcome', token: id };
  if (a === 'trails' && isAuditedTable(id) && b) return { page: 'trail', table: id, id: b };
  if (a === 'audit-export') return { page: 'auditExport' };
  const module = modules.find((m) => m.key === a && m.key !== 'tests');
  return module ? { page: 'module', module } : { page: 'tests' };
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

function page(route: Route, me: ActorContext) {
  switch (route.page) {
    case 'tests':
      return <Worklist me={me} />;
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
    case 'welcome':
      return <WelcomePage token={route.token} />;
    case 'module':
      return <Placeholder key={route.module.key} me={me} module={route.module} />;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
