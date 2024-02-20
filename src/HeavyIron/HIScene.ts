import { CameraController } from "../Camera.js";
import { DataFetcher } from "../DataFetcher.js";
import { SceneContext } from "../SceneBase.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { HIEvent } from "./HIEvent.js";
import { HIBase } from "./HIBase.js";
import { HIFog } from "./HIFog.js";
import { HIDispatcher } from "./HIDispatcher.js";
import { HICamera } from "./HICamera.js";
import { HIEntSimpleObj } from "./HIEntSimpleObj.js";
import { HIEnt } from "./HIEnt.js";
import { HILightKit, HILightKitManager } from "./HILightKit.js";
import { HIEnv } from "./HIEnv.js";
import { HIModelAssetInfo, HIPipeInfoTable } from "./HIModel.js";
import { HIModelBucketManager } from "./HIModelBucket.js";
import { HIPAsset, HIPFile } from "./HIP.js";
import { HIPlatform } from "./HIPlatform.js";
import { HISkyDomeManager } from "./HISkyDome.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { strHash } from "./Util.js";
import { JSP } from "./JSP.js";
import { HIRenderState, HIRenderStateManager } from "./HIRenderState.js";
import { HIDebug } from "./HIDebug.js";
import { RpClump } from "./rw/rpworld.js";
import { RwEngine, RwTexture, RwStream, RwPluginID, RwTexDictionary } from "./rw/rwcore.js";
import { HIEntButton } from "./HIEntButton.js";
import { HIEntDestructObj } from "./HIEntDestructObj.js";
import { HINPCCommon } from "./HINPCCommon.js";
import { HIEntPlayer } from "./HIEntPlayer.js";

export const enum HIAssetType {
    ALST = 0x414C5354,
    ANIM = 0x414E494D,
    ATBL = 0x4154424C,
    ATKT = 0x41544B54,
    BINK = 0x42494E4B,
    BOUL = 0x424F554C,
    BSP  = 0x42535020,
    BUTN = 0x4255544E,
    CAM  = 0x43414D20,
    CCRV = 0x43435256,
    CNTR = 0x434E5452,
    COLL = 0x434F4C4C,
    COND = 0x434F4E44,
    CRDT = 0x43524454,
    CSN  = 0x43534E20,
    CSNM = 0x43534E4D,
    CSSS = 0x43535353,
    CTOC = 0x43544F43,
    DEST = 0x44455354,
    DPAT = 0x44504154,
    DSCO = 0x4453434F,
    DSTR = 0x44535452,
    DTRK = 0x4454524B,
    DUPC = 0x44555043,
    DYNA = 0x44594E41,
    EGEN = 0x4547454E,
    ENV  = 0x454E5620,
    FLY  = 0x464C5920,
    FOG  = 0x464F4720,
    GRSM = 0x4752534D,
    GRUP = 0x47525550,
    GUST = 0x47555354,
    HANG = 0x48414E47,
    JAW  = 0x4A415720,
    JSP  = 0x4A535020,
    LITE = 0x4C495445,
    LKIT = 0x4C4B4954,
    LOBM = 0x4C4F424D,
    LODT = 0x4C4F4454,
    MAPR = 0x4D415052,
    MINF = 0x4D494E46,
    MODL = 0x4D4F444C,
    MPHT = 0x4D504854,
    MRKR = 0x4D524B52,
    MVPT = 0x4D565054,
    NGMS = 0x4E474D53,
    NPC  = 0x4E504320,
    NPCS = 0x4E504353,
    ONEL = 0x4F4E454C,
    PARE = 0x50415245,
    PARP = 0x50415250,
    PARS = 0x50415253,
    PEND = 0x50454E44,
    PGRS = 0x50475253,
    PICK = 0x5049434B,
    PIPT = 0x50495054,
    PKUP = 0x504B5550,
    PLAT = 0x504C4154,
    PLYR = 0x504C5952,
    PORT = 0x504F5254,
    PRJT = 0x50524A54,
    RANM = 0x52414E4D,
    RAW  = 0x52415720,
    RWTX = 0x52575458,
    SCRP = 0x53435250,
    SDFX = 0x53444658,
    SFX  = 0x53465820,
    SGRP = 0x53475250,
    SHDW = 0x53484457,
    SHRP = 0x53485250,
    SIMP = 0x53494D50,
    SLID = 0x534C4944,
    SND  = 0x534E4420,
    SNDI = 0x534E4449,
    SNDS = 0x534E4453,
    SPLN = 0x53504C4E,
    SPLP = 0x53504C50,
    SSET = 0x53534554,
    SUBT = 0x53554254,
    SURF = 0x53555246,
    TEXS = 0x54455853,
    TEXT = 0x54455854,
    TIMR = 0x54494D52,
    TPIK = 0x5450494B,
    TRIG = 0x54524947,
    TRWT = 0x54525754,
    UI   = 0x55492020,
    UIFT = 0x55494654,
    UIM  = 0x55494D20,
    VIL  = 0x56494C20,
    VILP = 0x56494C50,
    VOLU = 0x564F4C55,
    WIRE = 0x57495245,
    ZLIN = 0x5A4C494E,
}

