
import { mat4, vec3, mat2d } from 'gl-matrix';

import { BMD, BMT, BTK, HierarchyNode, HierarchyType, MaterialEntry, Shape, BTI_Texture, ShapeDisplayFlags, TEX1_Sampler, TEX1_TextureData, VertexArray, BRK, DRW1JointKind, BCK, BTI } from './j3d';

import * as GX from 'gx/gx_enum';
import * as GX_Material from 'gx/gx_material';
import * as GX_Texture from 'gx/gx_texture';
import { AttributeFormat } from 'gx/gx_displaylist';
import { TextureMapping, MaterialParams, SceneParams, GXRenderHelper, PacketParams, GXShapeHelper, loadedDataCoalescer, fillSceneParamsFromRenderState, loadTextureFromMipChain, translateTexFilter, translateWrapMode } from 'gx/gx_render';
import * as Viewer from 'viewer';

import { CompareMode, RenderFlags, RenderState } from '../render';
import { align, assert } from '../util';
import { computeViewMatrix, computeModelMatrixBillboard, computeModelMatrixYBillboard, computeViewMatrixSkybox } from '../Camera';
import BufferCoalescer, { CoalescedBuffers } from '../BufferCoalescer';

function translateAttribType(gl: WebGL2RenderingContext, attribFormat: AttributeFormat): { type: GLenum, normalized: boolean } {
    switch (attribFormat) {
    case AttributeFormat.F32:
        return { type: gl.FLOAT, normalized: false };
    case AttributeFormat.U16:
        return { type: gl.UNSIGNED_SHORT, normalized: false };
    default:
        throw "whoops";
    }
}

const scratchModelMatrix = mat4.create();
const scratchViewMatrix = mat4.create();
class Command_Shape {
    private bmd: BMD;
    private packetParams = new PacketParams();
    private shapeHelper: GXShapeHelper;

    constructor(gl: WebGL2RenderingContext, sceneLoader: SceneLoader, private scene: Scene, private shape: Shape, coalescedBuffers: CoalescedBuffers) {
        this.bmd = sceneLoader.bmd;
        this.shapeHelper = new GXShapeHelper(gl, coalescedBuffers, this.shape.loadedVertexLayout, this.shape.loadedVertexData);
    }

    private computeModelView(dst: mat4, state: RenderState): void {
        mat4.copy(scratchModelMatrix, this.scene.modelMatrix);

        switch (this.shape.displayFlags) {
        case ShapeDisplayFlags.NORMAL:
        case ShapeDisplayFlags.USE_PNMTXIDX:
            // We should already be using PNMTXIDX in the normal case -- it's hardwired to 0.
            break;

        case ShapeDisplayFlags.BILLBOARD:
            computeModelMatrixBillboard(scratchModelMatrix, state.camera);
            mat4.mul(scratchModelMatrix, this.scene.modelMatrix, scratchModelMatrix);
            break;
        case ShapeDisplayFlags.Y_BILLBOARD:
            computeModelMatrixYBillboard(scratchModelMatrix, state.camera);
            mat4.mul(scratchModelMatrix, this.scene.modelMatrix, scratchModelMatrix);
            break;
        default:
            throw new Error("whoops");
        }

        if (this.scene.isSkybox) {
            computeViewMatrixSkybox(scratchViewMatrix, state.camera);
        } else {
            computeViewMatrix(scratchViewMatrix, state.camera);
        }

        mat4.mul(dst, scratchViewMatrix, scratchModelMatrix);
    }

