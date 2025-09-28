import * as Viewer from '../viewer.js';
import * as F3DEX from "../BanjoKazooie/f3dex.js";
import * as RDP from '../Common/N64/RDP.js';

import { vec3, mat4, ReadonlyVec3 } from 'gl-matrix';
import { scaleMatrix } from '../MathHelpers.js';
import { BasicRspRenderer, Mk64RenderLayer } from './render.js';
import { Light1, MkRSPState } from './f3dex.js';
import { RSP_Geometry } from '../BanjoKazooie/f3dex.js';
import { GfxDevice, GfxMegaStateDescriptor, GfxTexture } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { CourseId } from './scenes.js';
import { drawWorldSpaceCircle, drawWorldSpaceText, getDebugOverlayCanvas2D } from '../DebugJunk.js';
import { Green, White } from '../Color.js';
import { Collision } from './collision.js';
import { BinAngleToRad, calcModelMatrix, IsTargetInRangeXYZ } from './utils.js';
import { Mk64Globals, Mk64Renderer } from './courses.js';
import { assert } from '../util.js';

export enum ActorType {
    Unused0x01 = 0x01,
    TreeMarioRaceway,
    TreeYoshiValley,
    TreeRoyalRaceway,
    FallingRock,
    Banana,
    GreenShell,
    RedShell,
    YoshiEgg,
    PiranhaPlant,
    Unknown0x0B,
    ItemBox,
    FakeItemBox,
    BananaBunch,
    TrainEngine,
    TrainTender,
    TrainPassengerCar,
    Cow,
    TreeMooMooFarm,
    Unknown0x14,
    TripleGreenShell,
    TripleRedShell,
    MarioSign,
    Unused0x18,
    PalmTree,
    TreeLuigiRaceway,
    Unused0x1B,
    TreePeachesCastle,
    TreeFrappeSnowland,
    Cactus1KalamariDesert,
    Cactus2KalamariDesert,
    Cactus3KalamariDesert,
    BushBowsersCastle,
    Unused0x21,
    WarioSign,
    Unused0x23,
    BoxTruck,
    PaddleBoat,
    RailroadCrossing,
    SchoolBus,
    TankerTruck,
    BlueSpinyShell,
    HotAirBalloonItemBox,
    Car,
    KiwanoFruit,

    //fake actor
    JungleTree,
    WaterBansheeBoardwalk,
}

export enum ActorFlags {
    RenderForP1 = 1 << 0,
    RenderForP2 = 1 << 1,
    RenderForP3 = 1 << 2,
    RenderForP4 = 1 << 3,

    IsHitByStar = 1 << 10,
    IsKilled = 1 << 11,
    IsDropableItem = 1 << 12,
    IsThrowable = 1 << 13,
    IsCollisionActive = 1 << 14,
    IsActive = 1 << 15,
}

const scratchVec3a = vec3.create();
const scratchRot = vec3.create();
const scratchPos = vec3.create();
const scratchMtx1 = mat4.create();
const scratchMtx2 = mat4.create();

export class Actor {
    public flags: ActorFlags = ActorFlags.IsActive;
    public state: number = 0;

    public pathRadius: number = 0;
    public boundingBoxSize: number = 0;

    public pos: vec3 = vec3.create();
    public rot: vec3 = vec3.create();
    public velocity: vec3 = vec3.create();

    public collision: Collision = new Collision();

