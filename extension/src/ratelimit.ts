export class RateLimiter {
  constructor(
    private minMs = 2000,
    private maxMs = 4000,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private rand: () => number = Math.random,
  ) {}
  nextDelay(): number {
    return this.minMs + this.rand() * (this.maxMs - this.minMs);
  }
  async wait(): Promise<number> {
    const d = this.nextDelay();
    await this.sleep(d);
    return d;
  }
}

export class RunGuard {
  private steps = 0;
  private running = false;
  constructor(
    public readonly maxSteps: number,
    private cooldownMs: number,
    private now: () => number = Date.now,
    public lastEnd: number | null = null,
  ) {}
  get stepCount(): number {
    return this.steps;
  }
  cooldownLeftMs(): number {
    return this.lastEnd == null ? 0 : Math.max(0, this.lastEnd + this.cooldownMs - this.now());
  }
  canStart(): boolean {
    return !this.running && this.cooldownLeftMs() === 0;
  }
  begin(): boolean {
    if (!this.canStart()) return false;
    this.running = true;
    this.steps = 0;
    return true;
  }
  /** Count one scroll step; false once maxSteps are used up. */
  step(): boolean {
    if (this.steps >= this.maxSteps) return false;
    this.steps += 1;
    return true;
  }
  end(): void {
    this.running = false;
    this.lastEnd = this.now();
  }
}
