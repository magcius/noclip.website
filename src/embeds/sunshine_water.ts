
import { mat4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';

import { RenderState } from '../render';
import { fetchData } from '../fetch';
import { MainScene, Scene } from '../viewer';

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import { BMD, BTK, MaterialEntry } from '../j3d/j3d';
import * as RARC from '../j3d/rarc';
import { MaterialData, J3DTextureHolder, BMDModel, MaterialInstance } from '../j3d/render';
import { SunshineRenderer, SunshineSceneDesc } from '../j3d/sms_scenes';
import * as Yaz0 from '../compression/Yaz0';
import { GXRenderHelper, SceneParams, PacketParams, fillSceneParamsFromRenderState } from '../gx/gx_render';
import AnimationController from '../AnimationController';

const scale = 200;
const posMtx = mat4.create();
mat4.fromScaling(posMtx, [scale, scale, scale]);

class SeaPlaneScene implements Scene {
    private sceneParams = new SceneParams();

    private seaMaterial: MaterialData;
    private seaMaterialInstance: MaterialInstance;
    private plane: PlaneShape;
    private renderHelper: GXRenderHelper;
    private bmdModel: BMDModel;
    private animationController: AnimationController;

    constructor(gl: WebGL2RenderingContext, private textureHolder: J3DTextureHolder, bmd: BMD, btk: BTK, configName: string) {
        this.animationController = new AnimationController();
        // Make it go fast.
        this.animationController.fps = 30 * 5;

        if (configName.includes('nomip')) {
            for (const sampler of bmd.tex1.samplers) {
                sampler.minLOD = 1;
                sampler.maxLOD = 1;
            }
        }

        textureHolder.addJ3DTextures(gl, bmd);
        this.bmdModel = new BMDModel(gl, bmd);

        const seaMaterial = bmd.mat3.materialEntries.find((m) => m.name === '_umi');
        this.seaMaterial = this.makeMaterialData(seaMaterial, configName);
        this.seaMaterialInstance = new MaterialInstance(null, this.seaMaterial);
        this.seaMaterialInstance.bindTTK1(this.animationController, btk.ttk1);
        this.plane = new PlaneShape(gl);

        this.renderHelper = new GXRenderHelper(gl);
    }

    public makeMaterialData(material: MaterialEntry, configName: string) {
        const gxMaterial = material.gxMaterial;

        if (configName.includes('noalpha')) {
            // Disable alpha test
            gxMaterial.alphaTest.compareA = GX.CompareType.ALWAYS;
            gxMaterial.alphaTest.op = GX.AlphaOp.OR;
        }

        if (configName.includes('noblend')) {
            // Disable blending.
            gxMaterial.tevStages[0].alphaInD = GX.CombineAlphaInput.KONST;
            gxMaterial.tevStages[1].alphaInD = GX.CombineAlphaInput.KONST;
            gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ONE;
            gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ZERO;
        }

        if (configName.includes('opaque')) {
            // Make it always opaque.
            gxMaterial.tevStages[0].colorInB = GX.CombineColorInput.TEXA;
            gxMaterial.tevStages[0].colorInC = GX.CombineColorInput.RASA;
            gxMaterial.tevStages[0].colorInD = GX.CombineColorInput.CPREV;
            gxMaterial.tevStages[0].colorScale = GX.TevScale.SCALE_1;
            gxMaterial.tevStages[1].colorInB = GX.CombineColorInput.TEXA;
            gxMaterial.tevStages[1].colorInC = GX.CombineColorInput.RASA;
            gxMaterial.tevStages[1].colorInD = GX.CombineColorInput.CPREV;
            gxMaterial.tevStages[1].colorScale = GX.TevScale.SCALE_1;
            gxMaterial.tevStages[1].colorClamp = true;

            // Use one TEV stage.
            if (configName.includes('layer0')) {
                gxMaterial.tevStages.length = 1;
            } else if (configName.includes('layer1')) {
                gxMaterial.tevStages[0] = gxMaterial.tevStages[1];
                gxMaterial.tevStages.length = 1;
            }
        }

        return new MaterialData(material);
    }

    public render(state: RenderState): void {
        this.renderHelper.bindUniformBuffers(state);

        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);

        this.animationController.updateTime(state.time);

        this.seaMaterialInstance.bindMaterial(state, this.bmdModel, this.renderHelper, this.textureHolder);
        this.plane.render(state, this.renderHelper);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.plane.destroy(gl);
        this.seaMaterial.destroy(gl);
        this.renderHelper.destroy(gl);
        this.bmdModel.destroy(gl);
    }
}

class PlaneShape {
    private vao: WebGLVertexArrayObject;
    private posBuffer: WebGLBuffer;
    private txcBuffer: WebGLBuffer;
    private packetParams = new PacketParams();

    constructor(gl: WebGL2RenderingContext) {
        this.createBuffers(gl);
    }

    public render(state: RenderState, renderHelper: GXRenderHelper) {
        const gl = state.gl;

        mat4.mul(this.packetParams.u_PosMtx[0], state.updateModelView(), posMtx);
        renderHelper.bindPacketParams(state, this.packetParams);

        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteVertexArray(this.vao);
        gl.deleteBuffer(this.posBuffer);
        gl.deleteBuffer(this.txcBuffer);
    }

    private createBuffers(gl: WebGL2RenderingContext) {
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        const posData = new Float32Array(4 * 3);
        posData[0]  = -1;
        posData[1]  = 0;
        posData[2]  = -1;
        posData[3]  = 1;
        posData[4]  = 0;
        posData[5]  = -1;
        posData[6]  = -1;
        posData[7]  = 0;
        posData[8]  = 1;
        posData[9]  = 1;
        posData[10] = 0;
        posData[11] = 1;

        this.posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, posData, gl.STATIC_DRAW);
        const posAttribLocation = GX_Material.getVertexAttribLocation(GX.VertexAttribute.POS);
        gl.vertexAttribPointer(posAttribLocation, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(posAttribLocation);

        const txcData = new Float32Array(4 * 2);
        txcData[0] = 0;
        txcData[1] = 0;
        txcData[2] = 2;
        txcData[3] = 0;
        txcData[4] = 0;
        txcData[5] = 2;
        txcData[6] = 2;
        txcData[7] = 2;

        this.txcBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.txcBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, txcData, gl.STATIC_DRAW);
        const tex0AttribLocation = GX_Material.getVertexAttribLocation(GX.VertexAttribute.TEX0);
        gl.vertexAttribPointer(tex0AttribLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(tex0AttribLocation);

        gl.bindVertexArray(null);
    }
}

export function createScene(gl: WebGL2RenderingContext, name: string): Progressable<MainScene> {
    return fetchData("data/j3d/sms/dolpic0.szs").then((buffer: ArrayBufferSlice) => {
        return Yaz0.decompress(buffer);
    }).then((buffer: ArrayBufferSlice) => {
        const rarc = RARC.parse(buffer);

        const textureHolder = new J3DTextureHolder();
        const skyScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, textureHolder, rarc, 'map/map/sky', true);

        const bmdFile = rarc.findFile('map/map/sea.bmd');
        const btkFile = rarc.findFile('map/map/sea.btk');
        const bmd = BMD.parse(bmdFile.buffer);
        const btk = BTK.parse(btkFile.buffer);

        const seaScene = new SeaPlaneScene(gl, textureHolder, bmd, btk, name);
        return new SunshineRenderer(
            textureHolder,
            skyScene,
            null, // map
            seaScene,
            null, // seaindirect
            [],
        );
    });
}
