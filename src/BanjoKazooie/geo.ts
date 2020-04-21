
import * as F3DEX from "./f3dex";
import * as F3DEX2 from "../PokemonSnap/f3dex2";
import * as RDP from "../Common/N64/RDP";

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero, assertExists, nArray } from "../util";
import { vec3 } from "gl-matrix";
import { Endianness } from "../endian";
import { ImageFormat, ImageSize, TexCM } from "../Common/N64/Image";
import { DataMap, DataRange } from "../PokemonSnap/room";

// Banjo-Kazooie Geometry

export interface Bone {
    boneIndex: number;
    parentIndex: number;
    boneAnimID: number;
    offset: vec3;
}

export interface AnimationSetup {
    translationScale: number;
    bones: Bone[];
}

export interface VertexBoneEntry {
    position: vec3;
    boneID: number;
    vertexIDs: Uint16Array;
}

export interface VertexBoneTable {
    vertexBoneEntries: VertexBoneEntry[];
}

export interface TextureAnimationSetup {
    speed: number;
    blockCount: number;
    indexLists: number[][];
}

export interface ModelPoint {
    boneID: number;
    offset: vec3;
}

export const enum GeoFlags {
    RGBA16Mipmaps   = 0x002,
    ComputeLookAt   = 0x004,
    ExtraSegments   = 0x040,
    CI8Mipmaps      = 0x080,
    CI4Mipmaps      = 0x100,
}
export interface Geometry<N extends GeoNode> {
    geoFlags: number;
    animationSetup: AnimationSetup | null;
    vertexBoneTable: VertexBoneTable | null;
    textureAnimationSetup: TextureAnimationSetup[];
    vertexEffects: VertexAnimationEffect[];
    modelPoints: ModelPoint[];
    sharedOutput: F3DEX.RSPSharedOutput;
    rootNode: N;

    normals?: vec3[];
    softwareLighting?: SoftwareLightingEffect[];
    colorMapping?: number[][];
}

export const enum VertexEffectType {
    // id mapping is different from game table index (in comment)
    // names in the comment are from bt files
    FlowingWater      = 1,  // 1 scroll
    ColorFlicker      = 2,  // 0 light
    StillWater        = 3,  // 3 water
    ColorPulse        = 5,  // 4 glow
    RipplingWater     = 7,  // 5 wave
    AlphaBlink        = 8,  // 6 glowa
    LightningBolt     = 9,  // 8
    LightningLighting = 10, // 7

    // these are still speculative
    Interactive       = 4,  // 2
    OtherInteractive  = 6,  // 2 again

    // tooie only, there are multiple tables so no meaningful index
    FlashAlpha        = 9,
    Flash             = 10,
    Unknown           = 11,
    Wibble            = 12,
    Bounce            = 17,
    Twinkle           = 18,
    Flame             = 19,
    TwinkleAlpha      = 20,
    OtherWibble       = 21,
    TwinkleColor      = 22,
}

interface BlinkStateMachine {
    currBlink: number;
    strength: number;
    count: number;
    duration: number;
    timer: number;
}

export interface VertexAnimationEffect {
    type: VertexEffectType;
    subID: number;
    vertexIndices: number[];
    baseVertexValues: F3DEX.Vertex[];
    xPhase: number;
    yPhase: number;
    dtx: number;
    dty: number;
    dy: number;
    colorFactor: number;

    bbMin?: vec3;
    bbMax?: vec3;
    blinker?: BlinkStateMachine;
    pairedEffect?: VertexAnimationEffect;
    timers?: Float32Array;
}

function otherModeLEntries(flags: number[]): ArrayBufferSlice {
    // set bytes individually to avoid endianness issues
    const out = new Uint8Array(16 * flags.length);
    for (let i = 0; i < flags.length; i++) {
        out[16 * i + 0] = F3DEX.F3DEX_GBI.G_SETOTHERMODE_L;
        out[16 * i + 2] = 0x03;
        out[16 * i + 3] = 0x1d;

        out[16 * i + 4] = (flags[i] >>> 24) & 0xff;
        out[16 * i + 5] = (flags[i] >>> 16) & 0xff;
        out[16 * i + 6] = (flags[i] >>> 8) & 0xff;
        out[16 * i + 7] = (flags[i] >>> 0) & 0xff;

        out[16 * i + 8] = F3DEX.F3DEX_GBI.G_ENDDL;
    }
    return new ArrayBufferSlice(out.buffer);
}

