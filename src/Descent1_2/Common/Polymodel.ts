import { mat3, mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert, nArray } from "../../util";
import { DescentPalette } from "./AssetTypes";
import { DescentDataReader } from "./DataReader";

export const POLYOBJ_MAX_SUBMODELS = 10;
export const POLYOBJ_MAX_GUNS = 8;

export class DescentPolymodelSubmodel {
    constructor(
        public pointer: number,
        public offset: vec3,
        public renderOffset: vec3,
        public normal: vec3,
        public point: vec3,
        public radius: number,
        public parent: number,
        public bbMin: vec3,
        public bbMax: vec3,
        public submodels: DescentPolymodelSubmodel[],
    ) {}
}

export class DescentPolymodel {
    public data: ArrayBufferSlice;

    constructor(
        public id: number,
        public dataSize: number,
        public submodelCount: number,
        public submodels: DescentPolymodelSubmodel[],
        public bbMin: vec3,
        public bbMax: vec3,
        public radius: number,
        public textureCount: number,
        public texturePointerOffset: number,
        public lessDetailedModelId: number,
        public dyingModelId: number,
        public deadModelId: number,
    ) {
        this.data = new ArrayBufferSlice(new ArrayBuffer(2));
    }
}

export function readPolymodel(reader: DescentDataReader, id: number) {
    const submodelCount = reader.readInt32();
    assert(submodelCount <= POLYOBJ_MAX_SUBMODELS);
    const dataSize = reader.readInt32();
    reader.readInt32();
    const submodels = nArray(
        POLYOBJ_MAX_SUBMODELS,
        () =>
            new DescentPolymodelSubmodel(
                0,
                vec3.create(),
                vec3.create(),
                vec3.create(),
                vec3.create(),
                0,
                -1,
                vec3.create(),
                vec3.create(),
                [],
            ),
    );
    for (let i = 0; i < POLYOBJ_MAX_SUBMODELS; ++i)
        submodels[i].pointer = reader.readInt32();
    for (let i = 0; i < POLYOBJ_MAX_SUBMODELS; ++i)
        submodels[i].offset = reader.readFixVector();
    for (let i = 0; i < POLYOBJ_MAX_SUBMODELS; ++i)
        submodels[i].normal = reader.readFixVector();
    for (let i = 0; i < POLYOBJ_MAX_SUBMODELS; ++i)
        submodels[i].point = reader.readFixVector();
    for (let i = 0; i < POLYOBJ_MAX_SUBMODELS; ++i)
        submodels[i].radius = reader.readFix();
    for (let i = 0; i < POLYOBJ_MAX_SUBMODELS; ++i) {
        const parent = reader.readUint8();
        submodels[i].parent = parent;
        if (parent !== 255) {
            submodels[parent].submodels.push(submodels[i]);
        }
    }
    for (let i = 0; i < POLYOBJ_MAX_SUBMODELS; ++i)
        submodels[i].bbMin = reader.readFixVector();
    for (let i = 0; i < POLYOBJ_MAX_SUBMODELS; ++i)
        submodels[i].bbMax = reader.readFixVector();
    const bbMin = reader.readFixVector();
    const bbMax = reader.readFixVector();
    const radius = reader.readFix();
    const textureCount = reader.readUint8();
    const firstTexture = reader.readInt16();
    const lessDetailedModelId = reader.readUint8();
    return new DescentPolymodel(
        id,
        dataSize,
        submodelCount,
        submodels,
        bbMin,
        bbMax,
        radius,
        textureCount,
        firstTexture,
        lessDetailedModelId,
        -1,
        -1,
    );
}

export type DescentPolymodelMeshVertex = {
    position: vec3;
    normal: vec3;
    rgb_uvl: vec3;
};

type DescentPolymodelState = {
    polymodel: DescentPolymodel;
    vertices: vec3[];
    vertexStart: number;
    vertexEnd: number;
    matrix: mat4;
    callCache: Map<number, DescentPolymodelCall>;
    palette: DescentPalette | null;
};

type DescentPolymodelCall = {
    indices: number[];
    texture: number | null;
};

export type DescentPolymodelMesh = {
    vertices: DescentPolymodelMeshVertex[];
    calls: DescentPolymodelCall[];
};

function buildTriangleFan(
    calls: DescentPolymodelCall[],
    state: DescentPolymodelState,
    texture: number | null,
    vertexOffset: number,
    vertexCount: number,
) {
    const callCacheKey = texture ?? -1;
    let call: DescentPolymodelCall;
    if (!state.callCache.has(callCacheKey)) {
        call = { indices: [], texture };
        calls.push(call);
        state.callCache.set(callCacheKey, call);
    } else {
        call = state.callCache.get(callCacheKey)!;
    }

    const { indices } = call;
    for (let i = 2; i < vertexCount; ++i) {
        indices.push(vertexOffset);
        indices.push(vertexOffset + i - 1);
        indices.push(vertexOffset + i);
    }
}

function applyStateMatrix3(state: DescentPolymodelState, pos: vec3): vec3 {
    const m3 = mat3.create();
    const v3 = vec3.create();
    mat3.fromMat4(m3, state.matrix);
    vec3.transformMat3(v3, pos, m3);
    return v3;
}

function applyStateMatrix4(state: DescentPolymodelState, pos: vec3): vec3 {
    const v3 = vec3.create();
    vec3.transformMat4(v3, pos, state.matrix);
    return v3;
}

function vec3FromPalette([r, g, b]: [number, number, number]) {
    return vec3.fromValues(r / 255.0, g / 255.0, b / 255.0);
}

const GLOW_VALUES = [0.2, 0.0];

