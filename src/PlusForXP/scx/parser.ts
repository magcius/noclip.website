import { vec3 } from "gl-matrix";
import { Endianness, getSystemEndianness } from "../../endian.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { SCX } from "./types.js";
import { Token } from "./tokens.js";

type ParseState = {
    bytes: Uint8Array;
    dataView: DataView;
    offset: number;
};

const appended = <T>(a: T[] | undefined, v: T): T[] => {
    a ??= [];
    a.push(v);
    return a;
};

const guardedLoop = (state: ParseState, cases: { [key in Token]?: () => void }) => {
    while (state.offset < state.bytes.length) {
        const token: Token = state.bytes[state.offset++];
        if (token === Token.PopScope) return;
        cases[token]?.();
    }
};

// basic data parsers

const bracket = (state: ParseState, func: () => void) => {
    state.offset++;
    func();
    state.offset++;
};

const parseBoolean = (state: ParseState): boolean => {
    const token = state.bytes[state.offset++];
    if (token === Token.True) return true;
    if (token === Token.False) return false;
    console.warn("Not a boolean.");
    return false;
};

const parseString = (state: ParseState) => {
    const end = state.bytes.indexOf(0, state.offset);
    const bytes = state.bytes.subarray(state.offset + 1, end);
    state.offset = end + 1;
    return [...bytes].map((c) => String.fromCharCode(c)).join("");
};

const isLittleEndian = getSystemEndianness() === Endianness.LITTLE_ENDIAN;
type DataViewCall = (view: DataView, byteOffset: number) => number;
const createDataParser =
    (size: number, call: DataViewCall) =>
    (state: ParseState): number => {
        const value = call(state.dataView, state.offset);
        state.offset += size;
        return value;
    };

const numericParsers: { [key in Token]?: (state: ParseState) => number } = {
    [Token.Number]: createDataParser(4, (view, offset) => view.getFloat32(offset, isLittleEndian)),
    [Token.Integer]: createDataParser(4, (view, offset) => view.getInt32(offset, isLittleEndian)),
    [Token.Byte]: createDataParser(1, (view, offset) => view.getInt8(offset)),
    [Token.UnsignedByte]: createDataParser(1, (view, offset) => view.getUint8(offset)),
    [Token.Word]: createDataParser(2, (view, offset) => view.getInt16(offset, isLittleEndian)),
    [Token.UnsignedWord]: createDataParser(2, (view, offset) => view.getUint16(offset, isLittleEndian)),
};

const parseNumber = (state: ParseState, token?: Token) => {
    if (token === undefined) token = state.bytes[state.offset++];
    return numericParsers[token]!(state);
};

const parseNumberList = (state: ParseState) => {
    state.offset++;
    const values: number[] = [];
    while (true) {
        const count = parseNumber(state, Token.UnsignedByte);
        for (let i = 0; i < count; i++) {
            values.push(parseNumber(state, Token.Number));
        }
        // A full number list might spill over into its successor
        const isFull = count >= 0xff;
        if (isFull) {
            const peekedToken = state.bytes[state.offset];
            if (peekedToken === Token.NumberList) {
                state.offset++;
                continue;
            }
            if (peekedToken === Token.Number) {
                values.push(parseNumber(state));
            }
        }
        break;
    }
    return values;
};

const parseVec3 = (state: ParseState): SCX.Vec3 => parseNumberList(state).slice(0, 3) as SCX.Vec3;

// enum parsers

const parseOff = (state: ParseState): SCX.Off => {
    const token = state.bytes[state.offset++];
    const enumValues = Object.values(SCX.Off);
    if (enumValues.includes(token)) return token;
    console.warn("Invalid off type.");
    return enumValues[0] as SCX.Off;
};

const parseLightType = (state: ParseState): SCX.LightType => {
    const token = state.bytes[state.offset++];
    const enumValues = Object.values(SCX.LightType);
    if (enumValues.includes(token)) return token;
    console.warn("Invalid light type.");
    return enumValues[0] as SCX.LightType;
};

const parseKeyframeChannel = (state: ParseState): SCX.KeyframeAnimationChannel => {
    const token = state.bytes[state.offset++];
    const enumValues = Object.values(SCX.KeyframeAnimationChannel);
    if (enumValues.includes(token)) return token;
    console.warn("Invalid keyframe channel.");
    return enumValues[0] as SCX.KeyframeAnimationChannel;
};

const parseExtrapolation = (state: ParseState): SCX.Extrapolation => {
    const token = state.bytes[state.offset++];
    const enumValues = Object.values(SCX.Extrapolation);
    if (enumValues.includes(token)) return token;
    console.warn("Invalid extrapolation.");
    return enumValues[0] as SCX.Extrapolation;
};

