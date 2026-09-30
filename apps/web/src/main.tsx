import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');
const root = createRoot(container);

// The gallery is a dev-only page. In a production build `import.meta.env.DEV` is the literal
// false, so this branch and the gallery module drop out of the bundle; bundle.test.ts proves it.
if (import.meta.env.DEV && window.location.pathname.startsWith('/gallery')) {
  const { Gallery } = await import('./dev/Gallery');
  root.render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
