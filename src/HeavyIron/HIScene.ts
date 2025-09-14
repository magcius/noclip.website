import * as UI from "../ui.js";
import { CameraController } from "../Camera.js";
import { DataFetcher } from "../DataFetcher.js";
import { SceneContext } from "../SceneBase.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { convertToHIEvent, HIEvent } from "./HIEvent.js";
import { HIBase } from "./HIBase.js";
import { HIFog } from "./HIFog.js";
import { HIDispatcher } from "./HIDispatcher.js";
import { HICamera } from "./HICamera.js";
import { HIEntSimpleObj } from "./HIEntSimpleObj.js";
import { HIEnt } from "./HIEnt.js";
import { HILightKit, HILightKitManager } from "./HILightKit.js";
import { HIEnv } from "./HIEnv.js";
import { HIModelManager, HIPipeInfoTable } from "./HIModel.js";
import { HIModelBucketManager } from "./HIModelBucket.js";
import { HIPAsset } from "./HIP.js";
import { HIPlatform } from "./HIPlatform.js";
import { HISkyDomeManager } from "./HISkyDome.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { strHash, strHashCat } from "./Util.js";
import { HIRenderState, HIRenderStateManager } from "./HIRenderState.js";
import { HIDebug } from "./HIDebug.js";
import { RpClump } from "./rw/rpworld.js";
import { RwEngine, RwTexture, RwStream, } from "./rw/rwcore.js";
import { HIEntButton, HIEntButtonManager } from "./HIEntButton.js";
import { HIEntDestructObj } from "./HIEntDestructObj.js";
import { HINPCCommon } from "./HINPCCommon.js";
import { HIEntPlayer, HIEntPlayerBFBB, HIEntPlayerTSSM } from "./HIEntPlayer.js";
import { HIAssetPickupTable, HIEntPickup, HIEntPickupManager } from "./HIEntPickup.js";
import { HILOD } from "./HILOD.js";
import { HIDynAsset } from "./HIDynAsset.js";
import { HIEntTeleportBox } from "./HIEntTeleportBox.js";
import { HIAssetManager } from "./HIAssetManager.js";
import { HIAssetType } from "./HIAssetTypes.js";

export enum HIGame {
    BFBBBeta,
    BFBB,
    TSSM,
}

export class HIRenderHacks {
    public lighting = true;
    public vertexColors = true;
    public fog = true;
    public skydome = true;
    public player = true;
    public showAllEntities = false;
    public showAllJSPNodes = false;
    public frustumCulling = true;
}

export class HIScene implements SceneGfx {
    private rw: RwEngine;

    public debug = new HIDebug();
    public assetManager = new HIAssetManager();
    public env: HIEnv;
    public camera: HICamera;
    public player: HIEntPlayer;
    public pickupTable: HIAssetPickupTable;
    public renderStateManager = new HIRenderStateManager();
    public lightKitManager = new HILightKitManager();
    public modelManager = new HIModelManager();
    public modelBucketManager = new HIModelBucketManager(this.game < HIGame.TSSM ? 256 : 512);
    public skydomeManager = new HISkyDomeManager();
    public pickupManager = new HIEntPickupManager();
    public buttonManager = new HIEntButtonManager();
    public lod = new HILOD();
    public baseList: HIBase[] = [];
    public entList: HIEnt[] = [];
    public renderHacks = new HIRenderHacks();

    constructor(public game: HIGame, device: GfxDevice, context: SceneContext) {
        this.rw = new RwEngine(device, context);

        this.rw.textureFindCallback = (name, maskName) => {
            const id = strHash(name + ".RW3");
            return (this.assetManager.findAsset(id)?.runtimeData as RwTexture) || null;
        };

        this.camera = new HICamera();

        this.debug.eventLog.ignore.add(HIEvent.SceneBegin);
        this.debug.eventLog.ignore.add(HIEvent.RoomBegin);
        this.debug.eventLog.ignore.add(HIEvent.SceneEnter);
        this.debug.eventLog.ignore.add(HIEvent.LevelBegin);
    }