// labels are approximate, since some have combinations of ZMODE and/or Z_UPD that don't make sense
const renderModeBuffers: ArrayBufferSlice[] = [
    // non-z-buffered "opaque"
    otherModeLEntries([
        0x0F0A4000, // OPA_SURF
        0x0C192048, // AA_OPA_SURF
        0x0C184240, // XLU_SURF
        0x0C1841C8, // AA_XLU_SURF
        0x0C184240, // XLU_SURF
        0x0C1841C8, // AA_XLU_SURF
        0x0F0A4000, // repeated
        0x0C192048,
        0x0C184240,
        0x0C1841C8,
        0x0C184240,
        0x0C1841C8,
        0x0C1843C8, // AA_CLD_SURF (doesn't actually exist)
    ]),
    // z-buffered "opaque"
    otherModeLEntries([
        0x0F0A4030, // OPA_SURF
        0x0C192078, // AA_OPA_SURF
        0x0C184270, // XLU_SURF
        0x0C1841F8, // AA_XLU_SURF
        0x0C184270, // XLU_SURF
        0x0C1841F8, // AA_XLU_SURF
        0x0F0A4010, // repeated, but without Z_UPD
        0x0C192058,
        0x0C184250,
        0x0C1841D8,
        0x0C184250,
        0x0C1841D8,
        0x0C1843D8, // ?
    ]),
    // z-buffered (no update) "opaque"
    otherModeLEntries([
        0x0F0A4010,
        0x0C192058,
        0x0C184250,
        0x0C1841D8,
        0x0C184250,
        0x0C1841D8,
        0x0F0A4010, // repeated
        0x0C192058,
        0x0C184250,
        0x0C1841D8,
        0x0C184250,
        0x0C1841D8,
        0x0C1843D8, // ?
    ]),
    // non-z-buffered "translucent"
    otherModeLEntries(([] as number[]).concat(
        ...nArray(6, () => [
            0x0C184240, // XLU_SURF
            0x0C1841C8, // AA_XLU_SURF
        ])).concat(
            [0x0C1843C8], // AA_CLD_SURF (doesn't actually exist)
        )
    ),
    // z-buffered "translucent"
    otherModeLEntries([
        0x0C184270, // XLU_SURF
        0x0C1841F8, // AA_XLU_SURF
        0x0C184270, // XLU_SURF
        0x0C1841F8, // AA_XLU_SURF
        0x0C184270, // XLU_SURF
        0x0C1841F8, // AA_XLU_SURF
        0x0C184250, // repeated, but without Z_UPD
        0x0C1841D8,
        0x0C184250,
        0x0C1841D8,
        0x0C184250,
        0x0C1841D8,
        0x0C1843D8, // ?
    ]),
    // z-buffered (no update) "translucent"
    otherModeLEntries(([] as number[]).concat(
        ...nArray(6, () => [
            0x0C184250, // XLU_SURF
            0x0C1841D8, // AA_XLU_SURF
        ])).concat(
            [0x0C1843D8], // ?
        )
    ),
];

// just create the first mipmap entry
function mipmapEntries(fmt: ImageFormat, siz: ImageSize): ArrayBufferSlice {
    const out = new ArrayBufferSlice(new ArrayBuffer(8 * 24));
    const view = out.createDataView();
    let w = 5;
    let h = 5;
    const line = Math.ceil((1 << (w + siz - 1)) / 8);
    const lrs = (1 << (w + 2)) - 4;
    const lrt = (1 << (h + 2)) - 4;

    // wrap
    view.setUint32(0x00, (F3DEX2.F3DEX2_GBI.G_SETTILE << 24) | (fmt << 21) | (siz << 19) | (line << 9));
    view.setUint32(0x04, (2 << 24) | (h << 14) | (w << 4));

    view.setUint8(0x08, F3DEX2.F3DEX2_GBI.G_SETTILESIZE);
    view.setUint32(0x0C, (2 << 24) | (lrs << 12) | lrt);

    view.setUint8(0x10, F3DEX2.F3DEX2_GBI.G_ENDDL);

    // clamp
    view.setUint32(0x60, (F3DEX2.F3DEX2_GBI.G_SETTILE << 24) | (fmt << 21) | (siz << 19) | (line << 9));
    view.setUint32(0x64, (2 << 24) | (1 << 18) | (h << 14) | (1 << 8) | (w << 4));

    view.setUint8(0x68, F3DEX2.F3DEX2_GBI.G_SETTILESIZE);
    view.setUint32(0x6C, (2 << 24) | (lrs << 12) | lrt);

    view.setUint8(0x70, F3DEX2.F3DEX2_GBI.G_ENDDL);

    return out;
}

const mipmapSegments = [
    mipmapEntries(ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_4b),
    mipmapEntries(ImageFormat.G_IM_FMT_CI, ImageSize.G_IM_SIZ_8b),
    mipmapEntries(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b),
];

export interface SelectorNode {
    kind: "select";
    stateIndex: number;
}

export interface SortNode {
    kind: "sort";
    point: vec3;
    normal: vec3;
}

export function isSelector(node: SelectorNode | SortNode | null): node is SelectorNode {
    return node !== null && node.kind === "select";
}

export function isSorter(node: SelectorNode | SortNode | null): node is SortNode {
    return node !== null && node.kind === "sort";
}

export interface GeoNode {
    boneIndex: number;
    parentIndex: number;
    rspOutput: F3DEX.RSPOutput | null;
    children: GeoNode[];
    nodeData: SelectorNode | SortNode | null;
    rspState: F3DEX.RSPState | F3DEX2.RSPState;
    runDL: (addr: number) => void;
}

export interface SoftwareLightingEffect {
    startVertex: number;
    vertexCount: number;
    bone: number;
}

type nodeBuilder<N extends GeoNode> = (bone: number, parent: number, ctx: GeoContext<N>) => N;

interface GeoContext<N extends GeoNode> {
    buffer: ArrayBufferSlice;

    segmentBuffers: ArrayBufferSlice[];
    dataMap?: DataMap;
    sharedOutput: F3DEX.RSPSharedOutput;
    zMode: RenderZMode;

    animationSetup: AnimationSetup | null;
    vertexBoneTable: VertexBoneTable | null;
    modelPoints: ModelPoint[];

