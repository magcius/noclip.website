
import { mat3, mat4 } from 'gl-matrix';

import * as RARC from 'j3d/rarc';
import * as Yaz0 from 'yaz0';

import { BMD, BTK, BMT, TEX1, MaterialEntry } from 'j3d/j3d';
import * as GX from 'gx/gx_enum';
import * as GX_Material from 'gx/gx_material';

import { MainScene, OrbitCameraController, Texture, Scene } from 'viewer';
import { BlendMode, RenderFlags, RenderState, RenderPass } from 'render';
import { Progressable } from 'progress';
import { fetch } from 'util';
import { Command_Material } from '../j3d/render';
import { SunshineClearScene, SunshineSceneDesc } from '../j3d/sms_scenes';
import ArrayBufferSlice from 'ArrayBufferSlice';

const scale = 200;
const posMtx = mat4.create();
mat4.fromScaling(posMtx, [scale, scale, scale]);
const packetParamsData = new Float32Array(16 * 10);
for (let i = 0; i < 10; i++) {
    packetParamsData.set(posMtx, i * 16);
}

class MultiScene implements MainScene {
    public cameraController = OrbitCameraController;
    public renderPasses = [ RenderPass.CLEAR, RenderPass.OPAQUE, RenderPass.TRANSPARENT ];
    public scenes: Scene[];
    public textures: Texture[];

    constructor(scenes: Scene[]) {
        this.setScenes(scenes);
    }

    protected setScenes(scenes: Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }

    public render(renderState: RenderState) {
        this.scenes.forEach((scene) => {
            if (!scene.renderPasses.includes(renderState.currentPass))
                return;
            scene.render(renderState);
        });
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.scenes.forEach((scene) => scene.destroy(gl));
    }
}

const sceneParamsData = new Float32Array(4*4 + 4*4 + 4*4 + 4);
class SeaPlaneScene implements Scene {
    public renderPasses = [ RenderPass.TRANSPARENT ];
    public textures: Texture[] = [];

    public bmd: BMD;
    public btk: BTK;

    public animationScale: number = 5;

    // Play make-believe for Command_Material.
    public bmt: BMT = null;
    public isSkybox: boolean = false;
    public useMaterialTexMtx: boolean = false;
    public fps: number = 30;
    public attrScaleData: Float32Array;
    public colorOverrides: GX_Material.Color[] = [];
    public alphaOverrides: number[] = [];

    private seaCmd: Command_Material;
    private plane: PlaneShape;
    private sceneParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext, bmd: BMD, btk: BTK, configName: string) {
        this.bmd = bmd;
        this.btk = btk;

        this.attrScaleData = new Float32Array(GX_Material.scaledVtxAttributes.map(() => 1));

        const seaMaterial = bmd.mat3.materialEntries.find((m) => m.name === '_umi');
        this.seaCmd = this.makeMaterialCommand(gl, seaMaterial, configName);
        this.plane = new PlaneShape(gl);

        this.sceneParamsBuffer = gl.createBuffer();
    }

    public makeMaterialCommand(gl: WebGL2RenderingContext, material: MaterialEntry, configName: string) {
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
            gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.INVSRCALPHA;
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

            // Use one TEV stage.
            if (configName.includes('layer0')) {
                gxMaterial.tevStages.length = 1;
            } else if (configName.includes('layer1')) {
                gxMaterial.tevStages[0] = gxMaterial.tevStages[1];
                gxMaterial.tevStages.length = 1;
            }
        }

        const scene = this as any; // Play make-believe.
        const cmd = new Command_Material(gl, scene, material);

        if (configName.includes('nomip')) {
            gl.bindTexture(gl.TEXTURE_2D, cmd.textures[0]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_LOD, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LOD, 1);
            gl.bindTexture(gl.TEXTURE_2D, cmd.textures[1]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_LOD, 1);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LOD, 1);
        }

        return cmd;
    }

    public render(state: RenderState) {
        const gl = state.gl;
        
        // Update our SceneParams UBO.
        let offs = 0;
        sceneParamsData.set(state.projection, offs);
        offs += 4*4;
        sceneParamsData.set(state.updateModelView(this.isSkybox), offs);
        offs += 4*4;
        sceneParamsData.set(this.attrScaleData, offs);
        offs += 4*4;
        sceneParamsData[offs++] = GX_Material.getTextureLODBias(state);

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.sceneParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, sceneParamsData, gl.DYNAMIC_DRAW);

        this.seaCmd.exec(state);
        this.plane.render(state);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.plane.destroy(gl);
        this.seaCmd.destroy(gl);
        gl.deleteBuffer(this.sceneParamsBuffer);
    }

    public getTimeInFrames(milliseconds: number) {
        return (milliseconds / 1000) * this.fps * this.animationScale;
    }
}

class PlaneShape {
    private vao: WebGLVertexArrayObject;
    private posBuffer: WebGLBuffer;
    private txcBuffer: WebGLBuffer;
    private packetParamsBuffer: WebGLBuffer;

    constructor(gl: WebGL2RenderingContext) {
        this.createBuffers(gl);
        this.packetParamsBuffer = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.packetParamsBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, packetParamsData, gl.STATIC_DRAW);
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

    public render(state: RenderState) {
        const gl = state.viewport.gl;

        gl.bindBufferBase(gl.UNIFORM_BUFFER, GX_Material.GX_Program.ub_PacketParams, this.packetParamsBuffer);

        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteVertexArray(this.vao);
        gl.deleteBuffer(this.posBuffer);
        gl.deleteBuffer(this.txcBuffer);
        gl.deleteBuffer(this.packetParamsBuffer);
    }
}

export function createScene(gl: WebGL2RenderingContext, name: string): Progressable<MainScene> {
    return fetch("data/j3d/dolpic0.szs").then((buffer: ArrayBufferSlice) => {
        const bufferSlice: ArrayBufferSlice = Yaz0.decompress(buffer);
        const rarc = RARC.parse(bufferSlice);

        const skyScene = SunshineSceneDesc.createSunshineSceneForBasename(gl, rarc, 'sky', true);

        const bmdFile = rarc.findFile('map/map/sea.bmd');
        const btkFile = rarc.findFile('map/map/sea.btk');
        const bmd = BMD.parse(bmdFile.buffer);
        const btk = BTK.parse(btkFile.buffer);

        const seaScene = new SeaPlaneScene(gl, bmd, btk, name);
        return new MultiScene([
            new SunshineClearScene(),
            skyScene,
            seaScene,
        ]);
    });
}
