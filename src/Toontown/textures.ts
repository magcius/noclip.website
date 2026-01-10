import type ArrayBufferSlice from "../ArrayBufferSlice.js";
import { rust } from "../rustlib.js";
import { Format } from "./nodes/textureEnums.js";

/**
 * Decoded image data in RGBA format
 */
export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Supported image formats for decoding
 */
export type ImageFormat = "jpeg" | "png" | "sgi";

/**
 * Expand texture data to RGBA format
 */
export function expandToRGBA(
  data: Uint8Array,
  width: number,
  height: number,
  numComponents: number,
  format: Format,
): Uint8Array {
  const pixelCount = width * height;
  const result = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    let r = 255,
      g = 255,
      b = 255,
      a = 255;

    if (format === Format.Luminance || format === Format.Red) {
      // Grayscale
      const lum = data[i];
      r = g = b = lum;
      a = 255;
    } else if (format === Format.Alpha) {
      // Alpha only
      r = g = b = 255;
      a = data[i];
    } else if (format === Format.LuminanceAlpha) {
      // Luminance + alpha
      const lum = data[i * 2];
      r = g = b = lum;
      a = data[i * 2 + 1];
    } else if (numComponents === 3) {
      // RGB
      r = data[i * 3];
      g = data[i * 3 + 1];
      b = data[i * 3 + 2];
      a = 255;
    } else if (numComponents === 4) {
      // RGBA - direct copy
      r = data[i * 4];
      g = data[i * 4 + 1];
      b = data[i * 4 + 2];
      a = data[i * 4 + 3];
    } else if (numComponents === 1) {
      // Single component - treat as luminance
      r = g = b = data[i];
      a = 255;
    } else if (numComponents === 2) {
      // Two components - luminance + alpha
      r = g = b = data[i * 2];
      a = data[i * 2 + 1];
    }

    result[i * 4] = r;
    result[i * 4 + 1] = g;
    result[i * 4 + 2] = b;
    result[i * 4 + 3] = a;
  }

  return result;
}

/**
 * Decode SGI RGB format image using Rust WASM decoder.
 * Returns null if the data is not a valid SGI image.
 */
function decodeSGI(data: ArrayBufferSlice): DecodedImage {
  const src = data.createTypedArray(Uint8Array);

  // Get dimensions and validate
  const dims = rust.sgi_get_dimensions(src);
  if (dims.width === 0 || dims.height === 0) {
    throw new Error("Invalid SGI image");
  }

  const pixels = rust.decode_sgi(src);
  return { width: dims.width, height: dims.height, data: pixels };
}

/**
 * Decode an image using the canvas element
 */
async function decodeImageCanvas(
  data: ArrayBufferSlice,
  mimeType: string,
): Promise<DecodedImage> {
  const img = document.createElement("img");
  img.crossOrigin = "anonymous";
  const url = window.URL.createObjectURL(
    new Blob([data.createTypedArray(Uint8Array)], { type: mimeType }),
  );
  img.src = url;

  return new Promise((resolve, reject) => {
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      window.URL.revokeObjectURL(url);
      resolve({
        width: img.width,
        height: img.height,
        data: new Uint8Array(imageData.data.buffer),
      });
    };
    img.onerror = (err) => {
      window.URL.revokeObjectURL(url);
      reject(err);
    };
  });
}

/**
 * Get image format from filename extension
 */
export function getImageFormat(filename: string): ImageFormat | null {
  const ext = filename.toLowerCase().split(".").pop() || "";
  switch (ext) {
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "rgb":
    case "rgba":
    case "sgi":
      return "sgi";
    default:
      return null;
  }
}

/**
 * Decode an image in any supported format.
 */
export async function decodeImage(
  data: ArrayBufferSlice,
  format: ImageFormat,
): Promise<DecodedImage> {
  let decoded: DecodedImage;
  if (format === "sgi") {
    decoded = decodeSGI(data);
  } else {
    const mimeType = format === "png" ? "image/png" : "image/jpeg";
    decoded = await decodeImageCanvas(data, mimeType);
  }
  return decoded;
}

/**
 * Merge alpha channel from a separate image into the main image's alpha.
 * Mutates mainImage.data in place.
 * Alpha is taken from the red channel of the alpha image (grayscale).
 */
export function mergeAlphaChannel(
  mainImage: DecodedImage,
  alphaImage: DecodedImage,
): void {
  if (
    mainImage.width !== alphaImage.width ||
    mainImage.height !== alphaImage.height
  ) {
    console.warn(
      `Alpha texture size mismatch: ${alphaImage.width}x${alphaImage.height} vs ${mainImage.width}x${mainImage.height}`,
    );
    return;
  }

  const pixelCount = mainImage.width * mainImage.height;
  for (let i = 0; i < pixelCount; i++) {
    mainImage.data[i * 4 + 3] = alphaImage.data[i * 4 + 0];
  }
}
