
import { mat4, vec3 } from "gl-matrix";
import { TextureMapping } from "../../TextureHolder.js";
import { assert, assertExists, nArray, nullify } from "../../util.js";
import type { SourceRenderContext } from "../Main.js";
import { VKFParamMap, VMT, vmtParseVector } from "../VMT.js";
import type { VTF } from "../VTF.js";
import { MathConstants, clamp, invlerp, lerp } from "../../MathHelpers.js";
import { Color, colorFromRGBA } from "../../Color.js";
import type { MaterialCache } from "./MaterialCache.js";
import { BaseMaterial, EntityMaterialParameters } from "./MaterialBase.js";

interface Parameter {
    parse(S: string): void;
    index(i: number): Parameter | null;
    set(param: Parameter): void;
}

export class ParameterTexture {
    public texture: VTF | null = null;

    constructor(public isSRGB: boolean = false, public isEnvmap: boolean = false, public ref: string | null = null) {
    }

    public parse(S: string): void {
        this.ref = S;
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        // Cannot dynamically change at runtime.
        throw "whoops";
    }

    public async fetch(materialCache: MaterialCache, entityParams: EntityMaterialParameters | null): Promise<void> {
        if (this.ref !== null) {
            // Special case env_cubemap if we have a local override.
            let filename = this.ref;

            if (this.isEnvmap) {
                // Dynamic cubemaps.
                if (filename.toLowerCase() === 'env_cubemap' && entityParams !== null && entityParams.lightCache !== null && entityParams.lightCache.envCubemap !== null) {
                    filename = entityParams.lightCache.envCubemap.filename;
                } else if (materialCache.isUsingHDR()) {
                    const hdrFilename = `${filename}.hdr`;
                    if (materialCache.checkVTFExists(hdrFilename))
                        filename = hdrFilename;
                    else if (!materialCache.checkVTFExists(filename))
                        debugger;
                }
            }

            this.texture = await materialCache.fetchVTF(filename, this.isSRGB);
        }
    }

    public fillTextureMapping(m: TextureMapping, frame: number): boolean {
        if (this.texture !== null) {
            this.texture.fillTextureMapping(m, frame);
            return true;
        } else {
            return false;
        }
    }
}

export class ParameterString {
    constructor(public value: string = '') {
    }

    public parse(S: string): void {
        this.value = S;
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        // Cannot dynamically change at runtime.
        throw "whoops";
    }
}

export class ParameterNumber {
    constructor(public value: number, private dynamic: boolean = true) {
    }

    public parse(S: string): void {
        // Numbers and vectors are the same thing inside the Source engine, where numbers just are the first value in a vector.
        const v = vmtParseVector(S);
        this.value = v[0];
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        assert(param instanceof ParameterNumber);
        assert(this.dynamic);
        this.value = param.value;
    }
}

export class ParameterBoolean extends ParameterNumber {
    constructor(value: boolean, dynamic: boolean = true) {
        super(value ? 1 : 0, dynamic);
    }

    public getBool(): boolean {
        return !!this.value;
    }
}

function findall(haystack: string, needle: RegExp): RegExpExecArray[] {
    const results: RegExpExecArray[] = [];
    while (true) {
        const result = needle.exec(haystack);
        if (!result)
            break;
        results.push(result);
    }
    return results;
}

const scratchMat4a = mat4.create();
export class ParameterMatrix {
    public matrix = mat4.create();
    public defined = false;

    public setMatrix(cx: number, cy: number, sx: number, sy: number, r: number, tx: number, ty: number): void {
        mat4.identity(this.matrix);
        this.matrix[12] = -cx;
        this.matrix[13] = -cy;
        this.matrix[0] = sx;
        this.matrix[5] = sy;
        mat4.fromZRotation(scratchMat4a, MathConstants.DEG_TO_RAD * r);
        mat4.mul(this.matrix, scratchMat4a, this.matrix);
        mat4.identity(scratchMat4a);
        scratchMat4a[12] = cx + tx;
        scratchMat4a[13] = cy + ty;
        mat4.mul(this.matrix, scratchMat4a, this.matrix);
        this.defined = true;
    }