    constructor(public type: ActorType, startingPos: ReadonlyVec3, startingRot: ReadonlyVec3) {
        //this.unk_04 = 0;
        this.state = 0;
        //this.unk_08 = 0.0;
        this.boundingBoxSize = 0.0;
        vec3.copy(this.pos, startingPos);
        vec3.copy(this.rot, startingRot);

        switch (type) {
            case ActorType.YoshiEgg:
                this.flags |= ActorFlags.IsCollisionActive;
                this.pathRadius = 70.0;
                this.boundingBoxSize = 20.0;
                this.velocity[0] = startingPos[0];
                this.velocity[1] = startingPos[1];
                this.velocity[2] = startingPos[2] + 70.0;
                break;

            case ActorType.KiwanoFruit:
                //this.state = 0;
                this.rot = vec3.fromValues(0, 0, 0);
                this.boundingBoxSize = 2.0;
                break;

            case ActorType.FallingRock:
                this.flags |= ActorFlags.IsCollisionActive;
                this.boundingBoxSize = 10.0;
                break;

            case ActorType.TrainEngine:
                this.pathRadius = 10.0;
                break;

            case ActorType.Banana:
                this.flags |= ActorFlags.IsCollisionActive | ActorFlags.IsDropableItem;
                this.boundingBoxSize = 2.0;
                break;

            case ActorType.GreenShell:
            case ActorType.RedShell:
                //gNumSpawnedShells += 1;
                //this.unk_04 = 0;
                this.boundingBoxSize = 4.0;
                this.flags |= ActorFlags.IsCollisionActive | ActorFlags.IsThrowable | ActorFlags.IsDropableItem;
                break;

            case ActorType.TreeMarioRaceway:
            case ActorType.TreeYoshiValley:
            case ActorType.TreeRoyalRaceway:
            case ActorType.TreeMooMooFarm:
            case ActorType.TreeLuigiRaceway:
            case ActorType.TreePeachesCastle:
            case ActorType.BushBowsersCastle:
            case ActorType.TreeFrappeSnowland:
                this.flags |= ActorFlags.IsCollisionActive;
                //this.state = 0x0043;
                this.boundingBoxSize = 3.0;
                this.pathRadius = 17.0;
                break;

            case ActorType.Cactus1KalamariDesert:
            case ActorType.Cactus2KalamariDesert:
            case ActorType.Cactus3KalamariDesert:
                this.flags |= ActorFlags.IsCollisionActive;
                //this.state = 0x0019;
                this.boundingBoxSize = 3.0;
                this.pathRadius = 7.0;
                break;

            case ActorType.JungleTree:
            case ActorType.PalmTree:
                this.flags |= ActorFlags.IsCollisionActive;
                //this.state = 0x003C;
                this.boundingBoxSize = 3.0;
                this.pathRadius = 13.0;
                break;

            case ActorType.FakeItemBox:
                this.flags |= ActorFlags.IsCollisionActive | ActorFlags.IsDropableItem;
                this.pathRadius = 0.35;
                this.boundingBoxSize = 1.925;
                this.collision.checkBoundingCollision(this.boundingBoxSize, this.pos);
                break;

            case ActorType.HotAirBalloonItemBox:
                this.flags |= ActorFlags.IsCollisionActive;
                //this.unk_04 = 0;
                this.state = 5;
                this.boundingBoxSize = 5.5 * 3.0;
                break;
            case ActorType.ItemBox:
                this.flags |= ActorFlags.IsCollisionActive;
                //this.unk_04 = 0;
                this.state = 0;
                this.boundingBoxSize = 5.5 * 3.3;
                break;

            case ActorType.PiranhaPlant:
                this.flags |= ActorFlags.IsCollisionActive;
                //this.state = 0x001E;
                this.boundingBoxSize = 5.0;
                break;

            default:
                break;
        }
    }

    public init(globals: Mk64Globals): void { }

    public update(deltaTimeFrames: number): void { }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void { }

    public setShadowMtx(dst: mat4, scale: number, pos: vec3 = this.pos, rot: vec3 = this.rot): void {
        pos[1] += 2;

        calcModelMatrix(dst, pos, rot, scale);

        pos[1] -= 2;
    }
}

abstract class ActorTree extends Actor {
    protected tree: BasicRspRenderer;
    protected treeShadow: BasicRspRenderer;

    protected abstract treeMeshOffs: number;
    protected abstract shadowScale: number;

    public override init(globals: Mk64Globals): void {

        // Load palette
        F3DEX.runDL_F3DEX(globals.rspState, 0x0D05BAC8);

        this.tree = globals.initRendererFromDL(this.treeMeshOffs, true);
        this.treeShadow = globals.commonShadowMdl;
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.setShadowMtx(scratchMtx1, this.shadowScale);
        this.treeShadow.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

        calcModelMatrix(scratchMtx1, this.pos, [0, 0, 0]);
        this.tree.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }
}

export class ActorCactus1 extends ActorTree {
    protected treeMeshOffs = 0x06008528;
    protected shadowScale = 1;
}

export class ActorCactus2 extends ActorTree {
    protected treeMeshOffs = 0x06008628;
    protected shadowScale = 1;
}

export class ActorCactus3 extends ActorTree {
    protected treeMeshOffs = 0x06008728;
    protected shadowScale = 0.8;
}

export class ActorSnowTree extends ActorTree {
    protected treeMeshOffs = 0x060075A0;
    protected shadowScale = 2.8;
}

