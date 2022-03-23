import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { hexzero0x, readString } from "../util";

//#region GameObject
interface ReferenceBinding {
    unk_0x00: number;
    unk_0x08: number,
    unk_0x0C: number,
    name: string
}

interface CollisionBinding {
    referenceBindings: ReferenceBinding[],
}

interface AnimationCurve {

}

interface AnimationClip {
    unk_0x00: number,
    unk_0x04: number,
    unk_layer_0x18: number,
    animCurves: AnimationCurve
}

interface GameObject_Unk1 {

}

interface SkeletalAnimator {

}

interface GameObject {
    position: vec3,
    scale: vec3,
    collisionBinding: CollisionBinding,
    // animation: Animation,
    // skeletalAnimator: SkeletalAnimator,
    matrix: mat4
}

//#endregion GameObject

interface Unk0x72 {

}

//#region TrackNode

interface TrackCheckpoint {
    curveTimeStart: number,
    curveTimeEnd: number,

    trackDistanceStart: number,
    tangentStart: vec3,
    positionStart: vec3,

    trackDistanceEnd: number,
    tangentEnd: vec3,
    positionEnd: vec3,

    transformDistanceEnd: number,
    transformDistanceStart: number,
    trackWidth: number,
    isTrackContinuousStart: boolean,
    isTrackContinuousEnd: boolean,
}

interface TopologyParameters {

}

interface TrackCornerTopology {

}

interface TrackUnkOption2 {

}

interface TrackSegment {
    topologyMetadata: number,
    trackProperty: number,
    perimeterOptions: number,
    pipeCylinderOptions: number,
    trackAnimationCurves: TopologyParameters,
    hairpinCornerTopology: TrackCornerTopology,
    childIndexe: number[],
    localScale: vec3,
    localRotation: vec3,
    localPosition: vec3,
    /*
    unk_0x38: number, // mixed flags
    unk_0x39: number, // exclusive flags
    unk_0x3A: number, // mixed flags
    unk_0x3B: number, // mixed flags
    */
    railHeightRight: number,
    railHeightLeft: number,
    unk_0x4C: TrackUnkOption2, // 0, 1, 2, 3
}

interface TrackNode {
    next_index_increase: number,
    checkpoints: TrackCheckpoint[],
    // segment: TrackSegment,
}

//#endregion TrackNode

interface Header {
    unk_0x00: number,
    unk_0x04: number,
    trackNodeCount: number,
    trackNodeAbsPtr: number,
    unk_0x10: number,
    unk_0x14: number,
    unk_0x18: number,
    unk_0x1C: number,
    unk_0x20: number,
    headerSize: number,
    gameObjectCount: number,
    unk_0x4C: number, // One of these not in AX
    unk_0x50: number, // One of these not in AX
    gameObjectAbsPtr: number,
    unk_0x58: number,
    unk_0x60: number,
    unk_0x64: number,
    unk_0x68: number,
    unk_0x6C: number,
    unk_0x70: number,
    unk_0x7C: number,
    unk_0x80: number,
    unk_0x84: number,
    trackInfoAbsPtr: number,
    unk_0x94: number,
    unk_0x98: number,
    unk_0x9C: number,
    unk_0xA0: number,
    unk_0xA4: number,
    unk_0xA8: number,
    unk_0xAC: number,
    unk_0xB0: number,
    unk_0xB4: number,
    unk_0xB8: number,
    unk_0xBC: number,
    unk_0xC0: number,
    unk_0xC4: number,
    unk_0xC8: number,
    unk_0xCC: number,
    unk_0xD0: number,
    unk_0xD4: number,
}

export interface ColiScene{
    header: Header,
    trackNodes: TrackNode[],
    gameObjects: GameObject[],
}

function parseAnimationCurve(): AnimationCurve {


    return {};
}

