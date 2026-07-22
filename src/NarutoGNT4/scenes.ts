import { SceneGroup } from "../viewer.js";
import { HSD_AnimJointRoot, HSD_AObjLoadAnimJoint, HSD_AObjLoadMatAnimJoint, HSD_Archive, HSD_Archive__ResolvePtr, HSD_ArchiveParse, HSD_JObjLoadJoint, HSD_LoadContext, HSD_LoadContext__ResolvePtr, HSD_MatAnimJointRoot } from "../SYSDOLPHIN/SYSDOLPHIN.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assertExists } from "../util.js";
import { SceneContext, SceneDesc } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { MeleeRenderer } from "../SuperSmashBrosMelee/Scenes_SuperSmashBrosMelee.js";
import { HSD_JObjRoot_Instance } from "../SYSDOLPHIN/SYSDOLPHIN_Render.js";
import { mat4 } from "gl-matrix";
import { FPack } from "./fpack.js";

const pathBase = "NarutoGNT4";

class NarutoMapDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;

        //read fpack and get all hsd archives (.dat)
        const fpackData = await dataFetcher.fetchData(`${pathBase}/${this.id}.fpk`);
        const fpack = new FPack(fpackData);

        const datEntries = fpack.entries.filter((v) => {return v.path.endsWith(".dat")});

        const datDatas: ArrayBufferSlice[] = [];
        datEntries.forEach((v) => {datDatas.push(fpack.getEntryData(v))});

        const hsdArchives: HSD_Archive[] = [];
        datDatas.forEach((v) => {hsdArchives.push(HSD_ArchiveParse(v))});

        const renderer = new NarutoMapRenderer(device, hsdArchives, this.id.includes("stg"));
        return renderer;
    }
}

class NarutoMapRenderer extends MeleeRenderer {
    isStage: boolean

    constructor(device: GfxDevice, public modelArchives: HSD_Archive[], isStage: boolean = false) {
        super(device);

        this.isStage = isStage;

        for (const modelArchive of modelArchives) {
            this.loadModel(modelArchive);
        }
    }

    public getDefaultWorldMatrix(dst: mat4) {
        if (this.isStage) {
            mat4.fromTranslation(dst, [0,30,30]);
        }
    }

    loadModel(archive: HSD_Archive) {
        const ctx = new HSD_LoadContext(archive);
        const arc = ctx.archive;

        const scene_data_global = arc.publics[0];

        const scene_data = HSD_Archive__ResolvePtr(arc, scene_data_global.offset).createDataView();

        const jobjDescs = HSD_LoadContext__ResolvePtr(ctx, scene_data.getUint32(0x00)).createDataView();
        const jobjDesc = HSD_LoadContext__ResolvePtr(ctx, jobjDescs.getUint32(0x00)).createDataView();

        //get root joint
        const rootJointData = HSD_LoadContext__ResolvePtr(ctx, jobjDesc.getUint32(0x00), 0x40);
        const rootJoint = assertExists(HSD_JObjLoadJoint(ctx, rootJointData));
        const rootJointInstance = new HSD_JObjRoot_Instance(this.modelCache.loadJObjRoot(rootJoint));

        //get joint animation
        let jointAnimation: HSD_AnimJointRoot | null = null;

        const jointAnimationsOffset = jobjDesc.getUint32(0x04);
        if (jointAnimationsOffset > 0) {
            const jointAnimationsPtr = HSD_LoadContext__ResolvePtr(ctx, jointAnimationsOffset);
            const jointAnimationPtr = HSD_LoadContext__ResolvePtr(ctx, jointAnimationsPtr.createDataView().getUint32(0x00));
            jointAnimation = jointAnimationPtr ? HSD_AObjLoadAnimJoint(ctx, jointAnimationPtr) : null;
        }

        //get material animation
        let materialAnimation: HSD_MatAnimJointRoot | null = null;

        const materialAnimationsOffset = jobjDesc.getUint32(0x08);
        if (materialAnimationsOffset > 0) {
            const materialAnimationsPtr = HSD_LoadContext__ResolvePtr(ctx, materialAnimationsOffset);
            const materialAnimationPtr = HSD_LoadContext__ResolvePtr(ctx, materialAnimationsPtr.createDataView().getUint32(0x00));
            materialAnimation = materialAnimationPtr ? HSD_AObjLoadMatAnimJoint(ctx, materialAnimationPtr) : null;
        }

        //add root joint with animations
        if (jointAnimation || materialAnimation) {
            rootJointInstance.addAnimAll(jointAnimation, materialAnimation, null);
        }

        this.jobjRoots.push(rootJointInstance);
    }
}