    public exec(state: RenderState) {
        if (!this.scene.currentMaterialCommand.visible)
            return;

        const gl = state.gl;

        this.shapeHelper.drawPrologue(gl);

        let needsUpload = false;

        this.computeModelView(this.packetParams.u_ModelView, state);
        needsUpload = true;

        this.shape.packets.forEach((packet, packetIndex) => {
            // Update our matrix table.
            for (let i = 0; i < packet.weightedJointTable.length; i++) {
                const weightedJointIndex = packet.weightedJointTable[i];

                // Leave existing joint.
                if (weightedJointIndex === 0xFFFF)
                    continue;

                const posMtx = this.scene.weightedJointMatrices[weightedJointIndex];
                mat4.copy(this.packetParams.u_PosMtx[i], posMtx);
                needsUpload = true;
            }

            if (needsUpload) {
                this.scene.renderHelper.bindPacketParams(state, this.packetParams);
                needsUpload = false;
            }

            this.shapeHelper.drawTriangles(gl, packet.firstTriangle, packet.numTriangles);
        });

        this.shapeHelper.drawEpilogue(gl);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.shapeHelper.destroy(gl);
    }
}

interface Command_MaterialScene {
    brk: BRK;
    btk: BTK;
    currentMaterialCommand: Command_Material;
    getTimeInFrames(milliseconds: number): number;
    colorOverrides: GX_Material.Color[];
    alphaOverrides: number[];
    renderHelper: GXRenderHelper;
    fillTextureMapping(m: TextureMapping, i: number): void;
}

export class Command_Material {
    private static matrixScratch = mat4.create();
    private static materialParams = new MaterialParams();

    public material: MaterialEntry;

    public name: string;
    public visible: boolean = true;

    private scene: Command_MaterialScene;
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;

    constructor(gl: WebGL2RenderingContext, scene: Command_MaterialScene, material: MaterialEntry) {
        this.name = material.name;
        this.scene = scene;
        this.material = material;
        this.program = new GX_Material.GX_Program(material.gxMaterial);
        this.program.name = this.name;
        this.renderFlags = GX_Material.translateRenderFlags(this.material.gxMaterial);
    }

    public exec(state: RenderState) {
        this.scene.currentMaterialCommand = this;

        if (!this.scene.currentMaterialCommand.visible)
            return;

        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        const materialParams = Command_Material.materialParams;
        this.fillMaterialParams(materialParams, state);
        this.scene.renderHelper.bindMaterialParams(state, materialParams);
        this.scene.renderHelper.bindMaterialTextures(state, materialParams, this.program);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.program.destroy(gl);
    }

