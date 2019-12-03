
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero, assertExists, nArray } from "../util";
import * as F3DEX from "./f3dex";
import { vec3 } from "gl-matrix";
import { Endianness } from "../endian";

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

export interface ModelPoint {
    boneID: number;
    offset: vec3;
}

export interface Geometry {
    animationSetup: AnimationSetup | null;
    vertexBoneTable: VertexBoneTable | null;
    vertexEffects: VertexAnimationEffect[];
    modelPoints: ModelPoint[];
    sharedOutput: F3DEX.RSPSharedOutput;
    rootNode: GeoNode;
}

export const enum VertexEffectType {
    // id mapping is different from game table index (in comment)
    FlowingWater = 1,       // 1
    ColorFlicker = 2,       // 0
    StillWater = 3,         // 3
    ColorPulse = 5,         // 4
    RipplingWater = 7,      // 5
    AlphaBlink = 8,         // 6
    LightningBolt = 9,      // 8
    LightningLighting = 10, // 7

    // these are still speculative
    Interactive = 4,        // 2
    OtherInteractive = 6,   // 2 again
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

export interface StateSelector {
    stateIndex: number;
}

export interface GeoNode {
    boneIndex: number;
    parentIndex: number;
    rspState: F3DEX.RSPState;
    rspOutput: F3DEX.RSPOutput | null;
    children: GeoNode[];
    selector: StateSelector | null;
}

interface GeoContext {
    buffer: ArrayBufferSlice;

    segmentBuffers: ArrayBufferSlice[];
    sharedOutput: F3DEX.RSPSharedOutput;
    modelPoints: ModelPoint[];

    nodeStack: GeoNode[];
}

function pushGeoNode(context: GeoContext, boneIndex = 0, parentIndex = -1): GeoNode {
    // TODO: figure out the unreferenced vertices
    const rspState = new F3DEX.RSPState(context.segmentBuffers, context.sharedOutput);
    // G_TF_BILERP
    rspState.gDPSetOtherModeH(12, 2, 0x2000);
    rspState.gDPSetOtherModeH(
        F3DEX.OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2,
        F3DEX.OtherModeH_CycleType.G_CYC_2CYCLE << F3DEX.OtherModeH_Layout.G_MDSFT_CYCLETYPE,
    )
    const geoNode: GeoNode = {
        boneIndex,
        parentIndex,
        children: [],
        rspState,
        rspOutput: null,
        selector: null,
    };

    if (context.nodeStack.length > 0)
        context.nodeStack[0].children.push(geoNode);

    context.nodeStack.unshift(geoNode);
    return geoNode;
}

function peekGeoNode(context: GeoContext): GeoNode {
    return assertExists(context.nodeStack[0]);
}

function popGeoNode(context: GeoContext): GeoNode {
    const geoNode = context.nodeStack.shift()!;

    // Finalize geo node.
    geoNode.rspOutput = geoNode.rspState.finish();

    return geoNode;
}

function runDL(context: GeoContext, addr: number): void {
    const node = peekGeoNode(context);
    F3DEX.runDL_F3DEX(node.rspState, addr);
}

function runGeoLayout(context: GeoContext, geoIdx_: number): void {
    const buffer = context.buffer;
    const view = buffer.createDataView();

    while (true) {
        // Disallow accidental modifications of geoIdx.
        const geoIdx = geoIdx_;

        const cmd = view.getUint32(geoIdx + 0x00);
        const nextSiblingOffs = view.getUint32(geoIdx + 0x04);

        if (window.debug) {
            const end = view.getUint32(geoIdx + 0x04);
            console.log(hexzero(geoIdx, 0x04), hexzero(cmd, 0x08), hexzero(end, 0x08));
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
            if (child0Offs !== 0)
                runGeoLayout(context, geoIdx + child0Offs);
            if (child1Offs !== 0)
                runGeoLayout(context, geoIdx + child1Offs);
        } else if (cmd === 0x02) {
            // Bone.
            const boneIndex = view.getInt8(geoIdx + 0x09);
            const parentNode = peekGeoNode(context);

            pushGeoNode(context, boneIndex, parentNode.boneIndex);
            runGeoLayout(context, geoIdx + view.getUint8(geoIdx + 0x08));
            popGeoNode(context);
        } else if (cmd === 0x03) {
            // DL.
            const segmentStart = view.getUint16(geoIdx + 0x08);
            const triCount = view.getUint16(geoIdx + 0x0A);
            runDL(context, 0x09000000 + segmentStart * 0x08);
        } else if (cmd === 0x05) {
            // Skinned DL (?)
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
            // Draw distance conditional test.
            runGeoLayout(context, geoIdx + view.getUint32(geoIdx +  0x1C));
        } else if (cmd === 0x0A) {
            const vectorIndex = view.getInt16(geoIdx + 0x08);
            const boneID = view.getInt16(geoIdx + 0x0a);
            const x = view.getFloat32(geoIdx + 0x0c);
            const y = view.getFloat32(geoIdx + 0x10);
            const z = view.getFloat32(geoIdx + 0x14);

            context.modelPoints[vectorIndex] = {boneID, offset: vec3.fromValues(x,y,z)};
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
                childNode.selector = { stateIndex };
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
            // set mipmaps. Skip.
            const contFlag = view.getUint32(geoIdx + 0x04);
            // 1 for clamp, 2 for wrap
            const wrapMode = view.getInt32(geoIdx + 0x08);
        } else {
            throw `whoops ${cmd}`;
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

export function parse(buffer: ArrayBufferSlice, zMode: RenderZMode, opaque: boolean): Geometry {
    const view = buffer.createDataView();

    assert(view.getUint32(0x00) == 0x0B);
    const geoOffs = view.getUint32(0x04);

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

    const vertexBoneTableOffs = view.getUint32(0x28);
    let vertexBoneTable: VertexBoneTable | null = null;
    if (vertexBoneTableOffs !== 0) {
        assert(animationSetup !== null); // not sure what this would mean
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
        vertexBoneTable = {vertexBoneEntries};
    }

    const vertexDataOffs = view.getUint32(0x10);
    const vertexCount = view.getUint16(0x32);
    const vertexWordCount = view.getUint16(vertexDataOffs + 0x16);
    const vertexData = buffer.subarray(vertexDataOffs + 0x18, vertexCount * 0x10);

    const textureSetupOffs = view.getUint16(0x08);
    const textureSetupSize = view.getUint32(textureSetupOffs + 0x00);
    const textureCount = view.getUint8(textureSetupOffs + 0x05);
    const textureDataOffs = textureSetupOffs + 0x08 + (textureCount * 0x10);
    const textureData = buffer.slice(textureDataOffs, textureSetupOffs + textureSetupSize);

    const renderModeIndex = zMode + (opaque? 0 : 3);

    const segmentBuffers: ArrayBufferSlice[] = [];
    segmentBuffers[0x01] = vertexData;
    segmentBuffers[0x02] = textureData;
    segmentBuffers[0x03] = renderModeBuffers[renderModeIndex];
    segmentBuffers[0x09] = f3dexData;
    segmentBuffers[0x0F] = textureData;

    const sharedOutput = new F3DEX.RSPSharedOutput();
    sharedOutput.setVertexBufferFromData(vertexData.createDataView());
    const modelPoints: ModelPoint[] = [];

    const geoContext: GeoContext = {
        buffer,

        segmentBuffers,
        sharedOutput,
        modelPoints,

        nodeStack: [],
    };

    const rootNode = pushGeoNode(geoContext, 0);
    runGeoLayout(geoContext, geoOffs);
    const rootNode2 = popGeoNode(geoContext);
    assert(rootNode === rootNode2);

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
                xPhase: 0, yPhase: 0, dy: 0, dtx: 0, dty: 0, colorFactor: 1
            };

            if (type === VertexEffectType.RipplingWater) {
                // rippling water computes its amplitude from the bounding box
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

    return { animationSetup, vertexBoneTable, vertexEffects, rootNode, sharedOutput, modelPoints };
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
    }
}