    public parse(S: string): void {
        // "center {} {} scale {} {} rotate {} translate {} {}"
        const sections = findall(S, /([a-z]+) ([^a-z]+)/g);

        let cx = 0, cy = 0, sx = 1, sy = 1, r = 0, tx = 0, ty = 0;
        sections.forEach(([str, mode, items]) => {
            let values = items.split(' ').map((v) => parseFloat(v));
            if (values[1] === undefined)
                values[1] = values[0];

            if (mode === 'center') {
                cx = values[0];
                cy = values[1];
            } else if (mode === 'scale') {
                sx = values[0];
                sy = values[1];
            } else if (mode === 'rotate') {
                r = values[0];
            } else if (mode === 'translate') {
                tx = values[0];
                ty = values[1];
            }
        });

        this.setMatrix(cx, cy, sx, sy, r, tx, ty);
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        throw "whoops";
    }
}

export class ParameterVector {
    public internal: ParameterNumber[];

    constructor(length: number, values: number[] | null = null) {
        this.internal = nArray(length, (i) => new ParameterNumber(values !== null ? values[i] : 0));
    }

    public setArray(v: readonly number[] | Float32Array): void {
        assert(this.internal.length === v.length);
        for (let i = 0; i < this.internal.length; i++)
            this.internal[i].value = v[i];
    }

    public parse(S: string): void {
        const numbers = vmtParseVector(S);
        if (this.internal.length === 0)
            this.internal.length = numbers.length;
        for (let i = 0; i < this.internal.length; i++)
            this.internal[i] = new ParameterNumber(i > numbers.length - 1 ? numbers[0] : numbers[i]);
    }

    public index(i: number): ParameterNumber | null {
        return nullify(this.internal[i]);
    }

    public set(param: Parameter): void {
        if (param instanceof ParameterVector) {
            this.internal[0].value = param.internal[0].value;
            this.internal[1].value = param.internal[1].value;
            this.internal[2].value = param.internal[2].value;
        } else if (param instanceof ParameterNumber) {
            this.internal[0].value = param.value;
            this.internal[1].value = param.value;
            this.internal[2].value = param.value;
        } else {
            throw "whoops";
        }
    }

    public fillColor(c: Color, a: number): void {
        colorFromRGBA(c, this.internal[0].value, this.internal[1].value, this.internal[2].value, a);
    }

    public setFromColor(c: Color): void {
        this.internal[0].value = c.r;
        this.internal[1].value = c.g;
        this.internal[2].value = c.b;
    }

    public mulColor(c: Color): void {
        assert(this.internal.length === 3);
        c.r *= this.internal[0].value;
        c.g *= this.internal[1].value;
        c.b *= this.internal[2].value;
    }

    public get(i: number): number {
        return this.internal[i].value;
    }
}

export class ParameterColor extends ParameterVector {
    constructor(r: number, g: number = r, b: number = r) {
        super(3);
        this.internal[0].value = r;
        this.internal[1].value = g;
        this.internal[2].value = b;
    }
}

function createParameterAuto(value: any): Parameter | null {
    if (typeof value === 'string') {
        const S = value;
        const n = Number(S);
        if (!Number.isNaN(n))
            return new ParameterNumber(n);

        // Try Vector
        if (S.startsWith('[') || S.startsWith('{')) {
            const v = new ParameterVector(0);
            v.parse(S);
            return v;
        }

        if (S.startsWith('center')) {
            const v = new ParameterMatrix();
            v.parse(S);
            return v;
        }

        const v = new ParameterString();
        v.parse(S);
        return v;
    }

    return null;
}

