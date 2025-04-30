import { SCX } from "./types.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { sanitizeMesh } from "./sanitize_mesh.js";
import { splitMesh } from "./split_mesh.js";
import { Token } from "./tokens.js";
import { Endianness, getSystemEndianness } from "../../endian.js";
import { FixedTuple } from "../util.js";

type ParseState = {
    bytes: Uint8Array;
    dataView: DataView;
    offset: number;
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

const parseFixedTuple = <N extends number>(state: ParseState, count: N): FixedTuple<number, N> => parseNumberList(state) as any;

// enum parsers

const parseOff = (state: ParseState): false => {
    const token = state.bytes[state.offset++];
    if (token === Token.Off) return false;
    console.warn("Not off.");
    return false;
};

const parseLightType = (state: ParseState): SCX.LightType => {
    const token = state.bytes[state.offset++];
    switch (token) {
        case Token.Ambient: return "ambient";
        case Token.Directional: return "directional";
        case Token.Point: return "point";
        case Token.Spot: return "spot";
    }
    console.warn("Invalid light type.");
    return "ambient";
};

const parseKeyframeChannel = (state: ParseState): SCX.KeyframeAnimationChannel => {
    const token = state.bytes[state.offset++];
    switch (token) {
        case Token.TransX: return "xtrans";
        case Token.TransY: return "ytrans";
        case Token.TransZ: return "ztrans";
        case Token.RotX: return "xrot";
        case Token.RotY: return "yrot";
        case Token.RotZ: return "zrot";
        case Token.ScaleX: return "xscale";
        case Token.ScaleY: return "yscale";
        case Token.ScaleZ: return "zscale";
    }
    console.warn("Invalid keyframe channel.");
    return "xtrans";
};

const parseExtrapolation = (state: ParseState): SCX.Extrapolation => {
    const token = state.bytes[state.offset++];
    switch (token) {
        case Token.Constant: return "constant";
        case Token.Cycle: return "cycle";
        case Token.Oscillate: return "oscillate";
    }
    console.warn("Invalid extrapolation.");
    return "constant";
};

const parseInterpolation = (state: ParseState): SCX.Interpolation => {
    const token = state.bytes[state.offset++];
    switch (token) {
        case Token.Hermite: return "hermite";
        case Token.Linear: return "linear";
    }
    console.warn("Invalid interpolation.");
    return "linear";
};

// minor type parsers

const parseKeyframes = (state: ParseState, count: number): SCX.Keyframe[] => {
    const keyframes = [];
    for (let i = 0; i < count; i++) {
        const [time, value, tangentIn, tangentOut] = [parseNumber(state), ...parseFixedTuple(state, 3)];
        keyframes.push({ time, value, tangentIn, tangentOut });
    }
    return keyframes;
};

const parsePolygon = (state: ParseState): SCX.Polygon => {
    const polygon: SCX.Polygon = { verts: [0, 0, 0], shader: 0, smgroup: 0 };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Verts: { polygon.verts = [parseNumber(state), parseNumber(state), parseNumber(state)]; break; }
            case Token.Shader: { polygon.shader = parseNumber(state); break; }
            case Token.SMGroup: { polygon.smgroup = parseNumber(state); break; }
        }
    }
    return polygon;
};

const parseAnimation = (state: ParseState): SCX.KeyframeAnimation => {
    const animation: SCX.KeyframeAnimation = { channel: "xtrans", extrappre: "constant", extrappost: "constant", interp: "linear", keyframes: [] };
    let keyframeCount: number = 0;
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Channel: { animation.channel = parseKeyframeChannel(state); break; }
            case Token.ExtrapPre: { animation.extrappre = parseExtrapolation(state); break; }
            case Token.ExtrapPost: { animation.extrappost = parseExtrapolation(state); break; }
            case Token.Interp: { animation.interp = parseInterpolation(state); break; }
            case Token.KeyCount: { keyframeCount = parseNumber(state); break; }
            case Token.Keys: { bracket(state, () => animation.keyframes = parseKeyframes(state, keyframeCount)); break; }
        }
    }
    return animation;
};

const parseTransform = (state: ParseState): SCX.Transform => {
    const transform: SCX.Transform = { trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Trans: { transform.trans = parseFixedTuple(state, 3); break; }
            case Token.Rot: { transform.rot = parseFixedTuple(state, 3); break; }
            case Token.Scale: { transform.scale = parseFixedTuple(state, 3); break; }
        }
    }
    return transform;
};

const parseMesh = (state: ParseState): SCX.PolygonMesh => {
    const mesh: SCX.PolygonMesh = { shader: 0, vertexcount: 0, normals: [], texCoords: [], positions: [], indices: [] };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Shader: { mesh.shader = parseNumber(state); break; }
            case Token.VertexCount: { mesh.vertexcount = parseNumber(state); break; }
            case Token.Normals: { bracket(state, () => mesh.normals = parseNumberList(state)); break; }
            case Token.UVCoords: { bracket(state, () => mesh.texCoords = parseNumberList(state)); break; }
            case Token.VertexPoints: { bracket(state, () => mesh.positions = parseNumberList(state)); break; }
            
            case Token.PolyCount: { mesh.polycount = parseNumber(state); break; }
            case Token.Polygon: { mesh.polygons ??= []; mesh.polygons.push(parsePolygon(state)); break; }
        }
    }
    return mesh;
};

// entity parsers