export class HIScene implements SceneGfx {
    private rw: RwEngine;

    public debug = new HIDebug();
    public hips: HIPFile[] = [];
    public textures = new Map<number, RwTexture>();
    public models = new Map<number, RpClump>();
    public modelInfos = new Map<number, HIModelAssetInfo>();
    public env: HIEnv;
    public camera: HICamera;
    public player: HIEntPlayer;
    public renderStateManager = new HIRenderStateManager();
    public lightKitManager = new HILightKitManager();
    public modelBucketManager = new HIModelBucketManager();
    public skydomeManager = new HISkyDomeManager();
    public baseList: HIBase[] = [];
    public entList: HIEnt[] = [];

    constructor(device: GfxDevice, context: SceneContext) {
        this.rw = new RwEngine(device, context);

        this.rw.textureFindCallback = (name, maskName) => {
            const id = strHash(name + ".RW3");
            return this.textures.get(id) || null;
        };

        this.camera = new HICamera();

        this.debug.eventLog.ignore.add(HIEvent.SceneBegin);
        this.debug.eventLog.ignore.add(HIEvent.RoomBegin);
        this.debug.eventLog.ignore.add(HIEvent.SceneEnter);
        this.debug.eventLog.ignore.add(HIEvent.LevelBegin);
    }