    private fillMaterialParams(materialParams: MaterialParams, state: RenderState): void {
        const animationFrame = this.scene.getTimeInFrames(state.time);

        const copyColor = (i: ColorOverride, dst: GX_Material.Color, fallbackColor: GX_Material.Color) => {
            // First, check for a color animation.
            if (this.scene.brk !== null) {
                if (this.scene.brk.calcColorOverride(dst, this.material.name, i, animationFrame))
                    return;
            }

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

            dst.copy(color, alpha);
        };

        copyColor(ColorOverride.MAT0, materialParams.u_ColorMatReg[0], this.material.colorMatRegs[0]);
        copyColor(ColorOverride.MAT1, materialParams.u_ColorMatReg[1], this.material.colorMatRegs[1]);
        copyColor(ColorOverride.AMB0, materialParams.u_ColorAmbReg[0], this.material.colorAmbRegs[0]);
        copyColor(ColorOverride.AMB1, materialParams.u_ColorAmbReg[1], this.material.colorAmbRegs[1]);

        copyColor(ColorOverride.K0, materialParams.u_KonstColor[0], this.material.gxMaterial.colorConstants[0]);
        copyColor(ColorOverride.K1, materialParams.u_KonstColor[1], this.material.gxMaterial.colorConstants[1]);
        copyColor(ColorOverride.K2, materialParams.u_KonstColor[2], this.material.gxMaterial.colorConstants[2]);
        copyColor(ColorOverride.K3, materialParams.u_KonstColor[3], this.material.gxMaterial.colorConstants[3]);

        copyColor(ColorOverride.CPREV, materialParams.u_Color[0], this.material.gxMaterial.colorRegisters[0]);
        copyColor(ColorOverride.C0, materialParams.u_Color[1], this.material.gxMaterial.colorRegisters[1]);
        copyColor(ColorOverride.C1, materialParams.u_Color[2], this.material.gxMaterial.colorRegisters[2]);
        copyColor(ColorOverride.C2, materialParams.u_Color[3], this.material.gxMaterial.colorRegisters[3]);

        // Bind our texture matrices.
        const matrixScratch = Command_Material.matrixScratch;
        for (let i = 0; i < this.material.texMatrices.length; i++) {
            const texMtx = this.material.texMatrices[i];
            if (texMtx === null)
                continue;

            let finalMatrix = matrixScratch;
            mat4.copy(finalMatrix, texMtx.matrix);

            if (this.scene.btk !== null)
                this.scene.btk.calcAnimatedTexMtx(matrixScratch, this.material.name, i, animationFrame);

            switch(texMtx.type) {
            case 0x00: // Normal. Does nothing.
                break;

            case 0x01: // Defino Plaza
            case 0x0B: // Luigi Circuit
                break;
            case 0x06: // Rainbow Road
                mat4.mul(finalMatrix, finalMatrix, mat4.fromValues(
                    0.5, 0,   0, 0,
                    0,  -0.5, 0, 0,
                    0,   0,   0, 0,
                    0.5, 0.5, 1, 0,
                ));
                mat4.mul(finalMatrix, finalMatrix, state.view);
                finalMatrix[12] = 0;
                finalMatrix[13] = 0;
                finalMatrix[14] = 0;
                break;
            case 0x07: // Rainbow Road
                mat4.mul(finalMatrix, finalMatrix, mat4.fromValues(
                    0.5,  0,   0, 0,
                    0,   -0.5, 0, 0,
                    0.5,  0.5, 1, 0,
                    0,    0,   0, 0,
                ));
                mat4.mul(finalMatrix, finalMatrix, state.view);
                finalMatrix[12] = 0;
                finalMatrix[13] = 0;
                finalMatrix[14] = 0;
                break;
            case 0x08: // Peach Beach
                mat4.mul(finalMatrix, finalMatrix, mat4.fromValues(
                    0.5,  0,   0, 0,
                    0,   -0.5, 0, 0,
                    0.5,  0.5, 1, 0,
                    0,    0,   0, 0,
                ));
                mat4.mul(finalMatrix, finalMatrix, texMtx.projectionMatrix);
                break;
            case 0x09: // Rainbow Road
                mat4.mul(finalMatrix, finalMatrix, mat4.fromValues(
                    0.5,  0,   0, 0,
                    0,   -0.5, 0, 0,
                    0.5,  0.5, 1, 0,
                    0,    0,   0, 0,
                ));
                mat4.mul(finalMatrix, finalMatrix, texMtx.projectionMatrix);
                mat4.mul(finalMatrix, finalMatrix, state.view);
                break;
            default:
                throw "whoops";
            }

            mat4.copy(materialParams.u_TexMtx[i], finalMatrix);
        }

        for (let i = 0; i < this.material.postTexMatrices.length; i++) {
            const postTexMtx = this.material.postTexMatrices[i];
            if (postTexMtx === null)
                continue;

            const finalMatrix = postTexMtx.matrix;
            mat4.copy(materialParams.u_PostTexMtx[i], finalMatrix);
        }

        for (let i = 0; i < this.material.indTexMatrices.length; i++) {
            const indTexMtx = this.material.indTexMatrices[i];
            if (indTexMtx === null)
                continue;

            const a = indTexMtx[0], c = indTexMtx[1], tx = indTexMtx[2];
            const b = indTexMtx[3], d = indTexMtx[4], ty = indTexMtx[5];
            mat2d.set(materialParams.u_IndTexMtx[i], a, b, c, d, tx, ty);
        }

        // Bind textures.
        for (let i = 0; i < this.material.textureIndexes.length; i++) {
            const texIndex = this.material.textureIndexes[i];
            if (texIndex >= 0) {
                this.scene.fillTextureMapping(materialParams.m_TextureMapping[i], texIndex);
            } else {
                materialParams.m_TextureMapping[i].glTexture = null;
            }
        }
    }
}

