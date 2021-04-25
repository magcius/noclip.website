
// Reversed depth support

import { mat4 } from "gl-matrix";
import { GfxCompareMode } from "../platform/GfxPlatform";

export const IS_DEPTH_REVERSED = true;

export function reverseDepthForPerspectiveProjectionMatrix(m: mat4, isDepthReversed = IS_DEPTH_REVERSED): void {
    if (isDepthReversed) {
        m[10] = -m[10];
        m[14] = -m[14];
    }
}

export function reverseDepthForOrthographicProjectionMatrix(m: mat4, isDepthReversed = IS_DEPTH_REVERSED): void {
    if (isDepthReversed) {
        m[10] = -m[10];
        m[14] = -m[14] + 1;
    }
}

export function reverseDepthForCompareMode(compareMode: GfxCompareMode, isDepthReversed = IS_DEPTH_REVERSED): GfxCompareMode {
    if (isDepthReversed) {
        switch (compareMode) {
        case GfxCompareMode.Less:    return GfxCompareMode.Greater;
        case GfxCompareMode.LessEqual:  return GfxCompareMode.GreaterEqual;
        case GfxCompareMode.GreaterEqual:  return GfxCompareMode.LessEqual;
        case GfxCompareMode.Greater: return GfxCompareMode.Less;
        default: return compareMode;
        }
    } else {
        return compareMode;
    }
}

export function reverseDepthForClearValue(n: number, isDepthReversed = IS_DEPTH_REVERSED): number {
    if (isDepthReversed) {
        return 1.0 - n;
    } else {
        return n;
    }
}

export function reverseDepthForDepthOffset(n: number, isDepthReversed = IS_DEPTH_REVERSED): number {
    if (isDepthReversed) {
        return -n;
    } else {
        return n;
    }
}

export function compareDepthValues(a: number, b: number, op: GfxCompareMode, isDepthReversed = IS_DEPTH_REVERSED): boolean {
    op = reverseDepthForCompareMode(op, isDepthReversed);
    if (op === GfxCompareMode.Less)
        return a < b;
    else if (op === GfxCompareMode.LessEqual)
        return a <= b;
    else if (op === GfxCompareMode.Greater)
        return a > b;
    else if (op === GfxCompareMode.GreaterEqual)
        return a >= b;
    else
        throw "whoops";
}