export class ActorRoyalRacewayTree extends ActorTree {
    protected treeMeshOffs = 0x0600D4A0;
    protected shadowScale = 2.8;
}

export class ActorPeachCastleTree extends ActorTree {
    protected treeMeshOffs = 0x0600D578;
    protected shadowScale = 2.8;
}

export class ActorMarioTree extends ActorTree {
    protected treeMeshOffs = 0x06006A68;
    protected shadowScale = 3;
}

export class ActorLuigiTree extends ActorTree {
    protected treeMeshOffs = 0x0600FC70;
    protected shadowScale = 2.8;
}

export class ActorMooMooFarmTree extends ActorTree {
    protected treeMeshOffs = 0x06013F20;
    protected shadowScale = 5;
}

export class ActorBowsersCastleBush extends ActorTree {
    protected treeMeshOffs = 0x060090C8;
    protected shadowScale = 2.8;
}

export class ActorYoshiTree extends ActorTree {
    protected treeMeshOffs = 0x06015B48;
    protected shadowScale = 2.8;
}

enum ItemBoxState {
    BeginReset = 0,
    Resetting = 1,
    Idle = 2,
    Shattering = 3,
    IdleFloating = 5,
}

export class ActorItemBox extends Actor {
    public origY: number = 0;
    public respawnTimer: number = 0;
    public resetDistance: number = 0;

    private shadowMdl: BasicRspRenderer;
    private mainBoxMdl: BasicRspRenderer;

    private questionMarkMdl: BasicRspRenderer;
    private boxShardModels: BasicRspRenderer[] = []
    private static readonly boxShardVectors: vec3[] = [
        vec3.fromValues(0.0, 2.0, 1.0),
        vec3.fromValues(0.8, 2.3, 0.5),
        vec3.fromValues(0.8, 1.2, -0.5),
        vec3.fromValues(0.0, 1.8, -1.0),
        vec3.fromValues(-0.8, 0.6, -0.5),
        vec3.fromValues(-0.8, 2.0, 0.5),
    ];

    private gfxRenderModeOpa: Partial<GfxMegaStateDescriptor>;
    private gfxRenderModeCld: Partial<GfxMegaStateDescriptor>;

