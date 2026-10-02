const device = matchMedia('(prefers-reduced-motion: reduce)');
let personReduces = false;

/** True when the device or the signed-in person asks for reduced motion: the person's preference only ever adds to the device's. */
export const reducedMotion = () => device.matches || personReduces;

// app.css keys every reduced-motion rule on this attribute, so the device's and the person's setting share one set of rules.
const apply = () => document.documentElement.toggleAttribute('data-reduce-motion', reducedMotion());
device.addEventListener('change', apply);
apply();

/** Applies the signed-in person's preference, or none (false) once no one is signed in. */
export function setPersonReducesMotion(reduces: boolean): void {
  personReduces = reduces;
  apply();
}