function parseGameObject(buffer: ArrayBufferSlice, offs: number): GameObject {
    function paresReferenceBinding(buffer: ArrayBufferSlice, offs: number): ReferenceBinding {
        const view = buffer.createDataView();

        const unk_0x00 = view.getUint32(offs + 0x00);
        const nameAbsPtr = view.getUint32(offs + 0x04);
        const unk_0x08 = view.getUint32(offs + 0x08);
        const unk_0x0C = view.getUint32(offs + 0x0C);
        const name = readString(buffer, nameAbsPtr);

        return { unk_0x00, unk_0x08, unk_0x0C, name }
    }

    function parseCollisionBinding(buffer: ArrayBufferSlice, offs: number): CollisionBinding {
        const view = buffer.createDataView();
        
        const unk_0x00 = view.getUint32(offs + 0x00);
        const unk_0x04 = view.getInt32(offs + 0x04);
        const referenceBindingAbsPtr = view.getUint32(offs + 0x08);
        const collisionAbsPtr = view.getUint32(offs + 0x0C);

        const referenceBindings: ReferenceBinding[] = [];
        let referenceBindingoffs = referenceBindingAbsPtr;
        for (let i = 0; i < unk_0x04; i++){
            referenceBindings.push( paresReferenceBinding(buffer, referenceBindingoffs) );
            referenceBindingoffs += 0x10;
        }
        
        return { referenceBindings }
    }
    
    function parseAnimation(buffer: ArrayBufferSlice, offs: number): AnimationClip {
        const view = buffer.createDataView();
        const zero_0x08: number[] = [];
        const animCurves: AnimationCurve[] = [];

        const unk_0x00 = view.getFloat32(offs + 0x00);
        const unk_0x04 = view.getFloat32(offs + 0x04);
        for (let i = 0; i < 0x10; i+=4) {
            zero_0x08.push
        }
        const unk_layer_0x18 = view.getUint32(offs + 0x18);
        /// <summary>
        /// idx: 0,1,2: scale
        /// idx: 3,4,5: rotation
        /// idx: 6,7,8: position
        /// idx: 9: unused?
        /// idx: 10: light
        /// </summary>
        let kSizeCurvesPtrs = 6 + 5;
        for (let i = 0; i < kSizeCurvesPtrs; i++) {
            animCurves.push( parseAnimationCurve() );
        }

        return { unk_0x00, unk_0x04, unk_layer_0x18, animCurves };
    }

    function parseUnknown1(buffer: ArrayBufferSlice, offs: number): GameObject_Unk1 {
        // console.log(`offset: ${hexzero0x(offs)} Unknown1`);
        return {};
    }

    function parseSkeletalAnimator(buffer: ArrayBufferSlice, offs: number): SkeletalAnimator {

        return {};
    }

    function parseMatrix(buffer: ArrayBufferSlice): mat4{
        const view = buffer.createDataView();
        const transform = mat4.create();
    
        const m00 = view.getFloat32(0x00);
        const m01 = view.getFloat32(0x04);
        const m02 = view.getFloat32(0x08);
        const m03 = view.getFloat32(0x0C);
        const m10 = view.getFloat32(0x10);
        const m11 = view.getFloat32(0x14);
        const m12 = view.getFloat32(0x18);
        const m13 = view.getFloat32(0x1C);
        const m20 = view.getFloat32(0x20);
        const m21 = view.getFloat32(0x24);
        const m22 = view.getFloat32(0x28);
        const m23 = view.getFloat32(0x2C);
        const matrix = mat4.fromValues(
            m00, m10, m20, 0,
            m01, m11, m21, 0,
            m02, m12, m22, 0,
            m03, m13, m23, 1,
        );
    
        return matrix;
    }

    const view = buffer.createDataView();
    const position = vec3.create();
    const scale = vec3.create();
    
    const unk_0x00 = view.getUint32(offs + 0x00);
    const unk_0x04 = view.getUint32(offs + 0x04);
    const collisionBindingAbsPtr = view.getUint32(offs + 0x08);
    vec3.set(position, view.getUint32(offs + 0x0C), view.getUint32(offs + 0x10), view.getUint32(offs + 0x14));
    const unk_0x18 = view.getUint16(offs + 0x18);
    const unk_0x1A = view.getUint16(offs + 0x1A)
    const unk_0x1C = view.getUint32(offs + 0x1C);
    const unk_0x1E = view.getUint16(offs + 0x1E);
    vec3.set(scale, view.getUint32(offs + 0x20), view.getUint32(offs + 0x24), view.getUint32(offs + 0x28));
    const zero_0x2C = view.getUint32(offs + 0x2C);
    const animationAbsPtr = view.getUint32(offs + 0x30);
    const unkAbsPtr_0x34 = view.getUint32(offs + 0x34);
    const skeletalAnimatorAbsPtr = view.getUint32(offs + 0x38);
    const matrixAbsPtr = view.getUint32(offs + 0x3C);

    const collisionBinding = parseCollisionBinding(buffer, collisionBindingAbsPtr);
    const animation = animationAbsPtr == 0 ? null : parseAnimation(buffer, animationAbsPtr);
    const unk1 = unkAbsPtr_0x34 == 0 ? null : parseUnknown1(buffer, unkAbsPtr_0x34);
    const skeletalAnimator = skeletalAnimatorAbsPtr == 0 ? null : parseSkeletalAnimator(buffer, skeletalAnimatorAbsPtr);
    const matrix = matrixAbsPtr == 0 ? mat4.create() : parseMatrix( buffer.slice(matrixAbsPtr, matrixAbsPtr + 0x30) );

    return { position, scale, collisionBinding, /*animation, skeletalAnimator, */matrix };
}

