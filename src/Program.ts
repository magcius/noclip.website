
import CodeEditor from "./CodeEditor.js";
import { assert, assertExists, nullify } from "./util.js";
import { GfxVendorInfo, GfxProgram, GfxDevice } from "./gfx/platform/GfxPlatform.js";
import { preprocessShader_GLSL } from "./gfx/shaderc/GfxShaderCompiler.js";

export class DeviceProgram {
    public name: string = '(unnamed DeviceProgram)';

    // Compiled program.
    public preprocessedVert: string = '';
    public preprocessedFrag: string = '';

    // Inputs.
    public both: string = '';
    public vert: string = '';
    public frag: string = '';
    public defines = new Map<string, string>();

    public definesChanged(): void {
        this.preprocessedVert = '';
        this.preprocessedFrag = '';
    }

    public setDefineString(name: string, v: string | null): boolean {
        if (v !== null) {
            if (this.defines.get(name) === v)
                return false;
            this.defines.set(name, v);
        } else {
            if (!this.defines.has(name))
                return false;
            this.defines.delete(name);
        }
        this.definesChanged();
        return true;
    }

    public setDefineBool(name: string, v: boolean): boolean {
        return this.setDefineString(name, v ? '1' : null);
    }

    public getDefineString(name: string): string | null {
        return nullify(this.defines.get(name));
    }

    public getDefineBool(name: string): boolean {
        const str = this.getDefineString(name);
        if (str !== null)
            assert(str === '1');
        return str !== null;
    }

    public ensurePreprocessed(vendorInfo: GfxVendorInfo): void {
        if (this.preprocessedVert === '') {
            this.preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', this.both + this.vert, this.defines);
            this.preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', this.both + this.frag, this.defines);
        }
    }

    private _gfxDevice: GfxDevice | null = null;
    private _gfxProgram: GfxProgram | null = null;
    public associate(device: GfxDevice, program: GfxProgram): void {
        this._gfxDevice = device;
        this._gfxProgram = program;

        if (this.name === '(unnamed DeviceProgram)')
            this.name = this.constructor.name;
        this._gfxDevice.setResourceName(program, this.name);
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

                if (this._gfxDevice !== null && this._gfxProgram !== null) {
                    this.preprocessedVert = '';
                    this.ensurePreprocessed(this._gfxDevice.queryVendorInfo());
                    this._gfxDevice.programPatched(this._gfxProgram, this);
                }
            };

            editor.onvaluechanged = function(immediate: boolean) {
                if (timeout > 0)
                    clearTimeout(timeout);

                if (immediate) {
                    tryCompile();
                } else {
                    // debounce
                    timeout = window.setTimeout(tryCompile, 500);
                }
            };
            const onresize = win.onresize = () => {
                editor.setSize(document.body.offsetWidth, window.innerHeight);
            };
            onresize();
            (win as any).editor = editor;
            (window as any).editor = editor;
            win.document.body.appendChild(editor.elem);
            window.addEventListener('beforeunload', () => {
                win.close();
            });
            window.addEventListener('loadNewScene', () => {
                win.close();
            });
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
