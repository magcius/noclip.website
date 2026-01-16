/**
 * Hierarchical profiler for frame timing analysis.
 *
 * Supports two timing methods:
 * - begin()/end(): For low-frequency regions (push/pop stack-based)
 * - record(): For high-frequency operations using manual accumulators
 */

interface TimingRegion {
  name: string;
  children: Map<string, TimingRegion>;
  frameTime: number; // Accumulated time this frame (ms)
  history: number[]; // Circular buffer for rolling average
  historyIndex: number;
  historyCount: number; // Number of valid entries in history
}

interface ProfilerConfig {
  enabled: boolean;
  historySize: number; // Number of frames for rolling average
  printIntervalMs: number; // Console output interval (0 = disabled)
}

const MAX_STACK_DEPTH = 16;

export class HierarchicalProfiler {
  private config: ProfilerConfig;
  private root: TimingRegion;
  private currentRegion: TimingRegion;
  // Pre-allocated fixed-size stacks to avoid push/pop overhead
  private regionStack: (TimingRegion | null)[] = new Array(
    MAX_STACK_DEPTH,
  ).fill(null);
  private startTimeStack: Float64Array = new Float64Array(MAX_STACK_DEPTH);
  private stackDepth: number = 0;
  private lastPrintTime: number = 0;
  private frameStartTime: number = 0;

  constructor(config?: Partial<ProfilerConfig>) {
    this.config = {
      enabled: true,
      historySize: 60,
      printIntervalMs: 3000,
      ...config,
    };
    this.root = this.createRegion("root");
    this.currentRegion = this.root;
  }

  private createRegion(name: string): TimingRegion {
    return {
      name,
      children: new Map(),
      frameTime: 0,
      history: new Array(this.config.historySize).fill(0),
      historyIndex: 0,
      historyCount: 0,
    };
  }

  /**
   * Begin timing a named region. Must be paired with end().
   * Supports nesting - child regions are tracked under the current parent.
   */
  begin(name: string): void {
    if (!this.config.enabled) return;

    // Find or create child region
    let child = this.currentRegion.children.get(name);
    if (!child) {
      child = this.createRegion(name);
      this.currentRegion.children.set(name, child);
    }

    // Push onto pre-allocated stack using index
    const depth = this.stackDepth;
    this.regionStack[depth] = this.currentRegion;
    this.startTimeStack[depth] = performance.now();
    this.stackDepth = depth + 1;
    this.currentRegion = child;
  }

  /**
   * End timing the most recently started region.
   */
  end(_name?: string): void {
    if (!this.config.enabled) return;
    if (this.stackDepth === 0) return;

    const endTime = performance.now();
    const depth = this.stackDepth - 1;
    const elapsed = endTime - this.startTimeStack[depth];

    // Accumulate time
    this.currentRegion.frameTime += elapsed;

    // Pop stack using index
    this.currentRegion = this.regionStack[depth]!;
    this.stackDepth = depth;
  }

  /**
   * Record a pre-accumulated time for a region.
   * Use this for high-frequency operations where begin/end overhead is too high.
   *
   * The name can use dot notation to specify hierarchy: "traverse.culling"
   */
  record(name: string, timeMs: number): void {
    if (!this.config.enabled) return;

    const parts = name.split(".");
    let region = this.root;

    for (const part of parts) {
      let child = region.children.get(part);
      if (!child) {
        child = this.createRegion(part);
        region.children.set(part, child);
      }
      region = child;
    }

    region.frameTime += timeMs;
  }

  /**
   * Call at the start of each frame to reset per-frame accumulators.
   */
  beginFrame(): void {
    if (!this.config.enabled) return;
    this.frameStartTime = performance.now();
    this.resetFrameTimes(this.root);
  }

  private resetFrameTimes(region: TimingRegion): void {
    region.frameTime = 0;
    for (const child of region.children.values()) {
      this.resetFrameTimes(child);
    }
  }

  /**
   * Call at the end of each frame to store times into rolling average
   * and optionally print to console.
   */
  endFrame(): void {
    if (!this.config.enabled) return;

    // Record total frame time
    const frameTime = performance.now() - this.frameStartTime;
    this.record("frame", frameTime);

    this.storeFrameTimes(this.root);

    // Check if we should print
    if (this.config.printIntervalMs > 0) {
      const now = performance.now();
      if (now - this.lastPrintTime >= this.config.printIntervalMs) {
        this.print();
        this.lastPrintTime = now;
      }
    }
  }

  private storeFrameTimes(region: TimingRegion): void {
    region.history[region.historyIndex] = region.frameTime;
    region.historyIndex = (region.historyIndex + 1) % this.config.historySize;
    region.historyCount = Math.min(
      region.historyCount + 1,
      this.config.historySize,
    );

    for (const child of region.children.values()) {
      this.storeFrameTimes(child);
    }
  }

  private computeAverage(region: TimingRegion): number {
    if (region.historyCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < region.historyCount; i++) {
      sum += region.history[i];
    }
    return sum / region.historyCount;
  }

  /**
   * Get a single-line summary for debugConsole.addInfoLine().
   */
  getInfoLine(): string {
    const parts: string[] = [];
    for (const child of this.root.children.values()) {
      const avg = this.computeAverage(child);
      if (avg >= 0.01) {
        parts.push(`${child.name}=${avg.toFixed(2)}ms`);
      }
    }
    return `Profiler: ${parts.join(" ")}`;
  }

  /**
   * Print full hierarchical breakdown to console.
   */
  print(): void {
    if (!this.config.enabled) return;

    const lines: string[] = ["=== Toontown Profiler ==="];
    this.formatRegion(this.root, 0, lines);
    console.log(lines.join("\n"));
  }

  private formatRegion(
    region: TimingRegion,
    indent: number,
    lines: string[],
  ): void {
    // Sort children by average time descending
    const children = Array.from(region.children.values()).sort(
      (a, b) => this.computeAverage(b) - this.computeAverage(a),
    );

    for (const child of children) {
      const avg = this.computeAverage(child);
      if (avg < 0.01) continue; // Skip negligible times

      const prefix = "  ".repeat(indent);
      const timeStr = avg.toFixed(2).padStart(6);
      lines.push(`${prefix}${child.name}: ${timeStr}ms`);

      this.formatRegion(child, indent + 1, lines);
    }
  }

  /**
   * Enable or disable profiling at runtime.
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if profiling is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