function parseKey(key: string, defines: string[]): string | null {
    const question = key.indexOf('?');
    if (question >= 0) {
        let define = key.slice(0, question);

        let negate = false;
        if (key.charAt(0) === '!') {
            define = define.slice(1);
            negate = true;
        }

        let isValid = defines.includes(define);
        if (negate)
            isValid = !isValid;

        if (!isValid)
            return null;

        key = key.slice(question + 1);
    }

    return key;
}

export function setupParametersFromVMT(param: ParameterMap, vmt: VMT, defines: string[]): void {
    for (const vmtKey in vmt) {
        const destKey = parseKey(vmtKey, defines);
        if (destKey === null)
            continue;
        if (!destKey.startsWith('$'))
            continue;

        const value = vmt[vmtKey];
        if (destKey in param) {
            // Easy case -- existing parameter.
            param[destKey].parse(value as string);
        } else {
            // Hard case -- auto-detect type from string.
            const p = createParameterAuto(value);
            if (p !== null) {
                param[destKey] = p;
            } else {
                console.warn("Could not parse parameter", destKey, value);
            }
        }
    }
}

export class ParameterReference {
    public name: string | null = null;
    public index: number = -1;
    public value: Parameter | null = null;

    constructor(str: string, defaultValue: number | null = null, required: boolean = true) {
        if (str === undefined) {
            if (required || defaultValue !== null)
                this.value = new ParameterNumber(assertExists(defaultValue));
        } else if (str.startsWith('$')) {
            // '$envmaptint', '$envmaptint[1]'
            const [, name, index] = assertExists(/([a-zA-Z0-9$_]+)(?:\[(\d+)\])?/.exec(str));
            this.name = name.toLowerCase();
            if (index !== undefined)
                this.index = Number(index);
        } else {
            this.value = createParameterAuto(str);
        }
    }
}

function paramLookupOptional<T extends Parameter>(map: ParameterMap, ref: ParameterReference): T | null {
    if (ref.name !== null) {
        const pm = map[ref.name];
        if (pm === undefined)
            return null;
        else if (ref.index !== -1)
            return pm.index(ref.index) as T;
        else
            return pm as T;
    } else {
        return ref.value as T;
    }
}

export type ParameterMap = { [k: string]: Parameter };

function paramLookup<T extends Parameter>(map: ParameterMap, ref: ParameterReference): T {
    return assertExists(paramLookupOptional<T>(map, ref));
}

export function paramGetNum(map: ParameterMap, ref: ParameterReference): number {
    return paramLookup<ParameterNumber>(map, ref).value;
}

function paramSetBinOp(map: ParameterMap, dstRef: ParameterReference, src1Ref: ParameterReference, src2Ref: ParameterReference, func: (a: number, b: number) => number): void {
    const dst = paramLookup(map, dstRef);
    const src1 = paramLookup(map, src1Ref);
    const src2 = paramLookup(map, src2Ref);

    if (src1 instanceof ParameterVector) {
        assert(dst instanceof ParameterVector);
        for (let i = 0; i < dst.internal.length; i++)
            dst.internal[i].value = func(src1.get(i), (src2 instanceof ParameterVector) ? src2.get(i) : (src2 as ParameterNumber).value);
    } else if (src2 instanceof ParameterVector) {
        assert(dst instanceof ParameterVector);
        for (let i = 0; i < dst.internal.length; i++)
            dst.internal[i].value = func((src1 instanceof ParameterVector) ? src1.get(i) : (src1 as ParameterNumber).value, src2.get(i));
    } else {
        paramSetNum(map, dstRef, func((src1 as ParameterNumber).value, (src2 as ParameterNumber).value));
    }
}

export function paramSetNum(map: ParameterMap, ref: ParameterReference, v: number): void {
    const param = paramLookupOptional(map, ref);
    if (param === null) {
        // Perhaps put in a warning, but this seems to happen in live content (TF2's hwn_skeleton_blue.vmt)
        return;
    }

    if (param instanceof ParameterVector) {
        for (let i = 0; i < param.internal.length; i++)
            param.internal[i].value = v;
    } else {
        (param as ParameterNumber).value = v;
    }
}

