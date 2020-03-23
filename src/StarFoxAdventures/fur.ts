import { GfxDevice, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import * as GX from '../gx/gx_enum';
import { ViewerRenderInput } from '../viewer';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GXMaterial, SwapTable } from '../gx/gx_material';
import { MaterialParams } from '../gx/gx_render';
import { GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { nArray } from '../util';

import { SFATexture } from './textures';

interface Hair {
    numLayers: number;
    x: number;
    y: number;
    field_0xc: number;
    field_0x10: number;
}

function evaluateHair(x: number, y: number, layer: number, hairs: Hair[]): [number, number] {
    let dVar5 = 0;
    let dVar6 = 0;

    for (let i = 0; i < hairs.length; i++) {
        const hair = hairs[i];

        if (layer < hair.numLayers) {
            let dVar8 = 0.25 + (hair.numLayers - layer) / hair.numLayers;
            if (dVar8 > 1) {
                dVar8 = 1;
            }
            if (dVar8 > 0) {
                dVar8 = Math.sqrt(dVar8);
            }
            let fVar2 = Math.abs(hair.x - x);
            let fVar1 = Math.abs(1 + hair.x - x);
            if (fVar2 > fVar1) {
                fVar2 = fVar1;
            }
            fVar1 = Math.abs(hair.x - 1 - x)
            if (fVar2 > fVar1) {
                fVar2 = fVar1;
            }

            let dVar7 = hair.y;
            fVar1 = 0;
            if (dVar7 < y) {
                fVar1 = y - dVar7;
            }
            let fVar4 = Math.abs(1 + dVar7 - y);
            let fVar3 = Math.abs(dVar7 - y);
            if (fVar4 < Math.abs(dVar7 - y)) {
                fVar3 = fVar4;
                fVar1 = 0;
            }
            dVar7 = fVar1;
            let dVar9 = hair.y - 1;
            fVar1 = Math.abs(dVar9 - y);
            if ((fVar1 < fVar3) && (fVar3 = fVar1, dVar9 < y)) {
                dVar7 = y - dVar9;
            }
            dVar9 = Math.sqrt(fVar2 * fVar2 + fVar3 * fVar3);
            let dVar10 = Math.sqrt(layer / hair.numLayers);
            dVar10 = -(dVar10 * (hair.field_0xc - hair.field_0x10) - hair.field_0xc);
            if (dVar9 <= dVar10) {
                dVar9 = 1 - dVar9 / dVar10;
                if (dVar9 > 0) {
                    dVar9 = Math.sqrt(dVar9);
                }
                dVar5 = dVar8 * dVar9 + dVar5;
                dVar6 = 0.5 * -(layer / 16 - 1) + dVar6 + dVar7 / dVar10;
            }
        }
    }

    if (dVar5 > 1) {
        dVar5 = 1;
    }
    if (dVar6 > 1) {
        dVar6 = 1;
    }
    return [dVar6 / 8 + 7/16, dVar5];
}

function random(lo: number, hi: number) {
    return lo + (hi - lo) * Math.random();
}

export class FurFactory {
    private layers: SFATexture[] = [];
    private hairs: Hair[] = [];

    constructor(private device: GfxDevice) {
        let try_ = 0;
        for (let i = 0; i < 50 && try_ < 10000; i++) {
            const newHair = {
                numLayers: random(8, 16),
                x: 0,
                y: 0,
                field_0xc: 0.01 * random(5, 10),
                field_0x10: 0,
            };
            newHair.field_0x10 = newHair.field_0xc * 0.01 * random(20, 50);
    
            let done = false;
            do {
                newHair.x = 0.001 * random(0, 999);
                newHair.y = 0.001 * random(0, 999);
    
                done = false;
                let j = 0;
                while (j < i && !done) {
                    const cmpHair = this.hairs[j];
    
                    let fVar1 = Math.abs(newHair.x - cmpHair.x);
                    let fVar2 = Math.abs(1 + newHair.x - cmpHair.x);
                    if (fVar2 < fVar1) {
                        fVar1 = fVar2;
                    }
                    fVar2 = Math.abs(newHair.x - 1 - cmpHair.x);
                    if (fVar2 < fVar1) {
                        fVar1 = fVar2;
                    }
                    fVar2 = Math.abs(newHair.y - cmpHair.y);
                    let fVar3 = Math.abs(1 + newHair.y - cmpHair.y);
                    if (fVar3 < fVar2) {
                        fVar2 = fVar3;
                    }
                    fVar3 = Math.abs(newHair.y - 1 - cmpHair.y);
                    if (fVar3 < fVar2) {
                        fVar2 = fVar3;
                    }
    
                    let dVar11 = Math.sqrt(fVar1 * fVar1 + fVar2 * fVar2);
                    if (dVar11 < (newHair.field_0x10 + cmpHair.field_0xc)) {
                        done = true;
                    }
    
                    j++;
                }
    
                try_++;
            } while (done && try_ < 10000);
    
            if (try_ >= 10000) {
                console.warn(`reached 10,000 tries`);
            }
    
            this.hairs.push(newHair);
        }
    }

    public getLayer(layer: number): SFATexture {
        if (this.layers[layer] === undefined) {
            this.layers[layer] = this.makeFurMap(layer);
        }

        return this.layers[layer];
    }

    private makeFurMap(layer: number): SFATexture {
        const width = 64;
        const height = 64;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
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
                const [I_, A_] = evaluateHair(x / 64, y / 64, layer, this.hairs);
                const I = I_ * 0xff
                const A = A_ * 0xff
                plot(x, y, I, I, I, A)
            }
        }
    
        const hostAccessPass = this.device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
        this.device.submitPass(hostAccessPass);
    
        return { gfxTexture, gfxSampler, width, height }
    }
}