    public override init(globals: Mk64Globals): void {

        this.gfxRenderModeCld = RDP.translateRenderMode(RDP.RENDER_MODES.G_RM_ZB_CLD_SURF | RDP.RENDER_MODES.G_RM_ZB_CLD_SURF2);
        this.gfxRenderModeOpa = RDP.translateRenderMode(RDP.RENDER_MODES.G_RM_AA_ZB_OPA_SURF | RDP.RENDER_MODES.G_RM_AA_ZB_OPA_SURF2);

        globals.rspState.gSPSetGeometryMode(RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);

        this.questionMarkMdl = globals.initRendererFromDL(0x0D003008, false, Mk64RenderLayer.ItemBoxes);
        this.shadowMdl = globals.initRendererFromDL(0x0D002EE8, false, Mk64RenderLayer.ItemBoxes);
        this.mainBoxMdl = globals.initRendererFromDL(0x0D003090, false, Mk64RenderLayer.ItemBoxes);

        globals.rspState.gSPClearGeometryMode(RSP_Geometry.G_CULL_BACK | RSP_Geometry.G_CULL_FRONT);
        this.boxShardModels = [
            globals.initRendererFromDL(0x0D003158, false, Mk64RenderLayer.ItemBoxes),
            globals.initRendererFromDL(0x0D0031B8, false, Mk64RenderLayer.ItemBoxes),
            globals.initRendererFromDL(0x0D003128, false, Mk64RenderLayer.ItemBoxes),
            globals.initRendererFromDL(0x0D0031E8, false, Mk64RenderLayer.ItemBoxes),
            globals.initRendererFromDL(0x0D003188, false, Mk64RenderLayer.ItemBoxes),
            globals.initRendererFromDL(0x0D0030F8, false, Mk64RenderLayer.ItemBoxes)
        ];
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        if (this.state === ItemBoxState.Idle) {
            vec3.set(scratchRot, 0, this.rot[1], 0);
            vec3.set(scratchPos, this.pos[0], this.resetDistance + 2, this.pos[2]);
            calcModelMatrix(scratchMtx1, scratchPos, scratchRot);

            this.shadowMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

            scratchRot[1] = this.rot[1] * 2;
            scratchPos[1] = this.pos[1];
            calcModelMatrix(scratchMtx1, scratchPos, scratchRot);
            this.questionMarkMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }
        else if (this.state === ItemBoxState.IdleFloating) {
            calcModelMatrix(scratchMtx1, this.pos, this.rot);
            this.questionMarkMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }

        if (this.state !== ItemBoxState.Shattering) {
            calcModelMatrix(scratchMtx1, this.pos, this.rot);

            const rotY = this.rot[1] & 0xFFFF;
            if ((rotY > 0 && rotY < 0x0AA1) ||
                (rotY >= 0x6AA5 && rotY < 0x754E) ||
                (rotY >= 0x38E1 && rotY < 0x438A) ||
                (rotY >= 0xC711 && rotY < 0xD1BA)) {
                this.mainBoxMdl.setRenderMode(this.gfxRenderModeOpa);
            }
            else {
                this.mainBoxMdl.setRenderMode(this.gfxRenderModeCld);
            }

            this.mainBoxMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        } else {
            let scale = 1.0;

            const time = this.respawnTimer;
            const baseMtx = calcModelMatrix(scratchMtx1, this.pos, this.rot);
            const renderMode = (Math.floor(time) & 1) ? this.gfxRenderModeOpa : this.gfxRenderModeCld;

            if (time > 10) {
                scale = (1.0 - ((time - 10.0) * 0.1));
            }
            scaleMatrix(baseMtx, baseMtx, scale);
            mat4.copy(scratchMtx2, baseMtx);
            for (let i = 0; i < this.boxShardModels.length; i++) {
                const shardModel = this.boxShardModels[i];
                const posScale = ActorItemBox.boxShardVectors[i];
                shardModel.setRenderMode(renderMode);

                vec3.scale(scratchVec3a, posScale, time);
                scratchMtx2[12] = baseMtx[12] + scratchVec3a[0];
                scratchMtx2[13] = baseMtx[13] + scratchVec3a[1];
                scratchMtx2[14] = baseMtx[14] + scratchVec3a[2];
                shardModel.prepareToRender(renderInstManager, viewerInput, scratchMtx2);
            }
        }

        if (viewerInput.deltaTime !== 0) {
            mat4.getTranslation(scratchPos, viewerInput.camera.worldMatrix);

            const verticalDist = Math.abs(this.pos[1] - scratchPos[1]);

            if (this.state === ItemBoxState.Idle || this.state === ItemBoxState.IdleFloating) {
                if (verticalDist < 20 && IsTargetInRangeXYZ(scratchPos, this.pos, this.boundingBoxSize)) {
                    this.state = ItemBoxState.Shattering;
                }
            }
        }
    }

    public override update(deltaTimeFrames: number): void {
        if (this.type === ActorType.ItemBox) {
            switch (this.state) {
                case ItemBoxState.BeginReset:
                    this.state = ItemBoxState.Resetting;
                    break;

                case ItemBoxState.Resetting:
                    if ((this.pos[1] - this.origY) < 8.66) {
                        this.pos[1] += 0.45 * deltaTimeFrames;
                    } else {
                        this.state = ItemBoxState.Idle;
                        this.flags = ActorFlags.IsActive | ActorFlags.IsCollisionActive;
                        this.pos[1] = this.origY + 8.66;
                    }
                    break;

                case ItemBoxState.Idle:
                    this.rot[0] += 0xB6 * deltaTimeFrames;
                    this.rot[1] -= 0x16C * deltaTimeFrames;
                    this.rot[2] += 0xB6 * deltaTimeFrames;
                    break;

                case ItemBoxState.Shattering:
                    if (this.respawnTimer >= 20) {
                        this.respawnTimer = 0; // where is this reset in-game?

                        this.state = ItemBoxState.BeginReset;
                        this.flags = ActorFlags.IsActive | ActorFlags.IsCollisionActive;
                        this.pos[1] = this.resetDistance - 20.0;
                    } else {
                        this.respawnTimer += deltaTimeFrames;
                        this.rot[0] += 0x444 * deltaTimeFrames;
                        this.rot[1] -= 0x2D8 * deltaTimeFrames;
                        this.rot[2] += 0x16C * deltaTimeFrames;
                    }
                    break;
            }
        } else {
            switch (this.state) {
                case ItemBoxState.IdleFloating:
                    this.rot[0] += 0xB6 * deltaTimeFrames;
                    this.rot[1] -= 0x16C * deltaTimeFrames;
                    this.rot[2] += 0xB6 * deltaTimeFrames;
                    break;

                case ItemBoxState.Shattering:
                    if (this.respawnTimer >= 20) {
                        this.respawnTimer = 0;

                        this.state = ItemBoxState.IdleFloating;
                        this.flags = ActorFlags.IsCollisionActive;
                    } else {
                        this.respawnTimer += deltaTimeFrames;
                        this.rot[0] += 0x444 * deltaTimeFrames;
                        this.rot[1] -= 0x2D8 * deltaTimeFrames;
                        this.rot[2] += 0x16C * deltaTimeFrames;
                    }
                    break;
            }
        }
    }
}

