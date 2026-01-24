import type { ToontownLoader } from "./Loader";

export class AssetVersion {
  constructor(
    public major: number,
    public minor: number,
  ) {}

  compare(other: AssetVersion): number {
    return this.major !== other.major
      ? this.major - other.major
      : this.minor - other.minor;
  }

  equals(other: AssetVersion): boolean {
    return this.major === other.major && this.minor === other.minor;
  }

  toString(): string {
    return `${this.major}.${this.minor}`;
  }
}

export function enumName(
  value: number,
  enumObj: Record<number, string>,
): string {
  return enumObj[value] ?? `Unknown(${value})`;
}

let globalTime = 0;

/**
 * Get the current frame time in seconds.
 */
export function getFrameTime(): number {
  return globalTime;
}

/**
 * Add seconds to the current frame time.
 */
export function addFrameTime(seconds: number): void {
  globalTime += seconds;
}

/**
 * Reset the current frame time to 0.
 */
export function resetFrameTime(): void {
  globalTime = 0;
}

let globalLoader: ToontownLoader | null = null;

export function getLoader(): ToontownLoader {
  if (!globalLoader) throw new Error("Loader not initialized");
  return globalLoader;
}

export function setLoader(loader: ToontownLoader | null): void {
  globalLoader = loader;
}