    nodeStack: N[];
    buildSortNodes: boolean;
    nodeBuilder: nodeBuilder<N>;

    softwareLighting?: SoftwareLightingEffect[];
}

export class BKGeoNode implements GeoNode {
    public rspOutput: F3DEX.RSPOutput | null = null;
    public children: GeoNode[] = [];
    public nodeData: SelectorNode | SortNode | null = null;
    public rspState: F3DEX.RSPState;

    constructor(public boneIndex: number, public parentIndex: number, context: GeoContext<BKGeoNode>) {
        this.rspState = new F3DEX.RSPState(context.segmentBuffers, context.sharedOutput);
        // G_TF_BILERP
        this.rspState.gDPSetOtherModeH(12, 2, 0x2000);
        this.rspState.gDPSetOtherModeH(
            RDP.OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2,
            RDP.OtherModeH_CycleType.G_CYC_2CYCLE << RDP.OtherModeH_Layout.G_MDSFT_CYCLETYPE,
        );
        setMipmapTiles(this.rspState, TexCM.WRAP);
    }

    public runDL(addr: number): void {
        F3DEX.runDL_F3DEX(this.rspState, addr);
    }
}

const zBufferedOpaqueModes = [
    0x0F0A4030, // OPA_SURF
    0x0C192078, // AA_OPA_SURF
    0x0C184270, // XLU_SURF
    0x0C1841F8, // AA_XLU_SURF
    0x0C184270, // XLU_SURF
    0x0C1841F8, // AA_XLU_SURF
];

const noUpdateOpaqueModes = [
    0x0F0A4010,
    0x0C192058,
    0x0C184250,
    0x0C1841D8,
    0x0C184250,
    0x0C1841D8,
];

const backupModes = [
    0x0C1843D8,
    0x0C184E50,
    0x0C184DD8,
    0xC8104E50,
    0xC8104DD8,
];

export class BTGeoNode implements GeoNode {
    public rspOutput: F3DEX.RSPOutput | null = null;
    public children: GeoNode[] = [];
    public nodeData: SelectorNode | SortNode | null = null;
    public rspState: F3DEX2.RSPState;

    private zMode: RenderZMode;

    constructor(public boneIndex: number, public parentIndex: number, context: GeoContext<BTGeoNode>) {
        this.rspState = new F3DEX2.RSPState(context.sharedOutput, context.dataMap!, true);
        // G_TF_BILERP
        this.rspState.gDPSetOtherModeH(12, 2, 0x2000);
        this.rspState.gDPSetOtherModeH(
            RDP.OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2,
            RDP.OtherModeH_CycleType.G_CYC_2CYCLE << RDP.OtherModeH_Layout.G_MDSFT_CYCLETYPE,
        );
        this.zMode = context.zMode;
        this.runDL(0x07 << 24); // set up mipmaps
    }

    private static opaHandler(state: F3DEX2.RSPState, addr: number): void {
        BTGeoNode.modeHandler(state, addr, zBufferedOpaqueModes);
    }

    private static xluHandler(state: F3DEX2.RSPState, addr: number): void {
        BTGeoNode.modeHandler(state, addr, noUpdateOpaqueModes);
    }

    private static modeHandler(state: F3DEX2.RSPState, addr: number, list: number[]): void {
        if (addr >>> 24 !== 3)
            return F3DEX2.runDL_F3DEX2(state, addr);
        // each entry is two commands, so sixteen bytes
        const index = (addr & 0xFFFFFF) >>> 4;
        let mode = list[index % 6];
        if (index < 24) {
            const category = Math.floor(index / 6);
            if (category & 1) // no z update
                mode = mode & ~(1 << RDP.OtherModeL_Layout.Z_UPD);
            if (category & 2) // fog
                mode = (mode & ~0xCCCC0000) | 0xC8000000;
        } else
            mode = backupModes[index - 24];

        state.gDPSetOtherModeL(3, 0x1D, mode);
    }

    public runDL(addr: number): void {
        F3DEX2.runDL_F3DEX2(this.rspState, addr, this.zMode === RenderZMode.OPA ? BTGeoNode.opaHandler : BTGeoNode.xluHandler);
    }
}

function pushGeoNode<N extends GeoNode>(context: GeoContext<N>, boneIndex = 0, parentIndex = -1): N {
    const geoNode = context.nodeBuilder(boneIndex, parentIndex, context);

    if (context.nodeStack.length > 0)
        context.nodeStack[0].children.push(geoNode);

    context.nodeStack.unshift(geoNode);
    return geoNode;
}

function peekGeoNode<N extends GeoNode>(context: GeoContext<N>): N {
    return assertExists(context.nodeStack[0]);
}

function popGeoNode<N extends GeoNode>(context: GeoContext<N>): N {
    const geoNode = context.nodeStack.shift()!;

    // Finalize geo node.
    geoNode.rspOutput = geoNode.rspState.finish();

    return geoNode;
}

function setMipmapTiles(rspState: F3DEX.RSPState, cm: TexCM): void {
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0, 2, 0, cm, 5, 0, cm, 5, 0);
    rspState.gDPSetTileSize(2, 0, 0, 0x7C, 0x7C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0x100, 3, 0, cm, 4, 0, cm, 4, 0);
    rspState.gDPSetTileSize(3, 0, 0, 0x3C, 0x3C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0x104, 4, 0, cm, 3, 0, cm, 3, 0);
    rspState.gDPSetTileSize(4, 0, 0, 0x1C, 0x1C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0x106, 5, 0, cm, 2, 0, cm, 2, 0);
    rspState.gDPSetTileSize(5, 0, 0, 0x0C, 0x0C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 8, 0x107, 6, 0, cm, 1, 0, cm, 1, 0);
    rspState.gDPSetTileSize(6, 0, 0, 0x04, 0x04);
}

