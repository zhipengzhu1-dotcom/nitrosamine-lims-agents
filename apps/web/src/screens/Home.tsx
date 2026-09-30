import { useSession } from '../session/context';
import './screens.css';

/** Where a Lab session lands until the work queue exists. It reads nothing and offers no act. */
export function Home() {
  const { active } = useSession();
  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="h-screen">Work</h1>
        <p className="screen__lede">
          Signed in to Lab {active.lab?.code ?? ''} as {active.person.role}.
        </p>
      </header>
      <p className="screen__note">
        <b>The work queue is not built yet.</b> The sample-chain screens (Submissions, Tests, Runs, review and release) arrive with the next unit.
      </p>
    </div>
  );
}
