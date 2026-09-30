import { Secret, TOTP } from 'otpauth';

const PERIOD_MS = 30_000;

/** A person's phone: it never repeats a step, and never reuses one the server-side setup spent. */
export class Phone {
  readonly #totp: TOTP;
  readonly #used = new Set<number>();
  readonly #floor: number;

  constructor(secret: string, floor: number | null) {
    this.#totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
    this.#floor = floor ?? -1;
  }

  async code(): Promise<string> {
    for (;;) {
      const now = Math.floor(Date.now() / PERIOD_MS);
      const step = [now + 1, now, now - 1].find((s) => s > this.#floor && !this.#used.has(s));
      if (step !== undefined) {
        this.#used.add(step);
        return this.#totp.generate({ timestamp: step * PERIOD_MS });
      }
      await new Promise((r) => setTimeout(r, PERIOD_MS - (Date.now() % PERIOD_MS) + 100));
    }
  }
}