function runDL<N extends GeoNode>(context: GeoContext<N>, addr: number): void {
    const node = peekGeoNode(context);
    node.runDL(addr);
}

function runGeoLayout<N extends GeoNode>(context: GeoContext<N>, geoIdx_: number): void {
    const buffer = context.buffer;
    const view = buffer.createDataView();

    while (true) {
        // Disallow accidental modifications of geoIdx.
        const geoIdx = geoIdx_;

        const cmd = view.getUint32(geoIdx + 0x00);
        const nextSiblingOffs = view.getUint32(geoIdx + 0x04);

        if (window.debug) {
            const end = view.getUint32(geoIdx + 0x04);
            console.log(hexzero(geoIdx, 0x04), hexzero(cmd, 2), hexzero(end, 0x08));
        }

        if (cmd === 0x00) {
            // set custom model matrix?
            const childOffs = view.getUint16(geoIdx + 0x08);
            if (childOffs !== 0)
                runGeoLayout(context, geoIdx + childOffs);
        } else if (cmd === 0x01) {
            // XLU sorting
            const drawCloserOnly = !!(view.getUint16(geoIdx + 0x20) & 1);

            const child0Offs = view.getUint16(geoIdx + 0x22);
            const child1Offs = view.getUint32(geoIdx + 0x24);

            if (context.buildSortNodes && child0Offs !== 0 && child1Offs !== 0) {
                // only bother building a sort node if there are two children to sort
                const curr = peekGeoNode(context);
                const sortNode = pushGeoNode(context, curr.boneIndex, curr.parentIndex);
                const point = vec3.fromValues(
                    view.getFloat32(geoIdx + 0x08),
                    view.getFloat32(geoIdx + 0x0C),
                    view.getFloat32(geoIdx + 0x10),
                );
                const normal = vec3.fromValues(
                    view.getFloat32(geoIdx + 0x14),
                    view.getFloat32(geoIdx + 0x18),
                    view.getFloat32(geoIdx + 0x1C),
                );
                vec3.sub(normal, normal, point);

                sortNode.nodeData = { kind: "sort", point, normal };
                pushGeoNode(context, curr.boneIndex, curr.parentIndex);
                runGeoLayout(context, geoIdx + child0Offs);
                popGeoNode(context);

                pushGeoNode(context, curr.boneIndex, curr.parentIndex);
                runGeoLayout(context, geoIdx + child1Offs);
                popGeoNode(context);

                popGeoNode(context);
            } else {
                if (child0Offs !== 0)
                    runGeoLayout(context, geoIdx + child0Offs);
                if (child1Offs !== 0)
                    runGeoLayout(context, geoIdx + child1Offs);
            }
        } else if (cmd === 0x02) {
            // Bone.
            const geoOffset = view.getUint8(geoIdx + 0x08);
            const boneIndex = view.getInt8(geoIdx + 0x09);
            const parentNode = peekGeoNode(context);

            // tooie has a bunch of these with zero offset, which seem to do nothing
            if (geoOffset !== 0) {
                pushGeoNode(context, boneIndex, parentNode.boneIndex);
                runGeoLayout(context, geoIdx + geoOffset);
                popGeoNode(context);
            }
        } else if (cmd === 0x03 || cmd === 0x11) {
            // DL.
            const segmentStart = view.getUint16(geoIdx + 0x08);
            const triCount = view.getUint16(geoIdx + 0x0A);
            runDL(context, 0x09000000 + segmentStart * 0x08);
        } else if (cmd === 0x05 || cmd === 0x12) {
            // Skinned DL
            // Does something fancy with matrices.

            const node = peekGeoNode(context);

            // Matrix index 1 = parent bone.
            node.rspState.gSPResetMatrixStackDepth(1);

            runDL(context, 0x09000000 + view.getUint16(geoIdx + 0x08) * 0x08);

            let idx = 0x0A;
            while (true) {
                // Matrix index 0 = current bone.
                node.rspState.gSPResetMatrixStackDepth(0);

                const segmentStart = view.getUint16(geoIdx + idx);
                if (segmentStart === 0) // 0 after the first indicates the end
                    break;
                runDL(context, 0x09000000 + segmentStart * 0x08);
                idx += 0x02;
            }
        } else if (cmd === 0x08) {
            // LOD selection
            const minDist = view.getFloat32(geoIdx + 0x0c);
            if (minDist === 0) // only use high LOD parts
                runGeoLayout(context, geoIdx + view.getUint32(geoIdx + 0x1C));
        } else if (cmd === 0x0A) {
            const vectorIndex = view.getInt16(geoIdx + 0x08);
            const boneID = view.getInt16(geoIdx + 0x0a);
            const x = view.getFloat32(geoIdx + 0x0c);
            const y = view.getFloat32(geoIdx + 0x10);
            const z = view.getFloat32(geoIdx + 0x14);

            context.modelPoints[vectorIndex] = { boneID, offset: vec3.fromValues(x, y, z) };
        } else if (cmd === 0x0C) {
            // select child geo list(s), e.g. eye blink state
            const childCount = view.getUint16(geoIdx + 0x08);
            const stateIndex = view.getUint16(geoIdx + 0x0A);

            const currNode = peekGeoNode(context);
            // push a new geo node to ensure these are the only children
            // this isn't a new bone, so preserve the current bones
            pushGeoNode(context, currNode.boneIndex, currNode.parentIndex);

            const childArrOffs = geoIdx + 0x0C;
            for (let i = 0; i < childCount; i++) {
                const childOffs = geoIdx + view.getUint32(childArrOffs + (i * 0x04));

                const childNode = pushGeoNode(context, currNode.boneIndex, currNode.parentIndex);
                childNode.nodeData = { kind: "select", stateIndex };
                runGeoLayout(context, childOffs);
                popGeoNode(context);
            }
            popGeoNode(context);
        } else if (cmd === 0x0D) {
            // Draw dist conditional test.
            // TODO(jstpierre): Conditional
            const childOffs = view.getUint16(geoIdx + 0x14);
            if (childOffs !== 0)
                runGeoLayout(context, geoIdx + childOffs);
        } else if (cmd === 0x0E) {
            // View frustum culling.
            const jointIndex = view.getInt16(geoIdx + 0x12);
            // hexdump(buffer, geoIdx, 0x100);
            runGeoLayout(context, geoIdx + view.getUint16(geoIdx + 0x10));
        } else if (cmd === 0x0F) {
            // Conditionally run geolist.
            runGeoLayout(context, geoIdx + view.getUint16(geoIdx + 0x08));
        } else if (cmd === 0x10) {
            // 1 for clamp, 2 for wrap
            const wrapMode = view.getInt32(geoIdx + 0x08);
            const node = peekGeoNode(context);
            // TODO: Make this less heinous
            if (node.rspState instanceof F3DEX.RSPState)
                setMipmapTiles(node.rspState, wrapMode === 1 ? TexCM.CLAMP : TexCM.WRAP);
            else
                node.runDL((7 << 24) | (2-wrapMode)*0x60);
        } else if (cmd === 0x16 || cmd === 0x18) {
            runDL(context, 0x09000000 + view.getUint16(geoIdx + 0x08) * 0x08);
            const node = peekGeoNode(context);
            let idx = 0x0A;
            while (true) {
                node.rspState.gSPResetMatrixStackDepth(0);
                const segmentStart = view.getUint16(geoIdx + idx);
                if (segmentStart === 0) // 0 after the first indicates the end
                    break;
                runDL(context, 0x09000000 + segmentStart * 0x08);
                idx += 0x02;
            }
        }
        if (cmd > 0x10) {
            const node = peekGeoNode(context);
            assert(node instanceof BTGeoNode);
            assert(node.boneIndex >= 0 && (node.parentIndex >= 0 || cmd === 0x11))
            switch (cmd) {
                case 0x11: {
                    if (!(view.getUint16(geoIdx + 0x0E) & 1))
                        break;
                    context.softwareLighting!.push({
                        startVertex: view.getUint16(geoIdx + 0x0A),
                        vertexCount: view.getUint16(geoIdx + 0x0C),
                        bone: node.boneIndex,
                    });
                } break;
                case 0x12:
                case 0x18: {
                    if (!(view.getUint16(geoIdx + 0x2E) & 1))
                        break;
                    let startVertex = view.getUint16(geoIdx + 0x2C);
                    let vertexCount = 0;

                    let idx = 0;
                    while (true) {
                        if (view.getUint16(geoIdx + idx + 0x08) === 0)
                            break;
                        vertexCount = view.getUint16(geoIdx + idx + 0x20);
                        if (vertexCount > 0)
                            context.softwareLighting!.push({startVertex, vertexCount, bone: node.boneIndex});
                        startVertex += vertexCount;

                        vertexCount = view.getUint16(geoIdx + idx + 0x14);
                        if (vertexCount > 0)
                            context.softwareLighting!.push({startVertex, vertexCount, bone: node.parentIndex});
                        startVertex += vertexCount;
                        idx += 2;
                    }
                } break;
                // only active for the other lighting effects
                // case 0x15: {
                //     const count = view.getUint16(geoIdx + 0x08);
                //     let startVertex = view.getUint16(geoIdx + 0x0A);
                //     for (let i = 0; i < count; i++) {
                //         const vertexCount = view.getUint16(geoIdx + 4*i + 0x0E);
                //         context.softwareLighting!.push({
                //             startVertex,
                //             vertexCount,
                //             bone: view.getInt16(geoIdx + 4*i + 0x0C),
                //         });
                //         startVertex += vertexCount;
                //     }
                // }
                case 0x17: {
                    if (!(view.getUint16(geoIdx + 0x0E) & 1))
                        break;
                    let startVertex = view.getUint16(geoIdx + 0x08);
                    let vertexCount = view.getUint16(geoIdx + 0x0A);
                    if (vertexCount > 0)
                        context.softwareLighting!.push({startVertex, vertexCount, bone: node.boneIndex});
                    startVertex += vertexCount;

                    vertexCount = view.getUint16(geoIdx + 0x0C);
                    if (vertexCount > 0)
                        context.softwareLighting!.push({startVertex, vertexCount, bone: node.parentIndex});
                } break;
            }
        }

        if (nextSiblingOffs === 0)
            return;
        else
            geoIdx_ += nextSiblingOffs;
    }
}

