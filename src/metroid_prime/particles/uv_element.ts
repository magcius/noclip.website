import { defaultParticleGlobals, GetBool, NumberHolder, ParticleGlobals } from './base_generator';
import { TXTR } from '../txtr';
import { GetIntElement, IntElement } from './int_element';
import { InputStream } from '../stream';
import { ResourceSystem } from '../resource';

export interface UVElementSet {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
}
export const constantUvElements: UVElementSet = { xMin: 0.0, yMin: 0.0, xMax: 1.0, yMax: 1.0 };

export interface UVElement {
    GetValueTexture(frame: number, globals: ParticleGlobals): TXTR|null;
    GetValueUV(frame: number, globals: ParticleGlobals): UVElementSet;
    HasConstantTexture(): boolean;
    HasConstantUV(): boolean;
}

export class UVEConstant implements UVElement {
    constructor(private texture: TXTR|null) {
    }

    public GetValueTexture(frame: number, globals: ParticleGlobals): TXTR|null {
        return this.texture;
    }

    public GetValueUV(frame: number, globals: ParticleGlobals): UVElementSet {
        return constantUvElements;
    }

    public HasConstantTexture(): boolean { return true; }
    public HasConstantUV(): boolean { return true; }
}

export class UVEAnimTexture implements UVElement {
    tileW: NumberHolder = { value: 0 };
    tileH: NumberHolder = { value: 0 };
    strideW: NumberHolder = { value: 0 };
    strideH: NumberHolder = { value: 0 };
    totalTiles: number;
    uvElems: UVElementSet[] = [];

    constructor(private texture: TXTR|null, tileW: IntElement, tileH: IntElement,
                strideW: IntElement, strideH: IntElement, private cycleFrames: IntElement,
                private loop: boolean) {
        if (!texture)
            return;

        tileW.GetValue(0, defaultParticleGlobals, this.tileW);
        tileH.GetValue(0, defaultParticleGlobals, this.tileH);
        strideW.GetValue(0, defaultParticleGlobals, this.strideW);
        strideH.GetValue(0, defaultParticleGlobals, this.strideH);

        const { width, height } = texture;
        const xTiles = Math.max(1, Math.trunc(width / this.strideW.value));
        const yTiles = Math.max(1, Math.trunc(height / this.strideH.value));

        this.totalTiles = xTiles * yTiles;

        for (let y = yTiles - 1; y >= 0; --y) {
            for (let x = 0; x < xTiles; ++x) {
                const txa = this.strideW.value * x;
                const txb = txa + this.tileW.value;
                const tya = this.strideH.value * y;
                const tyb = tya + this.tileH.value;

                this.uvElems.push({ xMin: txa / width, yMin: tya / height,
                                    xMax: txb / width, yMax: tyb / height });
            }
        }
    }

    public GetValueTexture(frame: number, globals: ParticleGlobals): TXTR|null {
        return this.texture;
    }

    public GetValueUV(frame: number, globals: ParticleGlobals): UVElementSet {
        const cycleFrames = { value: 1 };
        this.cycleFrames.GetValue(frame, globals, cycleFrames);
        let tile = 0;
        if (cycleFrames.value !== 0) {
            tile = Math.trunc(frame / (cycleFrames.value / this.totalTiles));
            if (this.loop) {
                if (tile >= this.totalTiles)
                    tile = tile % this.totalTiles;
            } else {
                if (tile >= this.totalTiles)
                    tile = this.totalTiles - 1;
            }
        }
        return this.uvElems[tile];
    }

    public HasConstantTexture(): boolean { return true; }
    public HasConstantUV(): boolean { return false; }
}

export function GetUVElement(stream: InputStream, resourceSystem: ResourceSystem): UVElement | null {
    const type = stream.readFourCC();
    switch (type) {
    case 'CNST': {
        const subtype = stream.readFourCC();
        if (subtype === 'NONE')
            return null;
        const txtrId = stream.readAssetID();
        const txtr = resourceSystem.loadAssetByID<TXTR>(txtrId, 'TXTR');
        if (!txtr)
            return null;
        return new UVEConstant(txtr);
    }
    case 'ATEX': {
        const subtype = stream.readFourCC();
        if (subtype === 'NONE')
            return null;
        const txtrId = stream.readAssetID();
        const a = GetIntElement(stream);
        const b = GetIntElement(stream);
        const c = GetIntElement(stream);
        const d = GetIntElement(stream);
        const e = GetIntElement(stream);
        const f = GetBool(stream);
        const txtr = resourceSystem.loadAssetByID<TXTR>(txtrId, 'TXTR');
        if (!txtr)
            return null;
        return new UVEAnimTexture(txtr, a!, b!, c!, d!, e!, f);
    }
    case 'NONE':
        return null;
    default:
        throw `unrecognized element type ${type}`;
    }
}
