import { HSD_AnimJointRoot, HSD_AObjLoadAnimJoint, HSD_AObjLoadMatAnimJoint, HSD_Archive, HSD_Archive__ResolvePtr, HSD_ArchiveParse, HSD_JObjLoadJoint, HSD_JObjRoot, HSD_LoadContext, HSD_LoadContext__ResolvePtr, HSD_LoadContext__ResolvePtrNullable, HSD_LoadContext__ResolveSymbol, HSD_MatAnimJointRoot } from "../SYSDOLPHIN/SYSDOLPHIN.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assertExists } from "../util.js";
import { SceneContext, SceneDesc } from "../SceneBase.js";
import { pathBase } from "./scenes.js";
import { SceneGfx } from "../viewer.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { MeleeRenderer } from "../SuperSmashBrosMelee/Scenes_SuperSmashBrosMelee.js";
import { HSD_JObjRoot_Instance } from "../SYSDOLPHIN/SYSDOLPHIN_Render.js";
import { range } from "../MathHelpers.js";
import { HSD_LoadStructArray } from "../SuperSmashBrosMelee/Melee_map_head.js";
import { mat4, vec3 } from "gl-matrix";

class KirbyMapDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const modelArchive = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${this.id}Model.dat`));
        const dataArchive = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${this.id}.dat`))
        const renderer = new KirbyMapRenderer(device, modelArchive, dataArchive);
        return renderer;
    }
}

class KirbyMapRenderer extends MeleeRenderer {

    private data: KirbyGrData;

    constructor(device: GfxDevice, public modelArchive: HSD_Archive, public dataArchive: HSD_Archive) {
        super(device);
        this.loadModel(modelArchive);
        this.data = this.loadData(dataArchive);
    }

    public getDefaultWorldMatrix(dst: mat4) {
        let pos = this.data.positions.startPos.positionData[this.data.positions.startPos.positionData.length - 1];
        // console.log(`x: ${pos.x}\ny: ${pos.y}\nz: ${pos.z}\nm11: ${pos.m11}\nm12: ${pos.m12}\nm13: ${pos.m13}\nm21: ${pos.m21}\nm22: ${pos.m22}\nm23: ${pos.m23}\n`)

        // ty dimy!
        const v1 = vec3.fromValues(pos.m11, pos.m12, pos.m13);
        const v2 = vec3.fromValues(pos.m21, pos.m22, pos.m23);
        const cross = vec3.create();
        vec3.cross(cross, v1, v2);

        dst[0] = v1[0];
        dst[1] = v1[1];
        dst[2] = v1[2];
        dst[3] = 0;

        dst[4] = v2[0];
        dst[5] = v2[1];
        dst[6] = v2[2];
        dst[7] = 0;

        dst[8] = cross[0];
        dst[9] = cross[1];
        dst[10] = cross[2];
        dst[11] = 0;

        dst[12] = pos.x;
        dst[13] = pos.y + 20; // since the riders are so close to the ground
        dst[14] = pos.z;
        dst[15] = 1;

        mat4.rotateY(dst, dst, -Math.PI / 2);
    }

    loadModel(archive: HSD_Archive) {
        const ctx = new HSD_LoadContext(archive);

        const modelRootNode = HSD_Archive_Find_Model(ctx.archive);
        const map = Kirby_Load_grModel(ctx, assertExists(modelRootNode));

        if (map.skyboxModel) {
            this.jobjRoots.push(new HSD_JObjRoot_Instance(this.modelCache.loadJObjRoot(map.skyboxModel)));
        }

        const mainRoot = new HSD_JObjRoot_Instance(this.modelCache.loadJObjRoot(assertExists(map.mainModel)));
        this.jobjRoots.push(mainRoot);

        const grModelMotion = HSD_Archive_Find_ModelMotion(ctx.archive);
        if (grModelMotion) {
            const modelMotion = Kirby_Load_grModelMotion(ctx, assertExists(grModelMotion));
            mainRoot.addAnimAll(
                modelMotion.animJoint,
                modelMotion.matAnimJoint,
                null,
            )
        }
    }