const parseInterpolation = (state: ParseState): SCX.Interpolation => {
    const token = state.bytes[state.offset++];
    const enumValues = Object.values(SCX.Interpolation);
    if (enumValues.includes(token)) return token;
    console.warn("Invalid interpolation.");
    return enumValues[0] as SCX.Interpolation;
};

// minor type parsers

const parseKeyframes = (state: ParseState, count: number): SCX.Keyframe[] => {
    const keyframes = [];
    for (let i = 0; i < count; i++) {
        const [time, value, tangentIn, tangentOut] = [parseNumber(state), ...parseVec3(state)];
        keyframes.push({ time, value, tangentIn, tangentOut });
    }
    return keyframes;
};

const parsePolygon = (state: ParseState): SCX.Polygon => {
    const polygon: SCX.Polygon = { verts: [0, 0, 0], shader: 0, smgroup: 0 };
    guardedLoop(state, {
        [Token.Verts]: () => (polygon.verts = [parseNumber(state), parseNumber(state), parseNumber(state)]),
        [Token.Shader]: () => (polygon.shader = parseNumber(state)),
        [Token.SMGroup]: () => (polygon.smgroup = parseNumber(state)),
    });
    return polygon;
};

const parseAnimation = (state: ParseState): SCX.KeyframeAnimation => {
    const animation: SCX.KeyframeAnimation = {
        channel: SCX.KeyframeAnimationChannel.TransX,
        extrappre: SCX.Extrapolation.Constant,
        extrappost: SCX.Extrapolation.Constant,
        interp: SCX.Interpolation.Linear,
        keyframes: [],
    };
    let keyframeCount: number = 0;
    guardedLoop(state, {
        [Token.Channel]: () => (animation.channel = parseKeyframeChannel(state)),
        [Token.ExtrapPre]: () => (animation.extrappre = parseExtrapolation(state)),
        [Token.ExtrapPost]: () => (animation.extrappost = parseExtrapolation(state)),
        [Token.Interp]: () => (animation.interp = parseInterpolation(state)),
        [Token.KeyCount]: () => (keyframeCount = parseNumber(state)),
        [Token.Keys]: () => bracket(state, () => (animation.keyframes = parseKeyframes(state, keyframeCount))),
    });
    return animation;
};

