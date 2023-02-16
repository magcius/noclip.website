import { GfxDevice, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import { GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { lerp } from '../MathHelpers';

import { SFATexture } from './textures';

interface Hair {
    layerCount: number;
    x: number;
    y: number;
    baseRadius: number;
    tipRadius: number;
}

function evaluateHairs(x: number, y: number, layer: number, hairs: Hair[]): [number, number] {
    let A = 0;
    let I = 0;

    for (let i = 0; i < hairs.length; i++) {
        const hair = hairs[i];

        if (layer < hair.layerCount) {
            const dx = hair.x - x;
            const dy = hair.y - y;

            const fz = Math.sqrt(Math.min(1.0, 0.25 + (hair.layerCount - layer) / hair.layerCount));

            const fx = Math.min(Math.abs(dx), Math.abs(dx + 1), Math.abs(dx - 1));

            let iFactor = Math.max(0, -dy);
            let fVar4 = Math.abs(dy + 1);
            let fy = Math.abs(dy);
            if (fVar4 < fy) {
                fy = fVar4;
                iFactor = 0;
            }

            let ady = Math.abs(dy - 1);
            if (ady < fy) {
                fy = ady;
                if (dy < 1)
                    iFactor = 1 - dy;
            }

            const dist = Math.hypot(fx, fy);
            const radius = lerp(hair.baseRadius, hair.tipRadius, Math.sqrt(layer / hair.layerCount));
            if (dist <= radius) {
                let aFactor = 1 - dist / radius;
                if (aFactor > 0)
                    aFactor = Math.sqrt(aFactor);
                A += fz * aFactor;
                I += 0.5 * -(layer / 16 - 1) + iFactor / radius;
            }
        }
    }

    if (A > 1)
        A = 1;
    if (I > 1)
        I = 1;
    return [I / 8 + 7/16, A];
}

function random(lo: number, hi: number) {
    return lerp(lo, hi, Math.random());
}

export class FurFactory {
    private layers: SFATexture[] = [];
    private hairs: Hair[] = [];

    constructor(private device: GfxDevice) {
        // Distribute 50 hairs within the fur map and ensure they aren't too
        // densely packed.
        const NUM_HAIRS = 50;
        const MAX_TRIES = 10000;
        let tries = 0;
        for (let i = 0; i < NUM_HAIRS && tries < MAX_TRIES; i++) {
            const newHair: Hair = {
                layerCount: random(8, 16),
                x: 0,
                y: 0,
                baseRadius: 0.01 * random(5, 10),
                tipRadius: 0,
            };
            newHair.tipRadius = newHair.baseRadius * 0.01 * random(20, 50);
    
            let fail = false;
            do {
                newHair.x = 0.001 * random(0, 999);
                newHair.y = 0.001 * random(0, 999);
    
                fail = false;
                for (let j = 0; j < i; j++) {
                    const cmpHair = this.hairs[j];
                    const cmpX = newHair.x - cmpHair.x;
                    const cmpY = newHair.y - cmpHair.y;
    
                    const fx = Math.min(Math.abs(cmpX), Math.abs(cmpX + 1), Math.abs(cmpX - 1));
                    const fy = Math.min(Math.abs(cmpY), Math.abs(cmpY + 1), Math.abs(cmpY - 1));
                    const dist = Math.hypot(fx, fy);
                    if (dist < (newHair.tipRadius + cmpHair.baseRadius)) {
                        fail = true;
                        break;
                    }
                }
    
                tries++;
            } while (fail && tries < MAX_TRIES);
    
            if (tries >= MAX_TRIES) {
                // This is rare, but occasionally happens
                console.warn(`Reached ${tries} tries when placing hairs`);
            }
    
            this.hairs.push(newHair);
        }
    }

    public getLayer(layer: number): SFATexture {
        if (this.layers[layer] === undefined)
            this.layers[layer] = this.makeFurMap(layer);

        return this.layers[layer];
    }

    private makeFurMap(layer: number): SFATexture {
        const width = 64;
        const height = 64;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 100,
        });
    
        const pixels = new Uint8Array(4 * width * height);
    
        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x)
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a
        }
    
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const [I_, A_] = evaluateHairs(x / 64, y / 64, layer, this.hairs);
                const I = I_ * 0xff;
                const A = A_ * 0xff;
                plot(x, y, I, I, I, A);
            }
        }
    
        this.device.uploadTextureData(gfxTexture, 0, [pixels]);
    
        return new SFATexture(gfxTexture, gfxSampler, width, height);
    }

    public destroy(device: GfxDevice) {
        for (let texture of this.layers)
            texture.destroy(device);
    }
}