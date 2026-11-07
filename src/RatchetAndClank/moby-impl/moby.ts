import { mat4, quat, vec3 } from "gl-matrix";
import { assert } from "../../util";
import { MobyInstance, TieInstance } from "../bin-gameplay";
import { LevelResources } from "../loader";
import { matrixToNoclipSpace, MegaBuffer, noclipSpaceFromRatchetSpace, OcclusionChecker } from "../utils";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../../gfx/render/GfxRenderInstManager";
import { Frustum } from "../../Geometry";
import { Water_A } from "./water-a";
import { Water_Gaspar } from "./water-gaspar";
import { Water_C } from "./water-c";
import { Water_D } from "./water-d";
import { Water_E } from "./water-e";
import { Water_F } from "./water-f";
import { Water_G } from "./water-g";
import { Water_H } from "./water-h";
import { Water_I } from "./water-i";
import { WaterRenderer } from "../render-water";
import { GfxDevice, GfxSampler, GfxTexture } from "../../gfx/platform/GfxPlatform";
import { GoldBolt } from "./gold-bolt";
import { TieRotationAnimator } from "./tie-rotation-animator";
import { Trophy } from "./trophy";

export interface MobyConstructor {
    new(mobyInstance: MobyInstance, resources: LevelResources): MobyImpl;
}

export interface MobyImpl {
    update(drawKit: MobyDrawKit): void;
    drawAfterTies(drawKit: MobyDrawKit): void;
    drawAfterMobys(drawKit: MobyDrawKit): void;
    destroy(device: GfxDevice): void;
}

export interface MobyDrawKit {
    renderInstList: GfxRenderInstList;
    renderHelper: GfxRenderHelper;
    instanceDataBuffer: MegaBuffer
    dt: number;
    cameraPosition: vec3;
    cameraForward: vec3;
    cameraFrustum: Frustum;
    occlusionChecker: OcclusionChecker | null;
    lodSetting: number;
    lodBias: number;
    renderers: {
        water: WaterRenderer;
    },
    fxTextures: GfxTexture[] | null,
    fxSampler: GfxSampler,
}

export function ownPvars(mobyInstance: MobyInstance, resources: LevelResources) {
    assert(resources.pvars !== null);
    return resources.pvars[mobyInstance.pvarIndex]?.data ?? null;
}

export function ownClass(mobyInstance: MobyInstance, resources: LevelResources) {
    assert(resources.mobyClasses !== null);
    return resources.mobyClasses.get(mobyInstance.oClass) ?? null;
}

export function updateTransform(mobyInstance: MobyInstance) {
    mat4.fromRotationTranslationScale(mobyInstance._matrixPretransformed,
        quat.fromEuler(quat.create(), mobyInstance.rotation.x * (180 / Math.PI), mobyInstance.rotation.y * (180 / Math.PI), mobyInstance.rotation.z * (180 / Math.PI)),
        vec3.fromValues(mobyInstance.position.x, mobyInstance.position.y, mobyInstance.position.z),
        vec3.fromValues(mobyInstance.scale, mobyInstance.scale, mobyInstance.scale),
    );
    mat4.mul(mobyInstance._matrixPretransformed, noclipSpaceFromRatchetSpace, mobyInstance._matrixPretransformed);
    mobyInstance._positionPretransformed = mat4.getTranslation(vec3.create(), mobyInstance._matrixPretransformed);
    mobyInstance._scalePretransformed = vec3.length(vec3.fromValues(mobyInstance._matrixPretransformed[0], mobyInstance._matrixPretransformed[1], mobyInstance._matrixPretransformed[2]));
}

export function updateTransformForTie(tie: TieInstance) {
    tie._matrixPretransformed = matrixToNoclipSpace(tie.matrix);
    tie._positionPretransformed = mat4.getTranslation(vec3.create(), tie._matrixPretransformed);
    tie._scalePretransformed = vec3.length(vec3.fromValues(tie._matrixPretransformed[0], tie._matrixPretransformed[1], tie._matrixPretransformed[2]));
}

export function cuboidContainsPoint(point: vec3, resources: LevelResources, cuboidIndex: number): boolean {
    const cuboid = resources.shapesCuboids![cuboidIndex];
    const matrix = cuboid.matrix;
    const inverse = cuboid.inverseMatrix;

    // not so sure about this math
    const pointFromCenter = vec3.subtract(vec3.create(), point, vec3.fromValues(matrix[12], matrix[13], matrix[14]));
    const localPoint = vec3.fromValues(
        vec3.dot(pointFromCenter, vec3.fromValues(inverse[0], inverse[1], inverse[2])),
        vec3.dot(pointFromCenter, vec3.fromValues(inverse[4], inverse[5], inverse[6])),
        vec3.dot(pointFromCenter, vec3.fromValues(inverse[8], inverse[9], inverse[10])),
    );

    return Math.abs(localPoint[0]) <= 1
        && Math.abs(localPoint[1]) <= 1
        && Math.abs(localPoint[2]) <= 1;
}

export const MOBY_IMPL_REGISTRY = new Map<number, MobyConstructor>([
    [19, Water_E],
    [293, Water_C],
    [317, Water_Gaspar],
    [327, Water_F],
    [460, Water_F],
    [600, Water_D],
    [676, Water_A],
    [678, Water_A],
    [751, Water_E],
    [761, Water_A],
    [831, Water_E],
    [854, Water_F],
    [879, Water_F],
    [902, Water_E],
    [941, Water_E],
    [943, Water_E],
    [944, Water_E],
    [948, Water_E],
    [949, Water_E],
    [950, Water_E],
    [951, Water_E],
    [952, Water_E],
    [953, Water_E],
    [954, Water_E],
    [955, Water_E],
    [958, Water_E],
    [961, Water_E],
    [962, Water_E],
    [967, Water_E],
    [968, Water_E],
    [969, Water_E],
    [970, Water_E],
    [971, Water_E],
    [994, Water_F],
    [1018, Water_F],
    [1062, Water_H],
    [1083, Water_H],
    [1134, GoldBolt],
    [1111, Water_I],
    [1158, Water_E],
    [1225, Water_A],
    [1260, Water_F],
    [1263, Water_E],
    [1393, Water_E],
    [1418, Water_C],
    [1402, Water_H],
    [1405, Water_G],
    [1406, Water_G],
    [1407, Water_G],
    [1408, Water_G],
    [1409, Water_G],
    [1565, Water_G],
    [1567, Water_G],
    [1649, Water_D],
    [1901, Water_D],
    [1903, Water_D],
    [1919, Water_D],
    [2366, Water_I],
    [2583, Water_I],
    [3174, TieRotationAnimator],
    [4789, Water_I],
    [7501, Trophy],
    [7502, Trophy],
    [7503, Trophy],
    [7504, Trophy],
    [7505, Trophy],
    [7506, Trophy],
    [7507, Trophy],
    [7508, Trophy],
    [7509, Trophy],
]);

export const MOBYS_IMMUNE_TO_CHUNKING = new Set<number>([
    // water planes
    2366,
    2583,
    4789,
]);
