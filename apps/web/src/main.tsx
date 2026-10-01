import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type Me, onSignedOut } from './api.ts';
import { SignIn } from './signin.tsx';
import { TestPage, Worklist } from './tests.tsx';
import './app.css';

type Route = { page: 'tests' } | { page: 'test'; id: string };

function parse(hash: string): Route {
  const [, a, id] = hash.split('/');
  return a === 'tests' && id ? { page: 'test', id } : { page: 'tests' };
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
  const [me, setMe] = useState<Me | null>();
  const [notice, setNotice] = useState('');
  const route = useRoute();
  useEffect(() => {
    onSignedOut((message) => { setMe(null); setNotice(message); });
    api<Me>('/api/me').then(setMe, () => setNotice(''));
  }, []);

  if (me === undefined) return null;
  if (me === null) return <SignIn notice={notice} onIn={setMe} />;
  switch (route.page) {
    case 'tests': return <Worklist me={me} />;
    case 'test': return <TestPage key={route.id} me={me} id={route.id} />;
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
