import './styles/tokens.css';
import './styles/base.css';

/** Until the session unit lands, production shows no record and offers no action. */
export function App() {
  return (
    <main className="not-wired">
      <h1 className="h-screen">Nitrosamine LIMS</h1>
      <p>This build holds the screens and components only. Sign-in arrives with the session gate.</p>
    </main>
  );
}
