
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

    private _ensurePreprocessed(device: GfxDevice): void {
        if (this.preprocessedVert === '') {
            this.preprocessedVert = this.preprocessShader(device, this.both + this.vert, 'vert');
            this.preprocessedFrag = this.preprocessShader(device, this.both + this.frag, 'frag');
            // TODO(jstpierre): Would love a better place to do this.
            DeviceProgram.parseReflectionDefinitionsInto(this, this.preprocessedVert);
        }
    }

    public compile(device: GfxDevice, programCache: ProgramCache): void {
        if (this.compileDirty) {
            this._ensurePreprocessed(device);
            const newProg = programCache.compileProgram(this.preprocessedVert, this.preprocessedFrag);
            if (newProg !== null && newProg !== this.glProgram) {
                this.glProgram = newProg;
                this.bind(device, this.glProgram);
            }

            this.compileDirty = false;
        }

        if (!this.glProgram)
            throw new Error();
    }

    protected preprocessShader(device: GfxDevice, source: string, type: "vert" | "frag"): string {
        const deviceImpl = gfxDeviceGetImpl(device);
        const gl = deviceImpl.gl;

        const extensionDefines = assertExists(gl.getSupportedExtensions()).map((s) => {
            return `#define HAS_${s}`;
        }).join('\n');

        const bugDefines = deviceImpl.programBugDefines;

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
${bugDefines}
${precision}
#define ${type.toUpperCase()}
#define attribute in
#define varying ${type === 'vert' ? 'out' : 'in'}
#define main${type === 'vert' ? 'VS' : 'PS'} main
#define gl_FragColor o_color
#define texture2D texture

#ifdef _BUG_APPLE_ROW_MAJOR
struct Mat4x4 { vec4 _m[4]; };
struct Mat4x3 { vec4 _m[3]; };
struct Mat4x2 { vec4 _m[2]; };
vec4 Mul(Mat4x4 m, vec4 v) { return vec4(dot(m._m[0], v), dot(m._m[1], v), dot(m._m[2], v), dot(m._m[3], v)); }
vec3 Mul(Mat4x3 m, vec4 v) { return vec3(dot(m._m[0], v), dot(m._m[1], v), dot(m._m[2], v)); }
vec4 Mul(vec3 v, Mat4x3 m) { return vec4(
    dot(vec3(m._m[0].x, m._m[1].x, m._m[2].x), v),
    dot(vec3(m._m[0].y, m._m[1].y, m._m[2].y), v),
    dot(vec3(m._m[0].z, m._m[1].z, m._m[2].z), v),
    dot(vec3(m._m[0].w, m._m[1].w, m._m[2].w), v)
); }
vec2 Mul(Mat4x2 m, vec4 v) { return vec2(dot(m._m[0], v), dot(m._m[1], v)); }
void Fma(Mat4x3 d, Mat4x3 m, float s) { d._m[0] += m._m[0] * s; d._m[1] += m._m[1] * s; d._m[2] += m._m[2] * s; }
Mat4x4 _Mat4x4(Mat4x3 m) { Mat4x4 o; o._m[0] = m._m[0]; o._m[1] = m._m[1]; o._m[2] = m._m[2]; o._m[3] = vec4(0, 0, 0, 1); return o; }
Mat4x4 _Mat4x4(float n) { Mat4x4 o; o._m[0].x = n; o._m[1].y = n; o._m[2].z = n; o._m[3].w = n; return o; }
Mat4x3 _Mat4x3(Mat4x4 m) { Mat4x3 o; o._m[0] = m._m[0]; o._m[1] = m._m[1]; o._m[2] = m._m[2]; return o; }
Mat4x3 _Mat4x3(float n) { Mat4x3 o; o._m[0].x = n; o._m[1].y = n; o._m[2].z = n; return o; }
#else
#define Mat4x4 mat4x4
#define Mat4x3 mat4x3
#define Mat4x2 mat4x2
#define _Mat4x4 mat4x4
#define _Mat4x3 mat4x3
#define Mul(A, B) (A * B)
#define Fma(D, M, S) (D += (M) * (S))
#endif

${defines}
out vec4 o_color;
${rest}
`.trim();
    }

    public bind(device: GfxDevice, prog: ProgramWithKey): void {
        const gl = gfxDeviceGetImpl(device).gl;
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
