
import { mat3, mat4 } from 'gl-matrix';

import { BMD, BTK, BMT, TEX1_Texture, Shape, HierarchyNode, HierarchyType, MaterialEntry } from './j3d';

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from 'viewer';

import { RenderFlags, RenderState, RenderPass, CompareMode, CoalescedBuffers, BufferCoalescer } from '../render';
import { assert, align } from '../util';

function translateCompType(gl: WebGL2RenderingContext, compType: GX.CompType): { type: GLenum, normalized: boolean } {
    switch (compType) {
    case GX.CompType.F32:
        return { type: gl.FLOAT, normalized: false };
    case GX.CompType.S8:
        return { type: gl.BYTE, normalized: false };
    case GX.CompType.S16:
        return { type: gl.SHORT, normalized: false };
    case GX.CompType.U16:
        return { type: gl.UNSIGNED_SHORT, normalized: false };
    case GX.CompType.U8:
        return { type: gl.UNSIGNED_BYTE, normalized: false };
    case GX.CompType.RGBA8: // XXX: Is this right?
        return { type: gl.UNSIGNED_BYTE, normalized: true };
    default:
        throw new Error(`Unknown CompType ${compType}`);
    }
}

const packetParamsData = new Float32Array(10 * 16);
class Command_Shape {
    private bmd: BMD;
    private shape: Shape;
    private vao: WebGLVertexArrayObject;
    private jointMatrices: mat4[];
    private coalescedBuffers: CoalescedBuffers;
    private packetParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, bmd: BMD, shape: Shape, coalescedBuffers: CoalescedBuffers, jointMatrices: mat4[]) {
        this.bmd = bmd;
        this.shape = shape;
        this.coalescedBuffers = coalescedBuffers;
        this.jointMatrices = jointMatrices;

        this.packetParamsBuffer = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.packetParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, packetParamsData, gl.DYNAMIC_DRAW);

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, coalescedBuffers.vertexBuffer.buffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, coalescedBuffers.indexBuffer.buffer);

        for (const attrib of this.shape.packedVertexAttributes) {
            const vertexArray = this.bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);

            const attribLocation = GX_Material.getVertexAttribLocation(attrib.vtxAttrib);
            gl.enableVertexAttribArray(attribLocation);

            const { type, normalized } = translateCompType(gl, vertexArray.compType);

            gl.vertexAttribPointer(
                attribLocation,
                vertexArray.compCount,
                type, normalized,
                this.shape.packedVertexSize,
                coalescedBuffers.vertexBuffer.offset + attrib.offset,
            );
        }

        gl.bindVertexArray(null);
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        gl.bindVertexArray(this.vao);

        const indexOffset = this.coalescedBuffers.indexBuffer.offset;

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.packetParamsBuffer);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_PacketParams, this.packetParamsBuffer);

        this.shape.packets.forEach((packet, packetIndex) => {
            // Update our matrix table.
            let updated = false;
            for (let i = 0; i < packet.weightedJointTable.length; i++) {
                const weightedJointIndex = packet.weightedJointTable[i];
                // Leave existing joint.
                if (weightedJointIndex === 0xFFFF)
                    continue;
                const weightedJoint = this.bmd.drw1.weightedJoints[weightedJointIndex];
                if (weightedJoint.isWeighted)
                    throw "whoops";

                const posMtx = this.jointMatrices[weightedJoint.jointIndex];
                packetParamsData.set(posMtx, i * 16);
                updated = true;
            }
            if (updated)
                gl.bufferData(gl.UNIFORM_BUFFER, packetParamsData, gl.DYNAMIC_DRAW);

            gl.drawElements(gl.TRIANGLES, packet.numTriangles * 3, gl.UNSIGNED_SHORT, indexOffset + packet.firstTriangle * 3 * 2);
        });

        gl.bindVertexArray(null);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteVertexArray(this.vao);
        gl.deleteBuffer(this.packetParamsBuffer);
    }
}