    public destroy(device: GfxDevice) {
        this.modelBucketManager.deinit();

        for (const [, model] of this.models) {
            model.destroy(this.rw);
        }

        for (const [, texture] of this.textures) {
            texture.destroy(this.rw);
        }

        this.rw.destroy();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.025);
    }

    public findAsset(id: number): HIPAsset | undefined {
        for (const hip of this.hips) {
            const asset = hip.findAsset(id);
            if (asset) {
                return asset;
            }
        }
        return undefined;
    }

    public findObject(id: number): HIBase | null {
        const obj = this.baseList.find((base: HIBase) => {
            return base.baseAsset.id == id;
        });
        return obj || null;
    }
    
    public sendEvent(to: HIBase, event: HIEvent, params?: number[] | ArrayBufferSlice, from?: HIBase) {
        this.debug.eventLog.push(this, to, event, from);

        if (event == HIEvent.Disable) {
            to.disable();
        } else if (event == HIEvent.Enable) {
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
                if (event !== link.srcEvent) {
                    continue;
                }
                if (link.chkAssetID !== 0 && (from === undefined || link.chkAssetID !== from.baseAsset.id)) {
                    continue;
                }

                const sendTo = this.findObject(link.dstAssetID);
                if (!sendTo) {
                    continue;
                }

                this.sendEvent(sendTo, link.dstEvent, link.param, to);
            }
        }

        this.debug.eventLog.pop(event);
    }

    public sendEventAll(event: HIEvent) {
        for (const base of this.baseList) {
            this.sendEvent(base, event);
        }
    }

    private async fetchHIP(dataFetcher: DataFetcher, path: string) {
        const idx = this.hips.length++;
        const buf = await dataFetcher.fetchData(path);
        this.hips[idx] = HIPFile.read(buf);
    }

    public async load(dataFetcher: DataFetcher, hipPaths: string[]): Promise<void> {
        for (const path of hipPaths) {
            this.fetchHIP(dataFetcher, path);
        }
        await dataFetcher.waitForLoad();

        const jsp = new JSP();
        const pipeTables: HIPipeInfoTable[] = [];

        for (const hip of this.hips) {
            for (const layer of hip.layers) {
                for (const asset of layer.assets) {
                    switch (asset.type) {
                    case HIAssetType.BUTN:
                        this.addEnt(new HIEntButton(new RwStream(asset.data)));
                        break;
                    case HIAssetType.DPAT:
                        this.addBase(new HIDispatcher(new RwStream(asset.data)));
                        break;
                    case HIAssetType.DSTR:
                        this.addEnt(new HIEntDestructObj(new RwStream(asset.data)));
                        break;
                    case HIAssetType.ENV:
                        this.env = new HIEnv(new RwStream(asset.data), jsp);
                        this.addBase(this.env);
                        break;
                    case HIAssetType.FOG:
                        this.addBase(new HIFog(new RwStream(asset.data)));
                        break;
                    case HIAssetType.JSP:
                        jsp.load(asset.data, this.rw);
                        break;
                    case HIAssetType.MINF:
                        this.modelInfos.set(asset.id, new HIModelAssetInfo(new RwStream(asset.data)));
                        break;
                    case HIAssetType.MODL:
                        this.loadModel(asset);
                        break;
                    case HIAssetType.PLYR:
                        this.player = new HIEntPlayer(new RwStream(asset.data));
                        break;
                    case HIAssetType.VIL:
                        this.addEnt(new HINPCCommon(new RwStream(asset.data)));
                        break;
                    case HIAssetType.PIPT:
                        pipeTables.push(new HIPipeInfoTable(new RwStream(asset.data)));
                        break;
                    case HIAssetType.PLAT:
                        this.addEnt(new HIPlatform(new RwStream(asset.data)));
                        break;
                    case HIAssetType.RWTX:
                        this.loadTexture(asset);
                        break;
                    case HIAssetType.SIMP:
                        this.addEnt(new HIEntSimpleObj(new RwStream(asset.data)));
                        break;
                    }
                }
            }
        }

        // There's a BOOT.HIP player and a level.HIP player, we only want the level.HIP player
        this.addEnt(this.player);

        this.loadPipeTables(pipeTables);

        this.setup();
        this.reset();

        //console.log(this.baseList);

        this.sendEventAll(HIEvent.SceneBegin);
        this.sendEventAll(HIEvent.RoomBegin);
        this.sendEventAll(HIEvent.SceneEnter);
        this.sendEventAll(HIEvent.LevelBegin);
    }

    private loadModel(asset: HIPAsset): boolean {
        if (asset.data.byteLength === 0) return true;

        const stream = new RwStream(asset.data);
        if (!stream.findChunk(RwPluginID.CLUMP)) {
            console.warn(`Clump not found in asset ${asset.name}`);
            return false;
        }

        const clump = RpClump.streamRead(stream, this.rw);
        if (!clump) return false;

        this.models.set(asset.id, clump);
        return true;
    }

    private loadTexture(asset: HIPAsset): boolean {
        if (asset.data.byteLength === 0) return true;
        
        const stream = new RwStream(asset.data);
        if (!stream.findChunk(RwPluginID.TEXDICTIONARY)) {
            console.warn(`Tex dictionary not found in asset ${asset.name}`);
            return false;
        }
    
        const texDict = RwTexDictionary.streamRead(stream, this.rw);
        if (!texDict) return false;
        
        this.textures.set(asset.id, texDict.textures[0]);
        return true;
    }

    private loadPipeTables(pipeTables: HIPipeInfoTable[]) {
        for (const [id, model] of this.models) {
            let remainSubObjBits = (1 << model.atomics.length) - 1;
            for (const pipt of pipeTables) {
                for (const pipe of pipt.data) {
                    if (pipe.modelHashID === id) {
                        const subObjBits = pipe.subObjectBits & remainSubObjBits;
                        if (subObjBits) {
                            let currSubObjBits = subObjBits;
                            for (let i = model.atomics.length-1; i >= 0; i--) {
                                if (currSubObjBits & 0x1) {
                                    this.modelBucketManager.insertBucket(model.atomics[i], pipe.pipeFlags);
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
                        this.modelBucketManager.insertBucket(model.atomics[i], 0);
                    }
                    remainSubObjBits >>>= 1;
                }
            }
        }
    }

    private setup() {
        for (const base of this.baseList) {
            base.setup(this);
        }
        
        if (this.env.envAsset.objectLightKit) {
            const lkitAsset = this.findAsset(this.env.envAsset.objectLightKit);
            if (lkitAsset) {
                const lkit = new HILightKit(lkitAsset.data, this.rw);
                for (const ent of this.entList) {
                    if (ent.model) {
                        ent.lightKit = lkit;
                    }
                }
            }
        }

        if (this.player.playerAsset.lightKitID) {
            const lkitAsset = this.findAsset(this.player.playerAsset.lightKitID);
            if (lkitAsset) {
                this.player.lightKit = new HILightKit(lkitAsset.data, this.rw);
            }
        }
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
        for (const ent of this.entList) {
            ent.update(this, viewerInput.deltaTime);
        }
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        this.update(viewerInput);

        this.camera.begin(this.rw);

        this.lightKitManager.enable(null, this.rw.world);

        this.renderStateManager.set(HIRenderState.SkyBack, this.camera, this.rw);
        this.skydomeManager.render(this.rw);

        this.renderStateManager.set(HIRenderState.Environment, this.camera, this.rw);
        this.env.render(this.rw);
        
        this.renderStateManager.set(HIRenderState.OpaqueModels, this.camera, this.rw);
        this.modelBucketManager.begin();
        for (const ent of this.entList) {
            this.lightKitManager.enable(ent.lightKit, this.rw.world);
            ent.render(this, this.rw);
        }
        this.modelBucketManager.renderOpaque(this, this.rw);

        this.renderStateManager.set(HIRenderState.AlphaModels, this.camera, this.rw);
        this.modelBucketManager.renderAlpha(this, this.rw);
        
        this.camera.end(this.rw);
        
        this.rw.render();
    }
}