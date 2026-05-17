import { mat4 } from "gl-matrix";
import { DataViewExt } from "./DataViewExt";
import { matrixToNoclipSpace } from "./utils";

export type GameplayHeader = ReturnType<typeof readGameplayHeader>;
export function readGameplayHeader(view: DataViewExt) {
    /*
    // https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay.cpp#L113
    struct GameplayHeader {
        // 0x0 
        int32 levelSettings;
        // 0x4 - InstanceBlock<DirectionLightInstance>
        int32 directionLightInstances;
        // 0x8 - InstanceBlock<CameraInstance>
        int32 cameraInstances;
        // 0xc - InstanceBlock<SoundInstance>
        int32 soundInstances;
        // 0x10 - 0x2c
        // help message fields
        // 0x30
        int32 tieClasses; // just an array of o_class numbers, not class definitions
        // 0x34 - InstanceBlock<TieInstance>
        int32 tieInstances;
        // 0x38
        int32 shrubClasses;
        // 0x3c - InstanceBlock<ShrubInstance>
        int32 shrubInstances;
        // 0x40
        int32 mobyClasses;
        // 0x44 (not the same InstanceBlock structure as the other instance blocks)
        int32 mobyInstances;
        // 0x48
        int32 mobyGroupInstances;
        // 0x4c
        int32 sharedData;
        // 0x50
        int32 pvarMobyLinks;
        // 0x54
        int32 pvarTable;
        // 0x58
        int32 pvarData;
        // 0x5c
        int32 pvarRelativePointers;
        // 0x60
        int32 shapesCuboids;
        // 0x64
        int32 shapesSpheres;
        // 0x68
        int32 shapesCylinders;
        // 0x6c
        int32 shapesPills;
        // 0x70
        int32 paths;
        // 0x74
        int32 grindPaths;
        // 0x78
        int32 pointLightGrid;
        // 0x7c
        int32 pointLightInstances;
        // 0x80
        int32 envTransitions;
        // 0x84
        int32 camColGrid;
        // 0x88
        int32 envSamplePoints;
        // 0x8c
        int32 occlusionMappings;
    }
    */
    return {
        levelSettings: view.getInt32(0x0),
        tieClasses: view.getInt32(0x30),
        tieInstances: view.getInt32(0x34),
        shrubClasses: view.getInt32(0x38),
        shrubInstances: view.getInt32(0x3c),
        mobyInstances: view.getInt32(0x44),
        directionLightInstances: view.getInt32(0x4),
        pointLightInstances: view.getInt32(0x7c),
        shapesCuboids: view.getInt32(0x60),
        shapesSpheres: view.getInt32(0x64),
        shapesCylinders: view.getInt32(0x68),
        shapesPills: view.getInt32(0x6c),
        paths: view.getInt32(0x70),
        grindPaths: view.getInt32(0x74),
    }
}

export interface LevelSettings {
    backgroundColor: { r: number, g: number, b: number },
    fogColor: { r: number, g: number, b: number },
    fogNearDistance: number,
    fogFarDistance: number,
    fogNearIntensity: number,
    fogFarIntensity: number,
    deathHeight: number,
    shipPosition: { x: number, y: number, z: number },
    shipRotationZ: number,
    shipPath: number,
    shipCameraCuboidStart: number,
    shipCameraCuboidEnd: number,
}
export const SIZEOF_LEVEL_SETTINGS_1 = 0x50;
export function readLevelSettings(view: DataViewExt): LevelSettings {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_misc.inl#L24
    */
    return {
        backgroundColor: view.getInt32_Rgb(0),
        fogColor: view.getInt32_Rgb(0xc),
        fogNearDistance: view.getFloat32(0x18), // distance in world space multiplied by 1024
        fogFarDistance: view.getFloat32(0x1c),
        fogNearIntensity: view.getFloat32(0x20), // 255 means zero fog, 0 means full fog
        fogFarIntensity: view.getFloat32(0x24),
        deathHeight: view.getFloat32(0x28),
        shipPosition: view.getFloat32_Xyz(0x2c),
        shipRotationZ: view.getFloat32(0x38),
        shipPath: view.getInt32(0x3c),
        shipCameraCuboidStart: view.getInt32(0x40),
        shipCameraCuboidEnd: view.getInt32(0x44),
    }
}

