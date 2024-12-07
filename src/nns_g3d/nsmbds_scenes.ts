
// New Super Mario Bros DS

import * as Viewer from '../viewer.js';

import { DataFetcher } from '../DataFetcher.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { MDL0Renderer, nnsG3dBindingLayouts } from './render.js';
import { assert, assertExists } from '../util.js';
import { mat4, vec3 } from 'gl-matrix';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { SceneContext } from '../SceneBase.js';
import { BMD0, parseNSBMD, BTX0, parseNSBTX, BTP0, BTA0, parseNSBTP, parseNSBTA } from './NNS_G3D.js';
import { CameraController } from '../Camera.js';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { NITRO_Program } from '../SuperMario64DS/render.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';

export class WorldMapRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    public objectRenderers: MDL0Renderer[] = [];

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public getCache() {
        return this.renderHelper.renderCache;
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(8/60);
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(nnsG3dBindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16+32);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        renderInstManager.setCurrentList(this.renderInstListMain);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(renderInstManager, viewerInput);
        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

class NewSuperMarioBrosDSSceneDesc implements Viewer.SceneDesc {
    constructor(public worldNumber: number, public name: string, public id: string = '' + worldNumber) {
    }

    private fetchBMD(path: string, dataFetcher: DataFetcher): Promise<BMD0 | null> {
        return dataFetcher.fetchData(path, { allow404: true }).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0)
                return null;
            return parseNSBMD(buffer);
        });
    }

    private fetchBTX(path: string, dataFetcher: DataFetcher): Promise<BTX0 | null> {
        return dataFetcher.fetchData(path, { allow404: true }).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0)
                return null;
            return parseNSBTX(buffer);
        });
    }

    private fetchBTA(path: string, dataFetcher: DataFetcher): Promise<BTA0 | null> {
        return dataFetcher.fetchData(path, { allow404: true }).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0)
                return null;
            return parseNSBTA(buffer);
        });
    }

    private fetchBTP(path: string, dataFetcher: DataFetcher): Promise<BTP0 | null> {
        return dataFetcher.fetchData(path, { allow404: true}).then((buffer: ArrayBufferSlice) => {
            if (buffer.byteLength === 0)
                return null;
            return parseNSBTP(buffer);
        });
    }

    private async fetchObjectData(path: string, dataFetcher: DataFetcher): Promise<ObjectData | null> {
        const [_bmd, _btx, _bta, _btp] = await Promise.all<any>([
            this.fetchBMD(path + `.nsbmd`, dataFetcher),
            this.fetchBTX(path + `.nsbtx`, dataFetcher),
            this.fetchBTA(path + `.nsbta`, dataFetcher),
            this.fetchBTP(path + `.nsbtp`, dataFetcher),
        ]);

        if (_bmd === null)
            return null;

        const bmd = assertExists(_bmd as BMD0 | null);
        const btx = _btx as BTX0 | null;
        const bta = _bta as BTA0 | null;
        const btp = _btp as BTP0 | null;
        assert(bmd.models.length === 1);

        return new ObjectData(bmd, btx, bta, btp);
    }

    private createRendererFromData(cache: GfxRenderCache, objectData: ObjectData, position: vec3 | null = null): MDL0Renderer {
        const device = cache.device;
        const scaleFactor = 1/16;
        const renderer = new MDL0Renderer(cache, objectData.bmd.models[0], objectData.btx !== null ? assertExists(objectData.btx.tex0) : assertExists(objectData.bmd.tex0));
        if (position !== null)
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, position);
        mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [scaleFactor, scaleFactor, scaleFactor]);
        if (objectData.bta !== null)
            renderer.bindSRT0(objectData.bta.srt0);
        if (objectData.btp !== null)
            renderer.bindPAT0(device, objectData.btp.pat0[0]);
        return renderer;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const pathBase = `NewSuperMarioBros`;

        return Promise.all([
            this.fetchObjectData(`${pathBase}/map/w${this.worldNumber}`, dataFetcher),
            this.fetchObjectData(`${pathBase}/map/w${this.worldNumber}_tree`, dataFetcher),
            this.fetchObjectData(`${pathBase}/map/w1_castle`, dataFetcher),
            this.fetchObjectData(`${pathBase}/map/w8_koppaC`, dataFetcher),
            this.fetchObjectData(`${pathBase}/map/w1_tower`, dataFetcher),
            this.fetchObjectData(`${pathBase}/map/map_point`, dataFetcher),
        ]).then(([mainObjData, treeObjData, castleObjData, bigCastleObjData, towerObjData, mapPointObjData]) => {
            // Adjust the nodes/bones to emulate the flag animations.
            mat4.fromTranslation(castleObjData!.bmd.models[0].nodes[3].jointMatrix, [0, 88, 0]);
            mat4.fromTranslation(castleObjData!.bmd.models[0].nodes[4].jointMatrix, [12, 88, 0]);
            mat4.fromTranslation(bigCastleObjData!.bmd.models[0].nodes[5].jointMatrix, [-40, 0, -19]);
            mat4.fromTranslation(bigCastleObjData!.bmd.models[0].nodes[6].jointMatrix, [-40, 84, -19]);
            mat4.fromTranslation(bigCastleObjData!.bmd.models[0].nodes[7].jointMatrix, [-26, 84, -19]);
            mat4.fromTranslation(bigCastleObjData!.bmd.models[0].nodes[8].jointMatrix, [40, 0, -19]);
            mat4.fromTranslation(bigCastleObjData!.bmd.models[0].nodes[9].jointMatrix, [40, 84, -19]);
            mat4.fromTranslation(bigCastleObjData!.bmd.models[0].nodes[10].jointMatrix, [54, 84, -19]);
            mat4.fromTranslation(towerObjData!.bmd.models[0].nodes[2].jointMatrix, [0, 88, 0]);
            mat4.fromTranslation(towerObjData!.bmd.models[0].nodes[3].jointMatrix, [12, 88, 0]);

            const renderer = new WorldMapRenderer(device);
            const cache = renderer.getCache();

            const objects = worldMapDescs[this.worldNumber - 1];

            const mainObj = this.createRendererFromData(cache, assertExists(mainObjData));
            renderer.objectRenderers.push(mainObj);

            let treeObj: MDL0Renderer | null = null;
            if (treeObjData !== null) {
                treeObj = this.createRendererFromData(cache, treeObjData);
                renderer.objectRenderers.push(treeObj);
            }

            for (let i = 0; i < objects.length; i++) {
                const element = objects[i];
                if (element.type === WorldMapObjType.ROUTE_POINT) {
                    const obj = this.createRendererFromData(cache, mapPointObjData!, element.position);
                    obj.bindPAT0(device, assertExists(mapPointObjData!.btp).pat0[3]);
                    renderer.objectRenderers.push(obj);
                } else if (element.type === WorldMapObjType.START_POINT) {
                    const obj = this.createRendererFromData(cache, mapPointObjData!, element.position);
                    obj.bindPAT0(device, assertExists(mapPointObjData!.btp).pat0[2]);
                    renderer.objectRenderers.push(obj);
                } else if (element.type === WorldMapObjType.TOWER) {
                    renderer.objectRenderers.push(this.createRendererFromData(cache, towerObjData!, element.position));
                } else if (element.type === WorldMapObjType.CASTLE) {
                    renderer.objectRenderers.push(this.createRendererFromData(cache, castleObjData!, element.position));
                } else if (element.type === WorldMapObjType.BIG_CASTLE) {
                    renderer.objectRenderers.push(this.createRendererFromData(cache, bigCastleObjData!, element.position));
                }
            }

            if (this.worldNumber === 1) {
                mat4.translate(mainObj.modelMatrix, mainObj.modelMatrix, [0, 2.5, 0]);
            } else if (this.worldNumber === 3) {
                mat4.translate(mainObj.modelMatrix, mainObj.modelMatrix, [30, 3, 0]);
                mat4.translate(assertExists(treeObj).modelMatrix, treeObj!.modelMatrix, [-4, 0, 0]);
            }

            return renderer;
        });
    }
}

