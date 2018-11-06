
import Progressable from '../Progressable';

import { RenderState, RenderFlags } from '../render';
import { MainScene } from '../viewer';
import { SimpleProgram } from '../Program';
import { GfxBlendMode } from '../gfx/platform/GfxPlatform';

class InteriorProgram extends SimpleProgram {
    public static a_Position = 0;

    public vert = `
precision highp float;

uniform mat4 u_modelView;
uniform mat4 u_projection;

layout(location = ${InteriorProgram.a_Position}) attribute vec3 a_Position;
varying vec4 v_ObjPosWorld;

void main() {
    float t_PlaneScale = 20.0;
    vec3 t_Position = a_Position * t_PlaneScale;
    v_ObjPosWorld = vec4(a_Position, 1.0);
    gl_Position = u_projection * u_modelView * vec4(t_Position, 1.0);
}
`;

    public frag = `
precision highp float;

uniform mat4 u_modelView;
uniform samplerCube s_CubeMap;

varying vec4 v_ObjPosWorld;

const vec4 k_Right   = vec4(1, 0, 0, 0);
const vec4 k_Up      = vec4(0, 1, 0, 0);
const vec4 k_Forward = vec4(0, 0, 1, 0);

void main() {
    vec3 t_CameraPosWorld = (k_Forward * u_modelView).xyz;
    vec3 t_CameraToObj = v_ObjPosWorld.xyz - t_CameraPosWorld;
    t_CameraToObj *= vec3(0.2, 0.5, 0.6);
    t_CameraToObj = normalize(t_CameraToObj);

    vec4 t_Color;
    t_Color.a = 1.0;
    t_Color.rgb = texture(s_CubeMap, t_CameraToObj).rgb;

    gl_FragColor = t_Color;
}
`;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);
    }
}

class Scene {
    public program: InteriorProgram;

    private vtxBuffer: WebGLBuffer;
    private wallsCubeTexture: WebGLTexture;
    private renderFlags: RenderFlags;

    constructor(gl: WebGL2RenderingContext) {
        this.program = new InteriorProgram();
        this._createBuffers(gl);

        this.renderFlags = new RenderFlags();
        this.renderFlags.blendMode = GfxBlendMode.ADD;
    }

    public render(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.bindModelView();
        state.useFlags(this.renderFlags);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);
        gl.vertexAttribPointer(InteriorProgram.a_Position, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(InteriorProgram.a_Position);

        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.wallsCubeTexture);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disableVertexAttribArray(InteriorProgram.a_Position);
    }

    private _createBuffers(gl: WebGL2RenderingContext) {
        this.vtxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);

        const vtx = new Float32Array(4 * 3);

        vtx[0]  = -1;
        vtx[1]  = -1;
        vtx[2]  = 0;

        vtx[3]  = 1;
        vtx[4]  = -1;
        vtx[5]  = 0;

        vtx[6]  = -1;
        vtx[7]  = 1;
        vtx[8]  = 0;

        vtx[9]  = 1;
        vtx[10] = 1;
        vtx[11] = 0;

        gl.bufferData(gl.ARRAY_BUFFER, vtx, gl.STATIC_DRAW);

        this.wallsCubeTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.wallsCubeTexture);
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0xCC, 0x22, 0x66, 0xFF]));
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0x66, 0xCC, 0x22, 0xFF]));
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0x22, 0x66, 0xCC, 0xFF]));
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0xCC, 0x66, 0x22, 0xFF]));
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0x66, 0x22, 0xCC, 0xFF]));
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0x22, 0xCC, 0x66, 0xFF]));
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
        gl.deleteBuffer(this.vtxBuffer);
    }
}

export function createScene(gl: WebGL2RenderingContext, name: string): Progressable<MainScene> {
    return Progressable.resolve(new Scene(gl));
}