export function readClassPositionBlock(view: DataViewExt) {
    /*
    struct ClassPositionBlock {
        int32 oClassCount;
        int32 oClasses[oClassCount];
    }
    */
    const oClassCount = view.getInt32(0);
    const oClasses = view.subdivide(4, oClassCount, 4).map(view => view.getInt32(0));
    return oClasses;
}

export interface TieInstance {
    instanceIndex: number,
    oClass: number,
    drawDistance: number,
    occlusionIndex: number,
    matrix: mat4,
    _matrixInNoclipSpace: mat4,
    ambientRgbas: Uint16Array,
    directionalLights: number[],
    uid: number,
}
export const SIZEOF_TIE_INSTANCE = 0xe0;
export function readTieInstance(view: DataViewExt, instanceIndex: number): TieInstance {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_classes.inl#L611
    */

    const matrix = view.getMat4Slice(0x10).slice();

    return {
        instanceIndex,
        oClass: view.getInt32(0x0),
        drawDistance: view.getInt32(0x4),
        occlusionIndex: view.getInt32(0xc),
        matrix,
        _matrixInNoclipSpace: matrixToNoclipSpace(matrix),
        ambientRgbas: view.subview(0x50, 0x80).getTypedArrayView(Uint16Array), // array of 64 A1BGR5 colors
        directionalLights: view.getNibbleArray(0xd0, 2),
        uid: view.getInt32(0xd4),
    }
}

export interface MobyInstance {
    size: number,
    oClass: number,
    scale: number,
    drawDistance: number,
    updateDistance: number,
    position: { x: number, y: number, z: number },
    rotation: { x: number, y: number, z: number },
    group: number,
    isRooted: number,
    rootedDistance: number,
    pvarIndex: number,
    occlusion: number,
    modeBits: number,
    color: { r: number, g: number, b: number },
    light: number,
}
export const SIZEOF_MOBY_INSTANCE = 0x78;
export function readMobyInstance(view: DataViewExt): MobyInstance {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_classes.inl#L58
    */

    return {
        size: view.getInt32(0x0),
        oClass: view.getInt32(0x18),
        scale: view.getFloat32(0x1c),
        drawDistance: view.getFloat32(0x20),
        updateDistance: view.getInt32(0x24),
        position: view.getFloat32_Xyz(0x30),
        rotation: view.getFloat32_Xyz(0x3c),
        group: view.getInt32(0x48),
        isRooted: view.getInt32(0x4c),
        rootedDistance: view.getFloat32(0x50),
        pvarIndex: view.getInt32(0x58),
        occlusion: view.getInt32(0x5c),
        modeBits: view.getInt32(0x60),
        color: view.getInt32_Rgb(0x64),
        light: view.getInt32(0x70),
    }
}

export interface ShrubInstance {
    oClass: number,
    drawDistance: number,
    matrix: mat4,
    _matrixInNoclipSpace: mat4,
    color: { r: number, g: number, b: number },
    directionalLights: number[],
}
export const SIZEOF_SHRUB_INSTANCE = 0x70;
export function readShrubInstance(view: DataViewExt): ShrubInstance {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_classes.inl#L673
    */

    const matrix = view.getMat4Slice(0x10).slice();

    return {
        oClass: view.getInt32(0x0),
        drawDistance: view.getFloat32(0x4),
        matrix,
        _matrixInNoclipSpace: matrixToNoclipSpace(matrix),
        color: view.getInt32_Rgb(0x50),
        directionalLights: view.getNibbleArray(0x60, 2),
    }
}


