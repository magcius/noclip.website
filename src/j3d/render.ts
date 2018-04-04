
import { mat3, mat4 } from 'gl-matrix';

import { BMD, BMT, BTK, HierarchyNode, HierarchyType, MaterialEntry, Shape, BTI_Texture } from './j3d';

import * as GX from 'gx/gx_enum';
import * as GX_Material from 'gx/gx_material';
import * as GX_Texture from 'gx/gx_texture';
import * as Viewer from 'viewer';

import { BufferCoalescer, CoalescedBuffers, CompareMode, RenderFlags, RenderState } from '../render';
import { align, assert } from '../util';

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
                    throw new Error("whoops");

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

const materialParamsData = new Float32Array(4*2 + 4*8 + 4*3*10 + 4*3*20);
export class Command_Material {
    private static matrixScratch = mat3.create();
    private static textureScratch = new Int32Array(8);

    public bmd: BMD;
    public btk: BTK;
    public bmt: BMT;
    public material: MaterialEntry;

    public textures: WebGLTexture[] = [];

    private scene: Scene;
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
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);

        this.textures = this.translateTextures();

        this.materialParamsBuffer = gl.createBuffer();
    }

    private translateTextures(): WebGLTexture[] {
        const textures = [];
        for (let i = 0; i < this.material.textureIndexes.length; i++) {
            const texIndex = this.material.textureIndexes[i];
            if (texIndex >= 0)
                textures[i] = this.scene.materialTextures[texIndex];
            else
                textures[i] = null;
        }
        return textures;
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        let offs = 0;
        for (let i = 0; i < 2; i++) {
            const color = this.material.colorMatRegs[i];
            if (color !== null) {
                materialParamsData[offs+i*4+0] = color.r;
                materialParamsData[offs+i*4+1] = color.g;
                materialParamsData[offs+i*4+2] = color.b;
                materialParamsData[offs+i*4+3] = color.a;
            }
        }
        offs += 4*2;

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

            materialParamsData[offs + i*4 + 0] = color.r;
            materialParamsData[offs + i*4 + 1] = color.g;
            materialParamsData[offs + i*4 + 2] = color.b;
            materialParamsData[offs + i*4 + 3] = alpha;
        }
        offs += 4*8;

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

            // XXX(jstpierre): mat3's are effectively a mat4x3.
            materialParamsData[offs + i*12 +  0] = finalMatrix[0];
            materialParamsData[offs + i*12 +  1] = finalMatrix[1];
            materialParamsData[offs + i*12 +  2] = finalMatrix[2];
            materialParamsData[offs + i*12 +  4] = finalMatrix[3];
            materialParamsData[offs + i*12 +  5] = finalMatrix[4];
            materialParamsData[offs + i*12 +  6] = finalMatrix[5];
            materialParamsData[offs + i*12 +  8] = finalMatrix[6];
            materialParamsData[offs + i*12 +  9] = finalMatrix[7];
            materialParamsData[offs + i*12 + 10] = finalMatrix[8];
        }
        offs += 4*3*12;

        for (let i = 0; i < this.material.postTexMatrices.length; i++) {
            const postTexMtx = this.material.postTexMatrices[i];
            if (postTexMtx === null)
                continue;

            let finalMatrix = postTexMtx.matrix;

            materialParamsData[offs + i*12 +  0] = finalMatrix[0];
            materialParamsData[offs + i*12 +  1] = finalMatrix[1];
            materialParamsData[offs + i*12 +  2] = finalMatrix[2];
            materialParamsData[offs + i*12 +  4] = finalMatrix[3];
            materialParamsData[offs + i*12 +  5] = finalMatrix[4];
            materialParamsData[offs + i*12 +  6] = finalMatrix[5];
            materialParamsData[offs + i*12 +  8] = finalMatrix[6];
            materialParamsData[offs + i*12 +  9] = finalMatrix[7];
            materialParamsData[offs + i*12 + 10] = finalMatrix[8];
        }
        offs += 4*3*12;

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
    public textures: Viewer.Texture[];

    public name: string = '';
    public visible: boolean = true;
    public isSkybox: boolean = false;
    public useMaterialTexMtx: boolean = true;
    public fps: number = 30;

    public modelMatrix: mat4;

    public attrScaleData: Float32Array;

    public colorOverrides: GX_Material.Color[] = [];
    public alphaOverrides: number[] = [];
    public sceneParamsBuffer: WebGLBuffer;
    public materialTextures: WebGLTexture[];

    private bufferCoalescer: BufferCoalescer;

    private opaqueCommands: Command[];
    private transparentCommands: Command[];

    private materialCommands: Command_Material[];
    private shapeCommands: Command_Shape[];
    private jointMatrices: mat4[];
    private glTextures: WebGLTexture[];

    constructor(
        gl: WebGL2RenderingContext,
        public bmd: BMD,
        public btk: BTK,
        public bmt: BMT,
        public extraTextures: BTI_Texture[] = [],
    ) {
        this.translateModel(gl);

        this.sceneParamsBuffer = gl.createBuffer();
        this.modelMatrix = mat4.create();
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.bufferCoalescer.destroy(gl);
        this.materialCommands.forEach((command) => command.destroy(gl));
        this.shapeCommands.forEach((command) => command.destroy(gl));
        this.glTextures.forEach((texture) => gl.deleteTexture(texture));
        gl.deleteBuffer(this.sceneParamsBuffer);
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

    public bindState(state: RenderState): boolean {
        if (!this.visible)
            return false;

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
        return true;
    }

    public renderOpaque(state: RenderState) {
        this.execCommands(state, this.opaqueCommands);
    }

    public renderTransparent(state: RenderState) {
        this.execCommands(state, this.transparentCommands);
    }

    public render(state: RenderState) {
        if (!this.bindState(state))
            return;

        this.renderOpaque(state);
        this.renderTransparent(state);
    }

    private execCommands(state: RenderState, commands: Command[]) {
        commands.forEach((command) => {
            command.exec(state);
        });
    }

    private loadExtraTexture(texture: BTI_Texture): BTI_Texture {
        // XXX(jstpierre): Better texture replacement API, this one is ZTP specific...
        const textureName = texture.name.toLowerCase().replace('.tga', '');
        for (const extraTexture of this.extraTextures) {
            if (extraTexture.name.toLowerCase() === textureName)
                return extraTexture;
        }
        return texture;
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

    public static translateTexture(gl: WebGL2RenderingContext, texture: BTI_Texture): WebGLTexture {
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
            const name = texture.name;
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data !== null ? texture.data.subarray(offs, size) : null;
            const surface = { name, format, width, height, data };
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

    private static translateTextureToViewer(texture: BTI_Texture): Viewer.Texture {
        const surfaces = [];

        let width = texture.width, height = texture.height, offs = 0;
        const format = texture.format;
        for (let i = 0; i < texture.mipCount; i++) {
            const name = texture.name;
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data !== null ? texture.data.subarray(offs, size) : null;
            const surface = { name, format, width, height, data };
            const rgbaTexture = GX_Texture.decodeTexture(surface, false);
            // Should never happen.
            if (rgbaTexture.type === 'S3TC')
                throw new Error("whoops");

            const canvas = document.createElement('canvas');
            canvas.width = rgbaTexture.width;
            canvas.height = rgbaTexture.height;
            canvas.title = `${texture.name} ${texture.format}`;
            const ctx = canvas.getContext('2d');
            const imgData = new ImageData(rgbaTexture.width, rgbaTexture.height);
            imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
            ctx.putImageData(imgData, 0, 0);
            surfaces.push(canvas);

            offs += size;
            width /= 2;
            height /= 2;
        }

        return { name: texture.name, surfaces };
    }

    public translateTextures(gl: WebGL2RenderingContext) {
        this.glTextures = [];
        this.materialTextures = [];
        this.textures = [];
        const tex1 = this.bmt !== null ? this.bmt.tex1 : this.bmd.tex1;

        for (let i = 0; i < tex1.textures.length; i++) {
            let btiTexture: BTI_Texture = tex1.textures[i];
            if (btiTexture.data === null) {
                btiTexture = this.loadExtraTexture(btiTexture);
            }

            this.glTextures.push(Scene.translateTexture(gl, btiTexture));
            this.textures.push(Scene.translateTextureToViewer(btiTexture));
        }

        for (let i = 0; i < tex1.remapTable.length; i++) {
            this.materialTextures.push(this.glTextures[tex1.remapTable[i]]);
        }
    }

    private translateModel(gl: WebGL2RenderingContext) {
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

        this.translateTextures(gl);

        const mat3 = this.bmt !== null ? this.bmt.mat3 : this.bmd.mat3;
        this.materialCommands = mat3.materialEntries.map((material) => {
            return new Command_Material(gl, this, material);
        });

        this.bufferCoalescer = new BufferCoalescer(gl,
            this.bmd.shp1.shapes.map((shape) => shape.packedData),
            this.bmd.shp1.shapes.map((shape) => shape.indexData),
        );

        this.shapeCommands = this.bmd.shp1.shapes.map((shape, i) => {
            return new Command_Shape(gl, this.bmd, shape, this.bufferCoalescer.coalescedBuffers[i], this.jointMatrices);
        });

        // Iterate through scene graph.
        const context: HierarchyTraverseContext = {
            commandList: null,
            parentJointMatrix: mat4.create(),
        };
        this.translateSceneGraph(this.bmd.inf1.sceneGraph, context);
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
}
