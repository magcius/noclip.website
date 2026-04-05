/*
 * Some hardcoded models/constants that not present in the game data
 * 
 * petton-svn, 2026.
 */

import { colorNewFromRGBA8 } from "../../../Color.js";

export const PICORI_BLOB_1_COLOR = colorNewFromRGBA8(0xEF097CFF);
export const PICORI_BLOB_10_COLOR = colorNewFromRGBA8(0xFF7F00FF);
export const PICORI_BLOB_50_COLOR = colorNewFromRGBA8(0xEDCA29FF);

export const PICORI_EYES_VERTS = [
  {
    u: 0,
    v: 0,
    x: -2.380000114440918,
    y: 2.380000114440918,
    z: 0,
  },
  {
    u: 20480,
    v: 0,
    x: 2.380000114440918,
    y: 2.380000114440918,
    z: 0,
  },
  {
    u: 0,
    v: 10752,
    x: -2.380000114440918,
    y: -0.11999988555908203,
    z: 0,
  },
  {
    u: 20480,
    v: 10752,
    x: 2.380000114440918,
    y: -0.11999988555908203,
    z: 0,
  },
];

export const PICORI_BODY_VERTS = [
  {
    u: 0,
    v: 0,
    x: -4.880000114440918,
    y: 3.25,
    z: 0,
  },
  {
    u: -32768,
    v: 0,
    x: 4.880000114440918,
    y: 3.25,
    z: 0,
  },
  {
    u: 0,
    v: 16384,
    x: -4.880000114440918,
    y: -1.630000114440918,
    z: 0,
  },
  {
    u: -32768,
    v: 16384,
    x: 4.880000114440918,
    y: -1.630000114440918,
    z: 0,
  },
];

export const PICORI_BLOB_1_VERTS = [
  {
    u: 0,
    v: 0,
    x: -3.3499999046325684,
    y: 3.3499999046325684,
    z: 0,
  },
  {
    u: -32768,
    v: 0,
    x: 3.3499999046325684,
    y: 3.3499999046325684,
    z: 0,
  },
  {
    u: 0,
    v: -32768,
    x: -3.3499999046325684,
    y: -3.3499999046325684,
    z: 0,
  },
  {
    u: -32768,
    v: -32768,
    x: 3.3499999046325684,
    y: -3.3499999046325684,
    z: 0,
  },
];

export const PICORI_BLOB_10_VERTS = [
  {
    u: 0,
    v: 0,
    x: -6,
    y: 6,
    z: 0,
  },
  {
    u: -32768,
    v: 0,
    x: 6,
    y: 6,
    z: 0,
  },
  {
    u: 0,
    v: 32768, // Manually negated this. Not sure how the texture ends up upside down if I don't.
    x: -6,
    y: -6,
    z: 0,
  },
  {
    u: -32768,
    v: 32768, // Manually negated this. Not sure how the texture ends up upside down if I don't.
    x: 6,
    y: -6,
    z: 0,
  },
];

export const PICORI_BLOB_50_VERTS = [
  {
    u: 0,
    v: 0,
    x: -3.3499999046325684,
    y: 3.3499999046325684,
    z: 0,
  },
  {
    u: -32768,
    v: 0,
    x: 3.3499999046325684,
    y: 3.3499999046325684,
    z: 0,
  },
  {
    u: 0,
    v: -32768,
    x: -3.3499999046325684,
    y: -3.3499999046325684,
    z: 0,
  },
  {
    u: -32768,
    v: -32768,
    x: 3.3499999046325684,
    y: -3.3499999046325684,
    z: 0,
  },
];