export class ActorMarioSign extends Actor {
    private signModel: BasicRspRenderer;

    public override init(globals: Mk64Globals): void {
        this.signModel = globals.initRendererFromDL(0x06009820, false);
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.flags & ActorFlags.IsKilled) {
            return;
        }

        calcModelMatrix(scratchMtx1, this.pos, this.rot);
        this.signModel.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }

    public override update(deltaTimeFrames: number): void {
        if ((this.flags & ActorFlags.IsKilled) === 0) {
            if ((this.flags & ActorFlags.IsHitByStar) !== 0) {

                this.pos[1] += (4 * deltaTimeFrames);

                if (this.pos[1] > 800) {
                    this.flags |= ActorFlags.IsKilled;
                    this.rot[1] += (1820 * deltaTimeFrames);
                }
            } else {
                this.rot[1] += (182 * deltaTimeFrames);
            }
        }
    }
}

export class ActorPiranhaPlant extends Actor {
    private piranhaPlantMesh: BasicRspRenderer;

    private timer: number = 0;
    private isPlayerNearby: boolean = false;
    private gfxAnimTextures: GfxTexture[] = [];

    public override init(globals: Mk64Globals): void {

        const isMarioRaceway = globals.courseId === CourseId.MarioRaceway;

        if (isMarioRaceway) {
            this.piranhaPlantMesh = globals.initRendererFromDL(0x06009840, true);
        }
        else {
            this.piranhaPlantMesh = globals.initRendererFromDL(0x0600E108, true);
        }

        const baseTexAddr = isMarioRaceway ? 0x9800 : 0xA000;
        const dramPalAddr = isMarioRaceway ? 0x06006750 : 0x0600D610;

        const drawCallInst = this.piranhaPlantMesh.drawCallInstances[0];
        const tex0 = drawCallInst.textureEntry[0];

        for (let i = 0; i < 9; i++) {

            const dramAddr = 0x03000000 + (baseTexAddr + (i << 0xB));

            this.gfxAnimTextures.push(globals.getGfxTexture(dramAddr, dramPalAddr, tex0.tile));
        }
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.flags & ActorFlags.IsKilled) {
            return;
        }

        let animFrame: number = 0;

        mat4.getTranslation(scratchPos, viewerInput.camera.worldMatrix);
        const distToCamera: number = vec3.sqrDist(scratchPos, this.pos);

        if (distToCamera < 90000) {

            this.isPlayerNearby = true;
            animFrame = Math.floor(this.timer / 6);

            if (animFrame > 8) {
                animFrame = 8;
            }
        } else {
            this.isPlayerNearby = false;
        }

        this.setAnimTexture(animFrame);
        calcModelMatrix(scratchMtx1, this.pos, this.rot);
        this.piranhaPlantMesh.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }

    public override update(deltaTimeFrames: number): void {
        if (!(this.flags & ActorFlags.IsKilled)) {
            if ((this.flags & ActorFlags.IsHitByStar) !== 0) {
                this.pos[1] += 4 * deltaTimeFrames;
                if (this.pos[1] > 800) {
                    this.flags |= ActorFlags.IsKilled;
                }
            } else {
                if (this.isPlayerNearby) {
                    this.timer += deltaTimeFrames;
                    if (this.timer > 60) {
                        this.timer = 6;
                    }
                } else {
                    this.timer = 0;
                }
            }
        }
    }

    private setAnimTexture(texIndex: number): void {
        for (const drawcall of this.piranhaPlantMesh.drawCallInstances) {
            drawcall.textureMappings[0].gfxTexture = this.gfxAnimTextures[texIndex];
        }
    }
}

export class ActorCow extends Actor {
    private cowModels: BasicRspRenderer[] = [];
    public cowType: number = 0;

