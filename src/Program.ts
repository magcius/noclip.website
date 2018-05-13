
import MemoizeCache from "./MemoizeCache";
import CodeEditor from "./CodeEditor";
import { assertExists } from "./util";

const DEBUG = true;

function leftPad(n: number, v: string, num: number) {
    let s = ''+n;
    while (s.length < num)
        s = v + s;
    return s;
}

function prependLineNo(str: string, lineStart: number = 1) {
    const lines = str.split('\n');
    return lines.map((s, i) => `${leftPad(lineStart + i, ' ', 4)}  ${s}`).join('\n');
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

export abstract class BaseProgram {
    public name: string = '(unnamed)';
    public vert: string = '';
    public frag: string = '';

    private glProg: WebGLProgram;
    private forceRecompile: boolean = false;

    public compile(gl: WebGL2RenderingContext, programCache: ProgramCache) {
        if (!this.glProg || this.forceRecompile) {
            this.forceRecompile = false;
            const vert = this.preprocessShader(gl, this.vert, "vert");
            const frag = this.preprocessShader(gl, this.frag, "frag");
            const newProg = programCache.compileProgram(vert, frag);
            if (newProg !== null) {
                this.glProg = newProg;
                this.bind(gl, this.glProg);
            }
        }

        if (!this.glProg) {
            throw new Error();
        }
        return this.glProg;
    }

    protected preprocessShader(gl: WebGL2RenderingContext, source: string, type: "vert" | "frag") {
        // Garbage WebGL2 shader compiler until I get something better down the line...
        const lines = source.split('\n').map((n) => {
            // Remove comments.
            return n.replace(/[/][/].*$/, '');
        }).filter((n) => {
            // Filter whitespace.
            const isEmpty = !n || /^\s+$/.test(n);
            return !isEmpty;
        });

        const precision = lines.find((line) => line.startsWith('precision')) || 'precision mediump float;';
        const extensionLines = lines.filter((line) => line.startsWith('#extension'));
        const extensions = extensionLines.filter((line) =>
            line.indexOf('GL_EXT_frag_depth') === -1 ||
            line.indexOf('GL_OES_standard_derivatives') === -1
        ).join('\n');
        const rest = lines.filter((line) => !line.startsWith('precision') && !line.startsWith('#extension')).join('\n');

        const extensionDefines = assertExists(gl.getSupportedExtensions()).map((s) => {
            return `#define HAS_${s}`;
        }).join('\n');
        return `
#version 300 es
#define attribute in
#define varying ${type === 'vert' ? 'out' : 'in'}
${extensionDefines}
#define gl_FragColor o_color
#define texture2D texture
${extensions}
${precision}
out vec4 o_color;
${rest}
`.trim();
    }

    public abstract bind(gl: WebGL2RenderingContext, prog: WebGLProgram): void;

    public destroy(gl: WebGL2RenderingContext) {
        // TODO(jstpierre): Refcounting in the program cache?
    }

    private _editShader(n: 'vert' | 'frag') {
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
                timeout = setTimeout(tryCompile, 500);
            };
            const onresize = win.onresize = () => {
                editor.setSize(document.body.offsetWidth, window.innerHeight);
            };
            onresize();
            const tryCompile = () => {
                timeout = 0;
                this[n] = editor.getValue();
                this.forceRecompile = true;
            };
            (<any> win).editor = editor;
            win.document.body.appendChild(editor.elem);
        };
        if (win.document.readyState === 'complete')
            init();
        else
            win.onload = init;
    }

    public editv() {
        this._editShader('vert');
    }

    public editf() {
        this._editShader('frag');
    }
}

// TODO(jstpierre): Remove.
export default class Program extends BaseProgram {
    public projectionLocation: WebGLUniformLocation | null = null;
    public modelViewLocation: WebGLUniformLocation | null = null;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        this.modelViewLocation  = assertExists(gl.getUniformLocation(prog, "u_modelView"));
        this.projectionLocation = assertExists(gl.getUniformLocation(prog, "u_projection"));
    }
}

export class FullscreenProgram extends BaseProgram {
    public vert: string = `
out vec2 v_TexCoord;

void main() {
    v_TexCoord.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    v_TexCoord.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = v_TexCoord * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1);
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram): void {
        // Nothing to do.
    }
}

interface ProgramKey {
    vert: string;
    frag: string;
}

export class ProgramCache extends MemoizeCache<ProgramKey, WebGLProgram> {
    constructor(private gl: WebGL2RenderingContext) {
        super();
    }

    protected make(key: ProgramKey): WebGLProgram {
        const gl = this.gl;
        const vertShader = compileShader(gl, key.vert, gl.VERTEX_SHADER);
        const fragShader = compileShader(gl, key.frag, gl.FRAGMENT_SHADER);
        if (!vertShader || !fragShader)
            return null;
        const prog = gl.createProgram();
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
        return prog;
    }

    protected destroy(obj: WebGLProgram) {
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