export const enum RenderZMode {
    None = 0,
    OPA = 1,
    XLU = 2,
}

function commonSetup<N extends GeoNode>(buffer: ArrayBufferSlice, isTooie: boolean, builder: nodeBuilder<N>, zMode: number, textureData?: ArrayBufferSlice): GeoContext<N> {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) == 0x0B);

    const f3dexOffs = view.getUint32(0x0C);
    const f3dexCount = view.getUint32(f3dexOffs + 0x00);
    const f3dexData = buffer.subarray(f3dexOffs + 0x08, f3dexCount * 0x08);

    const animationSetupOffs = view.getUint32(0x18);
    let animationSetup: AnimationSetup | null = null;
    if (animationSetupOffs !== 0) {
        const translationScale = view.getFloat32(animationSetupOffs + 0x00);
        const boneCount = view.getUint16(animationSetupOffs + 0x04);

        let boneTableIdx = animationSetupOffs + 0x08;
        const bones: Bone[] = [];
        for (let i = 0; i < boneCount; i++) {
            const x = view.getFloat32(boneTableIdx + 0x00);
            const y = view.getFloat32(boneTableIdx + 0x04);
            const z = view.getFloat32(boneTableIdx + 0x08);

            const boneIndex = i;
            const boneID = view.getUint16(boneTableIdx + 0x0C);
            const parentIndex = view.getInt16(boneTableIdx + 0x0E);
            const offset = vec3.fromValues(x, y, z);
            bones.push({ boneIndex, parentIndex, boneAnimID: boneID, offset });

            boneTableIdx += 0x10;
        }

        animationSetup = { translationScale, bones };
    }

    const vertexDataOffs = view.getUint32(0x10);
    const vertexCount = isTooie ? view.getUint16(vertexDataOffs + 0x16) / 2 : view.getUint16(0x32);
    const vertexData = buffer.subarray(vertexDataOffs + 0x18, vertexCount * 0x10);

    if (!textureData) {
        const textureSetupOffs = view.getUint16(0x08);
        const textureSetupSize = view.getUint32(textureSetupOffs + 0x00);
        const textureCount = view.getUint8(textureSetupOffs + 0x05);
        const entrySize = isTooie ? 8 : 16;
        const textureHeaderSize = textureSetupOffs + 0x08 + (textureCount * entrySize);
        textureData = buffer.subarray(textureSetupOffs + textureHeaderSize, Math.max(textureSetupSize - textureHeaderSize, 0));
    }

    const segmentBuffers: ArrayBufferSlice[] = [];
    segmentBuffers[0x01] = vertexData;
    segmentBuffers[0x02] = textureData;
    segmentBuffers[0x09] = f3dexData;
    segmentBuffers[0x0B] = textureData;
    segmentBuffers[0x0C] = textureData;
    segmentBuffers[0x0D] = textureData;
    segmentBuffers[0x0E] = textureData;
    segmentBuffers[0x0F] = textureData;

    const sharedOutput = new F3DEX.RSPSharedOutput();
    sharedOutput.setVertexBufferFromData(vertexData.createDataView());
    const modelPoints: ModelPoint[] = [];

    const out: GeoContext<N> = {
        buffer,

        segmentBuffers,
        sharedOutput,
        zMode,

        animationSetup,
        vertexBoneTable: null,
        modelPoints,

        nodeStack: [],
        buildSortNodes: zMode === RenderZMode.XLU,
        nodeBuilder: builder,
    };
    return out;
}

