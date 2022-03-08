
// Represents an "uber-shader" -- aka a set of individual shader programs compiled
// from a base text representation.
//
// This is basically replacement for DeviceProgram that has better caching behavior
// and support for a wider variety of variants.

import CodeEditor from "../CodeEditor";
import { GfxDevice, GfxProgramDescriptorSimple } from "../gfx/platform/GfxPlatform";
import { GfxProgram } from "../gfx/platform/GfxPlatformImpl";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { preprocessShader_GLSL } from "../gfx/shaderc/GfxShaderCompiler";
import { hashCodeNumberUpdate, HashMap } from "../HashMap";
import { assertExists } from "../util";

class ShaderTextEditor {
    public onchanged: ((newText: string) => void) | null = null;
    private window: WindowProxy | null = null;

    constructor(private name: string, private initialText: string) {
    }

    public open(): void {
        assertExists(this.window === null);
        this.window = assertExists(window.open('about:blank', undefined, `location=off, resizable, alwaysRaised, left=20, top=20, width=1200, height=900`));

        const win = this.window;
        const init = () => {
            const editor = new CodeEditor(win.document);
            const document = win.document;
            document.title = this.name;
            document.body.style.margin = '0';
            editor.setValue(this.initialText);
            editor.setFontSize('16px');
            let timeout: number = 0;

            const textChanged = () => {
                timeout = 0;
                if (this.onchanged !== null)
                    this.onchanged(editor.getValue());
            };

            editor.onvaluechanged = (immediate: boolean) => {
                if (timeout > 0)
                    clearTimeout(timeout);

                if (immediate) {
                    textChanged();
                } else {
                    // debounce
                    timeout = window.setTimeout(textChanged, 500);
                }
            };
            const onresize = win.onresize = () => {
                editor.setSize(document.body.offsetWidth, window.innerHeight);
            };
            onresize();
            win.document.body.appendChild(editor.elem);
        };

        if (win.document.readyState === 'complete')
            init();
        else
            win.onload = init;
    }
}

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

    public destroy(device: GfxDevice): void {
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

function getGfxProgramDescriptorBasic(cache: GfxRenderCache, programString: string, variantSettings: DefinesMap): GfxProgramDescriptorSimple {
    const vendorInfo = cache.device.queryVendorInfo();
    const preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', programString, variantSettings);
    const preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', programString, variantSettings);
    return { preprocessedVert, preprocessedFrag };
}

export class UberShaderTemplateBasic extends UberShaderTemplate<DefinesMap> {
    public program: string = '';

    constructor() {
        super();
        this.cache = new HashMap<DefinesMap, GfxProgram>(definesEqual, definesHash);
    }

    public generateProgramString(variantSettings: DefinesMap): string {
        return this.program;
    }

    protected createGfxProgram(cache: GfxRenderCache, variantSettings: DefinesMap): GfxProgram {
        // We do our own caching here; no need to use the render cache for this.
        const programString = this.generateProgramString(variantSettings);
        return cache.device.createProgramSimple(getGfxProgramDescriptorBasic(cache, programString, variantSettings));
    }

    public override destroy(device: GfxDevice): void {
        for (const v of this.cache.values())
            device.destroyProgram(v);
    }
}

export class UberShaderInstance<T> {
    protected gfxProgram: GfxProgram | null = null;
    protected variantSettings: T;

    constructor(protected template: UberShaderTemplate<T>) {
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
    private shaderTextEditor: ShaderTextEditor | null = null;
    private gfxRenderCache: GfxRenderCache | null = null;

    constructor(template: UberShaderTemplateBasic) {
        super(template);
        this.variantSettings = new Map<string, string>();
    }

    public override getGfxProgram(cache: GfxRenderCache): GfxProgram {
        this.gfxRenderCache = cache;
        return super.getGfxProgram(cache);
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

    private patchProgram(newText: string): void {
        if (this.gfxRenderCache === null)
            return;

        if (this.gfxProgram === null)
            return;

        this.gfxRenderCache.device.programPatched(this.gfxProgram, getGfxProgramDescriptorBasic(this.gfxRenderCache, newText, this.variantSettings));
    }

    public edit(): void {
        const template = this.template as UberShaderTemplateBasic;
        const programString = template.generateProgramString(this.variantSettings);
        this.shaderTextEditor = new ShaderTextEditor(this.template.constructor.name, programString);
        this.shaderTextEditor.onchanged = (newText: string) => {
            this.patchProgram(newText);
        };
        this.shaderTextEditor.open();
    }
}