interface MaterialProxyFactory {
    type: string;
    new (params: VKFParamMap): MaterialProxy;
}

export class MaterialProxySystem {
    public proxyFactories = new Map<string, MaterialProxyFactory>();

    constructor() {
        this.registerDefaultProxyFactories();
    }

    private registerDefaultProxyFactories(): void {
        this.registerProxyFactory(MaterialProxy_Equals);
        this.registerProxyFactory(MaterialProxy_Add);
        this.registerProxyFactory(MaterialProxy_Subtract);
        this.registerProxyFactory(MaterialProxy_Multiply);
        this.registerProxyFactory(MaterialProxy_Clamp);
        this.registerProxyFactory(MaterialProxy_Abs);
        this.registerProxyFactory(MaterialProxy_LessOrEqual);
        this.registerProxyFactory(MaterialProxy_LinearRamp);
        this.registerProxyFactory(MaterialProxy_Sine);
        this.registerProxyFactory(MaterialProxy_TextureScroll);
        this.registerProxyFactory(MaterialProxy_PlayerProximity);
        this.registerProxyFactory(MaterialProxy_GaussianNoise);
        this.registerProxyFactory(MaterialProxy_AnimatedTexture);
        this.registerProxyFactory(MaterialProxy_MaterialModify);
        this.registerProxyFactory(MaterialProxy_MaterialModifyAnimated);
        this.registerProxyFactory(MaterialProxy_WaterLOD);
        this.registerProxyFactory(MaterialProxy_TextureTransform);
        this.registerProxyFactory(MaterialProxy_ToggleTexture);
        this.registerProxyFactory(MaterialProxy_EntityRandom);
        this.registerProxyFactory(MaterialProxy_FizzlerVortex);
        this.registerProxyFactory(MaterialProxy_YellowLevel);
    }

    public registerProxyFactory(factory: MaterialProxyFactory): void {
        this.proxyFactories.set(factory.type, factory);
    }

    public createProxyDriver(material: BaseMaterial, proxyDefs: [string, VKFParamMap][]): MaterialProxyDriver {
        const proxies: MaterialProxy[] = [];
        for (let i = 0; i < proxyDefs.length; i++) {
            const [name, params] = proxyDefs[i];
            const proxyFactory = this.proxyFactories.get(name);
            if (proxyFactory !== undefined) {
                const proxy = new proxyFactory(params);
                proxies.push(proxy);
            } else {
                console.log(`unknown proxy type`, name);
            }
        }
        return new MaterialProxyDriver(material, proxies);
    }
}

export class MaterialProxyDriver {
    constructor(private material: BaseMaterial, private proxies: MaterialProxy[]) {
    }

    public update(renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        if ((this as any).debug)
            debugger;
        for (let i = 0; i < this.proxies.length; i++)
            this.proxies[i].update(this.material.param, renderContext, entityParams);
    }
}

interface MaterialProxy {
    update(paramsMap: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void;
}

class MaterialProxy_Equals {
    public static type = 'equals';

    private srcvar1: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const srcvar1 = paramLookup(map, this.srcvar1);
        const resultvar = paramLookup(map, this.resultvar);
        resultvar.set(srcvar1);
    }
}

class MaterialProxy_Add {
    public static type = 'add';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetBinOp(map, this.resultvar, this.srcvar1, this.srcvar2, (a, b) => a + b);
    }
}

class MaterialProxy_Subtract {
    public static type = 'subtract';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetBinOp(map, this.resultvar, this.srcvar1, this.srcvar2, (a, b) => a - b);
    }
}

class MaterialProxy_Multiply {
    public static type = 'multiply';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetBinOp(map, this.resultvar, this.srcvar1, this.srcvar2, (a, b) => a * b);
    }
}