function bkBuilder(bone: number, parent: number, ctx: GeoContext<BKGeoNode>): BKGeoNode {
    return new BKGeoNode(bone, parent, ctx);
}

function btBuilder(bone: number, parent: number, ctx: GeoContext<BTGeoNode>): BTGeoNode {
    return new BTGeoNode(bone, parent, ctx);
}

export function parseBK(buffer: ArrayBufferSlice, zMode: RenderZMode, opaque: boolean): Geometry<BKGeoNode> {
    const context = commonSetup(buffer, false, bkBuilder, zMode);

    const view = buffer.createDataView();
    const vertexBoneTableOffs = view.getUint32(0x28);
    if (vertexBoneTableOffs !== 0) {
        assert(context.animationSetup !== null); // not sure what this would mean
        const vertexBoneEntries: VertexBoneEntry[] = [];
        const tableCount = view.getUint16(vertexBoneTableOffs);
        let tableOffs = vertexBoneTableOffs + 0x04;
        for (let i = 0; i < tableCount; i++) {
            const x = view.getInt16(tableOffs + 0x00);
            const y = view.getInt16(tableOffs + 0x02);
            const z = view.getInt16(tableOffs + 0x04);
            const position = vec3.fromValues(x, y, z);

            const boneID = view.getInt8(tableOffs + 0x06);
            const boneVertexCount = view.getUint8(tableOffs + 0x07);
            tableOffs += 0x08;

            // When -1, it just takes the model matrix... no entry required.
            if (boneID !== -1) {
                const vertexIDs = buffer.createTypedArray(Uint16Array, tableOffs, boneVertexCount, Endianness.BIG_ENDIAN);
                vertexBoneEntries.push({ position, boneID, vertexIDs });
            }

            tableOffs += 0x02 * boneVertexCount;
        }
        context.vertexBoneTable = { vertexBoneEntries };
    }

    const renderModeIndex = zMode + (opaque ? 0 : 3);
    context.segmentBuffers[0x03] = renderModeBuffers[renderModeIndex];
    return parse<BKGeoNode>(buffer, context);
}