const enum WorldMapObjType { ROUTE_POINT, START_POINT, TOWER, CASTLE, BIG_CASTLE };

class ObjectData {
    constructor(public bmd: BMD0, public btx: BTX0 | null, public bta: BTA0 | null, public btp: BTP0 | null) {
    }
}

interface IWorldMapObj {
    type: WorldMapObjType, position: vec3;
}

const worldMapDescs: IWorldMapObj[][] = [
    [
        { type: WorldMapObjType.START_POINT, position: [-180, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [2, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [34, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [10, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [34, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-400, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [-26, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [2, 0, -2.5] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [2, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [34, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [2, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [42, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [2, 0, -2] },
        { type: WorldMapObjType.TOWER, position: [18, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [34, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [6, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [26, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [-2, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [14, 0, -3] },
        { type: WorldMapObjType.TOWER, position: [50, 0, -2] },
        { type: WorldMapObjType.BIG_CASTLE, position: [66, 0, 0] },
    ],
];

const id = 'nsmbds';
const name = 'New Super Mario Bros DS';
const sceneDescs = [
    "World Maps",
    new NewSuperMarioBrosDSSceneDesc(1, "World 1"),
    new NewSuperMarioBrosDSSceneDesc(2, "World 2"),
    new NewSuperMarioBrosDSSceneDesc(3, "World 3"),
    new NewSuperMarioBrosDSSceneDesc(4, "World 4"),
    new NewSuperMarioBrosDSSceneDesc(5, "World 5"),
    new NewSuperMarioBrosDSSceneDesc(6, "World 6"),
    new NewSuperMarioBrosDSSceneDesc(7, "World 7"),
    new NewSuperMarioBrosDSSceneDesc(8, "World 8"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
