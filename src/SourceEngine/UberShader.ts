
// Represents an "uber-shader" -- aka a set of individual shader programs compiled
// from a base text representation.
//
// This is basically replacement for DeviceProgram that has better caching behavior
// and support for a wider variety of variants.

import { GfxProgram } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { preprocessShader_GLSL } from "../gfx/shaderc/GfxShaderCompiler";
import { hashCodeNumberUpdate, HashMap } from "../HashMap";

export abstract class UberShaderTemplate<T> {
    protected cache: HashMap<T, GfxProgram>;
    protected abstract createGfxProgram(cache: GfxRenderCache, variantSettings: T): GfxProgram;

    public getGfxProgram(cache: GfxRenderCache, variantSettings: T): GfxProgram {
        let program = this.cache.get(variantSettings);
        if (program === null) {
            program = this.createGfxProgram(cache, variantSettings);
            this.cache.add(variantSettings, program);
        }
        return program;
    }
}

type DefinesMap = Map<string, string>;

function stringHash(v: string): number {
    let hash = 0;
    for (let i = 0; i < v.length; i++)
        hash = hashCodeNumberUpdate(hash, v.charCodeAt(i));
    return hash;
}

function definesEqual(a: DefinesMap, b: DefinesMap): boolean {
    if (a.size !== b.size)
        return false;
    for (const [k, v] of a.entries())
        if (b.get(k) !== v)
            return false;
    return true;
}

function definesHash(m: DefinesMap): number {
    let hash = 0;
    for (const [k, v] of m.entries()) {
        hash = hashCodeNumberUpdate(hash, stringHash(k));
        hash = hashCodeNumberUpdate(hash, stringHash(v));
    }
    return hash;
}

export class UberShaderTemplateBasic extends UberShaderTemplate<DefinesMap> {
    public program: string = '';

    constructor() {
        super();
        this.cache = new HashMap<DefinesMap, GfxProgram>(definesEqual, definesHash);
    }

    protected generateProgramString(variantSettings: DefinesMap): string {
        return this.program;
    }

    protected createGfxProgram(cache: GfxRenderCache, variantSettings: DefinesMap): GfxProgram {
        const vendorInfo = cache.device.queryVendorInfo();
        const programString = this.generateProgramString(variantSettings);
        const preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', programString, variantSettings);
        const preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', programString, variantSettings);
        // We do our own caching here; no need to use the render cache for this.
        return cache.device.createProgramSimple({ preprocessedVert, preprocessedFrag });
    }
}

export class UberShaderInstance<T> {
    private gfxProgram: GfxProgram | null = null;
    protected variantSettings: T;

    constructor(private template: UberShaderTemplate<T>) {
    }

    public invalidate(): void {
        this.gfxProgram = null;
    }

    public getGfxProgram(cache: GfxRenderCache): GfxProgram {
        if (this.gfxProgram === null)
            this.gfxProgram = this.template.getGfxProgram(cache, this.variantSettings);

        return this.gfxProgram;
    }
}

export class UberShaderInstanceBasic extends UberShaderInstance<DefinesMap> {
    constructor(template: UberShaderTemplateBasic) {
        super(template);
        this.variantSettings = new Map<string, string>();
    }

    public setDefineString(name: string, v: string | null): boolean {
        if (v !== null) {
            if (this.variantSettings.get(name) === v)
                return false;
            this.variantSettings.set(name, v);
        } else {
            if (!this.variantSettings.has(name))
                return false;
            this.variantSettings.delete(name);
        }
        this.invalidate();
        return true;
    }

    public setDefineBool(name: string, v: boolean): boolean {
        return this.setDefineString(name, v ? '1' : null);
    }
}
