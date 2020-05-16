
import CodeEditor from "./CodeEditor";
import { assertExists } from "./util";
import { GfxVendorInfo } from "./gfx/platform/GfxPlatform";
import { preprocessShader_GLSL } from "./gfx/shaderc/GfxShaderCompiler";

type DefineMap = Map<string, string>;

function definesEqual(a: DefineMap, b: DefineMap): boolean {
    if (a.size !== b.size)
        return false;

    for (const [k, v] of a.entries())
        if (b.get(k) !== v)
            return false;

    return true;
}

export function deviceProgramEqual(a: DeviceProgram, b: DeviceProgram): boolean {
    if (a.both !== b.both)
        return false;
    if (a.vert !== b.vert)
        return false;
    if (a.frag !== b.frag)
        return false;
    if (!definesEqual(a.defines, b.defines))
        return false;
    return true;
}

export class DeviceProgram {
    public name: string = '(unnamed)';

    // Compiled program.
    public preprocessedVert: string = '';
    public preprocessedFrag: string = '';

    // Inputs.
    public both: string = '';
    public vert: string = '';
    public frag: string = '';
    public defines = new Map<string, string>();

    public setDefineBool(name: string, v: boolean): void {
        if (v)
            this.defines.set(name, '1');
        else
            this.defines.delete(name);
    }

    public ensurePreprocessed(vendorInfo: GfxVendorInfo): void {
        if (this.preprocessedVert === '') {
            this.preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', this.both + this.vert, this.defines);
            this.preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', this.both + this.frag, this.defines);
        }
    }

    private _editShader(n: 'vert' | 'frag' | 'both') {
        const win = assertExists(window.open('about:blank', undefined, `location=off, resizable, alwaysRaised, left=20, top=20, width=1200, height=900`));
        const init = () => {
            const editor = new CodeEditor(win.document);
            const document = win.document;
            const title = n === 'vert' ? `${this.name} - Vertex Shader` : `${this.name} - Fragment Shader`;
            document.title = title;
            document.body.style.margin = '0';
            const shader: string = this[n];
            editor.setValue(shader);
            editor.setFontSize('16px');
            let timeout: number = 0;

            const tryCompile = () => {
                timeout = 0;
                this[n] = editor.getValue();
                this.preprocessedVert = '';
            };

            editor.onvaluechanged = function() {
                if (timeout > 0)
                    clearTimeout(timeout);
                timeout = window.setTimeout(tryCompile, 500);
            };
            const onresize = win.onresize = () => {
                editor.setSize(document.body.offsetWidth, window.innerHeight);
            };
            onresize();
            (win as any).editor = editor;
            win.document.body.appendChild(editor.elem);
        };
        if (win.document.readyState === 'complete')
            init();
        else
            win.onload = init;
    }

    public editb() {
        this._editShader('both');
    }

    public editv() {
        this._editShader('vert');
    }

    public editf() {
        this._editShader('frag');
    }
}
