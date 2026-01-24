import { quat, vec3 } from "gl-matrix";
import type { DataStream } from "./DataStream";
import { quatToHpr } from "./Math";

/**
 * Run-length encoding width markers.
 * The top 2 bits indicate the width, bottom 6 bits indicate the length.
 */
enum RunWidth {
  RW_WIDTH_MASK = 0xc0,
  RW_LENGTH_MASK = 0x3f,
  RW_0 = 0x00, // All zeros (no data)
  RW_8 = 0x40, // 8-bit integers
  RW_16 = 0x80, // 16-bit integers
  RW_32 = 0xc0, // 32-bit integers
  RW_DOUBLE = 0xff, // 64-bit double (special case)
}

/**
 * FFT Compressor for reading Panda3D's lossy animation compression.
 *
 * This class decompresses floating-point animation data that was compressed
 * using FFT-based lossy compression. The compression stores quantized FFT
 * coefficients which are run-length encoded by their bit width.
 */
export class FFTCompressor {
  private _quality = 0;
  private _fftOffset = 0;
  private _fftFactor = 0;
  private _fftExponent = 0;

  /**
   * Read the compression header from the data stream.
   * Must be called before reading any compressed data.
   */
  readHeader(data: DataStream): void {
    this._quality = data.readInt8();

    if (this._quality < 0) {
      // Custom compression parameters
      this._fftOffset = data.readFloat64();
      this._fftFactor = data.readFloat64();
      this._fftExponent = data.readFloat64();
    } else {
      // Compute parameters from quality level
      this.setQualityParams(this._quality);
    }
  }

  private setQualityParams(quality: number): void {
    if (quality < 40) {
      // 0 - 40: fft-offset 1.0 - 0.001, fft-factor 1.0, fft-exponent 4.0
      const t = quality / 40.0;
      this._fftOffset = 1.0 + t * (0.001 - 1.0);
      this._fftFactor = 1.0;
      this._fftExponent = 4.0;
    } else if (quality < 95) {
      // 40 - 95: fft-offset 0.001, fft-factor 1.0 - 0.1, fft-exponent 4.0
      const t = (quality - 40) / 55.0;
      this._fftOffset = 0.001;
      this._fftFactor = 1.0 + t * (0.1 - 1.0);
      this._fftExponent = 4.0;
    } else {
      // 95 - 100: fft-offset 0.001, fft-factor 0.1 - 0.0, fft-exponent 4.0
      const t = (quality - 95) / 5.0;
      this._fftOffset = 0.001;
      this._fftFactor = 0.1 + t * (0.0 - 0.1);
      this._fftExponent = 4.0;
    }
  }

  /**
   * Read an array of floating-point numbers from the stream.
   */
  readReals(data: DataStream): Float32Array {
    const length = data.readInt32();

    if (this._quality > 100 || length < 2) {
      // Lossless output: just read raw floats
      return data.readFloat32Array(length);
    }

    // Check if compression was rejected for this stream
    const rejectCompression = data.readBool();
    if (rejectCompression) {
      return data.readFloat32Array(length);
    }

    // Read run-length encoded FFT coefficients
    const halfComplex: number[] = [];
    while (halfComplex.length < length) {
      this._readRun(data, halfComplex);
    }

    // Apply scale factors to reconstruct halfcomplex array
    for (let i = 0; i < length; i++) {
      halfComplex[i] *= this._getScaleFactor(i, length);
    }

    // Apply inverse real FFT
    const result = this._inverseRealFFT(halfComplex);

    // Scale by 1/length (FFTW normalization)
    const scale = 1.0 / length;
    const output = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      output[i] = result[i] * scale;
    }