export function parseBT(buffer: ArrayBufferSlice, zMode: RenderZMode, textureData?: ArrayBufferSlice, trackColor = false): Geometry<BTGeoNode> {
    const context = commonSetup(buffer, true, btBuilder, zMode, textureData);

    const view = buffer.createDataView();
    const vertexBoneTableOffs = view.getUint32(0x28);
    if (vertexBoneTableOffs !== 0) {
        assert(context.animationSetup !== null); // not sure what this would mean
        const vertexBoneEntries: VertexBoneEntry[] = [];
        const hasNorms = view.getUint16(vertexBoneTableOffs + 0x00) !== 0;
        const tableCount = view.getUint16(vertexBoneTableOffs + 0x02);
        let tableOffs = vertexBoneTableOffs + 0x04;
        for (let i = 0; i < tableCount; i++) {
            const boneID = view.getInt16(tableOffs + 0x00);
            const posCount = view.getInt16(tableOffs + 0x02);
            const vertexCount = view.getInt16(tableOffs + 0x04);
            tableOffs += 0x06;

            let currPos = tableOffs;
            tableOffs += 0x06 * posCount;
            // ignoring normals for now
            if (hasNorms)
                tableOffs += 0x04 * vertexCount;
            let entryStart = tableOffs;

            while (true) {
                const idx = view.getInt16(tableOffs);
                if (idx < 0) {
                    const vertexIDs = buffer.createTypedArray(Uint16Array, entryStart, (tableOffs - entryStart) / 2, Endianness.BIG_ENDIAN);
                    const position = vec3.fromValues(view.getInt16(currPos), view.getInt16(currPos + 2), view.getInt16(currPos + 4));
                    if (boneID !== -1)
                        vertexBoneEntries.push({ position, boneID, vertexIDs });
                    currPos += 0x06;
                    entryStart = tableOffs + 2;
                }
                tableOffs += 2;
                if (idx === -2)
                    break;
            }
        }
        context.vertexBoneTable = { vertexBoneEntries };
    }

    let mipmapIndex = 0;
    const geoFlags = view.getUint16(0x0A);
    if (geoFlags & GeoFlags.CI8Mipmaps)
        mipmapIndex = 1;
    else if (geoFlags & GeoFlags.RGBA16Mipmaps)
        mipmapIndex = 2;
    context.segmentBuffers[7] = mipmapSegments[mipmapIndex];

    context.softwareLighting = [];

    // build data map for the f3dex2 interpreter
    const ranges: DataRange[] = [];
    for (let i = 0; i < context.segmentBuffers.length; i++) {
        if (context.segmentBuffers[i])
            ranges.push({ start: i << 24, data: context.segmentBuffers[i] });
    }
    context.dataMap = new DataMap(ranges);
    const geo = parse<BTGeoNode>(buffer, context);
    if (context.softwareLighting && context.softwareLighting.length > 0) {
        geo.softwareLighting = context.softwareLighting;
        const normalOffset = view.getUint32(0x38);
        geo.normals = [];
        for (let i = 0; i < context.sharedOutput.vertices.length; i++) {
            const n = vec3.fromValues(
                view.getInt8(normalOffset + 4 * i + 0),
                view.getInt8(normalOffset + 4 * i + 1),
                view.getInt8(normalOffset + 4 * i + 2),
            );
            vec3.normalize(n, n);
            geo.normals.push(n);
        }
    }

    if (trackColor) {
        const colorMap: number[][] = [];
        const vertexView = context.segmentBuffers[1].createDataView();
        for (let offs = 0; offs < vertexView.byteLength; offs += 0x10) {
            const colorIndex = vertexView.getUint16(offs + 0x06) & 0x1FF;
            if (colorMap[colorIndex] === undefined)
                colorMap[colorIndex] = [];
            colorMap[colorIndex].push(offs >>> 4);
        }
        geo.colorMapping = colorMap;
    }

    return geo;
}

