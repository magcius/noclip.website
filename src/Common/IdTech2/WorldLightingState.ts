
import { lerp } from "../../MathHelpers.js";

export const MAX_LIGHTSTYLES = 64;
export const LIGHTSTYLE_FRAMERATE = 10;

// Default light style patterns (styles 0-12) as defined in Quake/Half-Life/Source
// 'a' = off (0.0), 'm' = normal (1.0), 'z' = double bright (~2.08)
const DEFAULT_LIGHTSTYLE_PATTERNS: string[] = [
    'm',                                                   // 0: Normal
    'mmnmmommommnonmmonqnmmo',                             // 1: Flicker A
    'abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba', // 2: Slow strong pulse
    'mmmmmaaaaammmmmaaaaaabcdefgabcdefg',                  // 3: Candle A
    'mamamamamama',                                        // 4: Fast strobe
    'jklmnopqrstuvwxyzyxwvutsrqponmlkj',                   // 5: Gentle pulse
    'nmonqnmomnmomomno',                                   // 6: Flicker B
    'mmmaaaabcdefgmmmmaaaammmaamm',                        // 7: Candle B
    'mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa',          // 8: Candle C
    'aaaaaaaazzzzzzzz',                                    // 9: Slow strobe
    'mmamammmmammamamaaamammma',                           // 10: Fluorescent flicker
    'abcdefghijklmnopqrrqponmlkjihgfedcba',                // 11: Slow pulse, no black
    'mmnnmmnnnmmnn',                                       // 12: Source-specific 'underwater light mutation'
];

export class WorldLightingState {
    public styleIntensities = new Float32Array(MAX_LIGHTSTYLES);
    public stylePatterns: string[] = [];
    public smoothAnim = false;

    constructor() {
        this.styleIntensities.fill(1.0);

        for (let i = 0; i < DEFAULT_LIGHTSTYLE_PATTERNS.length; i++)
            this.stylePatterns[i] = DEFAULT_LIGHTSTYLE_PATTERNS[i];

        for (let i = this.stylePatterns.length; i < MAX_LIGHTSTYLES; i++)
            this.stylePatterns[i] = 'm';
    }

    public setPattern(index: number, pattern: string): void {
        if (index >= 0 && index < MAX_LIGHTSTYLES) {
            this.stylePatterns[index] = pattern.length > 0 ? pattern : 'm';
        }
    }

    public getValue(index: number): number {
        if (index >= 0 && index < MAX_LIGHTSTYLES) {
            return this.styleIntensities[index];
        }
        return 1.0;
    }

    public update(timeInSeconds: number): void {
        const time = timeInSeconds * LIGHTSTYLE_FRAMERATE;

        for (let i = 0; i < this.styleIntensities.length; i++) {
            const pattern = this.stylePatterns[i];
            if (pattern === undefined || pattern.length === 0)
                continue;

            this.styleIntensities[i] = this.styleIntensityFromPattern(pattern, time);
        }
    }

    private styleIntensityFromChar(c: number): number {
        // 'a' = 0x61 = 97, maps to 0.0
        // 'm' = 0x6D = 109, maps to 1.0
        // 'z' = 0x7A = 122, maps to ~2.08
        const alpha = c - 0x61;
        return (alpha * 22) / 264.0;
    }

    private styleIntensityFromPattern(pattern: string, time: number): number {
        const t = time % pattern.length;
        const i0 = t | 0;
        const p0 = this.styleIntensityFromChar(pattern.charCodeAt(i0));

        if (this.smoothAnim) {
            const i1 = (i0 + 1) % pattern.length;
            const t01 = t - i0;
            const p1 = this.styleIntensityFromChar(pattern.charCodeAt(i1));
            return lerp(p0, p1, t01);
        } else {
            return p0;
        }
    }
}