class MaterialProxy_Clamp {
    public static type = 'clamp';

    private srcvar1: ParameterReference;
    private min: ParameterReference;
    private max: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.min = new ParameterReference(params.min, 0.0);
        this.max = new ParameterReference(params.max, 1.0);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, clamp(paramGetNum(map, this.srcvar1), paramGetNum(map, this.min), paramGetNum(map, this.max)));
    }
}

class MaterialProxy_Abs {
    public static type = 'abs';

    private srcvar1: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters): void {
        paramSetNum(map, this.resultvar, Math.abs(paramGetNum(map, this.srcvar1)));
    }
}

class MaterialProxy_LessOrEqual {
    public static type = 'lessorequal';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private lessequalvar: ParameterReference;
    private greatervar: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.lessequalvar = new ParameterReference(params.lessequalvar);
        this.greatervar = new ParameterReference(params.greatervar);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const src1 = paramGetNum(map, this.srcvar1);
        const src2 = paramGetNum(map, this.srcvar2);
        const p = (src1 <= src2) ? this.lessequalvar : this.greatervar;
        paramLookup(map, this.resultvar).set(paramLookup(map, p));
    }
}

class MaterialProxy_LinearRamp {
    public static type = 'linearramp';

    private rate: ParameterReference;
    private initialvalue: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.rate = new ParameterReference(params.rate);
        this.initialvalue = new ParameterReference(params.initialvalue, 0.0);
        this.resultvar = new ParameterReference(params.resultvar, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const rate = paramGetNum(map, this.rate);
        const initialvalue = paramGetNum(map, this.initialvalue);
        const v = initialvalue + (rate * renderContext.globalTime);
        paramSetNum(map, this.resultvar, v);
    }
}

class MaterialProxy_Sine {
    public static type = 'sine';

    private sineperiod: ParameterReference;
    private sinemin: ParameterReference;
    private sinemax: ParameterReference;
    private timeoffset: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.sineperiod = new ParameterReference(params.sineperiod, 1.0);
        this.sinemin = new ParameterReference(params.sinemin, 0.0);
        this.sinemax = new ParameterReference(params.sinemax, 1.0);
        this.timeoffset = new ParameterReference(params.sinemax, 0.0);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const freq = 1.0 / paramGetNum(map, this.sineperiod);
        const t = (renderContext.globalTime - paramGetNum(map, this.timeoffset));
        const min = paramGetNum(map, this.sinemin);
        const max = paramGetNum(map, this.sinemax);
        const v = lerp(min, max, invlerp(-1.0, 1.0, Math.sin(MathConstants.TAU * freq * t)));
        paramSetNum(map, this.resultvar, v);
    }
}

function gaussianRandom(mean: number, halfwidth: number): number {
    // https://en.wikipedia.org/wiki/Marsaglia_polar_method

    // pick two points inside a circle
    let x = 0, y = 0, s = 100;
    while (s > 1) {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        s = Math.hypot(x, y);
    }

    const f = Math.sqrt(-2 * Math.log(s));

    // return one of the two sampled values
    return mean * halfwidth * x * f;
}

class MaterialProxy_GaussianNoise {
    public static type = 'gaussiannoise';

    private resultvar: ParameterReference;
    private minval: ParameterReference;
    private maxval: ParameterReference;
    private mean: ParameterReference;
    private halfwidth: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
        this.minval = new ParameterReference(params.minval, -Number.MAX_VALUE);
        this.maxval = new ParameterReference(params.maxval, Number.MAX_VALUE);
        this.mean = new ParameterReference(params.mean, 0.0);
        this.halfwidth = new ParameterReference(params.halfwidth, 0.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const r = gaussianRandom(paramGetNum(map, this.mean), paramGetNum(map, this.halfwidth));
        const v = clamp(r, paramGetNum(map, this.minval), paramGetNum(map, this.maxval));
        paramSetNum(map, this.resultvar, v);
    }
}

