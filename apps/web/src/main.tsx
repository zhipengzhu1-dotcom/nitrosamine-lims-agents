import { type ActorContext, type AuditedTable, isAuditedTable } from '@lims/domain';
import { Fragment, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { onActorChanged, onSignedOut, resume } from './api.ts';
import { Placeholder } from './placeholder.tsx';
import { ReportPage } from './report.tsx';
import { LabSwitchPage, SignIn } from './signin.tsx';
import { TestPage, Worklist } from './tests.tsx';
import { TrailPage } from './trail.tsx';
import { type Module, modules } from './rail.tsx';
import './app.css';

type Route =
  | { page: 'tests' }
  | { page: 'test'; id: string }
  | { page: 'report'; id: string }
  | { page: 'switchLab' }
  | { page: 'trail'; table: AuditedTable; id: string }
  | { page: 'module'; module: Module };

function parse(hash: string): Route {
  const [, a, id, b] = hash.split('/');
  if (a === 'tests' && id) return b === 'report' ? { page: 'report', id } : { page: 'test', id };
  if (a === 'switch-lab') return { page: 'switchLab' };
  if (a === 'trails' && isAuditedTable(id) && b) return { page: 'trail', table: id, id: b };
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
  const route = useRoute();
  useEffect(() => {
    onActorChanged(setMe);
    onSignedOut((message) => {
      setMe(null);
      setNotice(message);
    });
    resume().then(setMe, () => setNotice(''));
  }, []);

  if (me === undefined) return null;
  if (me === null) return <SignIn notice={notice} onIn={setMe} />;
  // Keyed by the Lab, so that after a Lab switch no page keeps what it read in the Lab before.
  return <Fragment key={me.lab.id}>{page(route, me)}</Fragment>;
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
    case 'trail':
      return <TrailPage key={`${route.table}/${route.id}`} me={me} table={route.table} id={route.id} />;
    case 'module':
      return <Placeholder key={route.module.key} me={me} module={route.module} />;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