type Command = Command_Shape | Command_Material;

export enum ColorOverride {
    MAT0, MAT1, AMB0, AMB1,
    K0, K1, K2, K3,
    CPREV, C0, C1, C2,
}

// Used mostly by indirect texture FB installations...
export interface TextureOverride {
    glTexture: WebGLTexture;
    width: number;
    height: number;
    projectionMatrix?: mat4;
}

interface HierarchyTraverseContext {
    commandList: Command[];
    parentJointMatrix: mat4;
}

const matrixScratch = mat4.create(), matrixScratch2 = mat4.create();

// SceneLoaderToken is a private class that's passed to Scene.
// Basically, this emulates an internal constructor by making
// it impossible to call...
class SceneLoaderToken {
    constructor(public gl: WebGL2RenderingContext) {}
}

type TextureResolveCallback = (name: string) => TEX1_TextureData;

export class SceneLoader {
    constructor(
        public bmd: BMD,
        public bmt: BMT | null = null)
    {}

    public textureResolveCallback: TextureResolveCallback;

    public createScene(gl: WebGL2RenderingContext): Scene {
        return new Scene(new SceneLoaderToken(gl), this);
    }

    public resolveTexture(name: string): TEX1_TextureData {
        if (this.textureResolveCallback !== null)
            return this.textureResolveCallback(name);
        else
            return null;
    }
}

export class Scene implements Viewer.Scene {
    public textures: Viewer.Texture[];

    public name: string = '';
    public visible: boolean = true;
    public isSkybox: boolean = false;
    public fps: number = 30;

    public modelMatrix: mat4;

    public colorOverrides: GX_Material.Color[] = [];
    public alphaOverrides: number[] = [];
    public renderHelper: GXRenderHelper;
    private sceneParams = new SceneParams();

    // BMD
    public bmd: BMD;
    // TODO(jstpierre): Make BMT settable after load...
    public bmt: BMT | null = null;

    // Animations.
    public bck: BCK | null = null;
    public brk: BRK | null = null;
    public btk: BTK | null = null;

    // Texture information.
    private tex1TextureDatas: TEX1_TextureData[];
    private tex1Samplers: TEX1_Sampler[];
    private glSamplers: WebGLSampler[];
    private glTextures: WebGLTexture[];
    public textureOverrides = new Map<string, TextureOverride>();

    public currentMaterialCommand: Command_Material;

    public materialCommands: Command_Material[];
    private shapeCommands: Command_Shape[];
    private jointMatrices: mat4[];
    public weightedJointMatrices: mat4[];

    private bufferCoalescer: BufferCoalescer;

    private opaqueCommands: Command[];
    private transparentCommands: Command[];