class MaterialProxy_TextureScroll {
    public static type = 'texturescroll';

    private texturescrollvar: ParameterReference;
    private texturescrollangle: ParameterReference;
    private texturescrollrate: ParameterReference;
    private texturescale: ParameterReference;

    constructor(params: VKFParamMap) {
        this.texturescrollvar = new ParameterReference(params.texturescrollvar);
        this.texturescrollrate = new ParameterReference(params.texturescrollrate, 1.0);
        this.texturescrollangle = new ParameterReference(params.texturescrollangle, 0.0);
        this.texturescale = new ParameterReference(params.texturescale, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const p = paramLookup(map, this.texturescrollvar);

        const scale = paramGetNum(map, this.texturescale);
        const angle = paramGetNum(map, this.texturescrollangle) * MathConstants.DEG_TO_RAD;
        const rate = paramGetNum(map, this.texturescrollrate) * renderContext.globalTime;
        const offsS = (Math.cos(angle) * rate) % 1.0;
        const offsT = (Math.sin(angle) * rate) % 1.0;

        if (p instanceof ParameterMatrix) {
            mat4.identity(p.matrix);
            p.matrix[0] = scale;
            p.matrix[5] = scale;
            p.matrix[12] = offsS;
            p.matrix[13] = offsT;
        } else if (p instanceof ParameterVector) {
            p.index(0)!.value = offsS;
            p.index(1)!.value = offsT;
        } else {
            // not sure
            debugger;
        }
    }
}

class MaterialProxy_PlayerProximity {
    public static type = 'playerproximity';

    private resultvar: ParameterReference;
    private scale: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
        this.scale = new ParameterReference(params.scale);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        if (entityParams === null)
            return;

        const scale = paramGetNum(map, this.scale);
        const dist = vec3.distance(renderContext.currentView.cameraPos, entityParams.position);
        paramSetNum(map, this.resultvar, dist * scale);
    }
}

class MaterialProxy_AnimatedTexture {
    public static type = 'animatedtexture';

    private animatedtexturevar: ParameterReference;
    private animatedtextureframenumvar: ParameterReference;
    private animatedtextureframerate: ParameterReference;
    private animationnowrap: ParameterReference;

    constructor(params: VKFParamMap) {
        this.animatedtexturevar = new ParameterReference(params.animatedtexturevar);
        this.animatedtextureframenumvar = new ParameterReference(params.animatedtextureframenumvar);
        this.animatedtextureframerate = new ParameterReference(params.animatedtextureframerate, 15.0);
        this.animationnowrap = new ParameterReference(params.animationnowrap, 0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        const ptex = paramLookup<ParameterTexture>(map, this.animatedtexturevar);

        // This can happen if the parameter is not actually a texture, if we haven't implemented something yet.
        if (ptex.texture === undefined)
            return;

        if (ptex.texture === null)
            return;

        const rate = paramGetNum(map, this.animatedtextureframerate);
        const wrap = !paramGetNum(map, this.animationnowrap);

        let animationStartTime = entityParams !== null ? entityParams.animationStartTime : 0;
        let frame = (renderContext.globalTime - animationStartTime) * rate;
        if (wrap) {
            frame = frame % ptex.texture.numFrames;
        } else {
            frame = Math.min(frame, ptex.texture.numFrames);
        }

        paramSetNum(map, this.animatedtextureframenumvar, frame);
    }
}

class MaterialProxy_MaterialModify {
    public static type = 'materialmodify';

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        // Nothing to do
    }
}

class MaterialProxy_MaterialModifyAnimated extends MaterialProxy_AnimatedTexture {
    public static override type = 'materialmodifyanimated';
}

class MaterialProxy_WaterLOD {
    public static type = 'waterlod';