const parseTransform = (state: ParseState): SCX.Transform => {
    const transform: SCX.Transform = { trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
    guardedLoop(state, {
        [Token.Trans]: () => (transform.trans = parseVec3(state)),
        [Token.Rot]: () => (transform.rot = parseVec3(state)),
        [Token.Scale]: () => (transform.scale = parseVec3(state)),
    });
    return transform;
};

const parseMesh = (state: ParseState): SCX.Mesh[] => {
    const mesh: SCX.Mesh = { shader: 0, vertexcount: 0, normals: [], texCoords: [], positions: [], indices: [] };
    let polycount = 0;
    let polygons: SCX.Polygon[] = [];
    guardedLoop(state, {
        [Token.Shader]: () => (mesh.shader = parseNumber(state)),
        [Token.VertexCount]: () => (mesh.vertexcount = parseNumber(state)),
        [Token.Normals]: () => bracket(state, () => (mesh.normals = parseNumberList(state))),
        [Token.UVCoords]: () => bracket(state, () => (mesh.texCoords = parseNumberList(state))),
        [Token.VertexPoints]: () => bracket(state, () => (mesh.positions = parseNumberList(state))),

        [Token.PolyCount]: () => (polycount = parseNumber(state)),
        [Token.Polygon]: () => (polygons = appended(polygons, parsePolygon(state))),
    });

    const polygonsByShaderID: Map<number, SCX.Polygon[]> = new Map(polygons.map(({ shader }) => [shader, []]));
    for (const polygon of polygons) {
        polygonsByShaderID.get(polygon.shader)!.push(polygon);
    }

    const meshes = [];
    for (const polygons of polygonsByShaderID.values()) {
        meshes.push({
            ...mesh,
            shader: polygons[0]?.shader ?? 0,
            indices: polygons.flatMap((polygon) => polygon.verts),
        });
    }
    return meshes;
};

// entity parsers

const parseGlobal = (state: ParseState): SCX.Global => {
    const global: SCX.Global = { animinterval: [0, 0], framerate: 0, ambient: [0, 0, 0] };
    guardedLoop(state, {
        [Token.Name]: () => (global.name = parseString(state)),
        [Token.TextureFolders]: () => (global.textureFolders = parseOff(state)),
        [Token.AnimInterval]: () => (global.animinterval = [parseNumber(state), parseNumber(state)]),
        [Token.Framerate]: () => (global.framerate = parseNumber(state)),
        [Token.Ambient]: () => (global.ambient = parseVec3(state)),
    });
    return global;
};

const parseObject = (state: ParseState): SCX.Object => {
    const object: SCX.Object = { name: "", transform: { trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }, meshes: [] };
    guardedLoop(state, {
        [Token.Name]: () => (object.name = parseString(state)),
        [Token.ID]: () => (object.id = parseNumber(state)),
        [Token.Anim]: () => (object.animations = appended(object.animations, parseAnimation(state))),
        [Token.Parent]: () => (object.parent = parseString(state)),
        [Token.ParentID]: () => (object.parent = parseString(state)),
        [Token.Transform]: () => (object.transform = parseTransform(state)),
        [Token.Mesh]: () => (object.meshes = parseMesh(state)),
    });

    // For now, we only test whether an object is flipped in object space.
    // It might be worth testing whether an object is flipped in world space.
    const scale = object.transform.scale;
    const isFlipped = Math.sign(scale[0] * scale[1] * scale[2]) < 0;
    if (isFlipped) {
        const normal = vec3.create();
        for (const mesh of object.meshes) {
            for (let i = 0; i < mesh.vertexcount; i++) {
                vec3.copy(normal, mesh.normals.slice(i * 3, (i + 1) * 3) as SCX.Vec3);
                vec3.negate(normal, normal);
                mesh.normals.splice(i * 3, 3, ...normal);
            }
        }
    }
    return object;
};

const parseShader = (state: ParseState): SCX.Shader => {
    const shader: SCX.Shader = { name: "", id: 0, ambient: [0, 0, 0], diffuse: [0, 0, 0], specular: [0, 0, 0], opacity: 0, luminance: 0, blend: 0 };
    guardedLoop(state, {
        [Token.Name]: () => (shader.name = parseString(state)),
        [Token.ID]: () => (shader.id = parseNumber(state)),
        [Token.Ambient]: () => (shader.ambient = parseVec3(state)),
        [Token.Diffuse]: () => (shader.diffuse = parseVec3(state)),
        [Token.Specular]: () => (shader.specular = parseVec3(state)),
        [Token.Opacity]: () => (shader.opacity = parseNumber(state)),
        [Token.Luminance]: () => (shader.luminance = parseNumber(state)),
        [Token.Texture]: () => (shader.texture = parseString(state)),
        [Token.Blend]: () => (shader.blend = parseNumber(state)),
    });
    return shader;
};

const parseLight = (state: ParseState): SCX.Light => {
    const light: SCX.Light = { name: "", type: SCX.LightType.Ambient };
    guardedLoop(state, {
        [Token.Name]: () => (light.name = parseString(state)),
        [Token.Type]: () => (light.type = parseLightType(state)),
        [Token.Pos]: () => (light.pos = parseVec3(state)),
        [Token.Dir]: () => (light.dir = parseVec3(state)),
        [Token.Umbra]: () => (light.umbra = parseNumber(state)),
        [Token.Penumbra]: () => (light.penumbra = parseNumber(state)),
        [Token.AttenStart]: () => (light.attenstart = parseNumber(state)),
        [Token.AttenEnd]: () => (light.attenend = parseNumber(state)),
        [Token.Color]: () => (light.color = parseVec3(state)),
        [Token.Intensity]: () => (light.intensity = parseNumber(state)),
        [Token.Off]: () => (light.off = parseBoolean(state)),
    });
    return light;
};

const parseCamera = (state: ParseState): SCX.Camera => {
    const camera: SCX.Camera = { name: "", fov: 0, nearclip: 0, farclip: 0, pos: [0, 0, 0], targetpos: [0, 0, 0] };
    guardedLoop(state, {
        [Token.Name]: () => (camera.name = parseString(state)),
        [Token.Anim]: () => (camera.animations = appended(camera.animations, parseAnimation(state))),
        [Token.Fov]: () => (camera.fov = parseNumber(state)),
        [Token.NearClip]: () => (camera.nearclip = parseNumber(state)),
        [Token.FarClip]: () => (camera.farclip = parseNumber(state)),
        [Token.Pos]: () => (camera.pos = parseVec3(state)),
        [Token.TargetPos]: () => (camera.targetpos = parseVec3(state)),
    });
    return camera;
};

export const parseSCX = (data: ArrayBufferSlice): SCX.Scene => {
    const scene: SCX.Scene = { shaders: [], global: { animinterval: [0, 0], framerate: 0, ambient: [0, 0, 0] }, cameras: [], lights: [], objects: [] };
    const state: ParseState = { bytes: new Uint8Array(data.arrayBuffer), dataView: data.createDataView(), offset: 0 };
    guardedLoop(state, {
        [Token.Scene]: () => (scene.global = parseGlobal(state)),
        [Token.Object]: () => scene.objects.push(parseObject(state)),
        [Token.Shader]: () => scene.shaders.push(parseShader(state)),
        [Token.Light]: () => scene.lights.push(parseLight(state)),
        [Token.Camera]: () => scene.cameras.push(parseCamera(state)),
    });
    return scene;
};