    public override init(globals: Mk64Globals): void {

        const cowMdlOffsets: number[] = [0x13C00, 0x13CA0, 0x13D20, 0x13DA0, 0x13E20];

        for (let i = 0; i < cowMdlOffsets.length; i++) {
            this.cowModels.push(globals.initRendererFromDL(0x06000000 + cowMdlOffsets[i], true));
        }
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.cowType >= this.cowModels.length) {
            return;
        }

        calcModelMatrix(scratchMtx1, this.pos, this.rot);
        this.cowModels[this.cowType].prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }
}

export class ActorPalmTree extends Actor {
    public treeType: number = 0;
    public treeShadow: BasicRspRenderer;

    private treeVariants: BasicRspRenderer[] = [];

    private static readonly trunkOffsets: number[] = [0x186B8, 0x18A08, 0x18D58];
    private static readonly frondsOffsets: number[] = [0x185F8, 0x18948, 0x18C98];

    public override init(globals: Mk64Globals): void {
        const rspState = globals.rspState;

        for (let i = 0; i < 3; i++) {

            rspState.gSPClearGeometryMode(RSP_Geometry.G_SHADE);
            rspState.gSPSetGeometryMode(RSP_Geometry.G_LIGHTING | RSP_Geometry.G_CULL_BACK);
            F3DEX.runDL_F3DEX(rspState, 0x06000000 + ActorPalmTree.trunkOffsets[i]);

            rspState.gSPClearGeometryMode(RSP_Geometry.G_SHADE | RSP_Geometry.G_CULL_BACK);
            rspState.gSPSetGeometryMode(RSP_Geometry.G_LIGHTING);
            this.treeVariants.push(globals.initRendererFromDL(0x06000000 + ActorPalmTree.frondsOffsets[i]));
        }

        this.treeShadow = globals.commonShadowMdl;
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.treeType >= this.treeVariants.length) {
            return;
        }

        this.setShadowMtx(scratchMtx1, 2);
        this.treeShadow.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

        vec3.zero(scratchRot);
        calcModelMatrix(scratchMtx1, this.pos, scratchRot);
        this.treeVariants[this.treeType].prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }
}

export class ActorJungleTree extends Actor {
    public treeType: number = 0;
    public treeShadow: BasicRspRenderer;
    private treeVariants: BasicRspRenderer[] = [];

    public override init(globals: Mk64Globals): void {
        const treeOffsets: number[] = [0x10CC0, 0x11DC8, 0x12EF0, 0x138D0];

        globals.rspState.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
        globals.rspState.gDPSetCombine(0xFC127E24, 0xFFFFF3F9);//G_CC_MODULATEIDECALA
        globals.rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_AA_ZB_TEX_EDGE, RDP.RENDER_MODES.G_RM_AA_ZB_TEX_EDGE2);

        for (let i = 0; i < treeOffsets.length; i++) {
            this.treeVariants[i] = globals.initRendererFromDL(0x06000000 + treeOffsets[i], true);
        }
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if ((this.flags & ActorFlags.IsKilled) !== 0) {
            return;
        }

        vec3.zero(scratchRot);
        calcModelMatrix(scratchMtx1, this.pos, scratchRot);

        switch (this.treeType & 0xF) {
            case 0:
                this.treeVariants[0].prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                break;
            case 4:
                this.treeVariants[1].prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                break;
            case 5:
                this.treeVariants[2].prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                break;
            case 6:
                this.treeVariants[3].prepareToRender(renderInstManager, viewerInput, scratchMtx1);
                break;
        }
    }

    public override update(deltaTimeFrames: number): void {
        if ((this.flags & ActorFlags.IsHitByStar) !== 0) {
            this.pos[1] += 0xA * deltaTimeFrames;
            if (this.pos[1] > 0x321) {
                this.flags |= ActorFlags.IsKilled;
            }
        }
    }
}

export class ActorYoshiEgg extends Actor {
    private eggModel: BasicRspRenderer;
    private eggShadow: BasicRspRenderer;

    private eggRot: number = 0;
    private pathRot: number = 0;
    private pathCenter: vec3 = vec3.create();