const parseGlobal = (state: ParseState): SCX.Global => {
    const global: SCX.Global = { animinterval: [0, 0], framerate: 0, ambient: [0, 0, 0] };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Name: { global.name = parseString(state); break;}
            case Token.TextureFolders: { global.textureFolders = parseOff(state); break; }
            case Token.AnimInterval: { global.animinterval = [parseNumber(state), parseNumber(state)]; break; }
            case Token.Framerate: { global.framerate = parseNumber(state); break; }
            case Token.Ambient: { global.ambient = parseFixedTuple(state, 3); break; }
        }
    }
    return global;
};

const parseObject = (state: ParseState): SCX.Object => {
    const object: SCX.Object = { name: "", transforms: [], meshes: [] };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Name: { object.name = parseString(state); break;}
            case Token.ID: { object.id = parseNumber(state); break;}
            case Token.Anim: { object.animations ??= []; object.animations.push(parseAnimation(state)); break;}
            case Token.Parent: 
            case Token.ParentID: { object.parent = parseString(state); break;}
            case Token.Transform: { object.transforms = [parseTransform(state)]; break;}
            case Token.Mesh: { object.meshes = [parseMesh(state)]; break;}
        }
    }

    sanitize: {
        const mesh = object.meshes[0] as SCX.PolygonMesh;
        const transform = object.transforms[0];
        if (mesh === undefined) {
            break sanitize;
        }
        const scale = transform.scale;
        // For now, we only test whether an object is flipped in object space.
        // It might be worth testing whether an object is flipped in world space.
        const isFlipped = Math.sign(scale[0] * scale[1] * scale[2]) < 0;
        const meshes = [];
        if (mesh.polycount !== undefined && mesh.polygons !== undefined) {
            meshes.push(...splitMesh(mesh));
        }
        meshes.forEach((mesh) => sanitizeMesh(mesh, isFlipped));
        object.meshes = meshes;
    }
    return object;
};

const parseShader = (state: ParseState): SCX.Shader => {
    const shader: SCX.Shader = { name: "", id: 0, ambient: [0, 0, 0], diffuse: [0, 0, 0], specular: [0, 0, 0], opacity: 0, luminance: 0, blend: 0 };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Name: { shader.name = parseString(state); break;}
            case Token.ID: { shader.id = parseNumber(state); break;}
            case Token.Ambient: { shader.ambient = parseFixedTuple(state, 3); break;}
            case Token.Diffuse: { shader.diffuse = parseFixedTuple(state, 3); break;}
            case Token.Specular: { shader.specular = parseFixedTuple(state, 3); break;}
            case Token.Opacity: { shader.opacity = parseNumber(state); break;}
            case Token.Luminance: { shader.luminance = parseNumber(state); break;}
            case Token.Texture: { shader.texture = parseString(state); break;}
            case Token.Blend: { shader.blend = parseNumber(state); break;}
        }
    }
    return shader;
};

const parseLight = (state: ParseState): SCX.Light => {
    const light: SCX.Light = { name: "", type: "ambient" };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Name: { light.name = parseString(state); break;}
            case Token.Type: { light.type = parseLightType(state); break;}
            case Token.Pos: { light.pos = parseFixedTuple(state, 3); break;}
            case Token.Dir: { light.dir = parseFixedTuple(state, 3); break;}
            case Token.Umbra: { light.umbra = parseNumber(state); break;}
            case Token.Penumbra: { light.penumbra = parseNumber(state); break;}
            case Token.AttenStart: { light.attenstart = parseNumber(state); break;}
            case Token.AttenEnd: { light.attenend = parseNumber(state); break;}
            case Token.Color: { light.color = parseFixedTuple(state, 3); break;}
            case Token.Intensity: { light.intensity = parseNumber(state); break;}
            case Token.Off: { light.off = parseBoolean(state); break;}
        }
    }
    return light;
};

const parseCamera = (state: ParseState): SCX.Camera => {
    const camera: SCX.Camera = { name: "", fov: 0, nearclip: 0, farclip: 0, pos: [0, 0, 0], targetpos: [0, 0, 0] };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Name: { camera.name = parseString(state); break; }
            case Token.Anim: { camera.animations ??= []; camera.animations.push(parseAnimation(state)); break;}
            case Token.Fov: { camera.fov = parseNumber(state); break; }
            case Token.NearClip: { camera.nearclip = parseNumber(state); break; }
            case Token.FarClip: { camera.farclip = parseNumber(state); break; }
            case Token.Pos: { camera.pos = parseFixedTuple(state, 3); break; }
            case Token.TargetPos: { camera.targetpos = parseFixedTuple(state, 3); break; }
        }
    }
    return camera;
};

export const parseSCX = (data: ArrayBufferSlice): SCX.Scene => {
    const scene: SCX.Scene = { shaders: [], globals: [], cameras: [], lights: [], objects: [] };
    const bytes = new Uint8Array(data.arrayBuffer);
    const state: ParseState = { bytes, dataView: data.createDataView(), offset: 0 };
    loop: while (state.offset < state.bytes.length) {
        switch (state.bytes[state.offset++]) {
            case Token.PopScope: break loop;
            case Token.Scene: { scene.globals.push(parseGlobal(state)); break; }
            case Token.Object: { scene.objects.push(parseObject(state)); break; }
            case Token.Shader: { scene.shaders.push(parseShader(state)); break; }
            case Token.Light: { scene.lights.push(parseLight(state)); break; }
            case Token.Camera: { scene.cameras.push(parseCamera(state)); break; }
        }
    }
    return scene;
};