function parseTrackNode(buffer: ArrayBufferSlice, offs: number): TrackNode {
    function parseTrackPoint(buffer: ArrayBufferSlice, offs: number): TrackCheckpoint {
        const view = buffer.createDataView();
        const tangentStart = vec3.create();
        const positionStart = vec3.create();
        const tangentEnd = vec3.create();
        const positionEnd = vec3.create();

        const curveTimeStart = view.getFloat32(0x00);
        const curveTimeEnd = view.getFloat32(0x04);
        const trackDistanceStart = view.getFloat32(0x08);
        vec3.set(tangentStart, view.getFloat32(0x0C), view.getFloat32(0x10), view.getFloat32(0x14));
        vec3.set(positionStart, view.getFloat32(0x18), view.getFloat32(0x1C), view.getFloat32(0x20));
        const trackDistanceEnd = view.getFloat32(0x24);
        vec3.set(tangentEnd, view.getFloat32(0x28), view.getFloat32(0x2C), view.getFloat32(0x30));
        vec3.set(positionEnd, view.getFloat32(0x34), view.getFloat32(0x38), view.getFloat32(0x3C));
        const transformDistanceEnd = view.getFloat32(0x40);
        const transformDistanceStart = view.getFloat32(0x44);
        const trackWidth = view.getFloat32(0x48);
        const isTrackContinuousStart = (view.getUint8(0x4C) == 0x01);
        const isTrackContinuousEnd = (view.getUint8(0x4D) == 0x01);

        return { 
            curveTimeStart, curveTimeEnd,        
            trackDistanceStart, tangentStart, positionStart,
            trackDistanceEnd, tangentEnd, positionEnd,
            transformDistanceEnd, transformDistanceStart, trackWidth, 
            isTrackContinuousStart, isTrackContinuousEnd
        }
    }

    // function parseTrackTransform(buffer: ArrayBufferSlice, offs: number): TrackSegment {
        

    //     const view = buffer.createDataView();
    //     const localScale = vec3.create();
    //     const localRotation = vec3.create();
    //     const localPosition = vec3.create();
        
    //     const childIndexe = 0x00;

    //     const topologyMetadata = view.getInt8(0x00);
    //     const trackProperty = view.getInt8(0x01);
    //     const perimeterOptions = view.getInt8(0x02);
    //     const pipeCylinderOptions = view.getInt8(0x03);

    //     const trackAnimationCurvesPtr = view.getInt32(0x04);
    //     const trackAnimationCurves = ;

    //     const hairpinCornerTopologyPtr = view.getInt32(0x08);
    //     const hairpinCornerTopology = ;

    //     const childrenCount = view.getInt32(0x0C);
    //     const childrenPtrs = view.getInt32(0x10);

    //     vec3.set(localScale, view.getFloat32(0x14), view.getFloat32(0x18), view.getFloat32(0x1C));
    //     vec3.set(localRotation, view.getFloat32(0x20), view.getFloat32(0x24), view.getFloat32(0x28));
    //     vec3.set(localPosition, view.getFloat32(0x2C), view.getFloat32(0x30), view.getFloat32(0x34));
    //     const unk_0x38 = view.getInt8(0x38);
    //     const unk_0x39 = view.getInt8(0x39);
    //     const unk_0x3A = view.getInt8(0x3A);
    //     const unk_0x3B = view.getInt8(0x3B);
    //     const railHeightRight = view.getFloat32(0x3C);
    //     const railHeightLeft = view.getFloat32(0x40);
    //     const unk_0x4C = ;

    //     return {
    //         childIndexe,
    //         topologyMetadata, trackProperty, perimeterOptions, pipeCylinderOptions,
    //         trackAnimationCurves, hairpinCornerTopology,
    //         localScale, localRotation, localPosition,
    //         /*unk_0x38, unk_0x39, unk_0x3A, unk_0x3B,*/
    //         railHeightRight, railHeightLeft, unk_0x4C
    //     }
    // }

    const view = buffer.createDataView();
    const checkpoints: TrackCheckpoint[] = [];

    const next_index_increase = view.getInt32(0x00);
    const trackPoint_absPtr = view.getInt32(0x04);
    const trackTransform_absPtr = view.getInt32(0x08);
    let trackPoint_ptr = 0x00;
    for (let i = 0; i < next_index_increase; i++){
        offs = trackPoint_ptr + (i * 0x0C);
        checkpoints.push( parseTrackPoint(buffer, trackPoint_ptr) );
    }
    // const segment = parseTrackTransform(buffer, trackTransform_absPtr);
    return { next_index_increase, checkpoints/*, segment*/ };
}