    public override init(globals: Mk64Globals): void {
        globals.rspState.gSPSetGeometryMode(RSP_Geometry.G_LIGHTING | RSP_Geometry.G_SHADING_SMOOTH);
        this.eggRot = this.rot[1];
        this.pathCenter = this.velocity;

        const eggLight = Light1.InitLight(255, 254, 254, 100, 100, 100, 0, 0, 120);
        eggLight.setLightDirectionFromAngles(-0x38F0, 0x1C70);

        this.eggModel = globals.initRendererFromDL(0x06000000 + 0x16D70);
        this.eggModel.setLight(eggLight);

        this.eggShadow = globals.commonShadowMdl;
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        vec3.set(scratchVec3a, this.pos[0], 3, this.pos[2]);
        vec3.set(scratchRot, 0x4000, 0, 0);

        this.setShadowMtx(scratchMtx1, 10, scratchVec3a, scratchRot);
        this.eggShadow.prepareToRender(renderInstManager, viewerInput, scratchMtx1);

        vec3.set(scratchRot, 0, this.eggRot, 0);
        calcModelMatrix(scratchMtx1, this.pos, scratchRot);
        this.eggModel.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }

    public override update(deltaTimeFrames: number): void {
        this.pathRot += (0x5B * deltaTimeFrames);

        this.pos[0] = this.pathCenter[0] + (Math.sin(this.pathRot * BinAngleToRad) * 70);
        this.pos[2] = this.pathCenter[2] + (Math.cos(this.pathRot * BinAngleToRad) * 70);

        if ((this.flags & ActorFlags.IsHitByStar) !== 0) {

            this.pathCenter[1] -= 0.12;

            if (this.pathCenter[1] < -3) {
                this.pathCenter[1] = -3;
            }

            this.pos[1] += this.pathCenter[1] * deltaTimeFrames;

            if (this.pos[1] < 0) {
                this.pos[1] = 0;
                this.pathCenter[1] = 0;
                this.flags &= ~ActorFlags.IsHitByStar;
            }
            this.eggRot -= (0x4FA * deltaTimeFrames);
        }

        this.eggRot -= (0x222 * deltaTimeFrames);
    }
}

export class ActorCrossbuck extends Actor {
    private rightLightActiveMdl: BasicRspRenderer;
    private leftLightActiveMdl: BasicRspRenderer;
    private bothLightInactiveMdl: BasicRspRenderer;

    public isTrainNearby: boolean = false;
    private timer = 0;

    public override init(globals: Mk64Globals): void {
        this.rightLightActiveMdl = globals.initRendererFromDL(0x06023478);
        this.leftLightActiveMdl = globals.initRendererFromDL(0x060234A8);
        this.bothLightInactiveMdl = globals.initRendererFromDL(0x060234D8);
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        calcModelMatrix(scratchMtx1, this.pos, this.rot);

        if (this.isTrainNearby) {
            if (this.timer < 20) {
                this.rightLightActiveMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            } else {
                this.leftLightActiveMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
            }
        } else {
            this.bothLightInactiveMdl.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }
    }

    public override update(deltaTimeFrames: number): void {
        if (this.isTrainNearby) {
            this.timer += deltaTimeFrames;

            if (this.timer > 40) {
                this.timer = 1;
            }
        }
    }
}

export class ActorWarioSign extends Actor {
    private signModel: BasicRspRenderer;

    public override init(globals: Mk64Globals): void {
        this.signModel = globals.initRendererFromDL(0x0600CD38);
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {

        calcModelMatrix(scratchMtx1, this.pos, this.rot);
        this.signModel.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }

    public override update(deltaTimeFrames: number): void {
        this.rot[1] += 0xB6 * deltaTimeFrames;
    }
}

const scratchNormal = vec3.create();
export class ActorFallingRock extends Actor {
    public originalPos: vec3 = vec3.create();
    public respawnTimer: number = 0;
    public rockIndex: number = 0;

    private respawnTimers: number[] = [60, 120, 180];
    private rockModel: BasicRspRenderer;
    private shadowModel: BasicRspRenderer;

    public override init(globals: Mk64Globals): void {
        this.rockModel = globals.initRendererFromDL(0x06006FE0);

        globals.rspState.gSPSetGeometryMode(RSP_Geometry.G_FOG);
        this.shadowModel = globals.initRendererFromDL(0x06006F88);
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.respawnTimer !== 0) {
            return;
        }

        if (this.collision.hasCollisionY) {
            const height = this.collision.calculateSurfaceHeight(this.pos[0], this.pos[1], this.pos[2], this.collision.nearestTriIndexY);

            vec3.set(scratchPos, this.pos[0], height + 2, this.pos[2]);
            vec3.set(scratchRot, 0, 0, 0);
            calcModelMatrix(scratchMtx1, scratchPos, scratchRot);
            this.shadowModel.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
        }