    constructor(params: VKFParamMap) {
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters): void {
        if (map['$cheapwaterstartdistance'] !== undefined)
            (map['$cheapwaterstartdistance'] as ParameterNumber).value = renderContext.cheapWaterStartDistance;
        if (map['$cheapwaterenddistance'] !== undefined)
            (map['$cheapwaterenddistance'] as ParameterNumber).value = renderContext.cheapWaterEndDistance;
    }
}

class MaterialProxy_TextureTransform {
    public static type = 'texturetransform';

    private centervar: ParameterReference;
    private scalevar: ParameterReference;
    private rotatevar: ParameterReference;
    private translatevar: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.centervar = new ParameterReference(params.centervar, null, false);
        this.scalevar = new ParameterReference(params.scalevar, null, false);
        this.rotatevar = new ParameterReference(params.rotatevar, null, false);
        this.translatevar = new ParameterReference(params.translatevar, null, false);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const center = paramLookupOptional(map, this.centervar);
        const scale = paramLookupOptional(map, this.scalevar);
        const rotate = paramLookupOptional<ParameterNumber>(map, this.rotatevar);
        const translate = paramLookupOptional(map, this.translatevar);

        let cx = 0.5, cy = 0.5;
        if (center instanceof ParameterNumber) {
            cx = cy = center.value;
        } else if (center instanceof ParameterVector) {
            cx = center.index(0)!.value;
            cy = center.index(1)!.value;
        }

        let sx = 1.0, sy = 1.0;
        if (scale instanceof ParameterNumber) {
            sx = sy = scale.value;
        } else if (scale instanceof ParameterVector) {
            sx = scale.index(0)!.value;
            sy = scale.index(1)!.value;
        }

        let r = 0.0;
        if (rotate !== null)
            r = rotate.value;

        let tx = 0.0, ty = 0.0;
        if (translate instanceof ParameterNumber) {
            tx = ty = translate.value;
        } else if (translate instanceof ParameterVector) {
            tx = translate.index(0)!.value;
            ty = translate.index(1)!.value;
        }

        const result = paramLookup<ParameterMatrix>(map, this.resultvar);
        result.setMatrix(cx, cy, sx, sy, r, tx, ty);
    }
}

class MaterialProxy_ToggleTexture {
    public static type = 'toggletexture';

    private toggletexturevar: ParameterReference;
    private toggletextureframenumvar: ParameterReference;
    private toggleshouldwrap: ParameterReference;

    constructor(params: VKFParamMap) {
        this.toggletexturevar = new ParameterReference(params.toggletexturevar);
        this.toggletextureframenumvar = new ParameterReference(params.toggletextureframenumvar);
        this.toggleshouldwrap = new ParameterReference(params.toggleshouldwrap, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        const ptex = paramLookup<ParameterTexture>(map, this.toggletexturevar);
        if (ptex.texture === null || entityParams === null)
            return;

        const wrap = !!paramGetNum(map, this.toggleshouldwrap);

        let frame = entityParams.textureFrameIndex;
        if (wrap) {
            frame = frame % ptex.texture.numFrames;
        } else {
            frame = Math.min(frame, ptex.texture.numFrames);
        }

        paramSetNum(map, this.toggletextureframenumvar, frame);
    }
}

class MaterialProxy_EntityRandom {
    public static type = 'entityrandom';

    private scale: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.scale = new ParameterReference(params.scale);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        if (entityParams === null)
            return;

        const scale = paramGetNum(map, this.scale);
        paramSetNum(map, this.resultvar, entityParams.randomNumber * scale);
    }
}

class MaterialProxy_FizzlerVortex {
    public static type = `fizzlervortex`;

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        const param = map['$flow_color_intensity'] as ParameterNumber;
        if (param === undefined)
            return;
        param.value = 1.0;
    }
}

class MaterialProxy_YellowLevel {
    public static type = `yellowlevel`;

    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        paramSetNum(map, this.resultvar, 1);
    }
}
//#endregion