    loadData(dataArchive: HSD_Archive): KirbyGrData {
        const ctx = new HSD_LoadContext(dataArchive);
        const root = assertExists(dataArchive.publics.find(x => x.name.startsWith("grData")), "grData");
        return HSD_Parse_KirbyGrData(ctx, HSD_LoadContext__ResolveSymbol(ctx, root));
    }
}

interface KirbyGrData {
    lights: KirbyGrLightNode;
    positions: KirbyGrPositionNode;
}

function HSD_Parse_KirbyGrData(ctx: HSD_LoadContext, buf: ArrayBufferSlice): KirbyGrData {
    const view = buf.createDataView();
    return {
        lights: HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x14)),
        positions: HSD_Parse_KirbyGrPositionNode(ctx, HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x20))),
    };
}


interface KirbyGrPositionNode {
    startPos: KirbyPositionList,
}

function HSD_Parse_KirbyGrPositionNode(ctx: HSD_LoadContext, buf: ArrayBufferSlice): KirbyGrPositionNode {
    const view = buf.createDataView();
    return {
        startPos: HSD_Parse_KirbyPositionList(ctx, HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x04))),
    };
}

interface KirbyGrLightNode {
}

interface KirbyPositionList {
    positionData: KirbyGrPositionData[];
    count: number;
}

function HSD_Parse_KirbyPositionList(ctx: HSD_LoadContext, buf: ArrayBufferSlice): KirbyPositionList {
    const view = buf.createDataView();
    const count = view.getUint32(0x08);
    const positionData = HSD_LoadStructArray(ctx, buf, 0x04, 0x24, HSD_Parse_KirbyGrPositionData);
    console.log(count, "==", positionData.length, "?")
    return {
        positionData,
        count,
    };
}

interface KirbyGrPositionData {
    x: number;
    y: number;
    z: number;
    m11: number;
    m12: number;
    m13: number;
    m21: number;
    m22: number;
    m23: number;
}

function HSD_Parse_KirbyGrPositionData(ctx: HSD_LoadContext, buf: ArrayBufferSlice): KirbyGrPositionData {
    const view = buf.createDataView();
    const [x, y, z, m11, m12, m13, m21, m22, m23] = range(0, 9).map(i => view.getFloat32(i * 4));
    return {x, y, z, m11, m12, m13, m21, m22, m23};
}

interface KirbyMapGrModel {
    mainModel: HSD_JObjRoot,
    skyboxModel: HSD_JObjRoot | null,
}

function Kirby_Load_grModel(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): KirbyMapGrModel {
    let view = buffer.createDataView();
    const grMainModel = HSD_LoadContext__ResolvePtr(ctx, view.getUint32(0x00), 0x14);
    const grMainModelObjRoot = assertExists(HSD_JObjLoadJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, grMainModel.createDataView().getUint32(0x00), 0x40)));

    const grSkyboxOffset = view.getUint32(0x04);
    if (grSkyboxOffset === 0) {
        return {
            mainModel: grMainModelObjRoot,
            skyboxModel: null,
        };
    } else {
        const grSkyboxModel = HSD_LoadContext__ResolvePtr(ctx, grSkyboxOffset, 0x14);
        const grSkyboxModelObjRoot = assertExists(HSD_JObjLoadJoint(ctx, HSD_LoadContext__ResolvePtr(ctx, grSkyboxModel.createDataView().getUint32(0x00), 0x40)));

        return {
            mainModel: grMainModelObjRoot,
            skyboxModel: grSkyboxModelObjRoot,
        };
    }
}

interface KirbyMapGrModelMotion {
    animJoint: HSD_AnimJointRoot | null,
    matAnimJoint: HSD_MatAnimJointRoot | null,
}