    public destroy(device: GfxDevice) {
        this.modelBucketManager.deinit();

        this.assetManager.destroy(this.rw);
        this.rw.destroy();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.025);
    }

    public findObject(id: number): HIBase | null {
        const obj = this.baseList.find((base: HIBase) => {
            return base.baseAsset.id === id;
        });
        return obj || null;
    }
    
    public sendEvent(to: HIBase, event: HIEvent, params?: number[] | ArrayBufferSlice, from?: HIBase) {
        this.debug.eventLog.push(this, to, event, from);

        if (event === HIEvent.Disable) {
            to.disable();
        } else if (event === HIEvent.Enable) {
            to.enable();
        }

        if (to.isEnabled()) {
            if (params instanceof ArrayBufferSlice) {
                params = to.parseEventParams(event, new RwStream(params));
            } else if (params === undefined) {
                params = [];
            }

            to.handleEvent(event, params, this);

            for (const link of to.links) {
                if (event !== convertToHIEvent(link.srcEvent, this.game)) {
                    continue;
                }
                if (link.chkAssetID !== 0 && (from === undefined || link.chkAssetID !== from.baseAsset.id)) {
                    continue;
                }

                const sendTo = this.findObject(link.dstAssetID);
                if (!sendTo) {
                    continue;
                }

                this.sendEvent(sendTo, convertToHIEvent(link.dstEvent, this.game), link.param, to);
            }
        }

        this.debug.eventLog.pop(event);
    }

    public sendEventAll(event: HIEvent) {
        for (const base of this.baseList) {
            this.sendEvent(base, event);
        }
    }

    public async load(dataFetcher: DataFetcher, hipPaths: string[]): Promise<void> {
        await this.assetManager.load(dataFetcher, hipPaths, this.game, this.rw);

        const modelAssets: HIPAsset[] = [];
        const pipeTables: HIPipeInfoTable[] = [];

        for (const hip of this.assetManager.hips) {
            for (const layer of hip.layers) {
                for (const asset of layer.assets) {
                    switch (asset.type) {
                    case HIAssetType.MODL:
                        modelAssets.push(asset);
                        break;
                    case HIAssetType.PICK:
                        this.pickupTable = this.assetManager.findAssetByType(HIAssetType.PICK, 0)!.runtimeData as HIAssetPickupTable;
                        break;
                    case HIAssetType.PIPT:
                        pipeTables.push(asset.runtimeData as HIPipeInfoTable);
                        break;
                    }
                }
            }
        }

        this.loadPipeTables(pipeTables, modelAssets);

        for (const hip of this.assetManager.hips) {
            for (const layer of hip.layers) {
                for (const asset of layer.assets) {
                    switch (asset.type) {
                    case HIAssetType.BUTN:
                        this.addEnt(new HIEntButton(new RwStream(asset.rawData), this));
                        break;
                    case HIAssetType.DPAT:
                        this.addBase(new HIDispatcher(new RwStream(asset.rawData), this));
                        break;
                    case HIAssetType.DSTR:
                        this.addEnt(new HIEntDestructObj(new RwStream(asset.rawData), this));
                        break;
                    case HIAssetType.DYNA:
                    {
                        const stream = new RwStream(asset.rawData);
                        const dynAsset = new HIDynAsset(stream);
                        switch (dynAsset.type) {
                        case strHash("game_object:Teleport"):
                            this.addEnt(new HIEntTeleportBox(dynAsset, stream, this));
                            break;
                        }
                        break;
                    }
                    case HIAssetType.ENV:
                        this.env = new HIEnv(new RwStream(asset.rawData), this, this.assetManager.jsps);
                        this.addBase(this.env);
                        break;
                    case HIAssetType.FOG:
                        this.addBase(new HIFog(new RwStream(asset.rawData), this));
                        break;
                    case HIAssetType.PKUP:
                    {
                        const pkup = new HIEntPickup(new RwStream(asset.rawData), this);
                        this.pickupManager.add(pkup);
                        this.addEnt(pkup);
                        break;
                    }
                    case HIAssetType.PLYR:
                        switch (this.game) {
                        case HIGame.BFBBBeta:
                        case HIGame.BFBB:
                            this.player = new HIEntPlayerBFBB(new RwStream(asset.rawData), this);
                            break;
                        case HIGame.TSSM:
                            this.player = new HIEntPlayerTSSM(new RwStream(asset.rawData), this);
                            break;
                        }
                        break;
                    case HIAssetType.PLAT:
                        this.addEnt(new HIPlatform(new RwStream(asset.rawData), this));
                        break;
                    case HIAssetType.SIMP:
                        this.addEnt(new HIEntSimpleObj(new RwStream(asset.rawData), this));
                        break;
                    case HIAssetType.VIL:
                        this.addEnt(new HINPCCommon(new RwStream(asset.rawData), this));
                        break;
                    }
                }
            }
        }

        // There's a BOOT.HIP player and a level.HIP player, we only want the level.HIP player
        this.addEnt(this.player);

        this.reset();
        this.setup();

        //console.log(this.baseList);

        this.sendEventAll(HIEvent.SceneBegin);
        this.sendEventAll(HIEvent.RoomBegin);
        this.sendEventAll(HIEvent.SceneEnter);
        this.sendEventAll(HIEvent.LevelBegin);
    }

    private loadPipeTables(pipeTables: HIPipeInfoTable[], modelAssets: HIPAsset[]) {
        for (const asset of modelAssets) {
            const model = asset.runtimeData as RpClump;
            let remainSubObjBits = (1 << model.atomics.length) - 1;
            for (const pipt of pipeTables) {
                for (const pipe of pipt.data) {
                    if (pipe.modelHashID === asset.id || strHashCat(pipe.modelHashID, ".dff") === asset.id) {
                        const subObjBits = pipe.subObjectBits & remainSubObjBits;
                        if (subObjBits) {
                            let currSubObjBits = subObjBits;
                            for (let i = model.atomics.length-1; i >= 0; i--) {
                                if (currSubObjBits & 0x1) {
                                    this.modelBucketManager.insertBucket(model.atomics[i], pipe.pipe);
                                }
                                currSubObjBits >>>= 1;
                            }
                            remainSubObjBits &= ~subObjBits;
                            if (remainSubObjBits === 0) {
                                break;
                            }
                        }
                    }
                }
                if (remainSubObjBits === 0) {
                    break;
                }
            }
            if (remainSubObjBits) {
                for (let i = model.atomics.length-1; i >= 0; i--) {
                    if (remainSubObjBits & 0x1) {
                        this.modelBucketManager.insertBucket(model.atomics[i], { flags: 0, layer: 0, alphaDiscard: 0 });
                    }
                    remainSubObjBits >>>= 1;
                }
            }
        }
    }

    private setup() {
        this.lod.setup(this);

        for (const base of this.baseList) {
            base.setup(this);
        }
        
        if (this.env.envAsset.objectLightKit) {
            const lkit = this.assetManager.findAsset(this.env.envAsset.objectLightKit)?.runtimeData as HILightKit;
            if (lkit) {
                for (const ent of this.entList) {
                    if (ent.model) {
                        ent.lightKit = lkit;
                    }
                }
            }
        }

        if (this.player.playerAsset.lightKitID) {
            const lkit = this.assetManager.findAsset(this.player.playerAsset.lightKitID)?.runtimeData as HILightKit;
            if (lkit) {
                this.player.lightKit = lkit;
            }
        }

        this.pickupManager.setup(this);
    }

    private reset() {
        for (const base of this.baseList) {
            base.reset(this);
        }
    }

    private addBase(base: HIBase) {
        this.baseList.push(base);
    }

    private addEnt(ent: HIEnt) {
        this.addBase(ent);
        this.entList.push(ent);
    }

    private update(viewerInput: ViewerRenderInput) {
        const dt = viewerInput.deltaTime / 1000;

        this.pickupManager.update(this, dt);
        this.buttonManager.update(this, dt);

        for (const ent of this.entList) {
            ent.update(this, dt);
        }

        this.lod.update(this.rw);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        this.update(viewerInput);

        this.camera.disableFogHack = !this.renderHacks.fog;
        this.camera.disableFrustumCullHack = !this.renderHacks.frustumCulling;

        for (const jsp of this.env.jsps) {
            jsp.showAllNodesHack = this.renderHacks.showAllJSPNodes;
        }
        
        this.skydomeManager.disableHack = !this.renderHacks.skydome;

        this.camera.begin(this.rw);

        this.lightKitManager.enable(null, this);
        
        this.renderStateManager.set(HIRenderState.SkyBack, this.camera, this.rw);
        this.skydomeManager.render(this, this.rw);
        
        this.renderStateManager.set(HIRenderState.Environment, this.camera, this.rw);
        this.env.render(this, this.rw);
        
        this.renderStateManager.set(HIRenderState.OpaqueModels, this.camera, this.rw);
        this.modelBucketManager.begin();
        for (const ent of this.entList) {
            this.lightKitManager.enable(ent.lightKit, this);
            ent.render(this, this.rw);
        }

        this.pickupManager.render(this, this.rw);
        this.modelBucketManager.renderOpaque(this, this.rw);

        this.renderStateManager.set(HIRenderState.AlphaModels, this.camera, this.rw);
        this.modelBucketManager.renderAlpha(this, this.rw);
        
        this.camera.end(this.rw);
        
        this.rw.render();
    }

    public createPanels(): UI.Panel[] {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const lightingCheckbox = new UI.Checkbox('Lighting', this.renderHacks.lighting);
        lightingCheckbox.onchanged = () => { this.renderHacks.lighting = lightingCheckbox.checked; };
        panel.contents.appendChild(lightingCheckbox.elem);

        const vertexColorsCheckbox = new UI.Checkbox('Vertex Colors', this.renderHacks.vertexColors);
        vertexColorsCheckbox.onchanged = () => { this.renderHacks.vertexColors = vertexColorsCheckbox.checked; };
        panel.contents.appendChild(vertexColorsCheckbox.elem);

        const fogCheckbox = new UI.Checkbox('Fog', this.renderHacks.fog);
        fogCheckbox.onchanged = () => { this.renderHacks.fog = fogCheckbox.checked; }
        panel.contents.appendChild(fogCheckbox.elem);

        const skydomeCheckbox = new UI.Checkbox('Skydome', this.renderHacks.skydome);
        skydomeCheckbox.onchanged = () => { this.renderHacks.skydome = skydomeCheckbox.checked; };
        panel.contents.appendChild(skydomeCheckbox.elem);

        const playerCheckbox = new UI.Checkbox('Player', this.renderHacks.player);
        playerCheckbox.onchanged = () => { this.renderHacks.player = playerCheckbox.checked; };
        panel.contents.appendChild(playerCheckbox.elem);

        const showAllEntitiesCheckbox = new UI.Checkbox('Show All Entities', this.renderHacks.showAllEntities);
        showAllEntitiesCheckbox.onchanged = () => { this.renderHacks.showAllEntities = showAllEntitiesCheckbox.checked; };
        panel.contents.appendChild(showAllEntitiesCheckbox.elem);

        const showAllJSPNodesCheckbox = new UI.Checkbox('Show All JSP Nodes', this.renderHacks.showAllJSPNodes);
        showAllJSPNodesCheckbox.onchanged = () => { this.renderHacks.showAllJSPNodes = showAllJSPNodesCheckbox.checked; };
        panel.contents.appendChild(showAllJSPNodesCheckbox.elem);

        const frustumCullingCheckbox = new UI.Checkbox('Frustum Culling', this.renderHacks.frustumCulling);
        frustumCullingCheckbox.onchanged = () => { this.renderHacks.frustumCulling = frustumCullingCheckbox.checked; };
        panel.contents.appendChild(frustumCullingCheckbox.elem);

        panel.setVisible(true);
        return [panel];
    }
}