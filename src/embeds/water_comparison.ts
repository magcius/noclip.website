
import { mat4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Progressable from '../Progressable';

import { RenderState, depthClearFlags } from '../render';
import { fetch } from '../util';
import * as Viewer from '../viewer';

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import * as RARC from '../j3d/rarc';
import * as U8 from '../rres/u8';
import * as CX from '../compression/CX';
import * as Yaz0 from '../compression/Yaz0';

import { BMD, BTK } from '../j3d/j3d';
import * as BRRES from '../rres/brres';

import * as J3DRender from '../j3d/render';
import * as RRESRender from '../rres/render';
import { SunshineSceneDesc } from '../j3d/sms_scenes';
import { GXRenderHelper, SceneParams, PacketParams, fillSceneParamsFromRenderState, GXTextureHolder } from '../gx/gx_render';
import AnimationController from '../AnimationController';
import { MDL0Model, MDL0ModelInstance, RRESTextureHolder } from '../rres/render';

const scale = 200;
const posMtx = mat4.create();
mat4.fromScaling(posMtx, [scale, scale, scale]);

abstract class WaterComparisonRenderer implements Viewer.MainScene {
    public textures: Viewer.Texture[] = [];

    private sceneParams = new SceneParams();
    protected renderHelper: GXRenderHelper;
    protected animationController = new AnimationController();

    constructor(gl: WebGL2RenderingContext, private skyboxScene: J3DRender.BMDModelInstance, protected textureHolder: J3DRender.J3DTextureHolder, animationScale: number, private plane: PlaneShape) {
        // Make it go fast.
        this.animationController.fps = 30 * animationScale;
        this.renderHelper = new GXRenderHelper(gl);
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.skyboxScene.destroy(gl);
        this.textureHolder.destroy(gl);
        this.renderHelper.destroy(gl);
        this.plane.destroy(gl);
    }

    public render(state: RenderState): void {
        const gl = state.gl;
        state.setClipPlanes(20, 500000);
        gl.clearColor(0, 0, 0.125, 1);
        gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

        this.skyboxScene.render(state);
        state.useFlags(depthClearFlags);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        this.animationController.updateTime(state.time);
        this.renderHelper.bindUniformBuffers(state);
        fillSceneParamsFromRenderState(this.sceneParams, state);
        this.renderHelper.bindSceneParams(state, this.sceneParams);
        // Render skybox.
        this.bindMaterial(state);
        this.plane.render(state, this.renderHelper);
    }

    protected abstract bindMaterial(state: RenderState): void;
}

class J3DRenderer extends WaterComparisonRenderer {
    private seaCmd: J3DRender.Command_Material;
    private seaCmdInstance: J3DRender.MaterialInstance;
    private bmdModel: J3DRender.BMDModel;

    constructor(gl: WebGL2RenderingContext, skyboxScene: J3DRender.BMDModelInstance, textureHolder: J3DRender.J3DTextureHolder, animationScale: number, plane: PlaneShape, bmd: BMD, btk: BTK, materialName: string) {
        super(gl, skyboxScene, textureHolder, animationScale, plane);

        textureHolder.addJ3DTextures(gl, bmd);
        this.bmdModel = new J3DRender.BMDModel(gl, bmd);

        const seaMaterial = bmd.mat3.materialEntries.find((m) => m.name === materialName);
        this.seaCmd = new J3DRender.Command_Material(this.bmdModel, seaMaterial);
        this.seaCmdInstance = new J3DRender.MaterialInstance(null, seaMaterial);
        this.seaCmdInstance.bindTTK1(this.animationController, btk.ttk1);
    }

    public bindMaterial(state: RenderState): void {
        this.seaCmd.bindMaterial(state, this.renderHelper, this.textureHolder, this.seaCmdInstance);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.seaCmd.destroy(gl);
        this.bmdModel.destroy(gl);
    }
}

class RRESRenderer extends WaterComparisonRenderer {
    private seaCmd: RRESRender.Command_Material;
    private seaCmdInstance: RRESRender.MaterialInstance;

    constructor(gl: WebGL2RenderingContext, skyboxScene: J3DRender.BMDModelInstance, textureHolder: J3DRender.J3DTextureHolder, animationScale: number, plane: PlaneShape, mdl0: BRRES.MDL0, animRRES: BRRES.RRES) {
        super(gl, skyboxScene, textureHolder, animationScale, plane);

        const seaMaterial = mdl0.materials[0];
        this.seaCmd = new RRESRender.Command_Material(gl, seaMaterial);
        this.seaCmdInstance = new RRESRender.MaterialInstance(null, textureHolder, seaMaterial);

        for (const srt0 of animRRES.srt0)
            this.seaCmdInstance.bindSRT0(this.animationController, srt0);
    }

    public bindMaterial(state: RenderState): void {
        this.seaCmd.bindMaterial(state, this.renderHelper, this.seaCmdInstance);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.seaCmd.destroy(gl);
    }
}

class PlaneShape {
    private vao: WebGLVertexArrayObject;
    private posBuffer: WebGLBuffer;
    private txcBuffer: WebGLBuffer;
    private packetParams = new PacketParams();

    constructor(gl: WebGL2RenderingContext, uvScale: number, vertexColor: GX_Material.Color = new GX_Material.Color()) {
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
        txcData[2] = uvScale;
        txcData[3] = 0;
        txcData[4] = 0;
        txcData[5] = uvScale;
        txcData[6] = uvScale;
        txcData[7] = uvScale;

        this.txcBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.txcBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, txcData, gl.STATIC_DRAW);
        const tex0AttribLocation = GX_Material.getVertexAttribLocation(GX.VertexAttribute.TEX0);
        gl.vertexAttribPointer(tex0AttribLocation, 2, gl.FLOAT, false, 0, 0);
        const clr0AttribLocation = GX_Material.getVertexAttribLocation(GX.VertexAttribute.CLR0);
        gl.vertexAttrib4f(clr0AttribLocation, vertexColor.r, vertexColor.g, vertexColor.b, vertexColor.a);
        gl.enableVertexAttribArray(tex0AttribLocation);

        gl.bindVertexArray(null);
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
}

export function createScene(gl: WebGL2RenderingContext, name: string): Progressable<Viewer.MainScene> {
    return fetch("data/j3d/sms/dolpic0.szs").then((buffer: ArrayBufferSlice) => {
        return Yaz0.decompress(buffer);
    }).then(async (buffer: ArrayBufferSlice) => {
        const rarc = RARC.parse(buffer);

        const textureHolder = new J3DRender.J3DTextureHolder();
        const skyboxScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, textureHolder, rarc, 'map/map/sky', true);

        if (name === 'g1') {
            const bmdFile = rarc.findFile('map/map/sea.bmd');
            const btkFile = rarc.findFile('map/map/sea.btk');
            const bmd = BMD.parse(bmdFile.buffer);
            const btk = BTK.parse(btkFile.buffer);
            const plane = new PlaneShape(gl, 2, new GX_Material.Color(1, 1, 1, 1));
            return new J3DRenderer(gl, skyboxScene, textureHolder, 5, plane, bmd, btk, '_umi');
        } else if (name === 'g2') {
            const rarc = RARC.parse(await Yaz0.decompress(await fetch('data/j3d/smg/ObjectData/PeachCastleGardenPlanet.arc')));
            const bdlFile = rarc.findFile('peachcastlegardenplanet.bdl');
            const btkFile = rarc.findFile('peachcastlegardenplanet.btk');
            const bmd = BMD.parse(bdlFile.buffer);
            const btk = BTK.parse(btkFile.buffer);
            const plane = new PlaneShape(gl, 2, new GX_Material.Color(1, 1, 1, 1));
            return new J3DRenderer(gl, skyboxScene, textureHolder, 2, plane, bmd, btk, 'lambert119_v_x');
        } else if (name === 'g3') {
            const rarc = RARC.parse(await Yaz0.decompress(await fetch('data/j3d/ztp/F_SP127/R00_00.arc')));
            const bmdFile = rarc.findFile('bmdr/model4.bmd');
            const btkFile = rarc.findFile('btk/model4.btk');
            const bmd = BMD.parse(bmdFile.buffer);
            const btk = BTK.parse(btkFile.buffer);
            const plane = new PlaneShape(gl, 2, new GX_Material.Color(1, 1, 1, 1));
            return new J3DRenderer(gl, skyboxScene, textureHolder, 1, plane, bmd, btk, 'cc_MA09_Nigori_Water_v');
        } else if (name === 'g4') {
            const stage_u8 = U8.parse(await CX.decompress(await fetch('data/zss/F000_stg_l0.arc.LZ')));
            const stage_rres = BRRES.parse(stage_u8.findFile('g3d/stage.brres').buffer);

            // Hackety hack.
            const gxTextureHolder = textureHolder as GXTextureHolder;
            gxTextureHolder.addTextures(gl, stage_rres.tex0);

            // Animations
            const objpack_u8 = U8.parse(await CX.decompress(await fetch('data/zss/ObjectPack.arc.LZ')));
            const common_u8 = U8.parse(objpack_u8.findFile('oarc/Common.arc').buffer);
            const common_rres = BRRES.parse(common_u8.findFile('g3d/model.brres').buffer);

            const mdl0 = stage_rres.mdl0.find((mdl0) => mdl0.name === 'StageF000Water0');
            const plane = new PlaneShape(gl, 2);
            return new RRESRenderer(gl, skyboxScene, textureHolder, 2, plane, mdl0, common_rres);
        } else {
            throw new Error("whoops");
        }
    });
}