        calcModelMatrix(scratchMtx1, this.pos, this.rot);
        this.rockModel.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }

    public override update(deltaTimeFrames: number): void {
        let distance: number;

        if (this.respawnTimer > 0) {
            this.respawnTimer -= deltaTimeFrames;

            if (this.respawnTimer > 0)
                return;

            this.respawnTimer = 0;
        }

        if (this.pos[1] < -80) {
            this.respawnTimer = this.respawnTimers[this.rockIndex];
            vec3.copy(this.pos, this.originalPos);
            vec3.set(this.velocity, 0, 0, 0);
            vec3.set(this.rot, 0, 0, 0);
        }

        // rotate rock
        this.rot[0] += ((this.velocity[2] * 0x1555) / 20) * deltaTimeFrames;
        this.rot[2] += ((this.velocity[0] * 0x1555) / 20) * deltaTimeFrames;

        //gravity
        this.velocity[1] = Math.max(this.velocity[1] - (0.1 * deltaTimeFrames), -2);
        vec3.scaleAndAdd(this.pos, this.pos, this.velocity, deltaTimeFrames);

        let prevVelocityY = this.velocity[1];
        this.collision.checkBoundingCollision(this.boundingBoxSize, this.pos);

        if ((distance = this.collision.surfaceDistY) < 0.0) {
            vec3.negate(scratchNormal, this.collision.normalY);
            vec3.scaleAndAdd(this.pos, this.pos, scratchNormal, distance);
            this.rockBounce(scratchNormal, distance, this.velocity, 2);
            this.velocity[1] = -1.2 * prevVelocityY;
        }

        if ((distance = this.collision.surfaceDistZ) < 0.0) {
            scratchNormal[1] = -this.collision.normalZ[1];
            if (scratchNormal[1] === 0.0) {
                this.velocity[1] *= -1.2;
                return;
            } else {
                scratchNormal[0] = -this.collision.normalZ[0];
                scratchNormal[2] = -this.collision.normalZ[2];
                vec3.scaleAndAdd(this.pos, this.pos, scratchNormal, distance);
                this.rockBounce(scratchNormal, distance, this.velocity, 2.0);
                this.velocity[1] = -1.2 * prevVelocityY;
            }
        }

        if ((distance = this.collision.surfaceDistX) < 0.0) {
            scratchNormal[1] = -this.collision.normalX[1];
            if (scratchNormal[1] === 0.0) {
                this.velocity[1] *= -1.2;
            } else {
                scratchNormal[0] = -this.collision.normalX[0];
                scratchNormal[2] = -this.collision.normalX[2];
                vec3.scaleAndAdd(this.pos, this.pos, scratchNormal, distance);
                prevVelocityY = this.velocity[1];
                this.rockBounce(scratchNormal, distance, this.velocity, 2.0);
                this.velocity[1] = -1.2 * prevVelocityY;
            }
        }
    }

    private rockBounce(normal: vec3, distance: number, velocity: vec3, _unk: number): void {
        const dot = vec3.dot(normal, velocity);
        vec3.scaleAndAdd(scratchVec3a, velocity, normal, -dot);

        if (distance < -3.5) {
            vec3.scaleAndAdd(velocity, scratchVec3a, normal, -dot * 0.5);
        } else {
            vec3.copy(velocity, scratchVec3a);
        }
    }
}

export class DebugActor extends Actor {

    public override init(globals: Mk64Globals): void {
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, ActorType[this.type], 0, White, { outline: 6 });
        drawWorldSpaceCircle(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.pos, 1, vec3.fromValues(0, 1, 0), Green);
    }
}

export class ActorWaterBanshee extends Actor {
    private signModel: BasicRspRenderer;

    public override init(globals: Mk64Globals): void {
        //globals.rspState.gDPSetCombine(0xFC121624, 0xff2fffff);
        //globals.rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_AA_ZB_TEX_EDGE, RDP.RENDER_MODES.G_RM_AA_ZB_TEX_EDGE2);

        this.signModel = globals.initRendererFromDL(0x0600B278);
        vec3.set(this.pos, -1500, 70, -300);//map center
    }

    public override prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        mat4.getTranslation(scratchPos, viewerInput.camera.worldMatrix);
        scratchPos[1] = -82;

        calcModelMatrix(scratchMtx1, scratchPos, [0, 0, 0], 1);
        this.signModel.prepareToRender(renderInstManager, viewerInput, scratchMtx1);
    }
}