
import { mat4 } from "gl-matrix";

import * as Viewer from '../viewer';
import * as NSBMD from './nsbmd';
import { TextureHolder, LoadedTexture, TextureBase } from '../TextureHolder';
import { getTransitionDeviceForWebGL2 } from '../gfx/platform/GfxPlatformWebGL2';
import { GfxFormat } from '../gfx/platform/GfxPlatform';
import { NITRO_Program } from '../sm64ds/render';
import ArrayBufferSlice from "../ArrayBufferSlice";
import { RenderFlags, BlendMode, BlendFactor, RenderState } from "../render";

export interface ResolvedTexture extends TextureBase {
    pixels: ArrayBufferView;
}

export class TEX0TextureHolder extends TextureHolder<ResolvedTexture> {
    public addTexture(gl: WebGL2RenderingContext, texture: ResolvedTexture): LoadedTexture {
        const device = getTransitionDeviceForWebGL2(gl);

        const gfxTexture = device.createTexture(GfxFormat.U8_RGBA, texture.width, texture.height, 1);
        device.setResourceName(gfxTexture, texture.name);

        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);

        device.submitPass(hostAccessPass);
        const viewerTexture: Viewer.Texture = null;
        return { gfxTexture, viewerTexture };
    }
}

const scratchModelMatrix = mat4.create();
class MDL0Renderer {
    public localMatrix = mat4.create();

    private program: NITRO_Program = new NITRO_Program();

    constructor(gl: WebGL2RenderingContext, public textureHolder: TEX0TextureHolder, public model: NSBMD.MDL0Model) {
        this.execSBC(gl, model, model.sbcBuffer);
    }

    private execSBC(gl: WebGL2RenderingContext, model: NSBMD.MDL0Model, sbcBuffer: ArrayBufferSlice) {
        const view = sbcBuffer.createDataView();

        const enum Op {
            NOP, RET, NODE, MTX, MAT, SHP, NODEDESC, BB, BBY, NODEMIX, CALLDL, POSSCALE, ENVMAP, PRJMAP,
        };

        let idx = 0;
        let currentNode: NSBMD.MDL0Node;
        let currentMaterial: NSBMD.MDL0Material;
        while (true) {
            const w0 = view.getUint8(idx++);
            const cmd = w0 & 0x1F;
            if (cmd === Op.NOP)
                continue;
            else if (cmd === Op.RET)
                break;
            else if (cmd === Op.NODE) {
                const nodeIdx = view.getUint8(idx++);
                const visible = view.getUint8(idx++);
                currentNode = model.nodes[nodeIdx];
            } else if (cmd === Op.MTX) {
                const mtxIdx = view.getUint8(idx++);
            } else if (cmd === Op.MAT) {
                const matIdx = view.getUint8(idx++);
                currentMaterial = model.materials[matIdx];
            } else if (cmd === Op.SHP) {
                const shpIdx = view.getUint8(idx++);
                const shape = model.shapes[shpIdx];
                this.translateDrawShape(gl, currentNode, currentMaterial, shape);
            } else {
                throw new Error(`UNKNOWN SBC ${cmd}`);
            }
        }
    }

    private translateDrawShape(gl: WebGL2RenderingContext, node: NSBMD.MDL0Node, material: NSBMD.MDL0Material, shape: NSBMD.MDL0Shape): void {
    }

    private translateMaterial(gl: WebGL2RenderingContext, material: NSBMD.MDL0Material) {
        const renderFlags = new RenderFlags();
        renderFlags.blendMode = BlendMode.ADD;
        renderFlags.blendDst = BlendFactor.ONE_MINUS_SRC_ALPHA;
        renderFlags.blendSrc = BlendFactor.SRC_ALPHA;
        renderFlags.depthTest = true;
        renderFlags.depthWrite = material.depthWrite;
        renderFlags.cullMode = material.cullMode;

        return (state: RenderState) => {
            state.useFlags(renderFlags);
        };
    }

    public bindModelView(state: RenderState, isBillboard: boolean) {
        const gl = state.gl;
        const prog = this.program;

        // Build model matrix
        const modelMatrix = scratchModelMatrix;
        mat4.copy(modelMatrix, this.localMatrix);

        if (this.animation !== null)
            this.animation.updateModelMatrix(state, modelMatrix);

        // Build view matrix
        mat4.mul(viewMatrix, viewMatrix, modelMatrix);

        gl.uniformMatrix4fv(prog.projectionLocation, false, state.camera.projectionMatrix);
        gl.uniformMatrix4fv(prog.modelViewLocation, false, viewMatrix);
    }

    private translateBatch(gl: WebGL2RenderingContext, model: NITRO_BMD.Model, batch: NITRO_BMD.Batch): void {
        const applyMaterial = this.translateMaterial(gl, batch.material);
        const renderPoly = this.translatePoly(gl, batch.poly);

        const func = (state: RenderState): void => {
            state.useProgram(this.program);
            applyMaterial(state);
            this.bindModelView(state, model.billboard);
            renderPoly(state);
        };

        if (batch.material.isTranslucent)
            this.transparentCommands.push(func);
        else
            this.opaqueCommands.push(func);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.arena.destroy(gl);
    }
}