const sceneDescs = [
    "Stages",
    new NarutoMapDesc("fpack/stg/0010000", "Amid Toads"),
    new NarutoMapDesc("fpack/stg/0090000", "Amid Toads 2"),
    new NarutoMapDesc("fpack/stg/0020000", "Academy - Rooftop (Day)"),
    new NarutoMapDesc("fpack/stg/0100000", "Academy - Rooftop (Night)"),
    new NarutoMapDesc("fpack/stg/0110000", "Ichiraku Ramen Shop (Evening)"),
    new NarutoMapDesc("fpack/stg/0030000", "Ichiraku Ramen Shop (Night)"),
    new NarutoMapDesc("fpack/stg/0040000", "Konoha Gate (Day)"),
    new NarutoMapDesc("fpack/stg/0120000", "Konoha Gate (Night)"),
    new NarutoMapDesc("fpack/stg/0130000", "Academy - Schoolyard (Day)"),
    new NarutoMapDesc("fpack/stg/0050000", "Academy - Schoolyard (Night)"),
    new NarutoMapDesc("fpack/stg/0070000", "Great Naruto Bridge - Under Construction"),
    new NarutoMapDesc("fpack/stg/0080000", "Great Naruto Bridge - Mist"),
    new NarutoMapDesc("fpack/stg/0140000", "The Forest of Death (Day)"),
    new NarutoMapDesc("fpack/stg/0060000", "The Forest of Death (Night)"),
    new NarutoMapDesc("fpack/stg/0180000", "The Forest of Death - Training Ground 44"),
    new NarutoMapDesc("fpack/stg/0150000", "Chunin Exams - Qualifiers"),
    new NarutoMapDesc("fpack/stg/0160000", "Chunin Exams - Final"),
    new NarutoMapDesc("fpack/stg/0170000", "Chunin Exams - Rooftop"),
    new NarutoMapDesc("fpack/stg/0210000", "Chunin Exams - Orochimaru"),
    new NarutoMapDesc("fpack/stg/0200000", "Hidden Sand Village"),
    new NarutoMapDesc("fpack/stg/0220000", "Tanzaku Castle"),
    new NarutoMapDesc("fpack/stg/0230000", "Kyuubi Chamber"),
    new NarutoMapDesc("fpack/stg/0240000", "Three-Way Deadlock"),
    new NarutoMapDesc("fpack/stg/0190000", "Konoha Hot Springs"),
    new NarutoMapDesc("fpack/stg/0250000", "Konoha Hospital"),
    new NarutoMapDesc("fpack/stg/0260000", "Konoha Shrine"),
    new NarutoMapDesc("fpack/stg/0270000", "Konoha Police Department"),
    new NarutoMapDesc("fpack/stg/0280000", "Uchiha Compound"),
    new NarutoMapDesc("fpack/stg/0290000", "Land of Ice"),
    new NarutoMapDesc("fpack/stg/0300000", "Orochimaru's Lair"),
    new NarutoMapDesc("fpack/stg/0310000", "Plains"),
    "Other",
    new NarutoMapDesc("fpack/game0005", "Shop"),
];

const id = `NarutoGNT4`;
const name = "Naruto: Gekitō Ninja Taisen! 4";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};