const materialParamsData = new Float32Array(4*2 + 4*8 + 4*3*10);
export class Command_Material {
    static matrixScratch = mat3.create();
    static textureScratch = new Int32Array(8);

    private scene: Scene;

    public bmd: BMD;
    public btk: BTK;
    public bmt: BMT;
    public material: MaterialEntry;

    public textures: WebGLTexture[] = [];
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;

    private materialParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, scene: Scene, material: MaterialEntry) {
        this.scene = scene;
        this.bmd = scene.bmd;
        this.btk = scene.btk;
        this.bmt = scene.bmt;
        this.material = material;
        this.program = new GX_Material.GX_Program(material.gxMaterial);
        this.program.compile(gl);
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);

        this.textures = this.translateTextures(gl);

        this.materialParamsBuffer = gl.createBuffer();
    }

    private translateTextures(gl: WebGL2RenderingContext): WebGLTexture[] {
        const tex1 = this.bmt ? this.bmt.tex1 : this.bmd.tex1;
        const textures = [];
        for (let i = 0; i < this.material.textureIndexes.length; i++) {
            const texIndex = this.material.textureIndexes[i];
            if (texIndex >= 0)
                textures[i] = Command_Material.translateTexture(gl, tex1.textures[tex1.remapTable[texIndex]]);
            else
                textures[i] = null;
        }
        return textures;
    }

    private static translateTexFilter(gl: WebGL2RenderingContext, texFilter: GX.TexFilter) {
        switch (texFilter) {
        case GX.TexFilter.LIN_MIP_NEAR:
            return gl.LINEAR_MIPMAP_NEAREST;
        case GX.TexFilter.LIN_MIP_LIN:
            return gl.LINEAR_MIPMAP_LINEAR;
        case GX.TexFilter.LINEAR:
            return gl.LINEAR;
        case GX.TexFilter.NEAR_MIP_NEAR:
            return gl.NEAREST_MIPMAP_NEAREST;
        case GX.TexFilter.NEAR_MIP_LIN:
            return gl.NEAREST_MIPMAP_LINEAR;
        case GX.TexFilter.NEAR:
            return gl.NEAREST;
        }
    }

    private static translateWrapMode(gl: WebGL2RenderingContext, wrapMode: GX.WrapMode) {
        switch (wrapMode) {
        case GX.WrapMode.CLAMP:
            return gl.CLAMP_TO_EDGE;
        case GX.WrapMode.MIRROR:
            return gl.MIRRORED_REPEAT;
        case GX.WrapMode.REPEAT:
            return gl.REPEAT;
        }
    }

    private static translateTexture(gl: WebGL2RenderingContext, texture: TEX1_Texture) {
        const texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.translateTexFilter(gl, texture.minFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.translateTexFilter(gl, texture.magFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.translateWrapMode(gl, texture.wrapS));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.translateWrapMode(gl, texture.wrapT));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, texture.mipCount - 1);

        const ext_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        const format = texture.format;

        let offs = 0, width = texture.width, height = texture.height;
        for (let i = 0; i < texture.mipCount; i++) {
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data;
            const dataStart = texture.dataStart + offs;
            const surface = { format, width, height, data, dataStart };
            const decodedTexture = GX_Texture.decodeTexture(surface, !!ext_compressed_texture_s3tc);

            if (decodedTexture.type === 'RGBA') {
                gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA8, decodedTexture.width, decodedTexture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedTexture.pixels);
            } else if (decodedTexture.type === 'S3TC') {
                gl.compressedTexImage2D(gl.TEXTURE_2D, i, ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, decodedTexture.width, decodedTexture.height, 0, decodedTexture.pixels);
            }

            offs += size;
            width /= 2;
            height /= 2;
        }

        return texId;
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        for (let i = 0; i < 2; i++) {
            const color = this.material.colorMatRegs[i];
            if (color !== null) {
                materialParamsData[i*4+0] = color.r;
                materialParamsData[i*4+1] = color.g;
                materialParamsData[i*4+2] = color.b;
                materialParamsData[i*4+3] = color.a;
            }
        }

        for (let i = 0; i < 8; i++) {
            let fallbackColor: GX_Material.Color;
            if (i >= 4)
                fallbackColor = this.material.gxMaterial.colorRegisters[i - 4];
            else
                fallbackColor = this.material.gxMaterial.colorConstants[i];

            let color: GX_Material.Color;
            if (this.scene.colorOverrides[i]) {
                color = this.scene.colorOverrides[i];
            } else {
                color = fallbackColor;
            }

            let alpha: number;
            if (this.scene.alphaOverrides[i] !== undefined) {
                alpha = this.scene.alphaOverrides[i];
            } else {
                alpha = fallbackColor.a;
            }

            const offs = 4*2 + 4*i;
            materialParamsData[offs+0] = color.r;
            materialParamsData[offs+1] = color.g;
            materialParamsData[offs+2] = color.b;
            materialParamsData[offs+3] = alpha;
        }

        // Bind our texture matrices.
        const matrixScratch = Command_Material.matrixScratch;
        for (let i = 0; i < this.material.texMatrices.length; i++) {
            const texMtx = this.material.texMatrices[i];
            if (texMtx === null)
                continue;

            let finalMatrix;
            if (this.btk && this.btk.calcAnimatedTexMtx(matrixScratch, this.material.name, i, this.scene.getTimeInFrames(state.time))) {
                finalMatrix = matrixScratch;

                // Multiply in the material matrix if we want that.
                if (this.scene.useMaterialTexMtx)
                    mat3.mul(matrixScratch, matrixScratch, texMtx.matrix);
            } else {
                finalMatrix = texMtx.matrix;
            }

            const offs = 4*2 + 4*8 + 12*i;
            // XXX(jstpierre): mat3's are effectively a mat4x3.
            materialParamsData[offs +  0] = finalMatrix[0];
            materialParamsData[offs +  1] = finalMatrix[1];
            materialParamsData[offs +  2] = finalMatrix[2];
            materialParamsData[offs +  4] = finalMatrix[3];
            materialParamsData[offs +  5] = finalMatrix[4];
            materialParamsData[offs +  6] = finalMatrix[5];
            materialParamsData[offs +  8] = finalMatrix[6];
            materialParamsData[offs +  9] = finalMatrix[7];
            materialParamsData[offs + 10] = finalMatrix[8];
        }

        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_SceneParams, this.scene.sceneParamsBuffer);

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.materialParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, materialParamsData, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_MaterialParams, this.materialParamsBuffer);

        // Bind textures.
        const textureScratch = Command_Material.textureScratch;
        for (let i = 0; i < this.textures.length; i++) {
            const texture = this.textures[i];
            if (texture === null)
                continue;
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            textureScratch[i] = i;
        }
        gl.uniform1iv(this.program.u_Texture, textureScratch);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.textures.forEach((texture) => gl.deleteTexture(texture));
        this.program.destroy(gl);
        gl.deleteBuffer(this.materialParamsBuffer);
    }
}