type InstanceBlock<T> = {
    count: number,
    instances: T[]
}
const SIZEOF_INSTANCE_BLOCK_HEADER = 0x10;
export function readInstanceBlock<T>(view: DataViewExt, instanceSize: number, readerFn: (buf: DataViewExt, i: number) => T): InstanceBlock<T> {
    /*
    struct InstanceBlockHeader<T> {
        // 0x0
        int32 count;
        int32 pad[3];
        // 0x10
        T instances[count];
    }
    */
    const count = view.getInt32(0);
    const instances = view.subdivide(SIZEOF_INSTANCE_BLOCK_HEADER, count, instanceSize).map((view, i) => readerFn(view, i));
    return {
        count,
        instances,
    }
}

export interface DirectionLightInstance {
    colorA: { r: number, g: number, b: number, a: number },
    directionA: { x: number, y: number, z: number, w: number },
    colorB: { r: number, g: number, b: number, a: number },
    directionB: { x: number, y: number, z: number, w: number },
};
export const SIZEOF_DIRECTION_LIGHT_INSTANCE = 0x40;
export function readDirectionLightInstance(view: DataViewExt): DirectionLightInstance {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_env.inl#L628
    */
    return {
        colorA: view.getFloat32_Rgba(0x0),
        directionA: view.getFloat32_Xyzw(0x10),
        colorB: view.getFloat32_Rgba(0x20),
        directionB: view.getFloat32_Xyzw(0x30),
    }
}

export interface PointLightInstance {
    position: Float32Array,
    radius: number,
    color: { r: number, g: number, b: number },
}
export const SIZEOF_POINT_LIGHT_INSTANCE = 0x20;
export function readPointLightInstance(view: DataViewExt): PointLightInstance {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_env.inl#L628
    */
    return {
        position: view.getVec3Slice(0x0),
        radius: view.getFloat32(0xc),
        color: view.getUint8_Rgb(0x10),
    }
}

export interface PathBlockHeader {
    splineCount: number,
    dataOffset: number,
    dataSize: number,
    pointers: number[],
}
export function readPathBlockHeader(view: DataViewExt): PathBlockHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_misc.inl#L357
    struct PathBlock {
        int32 splineCount;
        int32 dataOffset;
        int32 dataSize;
        int32 pad;
        int32 pointers[header.splineCount]; // path data is relative to PathBlock, at dataOffset + pointers[i]
    }
    */
    const splineCount = view.getInt32(0x0);
    return {
        splineCount,
        dataOffset: view.getInt32(0x4),
        dataSize: view.getInt32(0x8),
        pointers: view.getArrayOfNumbers(0x10, splineCount, Uint32Array),
    };
}
export function readGrindPathBlockHeader(view: DataViewExt): PathBlockHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/instancemgr/gameplay_impl_misc.inl#L402
    struct GrindPathBlock {
        int32 splineCount;
        int32 dataOffset;
        int32 dataSize;
        int32 pad;
        struct {
            f32vec4 boundingSphere;
            int32 unknown;
            int32 wrap;
            int32 inactive;
            int32 pad;
        } grindPathData[header.splineCount];
        int32 pointers[header.splineCount];
    }
    */
    const splineCount = view.getInt32(0x0);
    return {
        splineCount,
        dataOffset: view.getInt32(0x4),
        dataSize: view.getInt32(0x8),
        pointers: view.getArrayOfNumbers(0x10 + splineCount * 0x20, splineCount, Uint32Array),
    };
}

export function readPathBlock(view: DataViewExt) {
    const header = readPathBlockHeader(view);
    return header.pointers.map(offset => readSpline(view.subview(header.dataOffset + offset)));
}

export function readGrindPathBlock(view: DataViewExt) {
    const header = readGrindPathBlockHeader(view);
    return header.pointers.map(offset => readSpline(view.subview(header.dataOffset + offset)));
}

export interface Spline {
    count: number,
    points: { x: number, y: number, z: number, w: number }[],
}
export function readSpline(view: DataViewExt): Spline {
    /*
    struct Spline {
        // 0x0
        int32 count;
        // 0x4
        int32 pad[3];
        // 0x10
        f32vec4 points[count];
    }
    */
    const count = view.getInt32(0x0);
    const points = view.subdivide(0x10, count, 0x10).map(view => view.getFloat32_Xyzw(0));
    return {
        count,
        points,
    };
}
