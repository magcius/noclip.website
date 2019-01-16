
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

    constructor(device: GfxDevice, public objs: ObjectRepresentation[]) {
        let viewerTextures: Viewer.Texture[] = [];

        this.objs.forEach(element => {
            viewerTextures = viewerTextures.concat(element.renderer.viewerTextures);
            element.renderer.addToViewRenderer(device, this.viewRenderer);
            element.applyAnimations(device);
        });

        this.textureHolder = new FakeTextureHolder(viewerTextures);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.objs.forEach(element => {
            element.renderer.prepareToRender(hostAccessPass, viewerInput);
        });
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, transparentBlackFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, G3DPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = device.createRenderPass(this.renderTarget.gfxRenderTarget, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, mainPassRenderer, G3DPass.MAIN);
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);

        this.objs.forEach(element => {
            element.renderer.destroy(device);
        });
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

    private createObjectRepresentation(device: GfxDevice, path: string, abortSignal: AbortSignal): Progressable<ObjectRepresentation> {
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

            const pat0 = btp !== null ? btp.pat0[0] : null;
            return new ObjectRepresentation(device, bmd, btx, bta, pat0);
        });
    }

    public createSceneGfx(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const basePath = `data/nsmbds`;

        // TODO(jstpierre): Stop the type system abuse.
        return Progressable.all<any>([
            this.createObjectRepresentation(device, `${basePath}/map/w${this.worldNumber}`, abortSignal),
            this.createObjectRepresentation(device, `${basePath}/map/w${this.worldNumber}_tree`, abortSignal),
            this.createObjectRepresentation(device, `${basePath}/map/w1_castle`, abortSignal),
            this.createObjectRepresentation(device, `${basePath}/map/w8_koppaC`, abortSignal),
            this.fetchBMD(`${basePath}/map/w1_tower.nsbmd`, abortSignal),
            this.fetchBMD(`${basePath}/map/map_point.nsbmd`, abortSignal),
            this.fetchBTP(`${basePath}/map/map_point.nsbtp`, abortSignal),
        ]).then(([_mainObj, _treeObj, _castleObj, _bigCastleObj, _towerBMD, _mapPointBMD, _mapPointBTP]) => {
            const mainObj = _mainObj as ObjectRepresentation;
            const treeObj = _treeObj as ObjectRepresentation;
            const castleObj = _castleObj as ObjectRepresentation;
            const bigCastleObj = _bigCastleObj as ObjectRepresentation;
            const towerBMD = _towerBMD as NSBMD.BMD0;
            const mapPointBMD = _mapPointBMD as NSBMD.BMD0;
            const mapPointBTP = _mapPointBTP as NSBTP.BTP0;

            // Adjust the nodes/bones to emulate the flag animations.
            mat4.fromTranslation(towerBMD.models[0].nodes[2].jointMatrix, [0, 5.5, 0]);
            mat4.fromTranslation(towerBMD.models[0].nodes[3].jointMatrix, [0.75, 5.5, 0]);
            mat4.fromTranslation(castleObj.renderer.model.nodes[3].jointMatrix, [0, 5.5, 0]);
            mat4.fromTranslation(castleObj.renderer.model.nodes[4].jointMatrix, [0.75, 5.5, 0]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[5].jointMatrix, [-1.25, 0, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[6].jointMatrix, [-1.25, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[7].jointMatrix, [-0.875, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[8].jointMatrix, [1.25, 0, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[9].jointMatrix, [1.25, 2.75, -0.75]);
            mat4.fromTranslation(bigCastleObj.renderer.model.nodes[10].jointMatrix, [1.625, 2.75, -0.75]);

            mat4.scale(mainObj.renderer.modelMatrix, mainObj.renderer.modelMatrix, [1 / 16, 1 / 16, 1 / 16]);

            const objects = worldMapDescs[this.worldNumber - 1];

            let representations: ObjectRepresentation[] = [];
            representations.push(mainObj);

            if (treeObj !== null) {
                mat4.scale(treeObj.renderer.modelMatrix, treeObj.renderer.modelMatrix, [1 / 16, 1 / 16, 1 / 16]);
                representations.push(treeObj);
            }

            objects.forEach((element) => {
                if (element.type == WorldMapObjType.ROUTE_POINT) {
                    const obj = new ObjectRepresentation(device, mapPointBMD, null, null, mapPointBTP.pat0[3]);
                    mat4.scale(obj.renderer.modelMatrix, obj.renderer.modelMatrix, [1 / 16, 1 / 16, 1 / 16]);
                    mat4.translate(obj.renderer.modelMatrix, obj.renderer.modelMatrix, element.position);
                    representations.push(obj);
                } else if (element.type == WorldMapObjType.START_POINT) {
                    const obj = new ObjectRepresentation(device, mapPointBMD, null, null, mapPointBTP.pat0[2]);
                    mat4.scale(obj.renderer.modelMatrix, obj.renderer.modelMatrix, [1 / 16, 1 / 16, 1 / 16]);
                    mat4.translate(obj.renderer.modelMatrix, obj.renderer.modelMatrix, element.position);
                    representations.push(obj);
                } else if (element.type == WorldMapObjType.TOWER) {
                    const obj = new ObjectRepresentation(device, towerBMD, null, null, null);
                    mat4.scale(obj.renderer.modelMatrix, obj.renderer.modelMatrix, [1 / 16, 1 / 16, 1 / 16]);
                    mat4.translate(obj.renderer.modelMatrix, obj.renderer.modelMatrix, element.position);
                    representations.push(obj);
                } else if (element.type == WorldMapObjType.CASTLE) {
                    mat4.scale(castleObj.renderer.modelMatrix, castleObj.renderer.modelMatrix, [1 / 16, 1 / 16, 1 / 16]);
                    mat4.translate(castleObj.renderer.modelMatrix, castleObj.renderer.modelMatrix, element.position);
                    representations.push(castleObj);
                } else if (element.type == WorldMapObjType.BIG_CASTLE) {
                    mat4.scale(bigCastleObj.renderer.modelMatrix, bigCastleObj.renderer.modelMatrix, [1 / 16, 1 / 16, 1 / 16]);
                    mat4.translate(bigCastleObj.renderer.modelMatrix, bigCastleObj.renderer.modelMatrix, element.position);
                    representations.push(bigCastleObj);
                }
            });

            if (this.worldNumber === 1) {
                mat4.translate(mainObj.renderer.modelMatrix, mainObj.renderer.modelMatrix, [0, 2.5, 0]);
            } else if (this.worldNumber === 3) {
                mat4.translate(mainObj.renderer.modelMatrix, mainObj.renderer.modelMatrix, [30, 3, 0]);
                mat4.translate(treeObj.renderer.modelMatrix, treeObj.renderer.modelMatrix, [-4, 0, 0]);
            }

            return new WorldMapRenderer(device, representations);
        });
    }
}

const enum WorldMapObjType { ROUTE_POINT, START_POINT, TOWER, CASTLE, BIG_CASTLE };

export class ObjectRepresentation {
    public renderer: MDL0Renderer;

    constructor(device: GfxDevice, public bmd: NSBMD.BMD0, public btx: NSBTX.BTX0, public bta: NSBTA.BTA0, public pat0: NSBTP.PAT0) {
        this.renderer = new MDL0Renderer(device, this.btx !== null ? this.btx.tex0 : this.bmd.tex0, this.bmd.models[0]);
    }

    public applyAnimations(device: GfxDevice): void {
        if (this.bta !== null)
            this.renderer.bindSRT0(this.bta.srt0);

        if (this.pat0 !== null)
            this.renderer.bindPAT0(device, this.pat0);
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