type Command = Command_Shape | Command_Material;

interface HierarchyTraverseContext {
    commandList: Command[];
    parentJointMatrix: mat4;
}

export enum ColorOverride {
    K0, K1, K2, K3,
    C0, C1, C2, C3,
}

const sceneParamsData = new Float32Array(4*4 + 4*4 + 4*4 + 4);
export class Scene implements Viewer.Scene {
    public renderPasses = [ RenderPass.OPAQUE, RenderPass.TRANSPARENT ];
    public textures: Viewer.Texture[];

    public name: string = '';
    public visible: boolean = true;
    public bmd: BMD;
    public btk: BTK;
    public bmt: BMT;
    public isSkybox: boolean = false;
    public useMaterialTexMtx: boolean = true;
    public fps: number = 30;

    public modelMatrix: mat4;

    public attrScaleData: Float32Array;

    public colorOverrides: GX_Material.Color[] = [];
    public alphaOverrides: number[] = [];

    private bufferCoalescer: BufferCoalescer;

    private opaqueCommands: Command[];
    private transparentCommands: Command[];

    private materialCommands: Command_Material[];
    private shapeCommands: Command_Shape[];
    private jointMatrices: mat4[];

    public sceneParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, bmd: BMD, btk: BTK, bmt: BMT) {
        this.bmd = bmd;
        this.btk = btk;
        this.bmt = bmt;

        this.translateModel(gl, this.bmd);

        this.sceneParamsBuffer = gl.createBuffer();
        this.modelMatrix = mat4.create();

        const tex1 = this.bmt ? this.bmt.tex1 : this.bmd.tex1;
        this.textures = tex1.textures.map((tex) => this.translateTextureToViewer(tex));
    }

    public setColorOverride(i: ColorOverride, color: GX_Material.Color) {
        this.colorOverrides[i] = color;
    }

    public setAlphaOverride(i: ColorOverride, alpha: number) {
        this.alphaOverrides[i] = alpha;
    }

    public setIsSkybox(v: boolean) {
        this.isSkybox = v;
    }

    public setFPS(v: number) {
        this.fps = v;
    }

    public setUseMaterialTexMtx(v: boolean) {
        // Wind Waker's BTK animations seem to override the existing baked-in TexMtx.
        // Super Mario Galaxy seems to stack them. I couldn't find any flag behavior for this,
        // implying it's probably an engine change rather than separate BMD behavior.
        this.useMaterialTexMtx = v;
    }

    public getTimeInFrames(milliseconds: number) {
        return (milliseconds / 1000) * this.fps;
    }

    private translateTextureToViewer(texture: TEX1_Texture): Viewer.Texture {
        const surfaces = [];

        let width = texture.width, height = texture.height, offs = 0;
        const format = texture.format;
        for (let i = 0; i < texture.mipCount; i++) {
            const data = texture.data;
            const dataStart = texture.dataStart + offs;
            const surface = { format, width, height, data, dataStart };
            const rgbaTexture = GX_Texture.decodeTexture(surface, false);
            // Should never happen.
            if (rgbaTexture.type === 'S3TC')
                throw "whoops";

            const canvas = document.createElement('canvas');
            canvas.width = rgbaTexture.width;
            canvas.height = rgbaTexture.height;
            canvas.title = `${texture.name} ${texture.format}`;
            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(rgbaTexture.width, rgbaTexture.height);
            imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
            ctx.putImageData(imgData, 0, 0);
            surfaces.push(canvas);
        
            const size = GX_Texture.calcTextureSize(format, width, height);
            offs += size;
            width /= 2;
            height /= 2;
        }

        return { name: texture.name, surfaces };
    }

    private execCommands(state: RenderState, commands: Command[]) {
        commands.forEach((command) => {
            command.exec(state);
        });
    }

    public render(state: RenderState) {
        if (!this.visible)
            return;

        const gl = state.gl;

        state.setClipPlanes(10, 500000);

        // Update our SceneParams UBO.
        let offs = 0;
        sceneParamsData.set(state.projection, offs);
        offs += 4*4;
        sceneParamsData.set(state.updateModelView(this.isSkybox, this.modelMatrix), offs);
        offs += 4*4;
        sceneParamsData.set(this.attrScaleData, offs);
        offs += 4*4;
        sceneParamsData[offs++] = GX_Material.getTextureLODBias(state);

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, sceneParamsData, gl.DYNAMIC_DRAW);

        if (this.isSkybox) {
            // The Super Mario Sunshine skyboxes are authored in this strange way where they are transparent,
            // and expect to be drawn directly on top of the clear color with blending on. I don't know why
            // Nintendo chose to do things this way -- there might be a flag for sorting in the BMD I'm not
            // correctly pulling out right now, or this might be explicitly done in the engine.
            // Draw them in the opaque pass, first thing.

            if (state.currentPass === RenderPass.OPAQUE) {
                this.execCommands(state, this.opaqueCommands);
                this.execCommands(state, this.transparentCommands);
            }
            return;
        }

        if (state.currentPass === RenderPass.OPAQUE) {
            this.execCommands(state, this.opaqueCommands);
        } else if (state.currentPass === RenderPass.TRANSPARENT) {
            this.execCommands(state, this.transparentCommands);
        }
    }

    private translateModel(gl: WebGL2RenderingContext, bmd: BMD) {
        const attrScaleCount = GX_Material.scaledVtxAttributes.length;
        const attrScaleData = new Float32Array(attrScaleCount);
        for (let i = 0; i < GX_Material.scaledVtxAttributes.length; i++) {
            const attrib = GX_Material.scaledVtxAttributes[i];
            const vtxArray = this.bmd.vtx1.vertexArrays.get(attrib);
            const scale = vtxArray !== undefined ? vtxArray.scale : 1;
            attrScaleData[i] = scale;
        }
        this.attrScaleData = attrScaleData;

        this.opaqueCommands = [];
        this.transparentCommands = [];
        this.jointMatrices = [];

        const mat3 = this.bmt ? this.bmt.mat3 : this.bmd.mat3;
        this.materialCommands = mat3.materialEntries.map((material) => {
            return new Command_Material(gl, this, material);
        });

        this.bufferCoalescer = new BufferCoalescer(gl,
            bmd.shp1.shapes.map((shape) => shape.packedData),
            bmd.shp1.shapes.map((shape) => shape.indexData.buffer)
        );

        this.shapeCommands = bmd.shp1.shapes.map((shape, i) => {
            return new Command_Shape(gl, this.bmd, shape, this.bufferCoalescer.coalescedBuffers[i], this.jointMatrices);
        });

        // Iterate through scene graph.
        const context: HierarchyTraverseContext = {
            commandList: null,
            parentJointMatrix: mat4.create(),
        };
        this.translateSceneGraph(bmd.inf1.sceneGraph, context);
    }

    private translateSceneGraph(node: HierarchyNode, context: HierarchyTraverseContext) {
        const mat3 = this.bmt ? this.bmt.mat3 : this.bmd.mat3;
        const jnt1 = this.bmd.jnt1;

        let commandList = context.commandList;
        let parentJointMatrix = context.parentJointMatrix;
        switch (node.type) {
        case HierarchyType.Shape:
            commandList.push(this.shapeCommands[node.shapeIdx]);
            break;
        case HierarchyType.Joint:
            const boneMatrix = jnt1.bones[jnt1.remapTable[node.jointIdx]].matrix;
            const jointMatrix = mat4.create();
            mat4.mul(jointMatrix, boneMatrix, parentJointMatrix);
            this.jointMatrices[node.jointIdx] = jointMatrix;
            parentJointMatrix = jointMatrix;
            break;
        case HierarchyType.Material:
            const materialIdx = mat3.remapTable[node.materialIdx];
            const materialCommand = this.materialCommands[materialIdx];
            commandList = materialCommand.material.translucent ? this.transparentCommands : this.opaqueCommands;
            commandList.push(materialCommand);
            break;
        }

        const childContext = { commandList, parentJointMatrix };

        for (const child of node.children)
            this.translateSceneGraph(child, childContext);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.bufferCoalescer.destroy(gl);
        this.materialCommands.forEach((command) => command.destroy(gl));
        this.shapeCommands.forEach((command) => command.destroy(gl));
        gl.deleteBuffer(this.sceneParamsBuffer);
    }
}
