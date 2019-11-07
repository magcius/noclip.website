
import { mat4 } from "gl-matrix";
import { GfxCompareMode } from "../platform/GfxPlatform";

// Utilities for depth reversal
const IS_DEPTH_REVERSED = true;

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
        case GfxCompareMode.LESS:    return GfxCompareMode.GREATER;
        case GfxCompareMode.LEQUAL:  return GfxCompareMode.GEQUAL;
        case GfxCompareMode.GEQUAL:  return GfxCompareMode.LEQUAL;
        case GfxCompareMode.GREATER: return GfxCompareMode.LESS;
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