function executePolymodelCode(
    mesh: DescentPolymodelMesh,
    state: DescentPolymodelState,
    reader: DescentDataReader,
    submodel: DescentPolymodelSubmodel,
) {
    const { vertices, calls } = mesh;
    let glow = -1;
    while (true) {
        const pc = reader.offset;
        const opcode = reader.readInt16();
        switch (opcode) {
            case 0: // END
                return;
            case 1: {
                // DEFPOINTS
                // Not used
                const n = reader.readInt16();
                for (let i = 0; i < n; ++i) reader.readFixVector();
                break;
            }
            case 2: {
                // FLATPOLY
                const pointCount = reader.readInt16();
                reader.readFixVector();
                const normal = reader.readFixVector();
                const color16 = reader.readUint16();

                const points = new Array(pointCount);
                for (let i = 0; i < points.length; ++i)
                    points[i] = reader.readInt16();
                if (!(pointCount & 1)) reader.readInt16();

                const color =
                    state.palette !== null && color16 < state.palette.data.length
                        ? vec3FromPalette(state.palette.data[color16])
                        : vec3.fromValues(
                              ((color16 >> 10) & 31) / 31,
                              ((color16 >> 5) & 31) / 31,
                              (color16 & 31) / 31,
                          );

                const vertexStart = vertices.length;
                for (let i = 0; i < points.length; ++i) {
                    vertices.push({
                        position: applyStateMatrix4(
                            state,
                            state.vertices[points[i]],
                        ),
                        normal: applyStateMatrix3(state, normal),
                        rgb_uvl: color,
                    });
                }
                buildTriangleFan(
                    calls,
                    state,
                    null,
                    vertexStart,
                    points.length,
                );
                break;
            }
            case 3: {
                // TMAPPOLY
                const pointCount = reader.readInt16();
                reader.readFixVector();
                const normal = reader.readFixVector();
                const textureIndex = reader.readInt16();

                const points = new Array(pointCount);
                for (let i = 0; i < points.length; ++i)
                    points[i] = reader.readInt16();
                if (!(pointCount & 1)) reader.readInt16();

                const uvls = new Array(pointCount);
                for (let i = 0; i < points.length; ++i)
                    uvls[i] = reader.readFixVector();

                const vertexStart = vertices.length;
                for (let i = 0; i < points.length; ++i) {
                    vertices.push({
                        position: applyStateMatrix4(
                            state,
                            state.vertices[points[i]],
                        ),
                        normal: applyStateMatrix3(state, normal),
                        rgb_uvl: vec3.fromValues(
                            uvls[i][0],
                            uvls[i][1],
                            glow >= 0 ? GLOW_VALUES[glow] : 0,
                        ),
                    });
                }
                buildTriangleFan(
                    calls,
                    state,
                    textureIndex,
                    vertexStart,
                    points.length,
                );
                glow = -1;
                break;
            }
            case 4: {
                // SORTNORM
                reader.readInt16();
                const normal = reader.readFixVector();
                const point = reader.readFixVector();
                const backOffset = reader.readInt16();
                const frontOffset = reader.readInt16();
                const cameraPosition = vec3.create(); // doesn't matter with GL anyway
                const offsetPoint = vec3.create();
                vec3.sub(offsetPoint, cameraPosition, point);

                if (vec3.dot(offsetPoint, normal) > 0) {
                    executePolymodelCode(
                        mesh,
                        state,
                        reader.clone(pc + frontOffset),
                        submodel,
                    );
                    executePolymodelCode(
                        mesh,
                        state,
                        reader.clone(pc + backOffset),
                        submodel,
                    );
                } else {
                    executePolymodelCode(
                        mesh,
                        state,
                        reader.clone(pc + backOffset),
                        submodel,
                    );
                    executePolymodelCode(
                        mesh,
                        state,
                        reader.clone(pc + frontOffset),
                        submodel,
                    );
                }
                break;
            }
            case 5: {
                // RODBM
                // Not used
                reader.offset += 34;
                break;
            }
            case 6: {
                // SUBCALL
                const submodelNum = reader.readInt16();
                const positionOffset = reader.readFixVector();
                const modelOffset = reader.readInt16();
                reader.readInt16();

                const submodel = state.polymodel.submodels[submodelNum];
                const matrix = mat4.create();
                mat4.translate(matrix, state.matrix, positionOffset);
                executePolymodelCode(
                    mesh,
                    { ...state, matrix },
                    reader.clone(pc + modelOffset),
                    submodel,
                );
                break;
            }
            case 7: {
                // DEFPSTART
                const pointCount = reader.readInt16();
                const pointOffset = reader.readInt16();
                reader.readInt16();

                for (let i = 0; i < pointCount; ++i) {
                    state.vertices[i + pointOffset] = reader.readFixVector();
                }

                state.vertexStart = pointOffset;
                state.vertexEnd = pointOffset + pointCount;
                break;
            }
            case 8: {
                // GLOW
                glow = reader.readInt16();
                break;
            }
            default:
                throw new Error(`unrecognized polymodel opcode ${opcode}`);
        }
    }
}

export function makePolymodelMesh(
    polymodel: DescentPolymodel,
    palette: DescentPalette | null,
): DescentPolymodelMesh {
    if (polymodel.data === null) throw new Error("polymodel data not loaded");
    const reader = new DescentDataReader(polymodel.data);
    const mesh: DescentPolymodelMesh = { vertices: [], calls: [] };
    const matrix = mat4.create();
    mat4.identity(matrix);
    const state: DescentPolymodelState = {
        polymodel,
        vertices: nArray(1000, () => vec3.create()),
        vertexStart: 0,
        vertexEnd: 0,
        matrix: matrix,
        callCache: new Map(),
        palette,
    };
    executePolymodelCode(mesh, state, reader, polymodel.submodels[0]);
    return mesh;
}
