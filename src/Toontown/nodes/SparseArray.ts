import type { DataStream } from "../common";

/**
 * Represents a sparse set of integers as a collection of subranges.
 * Used to efficiently represent which vertex rows are affected by transforms.
 *
 * BAM format:
 * - uint32 numSubranges
 * - For each subrange: int32 begin, int32 end
 * - bool inverse
 */
export interface Subrange {
  begin: number;
  end: number;
}

export class SparseArray {
  public subranges: Subrange[] = [];
  public inverse = false;

  load(data: DataStream): void {
    const numSubranges = data.readUint32();
    this.subranges = [];

    for (let i = 0; i < numSubranges; i++) {
      const begin = data.readInt32();
      const end = data.readInt32();
      this.subranges.push({ begin, end });
    }

    this.inverse = data.readBool();
  }

  /**
   * Check if a given index is in the set.
   */
  contains(index: number): boolean {
    for (const range of this.subranges) {
      if (index >= range.begin && index < range.end) {
        return !this.inverse;
      }
    }
    return this.inverse;
  }

  /**
   * Get the total number of elements in the set.
   */
  get size(): number {
    let count = 0;
    for (const range of this.subranges) {
      count += range.end - range.begin;
    }
    return this.inverse ? -1 : count; // -1 indicates infinite (inverted)
  }
}
