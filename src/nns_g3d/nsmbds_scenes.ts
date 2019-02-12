
// New Super Mario Bros DS

import * as Viewer from '../viewer';
import * as NSBMD from './nsbmd';
import * as NSBTA from './nsbta';
import * as NSBTP from './nsbtp';
import * as NSBTX from './nsbtx';

import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { MDL0Renderer, G3DPass } from './render';
import { assert } from '../util';
import { mat4 } from 'gl-matrix';
import { GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { BasicRenderTarget, depthClearRenderPassDescriptor, transparentBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { FakeTextureHolder } from '../TextureHolder';

export class WorldMapRenderer implements Viewer.SceneGfx {
    public viewRenderer = new GfxRenderInstViewRenderer();
    public renderTarget = new BasicRenderTarget();
    public textureHolder: FakeTextureHolder;

    constructor(device: GfxDevice, public objs: MDL0Renderer[]) {
        let viewerTextures: Viewer.Texture[] = [];

        for (let i = 0; i < this.objs.length; i++) {
            const element = this.objs[i];
            viewerTextures = viewerTextures.concat(element.viewerTextures);
            element.addToViewRenderer(device, this.viewRenderer);
        }

        this.textureHolder = new FakeTextureHolder(viewerTextures);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.objs.length; i++)
            this.objs[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.viewRenderer.prepareToRender(device);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, transparentBlackFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, G3DPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, G3DPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);

        for (let i = 0; i < this.objs.length; i++)
            this.objs[i].destroy(device);
    }
}

class NewSuperMarioBrosDSSceneDesc implements Viewer.SceneDesc {
    constructor(public worldNumber: number, public name: string, public id: string = '' + worldNumber) {
    }

    private fetchBMD(path: string, abortSignal: AbortSignal): Progressable<NSBMD.BMD0> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBMD.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTX(path: string, abortSignal: AbortSignal): Progressable<NSBTX.BTX0> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTX.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTA(path: string, abortSignal: AbortSignal): Progressable<NSBTA.BTA0> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTA.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTP(path: string, abortSignal: AbortSignal): Progressable<NSBTP.BTP0> {
        return fetchData(path, abortSignal).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTP.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchObjectData(path: string, abortSignal: AbortSignal): Progressable<ObjectData> {
        return Progressable.all<any>([
            this.fetchBMD(path + `.nsbmd`, abortSignal),
            this.fetchBTX(path + `.nsbtx`, abortSignal),
            this.fetchBTA(path + `.nsbta`, abortSignal),
            this.fetchBTP(path + `.nsbtp`, abortSignal),
        ]).then(([_bmd, _btx, _bta, _btp]) => {
            const bmd = _bmd as NSBMD.BMD0;
            const btx = _btx as NSBTX.BTX0;
            const bta = _bta as NSBTA.BTA0;
            const btp = _btp as NSBTP.BTP0;

            if (bmd === null)
                return null;
            assert(bmd.models.length === 1);

            return new ObjectData(bmd, btx, bta, btp);
        });
    }

    private createRendererFromData(device: GfxDevice, objectData: ObjectData, position: number[] | null = null): MDL0Renderer {
        const scaleFactor = 1/16;
        const renderer = new MDL0Renderer(device, objectData.bmd.models[0], objectData.btx !== null ? objectData.btx.tex0 : objectData.bmd.tex0);
        mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [scaleFactor, scaleFactor, scaleFactor]);
        if (position !== null)
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, position);
        if (objectData.bta !== null)
            renderer.bindSRT0(objectData.bta.srt0);
        if (objectData.btp !== null)
            renderer.bindPAT0(device, objectData.btp.pat0[0]);
        return renderer;
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const basePath = `nsmbds`;

        return Progressable.all([
            this.fetchObjectData(`${basePath}/map/w${this.worldNumber}`, abortSignal),
            this.fetchObjectData(`${basePath}/map/w${this.worldNumber}_tree`, abortSignal),
            this.fetchObjectData(`${basePath}/map/w1_castle`, abortSignal),
            this.fetchObjectData(`${basePath}/map/w8_koppaC`, abortSignal),
            this.fetchObjectData(`${basePath}/map/w1_tower`, abortSignal),
            this.fetchObjectData(`${basePath}/map/map_point`, abortSignal),
        ]).then(([mainObjData, treeObjData, castleObjData, bigCastleObjData, towerObjData, mapPointObjData]) => {
            // Adjust the nodes/bones to emulate the flag animations.
            mat4.fromTranslation(castleObjData.bmd.models[0].nodes[3].jointMatrix, [0, 5.5, 0]);
            mat4.fromTranslation(castleObjData.bmd.models[0].nodes[4].jointMatrix, [0.75, 5.5, 0]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[5].jointMatrix, [-1.25, 0, -0.75]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[6].jointMatrix, [-1.25, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[7].jointMatrix, [-0.875, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[8].jointMatrix, [1.25, 0, -0.75]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[9].jointMatrix, [1.25, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[10].jointMatrix, [1.625, 2.75, -0.75]);
            mat4.fromTranslation(towerObjData.bmd.models[0].nodes[2].jointMatrix, [0, 5.5, 0]);
            mat4.fromTranslation(towerObjData.bmd.models[0].nodes[3].jointMatrix, [0.75, 5.5, 0]);

            const objects = worldMapDescs[this.worldNumber - 1];

            const renderers: MDL0Renderer[] = [];

            const mainObj = this.createRendererFromData(device, mainObjData);
            renderers.push(mainObj);

            let treeObj: MDL0Renderer | null = null;
            if (treeObjData !== null) {
                treeObj = this.createRendererFromData(device, treeObjData);
                renderers.push(treeObj);
            }

            for (let i = 0; i < objects.length; i++) {
                const element = objects[i];
                if (element.type == WorldMapObjType.ROUTE_POINT) {
                    const obj = this.createRendererFromData(device, mapPointObjData, element.position);
                    obj.bindPAT0(device, mapPointObjData.btp.pat0[3]);
                    renderers.push(obj);
                } else if (element.type == WorldMapObjType.START_POINT) {
                    const obj = this.createRendererFromData(device, mapPointObjData, element.position);
                    obj.bindPAT0(device, mapPointObjData.btp.pat0[2]);
                    renderers.push(obj);
                } else if (element.type == WorldMapObjType.TOWER) {
                    renderers.push(this.createRendererFromData(device, towerObjData, element.position));
                } else if (element.type == WorldMapObjType.CASTLE) {
                    renderers.push(this.createRendererFromData(device, castleObjData, element.position));
                } else if (element.type == WorldMapObjType.BIG_CASTLE) {
                    renderers.push(this.createRendererFromData(device, bigCastleObjData, element.position));
                }
            }

            if (this.worldNumber === 1) {
                mat4.translate(mainObj.modelMatrix, mainObj.modelMatrix, [0, 2.5, 0]);
            } else if (this.worldNumber === 3) {
                mat4.translate(mainObj.modelMatrix, mainObj.modelMatrix, [30, 3, 0]);
                mat4.translate(treeObj.modelMatrix, treeObj.modelMatrix, [-4, 0, 0]);
            }

            return new WorldMapRenderer(device, renderers);
        });
    }
}

const enum WorldMapObjType { ROUTE_POINT, START_POINT, TOWER, CASTLE, BIG_CASTLE };

class ObjectData {
    constructor(public bmd: NSBMD.BMD0 | null, public btx: NSBTX.BTX0 | null, public bta: NSBTA.BTA0 | null, public btp: NSBTP.BTP0 | null) {
    }
}

interface IWorldMapObj {
    type: WorldMapObjType, position: number[];
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
        { type: WorldMapObjType.BIG_CASTLE, position: [33, 0, 0] },
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
