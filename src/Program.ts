
import MemoizeCache from "./MemoizeCache";
import CodeEditor from "./CodeEditor";
import { assertExists, leftPad } from "./util";
import { StructLayout, parseShaderSource } from "./gfx/helpers/UniformBufferHelpers";
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { gfxDeviceGetImpl } from "./gfx/platform/GfxPlatformWebGL2";

interface ProgramWithKey extends WebGLProgram {
    uniqueKey: number;
}

const DEBUG = true;

function prependLineNo(str: string, lineStart: number = 1) {
    const lines = str.split('\n');
    return lines.map((s, i) => `${leftPad('' + (lineStart + i), 4, ' ')}  ${s}`).join('\n');
}

function compileShader(gl: WebGL2RenderingContext, str: string, type: number) {
    const shader: WebGLShader = assertExists(gl.createShader(type));

    gl.shaderSource(shader, str);
    gl.compileShader(shader);

    if (DEBUG && !gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(prependLineNo(str));
        const debug_shaders = gl.getExtension('WEBGL_debug_shaders');
        if (debug_shaders)
            console.error(debug_shaders.getTranslatedShaderSource(shader));
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
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

function range(start: number, num: number): number[] {
    const L: number[] = [];
    for (let i = 0; i < num; i++)
        L.push(start + i);
    return L;
}

export interface DeviceProgramReflection {
    name: string;
    uniformBufferLayouts: StructLayout[];
    samplerBindings: SamplerBindingReflection[];
    totalSamplerBindingsCount: number;
    uniqueKey: number;
}

export interface SamplerBindingReflection {
    name: string;
    arraySize: number;
}

export class DeviceProgram {
    public name: string = '(unnamed)';

    // Reflection.
    public uniformBufferLayouts: StructLayout[];
    public samplerBindings: SamplerBindingReflection[];
    public totalSamplerBindingsCount: number;
    public uniqueKey: number;

    // Compiled program.
    public glProgram: ProgramWithKey;
    public compileDirty: boolean = true;
    private preprocessedVert: string = '';
    private preprocessedFrag: string = '';

    // Inputs.
    public both: string = '';
    public vert: string = '';
    public frag: string = '';
    public defines = new Map<string, string>();

    public static equals(device: GfxDevice, a: DeviceProgram, b: DeviceProgram): boolean {
        a._ensurePreprocessed(device);
        b._ensurePreprocessed(device);
        return a.preprocessedVert === b.preprocessedVert && a.preprocessedFrag === b.preprocessedFrag;
    }

    private _ensurePreprocessedGL(gl: WebGL2RenderingContext): void {
        if (this.preprocessedVert === '') {
            this.preprocessedVert = this.preprocessShader(gl, this.both + this.vert, 'vert');
            this.preprocessedFrag = this.preprocessShader(gl, this.both + this.frag, 'frag');
            // TODO(jstpierre): Would love a better place to do this.
            DeviceProgram.parseReflectionDefinitionsInto(this, this.preprocessedVert);
        }
    }

    private _ensurePreprocessed(device: GfxDevice): void {
        return this._ensurePreprocessedGL(gfxDeviceGetImpl(device).gl);
    }

    public compile(gl: WebGL2RenderingContext, programCache: ProgramCache): void {
        if (this.compileDirty) {
            this._ensurePreprocessedGL(gl);
            const newProg = programCache.compileProgram(this.preprocessedVert, this.preprocessedFrag);
            if (newProg !== null && newProg !== this.glProgram) {
                this.glProgram = newProg;
                this.bind(gl, this.glProgram);
            }

            this.compileDirty = false;
        }

        if (!this.glProgram)
            throw new Error();
    }

    protected preprocessShader(gl: WebGL2RenderingContext, source: string, type: "vert" | "frag") {
        const extensionDefines = assertExists(gl.getSupportedExtensions()).map((s) => {
            return `#define HAS_${s}`;
        }).join('\n');

        // Garbage WebGL2 shader compiler until I get something better down the line...
        const lines = source.split('\n').map((n) => {
            // Remove comments.
            return n.replace(/[/][/].*$/, '');
        }).filter((n) => {
            // Filter whitespace.
            const isEmpty = !n || /^\s+$/.test(n);
            return !isEmpty;
        });

        const defines = [... this.defines.entries()].map((k, v) => `#define ${k} ${v}`).join('\n');
        const precision = lines.find((line) => line.startsWith('precision')) || 'precision mediump float;';
        const rest = lines.filter((line) => !line.startsWith('precision')).join('\n');

        return `
#version 300 es
${extensionDefines}
${precision}
#define ${type.toUpperCase()}
#define attribute in
#define varying ${type === 'vert' ? 'out' : 'in'}
#define main${type === 'vert' ? 'VS' : 'PS'} main
#define gl_FragColor o_color
#define texture2D texture
${defines}
out vec4 o_color;
${rest}
`.trim();
    }

    public bind(gl: WebGL2RenderingContext, prog: ProgramWithKey): void {
        this.uniqueKey = prog.uniqueKey;

        for (let i = 0; i < this.uniformBufferLayouts.length; i++) {
            const uniformBufferLayout = this.uniformBufferLayouts[i];
            gl.uniformBlockBinding(prog, gl.getUniformBlockIndex(prog, uniformBufferLayout.blockName), i);
        }

        let samplerIndex = 0;
        for (let i = 0; i < this.samplerBindings.length; i++) {
            // Assign identities in order.
            // XXX(jstpierre): This will cause a warning in Chrome, but I don't care rn.
            // It's more expensive to bind this every frame than respect Chrome's validation wishes...
            const samplerUniformLocation = gl.getUniformLocation(prog, this.samplerBindings[i].name);
            gl.useProgram(prog);
            gl.uniform1iv(samplerUniformLocation, range(samplerIndex, this.samplerBindings[i].arraySize));
            samplerIndex += this.samplerBindings[i].arraySize;
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        // XXX(jstpierre): Should we have refcounting in the program cache?
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
            editor.onvaluechanged = function() {
                if (timeout > 0)
                    clearTimeout(timeout);
                timeout = window.setTimeout(tryCompile, 500);
            };
            const onresize = win.onresize = () => {
                editor.setSize(document.body.offsetWidth, window.innerHeight);
            };
            onresize();
            const tryCompile = () => {
                timeout = 0;
                this[n] = editor.getValue();
                this.compileDirty = true;
                this.preprocessedVert = '';
            };
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

    private static parseReflectionDefinitionsInto(refl: DeviceProgramReflection, vert: string): void {
        refl.uniformBufferLayouts = [];
        parseShaderSource(refl.uniformBufferLayouts, vert);

        const samplers = findall(vert, /^uniform .*sampler\S+ (\w+)(?:\[(\d+)\])?;$/gm);
        refl.samplerBindings = [];
        refl.totalSamplerBindingsCount = 0;
        for (let i = 0; i < samplers.length; i++) {
            const [m, name, arraySizeStr] = samplers[i];
            let arraySize: number = arraySizeStr ? parseInt(arraySizeStr) : 1;
            refl.samplerBindings.push({ name, arraySize });
            refl.totalSamplerBindingsCount += arraySize;
        }
    }

    public static parseReflectionDefinitions(vert: string): DeviceProgramReflection {
        const refl: DeviceProgramReflection = {} as DeviceProgramReflection;
        DeviceProgram.parseReflectionDefinitionsInto(refl, vert);
        return refl;
    }
}

export class FullscreenProgram extends DeviceProgram {
    public vert: string = `
out vec2 v_TexCoord;

void main() {
    v_TexCoord.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    v_TexCoord.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = v_TexCoord * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1);
}
`;
}

interface ProgramKey {
    vert: string;
    frag: string;
}

export class ProgramCache extends MemoizeCache<ProgramKey, ProgramWithKey> {
    private _uniqueKey: number = 0;

    constructor(private gl: WebGL2RenderingContext) {
        super();
    }

    protected make(key: ProgramKey): ProgramWithKey {
        const gl = this.gl;
        const vertShader = compileShader(gl, key.vert, gl.VERTEX_SHADER);
        const fragShader = compileShader(gl, key.frag, gl.FRAGMENT_SHADER);
        if (!vertShader || !fragShader)
            return null;
        const prog = gl.createProgram() as ProgramWithKey;
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);
        gl.deleteShader(vertShader);
        gl.deleteShader(fragShader);
        if (DEBUG && !gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error(key.vert);
            console.error(key.frag);
            console.error(gl.getProgramInfoLog(prog));
            gl.deleteProgram(prog);
            return null;
        }
        prog.uniqueKey = ++this._uniqueKey;
        return prog;
    }

    protected destroy(obj: ProgramWithKey) {
        const gl = this.gl;
        gl.deleteProgram(obj);
    }

    protected makeKey(key: ProgramKey): string {
        return `${key.vert}$${key.frag}`;
    }

    public compileProgram(vert: string, frag: string) {
        return this.get({ vert, frag });
    }
}