function parseHeader(buffer: ArrayBufferSlice, isAX: boolean): Header{
    const view = buffer.createDataView();

    const unk_0x00 = view.getInt32(0x00);
    const unk_0x04 = view.getInt32(0x04);
    const trackNodeCount = view.getInt32(0x08);
    const trackNodeAbsPtr = view.getInt32(0x0C);
    const unk_0x10 = view.getInt32(0x10);
    const unk_0x14 = view.getInt32(0x14);
    const unk_0x18 = view.getInt32(0x18);
    const unk_0x1C = view.getInt32(0x1C);
    const unk_0x20 = view.getInt32(0x20);
    const headerSize = view.getInt32(0x24);
    let offs = 0x28;
    const zero_0x28: number[] = [];
    for (let i = 0; i <= 0x20; i+=4) {
        zero_0x28.push( view.getInt32(offs + i) );
    }
    const gameObjectCount = isAX ? 0x00 : view.getInt32(0x48); // Only GX's COLI_SCENE get this value. AX set 0x00(dummy).
    offs = isAX ? 0x48 : 0x4C;
    const unk_0x4C = view.getInt32(offs + 0x00); // GX:0x4C AX:0x48
    const unk_0x50 = view.getInt32(offs + 0x04);
    const gameObjectAbsPtr = view.getInt32(offs + 0x08);
    const unk_0x58 = view.getInt32(offs + 0x0C);
    const zero_0x5C = view.getInt32(offs + 0x10);
    const unk_0x60 = view.getInt32(offs + 0x14);
    const unk_0x64 = view.getInt32(offs + 0x18);
    const unk_0x68 = view.getInt32(offs + 0x1C);
    const unk_0x6C = view.getInt32(offs + 0x20);
    const unk_0x70 = view.getInt32(offs + 0x24);
    const zero_0x74 = view.getInt32(offs + 0x28);
    const zero_0x78 = view.getInt32(offs + 0x2C);
    const unk_0x7C = view.getInt32(offs + 0x30);
    const unk_0x80 = view.getInt32(offs + 0x34);
    const unk_0x84 = view.getInt32(offs + 0x38);
    const zero_0x88 = view.getInt32(offs + 0x3C);
    const zero_0x8C = view.getInt32(offs + 0x40);
    const trackInfoAbsPtr = view.getInt32(offs + 0x44);
    const unk_0x94 = view.getInt32(offs + 0x48);
    const unk_0x98 = view.getInt32(offs + 0x4C);
    const unk_0x9C = view.getInt32(offs + 0x50);
    const unk_0xA0 = view.getInt32(offs + 0x54);
    const unk_0xA4 = view.getInt32(offs + 0x58);
    const unk_0xA8 = view.getInt32(offs + 0x5C);
    const unk_0xAC = view.getInt32(offs + 0x60);
    const unk_0xB0 = view.getInt32(offs + 0x64);
    const unk_0xB4 = view.getInt32(offs + 0x68);
    const unk_0xB8 = view.getInt32(offs + 0x6C);
    const unk_0xBC = view.getInt32(offs + 0x70);
    const unk_0xC0 = view.getInt32(offs + 0x74);
    const unk_0xC4 = view.getInt32(offs + 0x78);
    const unk_0xC8 = view.getInt32(offs + 0x7C);
    const unk_0xCC = view.getInt32(offs + 0x80);
    const unk_0xD0 = view.getInt32(offs + 0x84);
    const unk_0xD4 = view.getInt32(offs + 0x88); // GX:0xD4 AX:0xD0
    offs = offs + 0x8C;
    const zero_0xD8 :Number[] = [];
    for (let i = 0; i < 0x24; i+=4) {
        zero_0xD8.push( view.getInt32(offs + i) );
    }

    return { 
        unk_0x00, unk_0x04, trackNodeCount, trackNodeAbsPtr,
        unk_0x10, unk_0x14, unk_0x18, unk_0x1C,
        unk_0x20, headerSize, gameObjectCount, /*,*/
        /*, , ,*/unk_0x4C, 
        unk_0x50, gameObjectAbsPtr, unk_0x58, /*,*/
        unk_0x60, unk_0x64, unk_0x68, unk_0x6C,
        unk_0x70, /*, , */unk_0x7C, 
        unk_0x80, unk_0x84,/*, , */
        trackInfoAbsPtr, unk_0x94, unk_0x98, unk_0x9C,
        unk_0xA0, unk_0xA4, unk_0xA8, unk_0xAC,
        unk_0xB0, unk_0xB4, unk_0xB8, unk_0xBC,
        unk_0xC0, unk_0xC4, unk_0xC8, unk_0xCC,
        unk_0xD0, unk_0xD4
    };
}

export function parse(buffer: ArrayBufferSlice): ColiScene {
    const view = buffer.createDataView();
    const trackNodes: TrackNode[] = [];
    const gameObjects: GameObject[] = [];
    let offs = 0x00;

    const headerSize = view.getInt32(0x24);
    const isAX = headerSize == 0xF8; // 0xF8 treat as AX. not 0xF8(0xFC) treat as GX.
    const header = parseHeader(buffer.slice(0x00, headerSize), isAX);
    offs = header.trackNodeAbsPtr;
    for (let i = 0; i < header.trackNodeCount; i++){
        trackNodes.push( parseTrackNode(buffer, offs) );
        offs += 0x0C;
    }

    offs = header.gameObjectAbsPtr;
    for (let i = 0; i < header.gameObjectCount; i++){
        gameObjects.push( parseGameObject(buffer, offs) );
        offs += 0x40;
    }
    return { header, trackNodes, gameObjects };
}