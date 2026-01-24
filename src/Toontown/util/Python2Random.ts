/**
 * Python 2 Mersenne Twister PRNG implementation.
 */
export class Python2Random {
  private static readonly N = 624;
  private mt: Uint32Array = new Uint32Array(Python2Random.N);
  private mti: number = Python2Random.N + 1;

  constructor(seed?: number) {
    if (seed !== undefined) {
      this.seed(seed);
    }
  }

  /**
   * Initialize the generator with a single seed value.
   */
  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < Python2Random.N; i++) {
      const prev = this.mt[i - 1];
      const xored = prev ^ (prev >>> 30);
      this.mt[i] = (this.mulUint32(1812433253, xored) + i) >>> 0;
    }
    this.mti = Python2Random.N;
  }

  /**
   * Initialize the generator with an array of seeds.
   */
  private initByArray(initKey: number[]): void {
    const N = Python2Random.N;
    this.initGenrand(19650218);

    let i = 1;
    let j = 0;
    let k = N > initKey.length ? N : initKey.length;

    for (; k > 0; k--) {
      const prev = this.mt[i - 1];
      const xored = prev ^ (prev >>> 30);
      this.mt[i] =
        ((this.mt[i] ^ this.mulUint32(1664525, xored)) + initKey[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
      if (j >= initKey.length) j = 0;
    }

    for (k = N - 1; k > 0; k--) {
      const prev = this.mt[i - 1];
      const xored = prev ^ (prev >>> 30);
      this.mt[i] = (this.mt[i] ^ this.mulUint32(1566083941, xored)) >>> 0;
      // Subtract i, handling unsigned arithmetic
      this.mt[i] = (this.mt[i] - i) >>> 0;
      i++;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
    }

    // MSB is 1; assuring non-zero initial array
    this.mt[0] = 0x80000000;
  }

  /**
   * Initialize the generator with a seed.
   */
  seed(s: number): void {
    // Python 2 converts integer seeds to an array of 32-bit values
    // For seeds that fit in 32 bits, it's just [seed]
    const key = [s >>> 0];
    this.initByArray(key);
  }

  /**
   * Multiply two 32-bit unsigned integers and return lower 32 bits.
   */
  private mulUint32(a: number, b: number): number {
    const aLo = a & 0xffff;
    const aHi = a >>> 16;
    const bLo = b & 0xffff;
    const bHi = b >>> 16;

    const lo = aLo * bLo;
    const mid = aLo * bHi + aHi * bLo;
    return (lo + ((mid & 0xffff) << 16)) >>> 0;
  }

  /**
   * Generate a random 32-bit unsigned integer.
   */
  private genrandUint32(): number {
    const N = Python2Random.N;
    const M = 397;
    const MATRIX_A = 0x9908b0df;
    const UPPER_MASK = 0x80000000;
    const LOWER_MASK = 0x7fffffff;

    if (this.mti >= N) {
      let kk: number;

      for (kk = 0; kk < N - M; kk++) {
        const y = (this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK);
        this.mt[kk] = this.mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = (this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK);
        this.mt[kk] =
          this.mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      const y = (this.mt[N - 1] & UPPER_MASK) | (this.mt[0] & LOWER_MASK);
      this.mt[N - 1] = this.mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);

      this.mti = 0;
    }

    let y = this.mt[this.mti++];

    // Tempering
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;

    return y >>> 0;
  }

  /**
   * Generate a random float in [0.0, 1.0).
   */
  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864.0 + b) / 9007199254740992.0;
  }

  /**
   * Return random integer in range [start, stop).
   */
  randrange(start: number, stop: number): number {
    const n = stop - start;
    if (n <= 0) {
      throw new Error(`Empty range for randrange(${start}, ${stop})`);
    }
    return start + Math.floor(this.random() * n);
  }

  /**
   * Return random integer in range [a, b].
   */
  randint(a: number, b: number): number {
    return this.randrange(a, b + 1);
  }

  /**
   * Choose a random element from an array.
   */
  choice<T>(seq: T[]): T {
    if (seq.length === 0) {
      throw new Error("Cannot choose from empty sequence");
    }
    return seq[this.randint(0, seq.length - 1)];
  }
}