function Kirby_Load_grModelMotion(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): KirbyMapGrModelMotion {
    const view = buffer.createDataView();
    // the test maps don't have valid modelmotion data, so we catch loading errors

    let animJoint: HSD_AnimJointRoot | null = null;

    try {
        const animJointPtr = HSD_LoadContext__ResolvePtrNullable(ctx, view.getUint32(0x00));
        animJoint = animJointPtr ? HSD_AObjLoadAnimJoint(ctx, animJointPtr) : null;
    } catch (e) {
        console.warn(e);
    }

    let matAnimJoint: HSD_MatAnimJointRoot | null = null;
    try {
        const matAnimJointPtr = HSD_LoadContext__ResolvePtrNullable(ctx, view.getUint32(0x04));
        matAnimJoint = matAnimJointPtr ? HSD_AObjLoadMatAnimJoint(ctx, matAnimJointPtr) : null;
    } catch (e) {
        console.warn(e);
    }

    return {
        animJoint,
        matAnimJoint,
    }
}

function HSD_Archive_Find_Model(arc: HSD_Archive): ArrayBufferSlice | null {
    const obj = arc.publics.find((sym) => sym.name.startsWith("grModel") && !sym.name.startsWith("grModelMotion"));
    if (obj !== undefined)
        return HSD_Archive__ResolvePtr(arc, obj.offset);
    else
        return null;
}

function HSD_Archive_Find_ModelMotion(arc: HSD_Archive): ArrayBufferSlice | null {
    const obj = arc.publics.find((sym) => sym.name.startsWith("grModelMotion"));
    if (obj !== undefined)
        return HSD_Archive__ResolvePtr(arc, obj.offset);
    else
        return null;
}

export const maps = [
    "Air Ride",
    new KirbyMapDesc("GrPlants1", "Fantasy Meadows"),
    new KirbyMapDesc("GrValley2", "Celestial Valley"),
    new KirbyMapDesc("GrDesert1", "Sky Sands"),
    new KirbyMapDesc("GrIce1", "Frozen Hillside"),
    new KirbyMapDesc("GrHeat2", "Magma Flows"),
    new KirbyMapDesc("GrSky2", "Beanstalk Park"),
    new KirbyMapDesc("GrMachine2", "Machine Passage"),
    new KirbyMapDesc("GrCheck2", "Checker Knights"),
    new KirbyMapDesc("GrSpace2", "Nebula Belt"),

    "City Trial",
    new KirbyMapDesc("GrCity1", "City Trial"),

    "City Trial Stadiums",
    new KirbyMapDesc("GrJump1", "High Jump"),
    new KirbyMapDesc("GrJump2", "Target Flight"),
    new KirbyMapDesc("GrJump3", "Air Glider"),

    new KirbyMapDesc("GrZeroyon5", "Drag Race 1"),
    new KirbyMapDesc("GrZeroyon3", "Drag Race 2"),
    new KirbyMapDesc("GrZeroyon1", "Drag Race 3"),
    new KirbyMapDesc("GrZeroyon4", "Drag Race 4"),

    new KirbyMapDesc("GrColosseum1", "Dustup Derby 1"),
    new KirbyMapDesc("GrColosseum3", "Dustup Derby 2"),

    new KirbyMapDesc("GrPasture1", "Kirby Melee 1"),
    new KirbyMapDesc("GrColosseum5", "Kirby Melee 2"),

    new KirbyMapDesc("GrDedede1", "VS. King Dedede"),

    "Test",
    new KirbyMapDesc("GrTest6", "Test6Model"),
    new KirbyMapDesc("GrTest7", "Test7Model"),
    new KirbyMapDesc("GrTest", "TestModel"),
    new KirbyMapDesc("GrSimple2", "Simple2Model"),
    new KirbyMapDesc("GrSimple", "SimpleModel"),
]