    constructor(
        sceneLoaderToken: SceneLoaderToken,
        sceneLoader: SceneLoader,
    ) {
        const gl = sceneLoaderToken.gl;
        this.bmd = sceneLoader.bmd;
        this.bmt = sceneLoader.bmt;
        this.translateModel(gl, sceneLoader);

        this.renderHelper = new GXRenderHelper(gl);
        this.modelMatrix = mat4.create();
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.renderHelper.destroy(gl);
        this.bufferCoalescer.destroy(gl);
        this.materialCommands.forEach((command) => command.destroy(gl));
        this.shapeCommands.forEach((command) => command.destroy(gl));
        this.glSamplers.forEach((sampler) => gl.deleteSampler(sampler));
        this.glTextures.forEach((texture) => gl.deleteTexture(texture));
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

    public setTextureOverride(name: string, override: TextureOverride) {
        this.textureOverrides.set(name, override);
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public setBCK(bck: BCK | null): void {
        this.bck = bck;
    }

    public setBRK(brk: BRK | null): void {
        this.brk = brk;
    }

    public setBTK(btk: BTK | null): void {
        this.btk = btk;
    }

    public fillTextureMapping(m: TextureMapping, texIndex: number): void {
        const tex1Sampler = this.tex1Samplers[texIndex];
        const textureOverride: TextureOverride = this.textureOverrides.get(tex1Sampler.name);

        if (textureOverride !== undefined) {
            m.glTexture = textureOverride.glTexture;
            m.width = textureOverride.width;
            m.height = textureOverride.height;
        } else {
            m.glTexture = this.glTextures[tex1Sampler.textureDataIndex];
            const tex1TextureData = this.tex1TextureDatas[tex1Sampler.textureDataIndex];
            m.width = tex1TextureData.width;
            m.height = tex1TextureData.height;
        }

        m.glSampler = this.glSamplers[tex1Sampler.index];
        m.lodBias = tex1Sampler.lodBias;
    }

    public getTimeInFrames(milliseconds: number) {
        return (milliseconds / 1000) * this.fps;
    }

    public bindState(state: RenderState): boolean {
        if (!this.visible)
            return false;

        const gl = state.gl;

        state.setClipPlanes(10, 500000);

        // XXX(jstpierre): Is this the right place to do this? Need an explicit update call...
        this.updateJointMatrices(state);

        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

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
        commands.forEach((command, i) => {
            command.exec(state);
        });
    }

    public static translateSampler(gl: WebGL2RenderingContext, sampler: TEX1_Sampler): WebGLSampler {
        const glSampler = gl.createSampler();
        gl.samplerParameteri(glSampler, gl.TEXTURE_MIN_FILTER, translateTexFilter(gl, sampler.minFilter));
        gl.samplerParameteri(glSampler, gl.TEXTURE_MAG_FILTER, translateTexFilter(gl, sampler.magFilter));
        gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_S, translateWrapMode(gl, sampler.wrapS));
        gl.samplerParameteri(glSampler, gl.TEXTURE_WRAP_T, translateWrapMode(gl, sampler.wrapT));
        gl.samplerParameterf(glSampler, gl.TEXTURE_MIN_LOD, sampler.minLOD);
        gl.samplerParameterf(glSampler, gl.TEXTURE_MAX_LOD, sampler.maxLOD);
        return glSampler;
    }

    public translateTextures(gl: WebGL2RenderingContext, sceneLoader: SceneLoader) {
        const tex1 = sceneLoader.bmt !== null ? sceneLoader.bmt.tex1 : sceneLoader.bmd.tex1;

        // TODO(jstpierre): How does separable textureData / sampler work with external
        // texture resolve?

        this.glTextures = [];
        this.textures = [];
        for (let textureData of tex1.textureDatas) {
            if (textureData.data === null) {
                textureData = sceneLoader.resolveTexture(textureData.name);
            }

            const mipChain = GX_Texture.calcMipChain(textureData, textureData.mipCount);
            const { glTexture, viewerTexture } = loadTextureFromMipChain(gl, mipChain);
            this.glTextures.push(glTexture);
            this.textures.push(viewerTexture);
        }

        this.glSamplers = [];
        for (let sampler of tex1.samplers) {
            this.glSamplers.push(Scene.translateSampler(gl, sampler));
        }

        this.tex1TextureDatas = tex1.textureDatas;
        this.tex1Samplers = tex1.samplers;
    }

    private translateModel(gl: WebGL2RenderingContext, sceneLoader: SceneLoader) {
        const bmd = sceneLoader.bmd;
        const bmt = sceneLoader.bmt;
        const mat3 = (bmt !== null && bmt.mat3 !== null) ? bmt.mat3 : bmd.mat3;

        this.opaqueCommands = [];
        this.transparentCommands = [];

        this.jointMatrices = [];
        for (const index of bmd.jnt1.remapTable)
            if (this.jointMatrices[index] === undefined)
                this.jointMatrices[index] = mat4.create();

        this.weightedJointMatrices = [];
        for (const drw1Joint of bmd.drw1.drw1Joints)
            this.weightedJointMatrices.push(mat4.create());

        this.translateTextures(gl, sceneLoader);

        const materialCommands = mat3.materialEntries.map((material) => {
            return new Command_Material(gl, this, material);
        });

        // Apply remap table.
        this.materialCommands = mat3.remapTable.map((index) => {
            return materialCommands[index];
        });

        this.bufferCoalescer = loadedDataCoalescer(gl, bmd.shp1.shapes.map((shape) => shape.loadedVertexData));
        this.shapeCommands = bmd.shp1.shapes.map((shape, i) => {
            return new Command_Shape(gl, sceneLoader, this, shape, this.bufferCoalescer.coalescedBuffers[i]);
        });

        // Iterate through scene graph.
        this.translateSceneGraph(bmd.inf1.sceneGraph, null);
    }

    private translateSceneGraph(node: HierarchyNode, commandList: Command[]) {
        switch (node.type) {
        case HierarchyType.Shape:
            commandList.push(this.shapeCommands[node.shapeIdx]);
            break;
        case HierarchyType.Material:
            const materialCommand = this.materialCommands[node.materialIdx];
            commandList = materialCommand.material.translucent ? this.transparentCommands : this.opaqueCommands;
            commandList.push(materialCommand);
            break;
        }

        for (const child of node.children)
            this.translateSceneGraph(child, commandList);
    }

    private updateJointMatrixHierarchy(state: RenderState, node: HierarchyNode, parentJointMatrix: mat4) {
        // TODO(jstpierre): Don't pointer chase when traversing hierarchy every frame...
        const jnt1 = this.bmd.jnt1;

        switch (node.type) {
        case HierarchyType.Joint:
            const jointIndex = jnt1.remapTable[node.jointIdx];
            let boneMatrix = jnt1.bones[jointIndex].matrix;
            if (this.bck !== null) {
                boneMatrix = matrixScratch2;
                this.bck.calcJointMatrix(boneMatrix, jointIndex, this.getTimeInFrames(state.time));
            }
            const jointMatrix = this.jointMatrices[jointIndex];
            mat4.mul(jointMatrix, parentJointMatrix, boneMatrix);
            parentJointMatrix = jointMatrix;
            break;
        }

        for (let i = 0; i < node.children.length; i++)
            this.updateJointMatrixHierarchy(state, node.children[i], parentJointMatrix);
    }

    private updateJointMatrices(state: RenderState) {
        // First, update joint matrices from hierarchy.
        mat4.identity(matrixScratch);
        this.updateJointMatrixHierarchy(state, this.bmd.inf1.sceneGraph, matrixScratch);

        // Update weighted joint matrices.
        for (let i = 0; i < this.bmd.drw1.drw1Joints.length; i++) {
            const joint = this.bmd.drw1.drw1Joints[i];
            const destMtx = this.weightedJointMatrices[i];
            if (joint.kind === DRW1JointKind.NormalJoint) {
                mat4.copy(destMtx, this.jointMatrices[joint.jointIndex]);
            } else if (joint.kind === DRW1JointKind.WeightedJoint) {
                destMtx.fill(0);
                const envelope = this.bmd.evp1.envelopes[joint.envelopeIndex];
                for (let i = 0; i < envelope.weightedBones.length; i++) {
                    const weightedBone = envelope.weightedBones[i];
                    const inverseBindPose = this.bmd.evp1.inverseBinds[weightedBone.index];
                    mat4.mul(matrixScratch, this.jointMatrices[weightedBone.index], inverseBindPose);
                    mat4.multiplyScalarAndAdd(destMtx, destMtx, matrixScratch, weightedBone.weight);
                }
            }
        }
    }
}
