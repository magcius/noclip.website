import type { ReadonlyVec3 } from "gl-matrix";

export interface SceneLoader {
  musicFile: string | null;

  load(): Promise<void>;
  enter(): void;
  exit(): void;

  getDropPoints(): readonly [ReadonlyVec3, number][];
}
