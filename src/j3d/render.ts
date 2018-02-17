
import * as BMD from 'bmd';
import * as GX from 'gx';
import * as Viewer from 'viewer';

import { fetch } from 'util';
import { Progressable } from '../progress';

class BlackProgram extends Viewer.Program {
    public static a_position = 0;

    public vert = `
precision mediump float;
uniform mat4 u_modelView;
uniform mat4 u_projection;
layout(location = ${BlackProgram.a_position}) in vec3 a_position;

void main() {
    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
}`;

    public frag = `
precision mediump float;

void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

    public static getAttribLocation(vtxAttrib: GX.VertexAttribute) {
        switch (vtxAttrib) {
        case GX.VertexAttribute.POS:
            return this.a_position;
        }
        return null;
    }
}

function translateCompType(gl: WebGL2RenderingContext, compType: GX.CompType): number {
    switch (compType) {
    case GX.CompType.F32:
        return gl.FLOAT;
    case GX.CompType.S8:
        return gl.BYTE;
    case GX.CompType.S16:
        return gl.SHORT;
    case GX.CompType.U16:
        return gl.UNSIGNED_SHORT;
    case GX.CompType.U8:
        return gl.UNSIGNED_BYTE;
    case GX.CompType.RGBA8: // XXX: Is this right?
        return gl.UNSIGNED_BYTE;
    default:
        throw new Error(`Unknown CompType ${compType}`);
    }
}

function translatePrimType(gl: WebGL2RenderingContext, primType: GX.PrimitiveType): number {
    switch (primType) {
    case GX.PrimitiveType.TRIANGLESTRIP:
        return gl.TRIANGLE_STRIP;
    case GX.PrimitiveType.TRIANGLEFAN:
        return gl.TRIANGLE_FAN;
    default:
        throw new Error(`Unknown PrimType ${primType}`);
    }
}

class Command_Shape {
    public bmd: BMD.BMD;
    public shape: BMD.Shape;
    public buffer: WebGLBuffer;
    public vao: WebGLVertexArrayObject;

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD, shape: BMD.Shape) {
        this.bmd = bmd;
        this.shape = shape;
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.shape.packedData, gl.STATIC_DRAW);

        for (const attrib of this.shape.packedVertexAttributes) {
            const vertexArray = this.bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);

            const attribLocation = BlackProgram.getAttribLocation(attrib.vtxAttrib);
            if (attribLocation === null) continue; // XXX(jstpierre)
            gl.enableVertexAttribArray(attribLocation);

            gl.vertexAttribPointer(
                attribLocation,
                vertexArray.compCount,
                translateCompType(gl, vertexArray.compType),
                false,
                this.shape.packedVertexSize,
                attrib.offset,
            );
        }
    }

    public exec(state: Viewer.RenderState) {
        const gl = state.gl;

        gl.bindVertexArray(this.vao);

        // Do draw calls.
        for (const drawCall of this.shape.drawCalls) {
            gl.drawArrays(translatePrimType(gl, drawCall.primType), drawCall.first, drawCall.vertexCount);
        }

        gl.bindVertexArray(null);
    }
}

type Command = Command_Shape;

export class Scene implements Viewer.Scene {
    public gl: WebGL2RenderingContext;
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];
    private program_Black: BlackProgram;
    private bmd: BMD.BMD;
    private commands: Command[];

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD) {
        this.gl = gl;
        this.program_Black = new BlackProgram();
        this.bmd = bmd;
        this.translateModel(this.bmd);
    }

    public render(state: Viewer.RenderState) {
        state.useProgram(this.program_Black);
        for (const command of this.commands)
            command.exec(state);
    }

    private translateModel(bmd: BMD.BMD) {
        this.commands = [];
        // Iterate through scene graph.
        this.translateSceneGraph(bmd.inf1.sceneGraph);
    }

    private translateSceneGraph(node: BMD.HierarchyNode) {
        switch (node.type) {
        case BMD.HierarchyType.Open:
            for (const child of node.children)
                this.translateSceneGraph(child);
            break;
        case BMD.HierarchyType.Shape:
            const shape = this.bmd.shp1.shapes[node.shapeIdx];
            this.commands.push(new Command_Shape(this.gl, this.bmd, shape));
            break;
        case BMD.HierarchyType.Joint:
            // XXX: Implement joints...
            break;
        case BMD.HierarchyType.Material:
            // XXX: Implement materials...
            break;
        }
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const bmd = BMD.parse(result);
            return new Scene(gl, bmd);
        });
    }
}