export function parse<N extends GeoNode>(buffer: ArrayBufferSlice, geoContext: GeoContext<N>): Geometry<N> {
    const view = buffer.createDataView();
    const geoOffs = view.getUint32(0x04);
    const geoFlags = view.getUint16(0x0A);

    const sharedOutput = geoContext.sharedOutput;

    const rootNode = pushGeoNode<N>(geoContext, 0);
    runGeoLayout<N>(geoContext, geoOffs);
    const rootNode2 = popGeoNode<N>(geoContext);
    assert(rootNode === rootNode2);

    let textureAnimationSetup: TextureAnimationSetup[] = [];
    const textureAnimationSetupOffs = view.getInt32(0x2c);
    if (textureAnimationSetupOffs > 0) {
        const baseTextureCount = sharedOutput.textureCache.textures.length;
        let offs = textureAnimationSetupOffs;
        for (let seg = 0xF; seg >= 0xB; seg--) {
            const blockSize = view.getUint16(offs + 0x00);
            const blockCount = view.getUint16(offs + 0x02);
            const speed = view.getFloat32(offs + 0x04);
            offs += 8;
            if (blockSize === 0)
                break;
            const indexLists: number[][] = [];
            for (let i = 0; i < baseTextureCount; i++) {
                const tex = sharedOutput.textureCache.textures[i];
                let addr = tex.dramAddr;
                let palAddr = tex.dramPalAddr;
                // seems like all of the animations are just rgba8
                const animate = tex.dramAddr >>> 24 === seg;
                const animatePalette = tex.dramPalAddr >>> 24 === seg;
                if (!animate && !animatePalette) {
                    continue;
                }

                // first texture is the one we already have
                const textureFrames: number[] = [i];
                for (let j = 1; j < blockCount; j++) {
                    if (animate)
                        addr += blockSize;
                    if (animatePalette)
                        palAddr += blockSize;
                    textureFrames.push(sharedOutput.textureCache.translateTileTexture(geoContext.segmentBuffers, addr, palAddr, tex.tile));
                }

                indexLists.push(textureFrames);
            }
            textureAnimationSetup.push({ blockCount, speed, indexLists });
        }
    }

    const effectSetupOffs = view.getUint32(0x24);
    const vertexEffects: VertexAnimationEffect[] = [];
    if (effectSetupOffs > 0) {
        const numEffects = view.getUint16(effectSetupOffs);
        let offs = effectSetupOffs + 0x02;
        for (let i = 0; i < numEffects; i++) {
            const rawID = view.getUint16(offs + 0x00);
            const type: VertexEffectType = Math.floor(rawID / 100);
            const subID = rawID % 100;
            const vertexCount = view.getUint16(offs + 0x02);
            offs += 0x04;

            if (rawID <= 100 || type === VertexEffectType.Interactive || type === VertexEffectType.OtherInteractive) {
                // effects <= 100 are for changing the colors of the letter tiles in spelling minigames
                offs += vertexCount * 0x02;
                continue;
            }

            const vertexIndices: number[] = [];
            const baseVertexValues: F3DEX.Vertex[] = [];
            for (let j = 0; j < vertexCount; j++) {
                const index = view.getUint16(offs);
                vertexIndices.push(index);
                baseVertexValues.push(sharedOutput.vertices[index]);
                offs += 0x02;
            }

            const effect: VertexAnimationEffect = {
                type, subID, vertexIndices, baseVertexValues,
                xPhase: 0, yPhase: 0, dy: 0, dtx: 0, dty: 0, colorFactor: 1,
            };

            if (type === VertexEffectType.RipplingWater || type >= VertexEffectType.Wibble) {
                // compute bounding box to determine amplitude
                const vertexPos = vec3.create();
                const bbMin = vec3.fromValues(baseVertexValues[0].x, baseVertexValues[0].y, baseVertexValues[0].z);
                const bbMax = vec3.clone(bbMin);
                for (let j = 0; j < baseVertexValues.length; j++) {
                    vec3.set(vertexPos, baseVertexValues[j].x, baseVertexValues[j].y, baseVertexValues[j].z);
                    vec3.min(bbMin, bbMin, vertexPos);
                    vec3.max(bbMax, bbMax, vertexPos);
                }
                effect.bbMin = bbMin;
                effect.bbMax = bbMax;
            }

            if (type === VertexEffectType.LightningLighting) {
                // search for the paired lightning bolt
                for (let j = 0; j < vertexEffects.length; j++)
                    if (vertexEffects[j].type === VertexEffectType.LightningBolt && vertexEffects[j].subID === subID)
                        effect.pairedEffect = vertexEffects[j];

                assert(!!effect.pairedEffect);
            }

            initEffectState(effect);
            vertexEffects.push(effect);
        }
    }

    return {
        geoFlags, vertexEffects, textureAnimationSetup, rootNode, sharedOutput,
        animationSetup: geoContext.animationSetup, vertexBoneTable: geoContext.vertexBoneTable, modelPoints: geoContext.modelPoints
    };
}

function initEffectState(effect: VertexAnimationEffect) {
    if (effect.type === VertexEffectType.StillWater) {
        effect.xPhase = Math.random();
    } else if (effect.type === VertexEffectType.RipplingWater) {
        const baseline = (effect.bbMax![1] + effect.bbMin![1]) / 2;
        for (let i = 0; i < effect.baseVertexValues.length; i++) {
            effect.baseVertexValues[i].y = baseline;
        }
    } else if (effect.type === VertexEffectType.LightningBolt) {
        // set blinker so next state is long pause
        effect.blinker = {
            currBlink: 0,
            strength: 0,
            count: 0,
            duration: 1,
            timer: 0,
        };
    } else if (effect.type > VertexEffectType.Wibble && effect.type < VertexEffectType.Bounce) {
        effect.subID += 100 * (effect.type - VertexEffectType.Wibble);
        effect.type = VertexEffectType.Wibble;
        if (effect.subID > 400) {
            const baseline = (effect.bbMax![1] + effect.bbMin![1]) / 2;
            for (let i = 0; i < effect.baseVertexValues.length; i++) {
                effect.baseVertexValues[i].y = baseline;
            }
        }
    } else if (effect.type === VertexEffectType.OtherWibble) {
        effect.type = VertexEffectType.Wibble;
        effect.subID += 300;
    } else if (effect.type === VertexEffectType.Twinkle) {
        effect.yPhase = Math.random() * (1 + .1 * effect.subID);
        effect.timers = new Float32Array(effect.vertexIndices.length);
        for (let i = 0; i < effect.baseVertexValues.length; i++)
            effect.baseVertexValues[i].a = 0;
    }
}
