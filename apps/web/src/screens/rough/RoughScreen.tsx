import './rough.css';

export type RoughModule = {
  readonly slug: string;
  readonly title: string;
  /** What the module will hold, in the glossary's words. */
  readonly holds: string;
  readonly columns: readonly string[];
  /** The ticket or decision that must land before it is built. */
  readonly waitsOn: string;
};

/**
 * A module outside the walking skeleton. It shows where the module will sit and what it will list,
 * and it renders and saves nothing: no field, no command, no pass or fail.
 */
export function RoughScreen({ module }: { module: RoughModule }) {
  return (
    <section className="rough" aria-labelledby={`rough-${module.slug}`}>
      <header className="rough__head">
        <h1 className="h-screen" id={`rough-${module.slug}`}>
          {module.title}
        </h1>
        <p className="rough__holds">{module.holds}</p>
      </header>
      <p className="rough__note">
        <b>Not built in the walking skeleton.</b> Nothing on this screen reads a record or saves anything. {module.waitsOn}
      </p>
      <div className="rough__table" aria-hidden="true">
        <div className="rough__row rough__row--head">
          {module.columns.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        {[0, 1, 2, 3, 4].map((r) => (
          <div className="rough__row" key={r}>
            {module.columns.map((c) => (
              <span key={c}>
                <i />
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