    return output;
  }

  /**
   * Read an array of HPR angles from the stream.
   * HPR angles are stored as quaternion components (i, j, k) with r inferred.
   */
  readHprs(data: DataStream, _newHpr: boolean): Float32Array[] {
    // Read the three quaternion components
    const qi = this.readReals(data);
    const qj = this.readReals(data);
    const qk = this.readReals(data);

    const length = qi.length;
    if (length === 0) {
      return [new Float32Array(0), new Float32Array(0), new Float32Array(0)];
    }

    const h = new Float32Array(length);
    const p = new Float32Array(length);
    const r = new Float32Array(length);

    const q = quat.create();
    const hpr = vec3.create();
    for (let i = 0; i < length; i++) {
      q[0] = qi[i];
      q[1] = qj[i];
      q[2] = qk[i];
      quat.calculateW(q, q); // Infer the W component
      quatToHpr(hpr, q);
      h[i] = hpr[0];
      p[i] = hpr[1];
      r[i] = hpr[2];
    }

    return [h, p, r];
  }

  /**
   * Read a run-length encoded sequence of integers.
   */
  private _readRun(data: DataStream, output: number[]): void {
    const startByte = data.readUint8();
    let runWidth: number;
    let length: number;

    if (startByte === RunWidth.RW_DOUBLE) {
      // Special case: single double value
      output.push(data.readFloat64());
      return;
    }

    runWidth = startByte & RunWidth.RW_WIDTH_MASK;
    length = startByte & RunWidth.RW_LENGTH_MASK;

    if (length === 0) {
      // Actual length follows as uint16
      length = data.readUint16();
    }

    switch (runWidth) {
      case RunWidth.RW_0:
        // All zeros
        for (let i = 0; i < length; i++) {
          output.push(0);
        }
        break;

      case RunWidth.RW_8:
        // 8-bit signed integers
        for (let i = 0; i < length; i++) {
          output.push(data.readInt8());
        }
        break;

      case RunWidth.RW_16:
        // 16-bit signed integers
        for (let i = 0; i < length; i++) {
          output.push(data.readInt16());
        }
        break;

      case RunWidth.RW_32:
        // 32-bit signed integers
        for (let i = 0; i < length; i++) {
          output.push(data.readInt32());
        }
        break;
    }
  }

  /**
   * Get the scale factor for a given position in the halfcomplex array.
   */
  private _getScaleFactor(i: number, length: number): number {
    const m = Math.floor(length / 2) + 1;
    const k = i < m ? i : length - i;
    return (
      this._fftOffset +
      this._fftFactor * ((m - 1 - k) / (m - 1)) ** this._fftExponent
    );
  }

  /**
   * Perform inverse real FFT (FFTW halfcomplex format to real).
   *
   * FFTW's halfcomplex format for n elements:
   * [r0, r1, r2, ..., r(n/2), i(n/2-1), ..., i2, i1]
   *
   * Where r_k is the real part and i_k is the imaginary part of the k-th frequency.
   */
  private _inverseRealFFT(halfComplex: number[]): number[] {
    const n = halfComplex.length;
    const result = new Array<number>(n);

    // Extract real and imaginary parts from halfcomplex format
    const m = Math.floor(n / 2) + 1;
    const real = new Array<number>(m);
    const imag = new Array<number>(m);

    // r0 has no imaginary part
    real[0] = halfComplex[0];
    imag[0] = 0;

    // Middle frequencies
    for (let k = 1; k < m; k++) {
      real[k] = halfComplex[k];
      if (k < n - k) {
        imag[k] = halfComplex[n - k];
      } else {
        // For n/2 when n is even, there's no imaginary part
        imag[k] = 0;
      }
    }

    // Compute inverse DFT
    const twoPiOverN = (2 * Math.PI) / n;
    for (let i = 0; i < n; i++) {
      let sum = real[0]; // DC component

      for (let k = 1; k < m; k++) {
        const angle = twoPiOverN * k * i;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // For real signal: X[k] = R[k] + jI[k], X[n-k] = R[k] - jI[k]
        // x[i] = sum of X[k] * e^(j*2*pi*k*i/n) for k=0 to n-1
        // For real: x[i] = R[0] + 2*sum(R[k]*cos - I[k]*sin) for k=1 to n/2-1, plus n/2 term
        if (k === n - k) {
          // k = n/2 for even n
          sum += real[k] * cos;
        } else {
          sum += 2 * (real[k] * cos - imag[k] * sin);
        }
      }

      result[i] = sum;
    }

    return result;
  }
}
