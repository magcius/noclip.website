import { vec3 } from "gl-matrix";
import { Endianness, getSystemEndianness } from "../../endian";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { SCX } from "./types";
import { Token, Numeric } from "./tokens";

type DataViewCall = (view: DataView, byteOffset: number) => number;
const isLittleEndian = getSystemEndianness() === Endianness.LITTLE_ENDIAN;

const appended = <T>(a: T[] | undefined, v: T): T[] => {
    a ??= [];
    a.push(v);
    return a;
};

export class Parser {
    private bytes: Uint8Array;
    private dataView: DataView;
    private offset: number;

    public static parse(data: ArrayBufferSlice): SCX.Scene {
        return new Parser(data).parseScene();
    }

    private constructor(data: ArrayBufferSlice) {
        this.bytes = new Uint8Array(data.arrayBuffer);
        this.dataView = data.createDataView();
        this.offset = 0;
    }

    // onTokens loops over tokens and returns when it encounters a PopScope.
    // Meanwhile, it will call the function associted with the current token.
    private scanScope(cases: { [key in Token]?: () => void }) {
        while (this.offset < this.bytes.length) {
            const token: Token = this.bytes[this.offset++];
            if (token === Token.PopScope) return;
            cases[token]?.();
        }
    }

    // Disregard surrounding PushScope and PopScope tokens
    private scoped(func: () => void) {
        this.offset++;
        func();
        this.offset++;
    }

    // Basic data parsers

    private parseBoolean(): boolean {
        const token = this.bytes[this.offset++];
        if (token === Token.True) return true;
        if (token === Token.False) return false;
        console.warn("Not a boolean.");
        return false;
    }

    private parseString() {
        const end = this.bytes.indexOf(0, this.offset);
        const bytes = this.bytes.subarray(this.offset + 1, end);
        this.offset = end + 1;
        return [...bytes].map((c) => String.fromCharCode(c)).join("");
    }

    private static createDataParser =
        (size: number, call: DataViewCall) =>
        (parser: Parser): number => {
            const value = call(parser.dataView, parser.offset);
            parser.offset += size;
            return value;
        };

    private static numericParsers: Record<Numeric, (parser: Parser) => number> = {
        [Numeric.Number]: Parser.createDataParser(4, (view, offset) => view.getFloat32(offset, isLittleEndian)),
        [Numeric.Integer]: Parser.createDataParser(4, (view, offset) => view.getInt32(offset, isLittleEndian)),
        [Numeric.Byte]: Parser.createDataParser(1, (view, offset) => view.getInt8(offset)),
        [Numeric.UnsignedByte]: Parser.createDataParser(1, (view, offset) => view.getUint8(offset)),
        [Numeric.Word]: Parser.createDataParser(2, (view, offset) => view.getInt16(offset, isLittleEndian)),
        [Numeric.UnsignedWord]: Parser.createDataParser(2, (view, offset) => view.getUint16(offset, isLittleEndian)),
    };

    private parseNumber(numeric?: Numeric) {
        if (numeric === undefined) numeric = this.bytes[this.offset++];
        return Parser.numericParsers[numeric]!(this);
    }

    private parseNumberList() {
        this.offset++;
        const values: number[] = [];
        while (true) {
            const count = this.parseNumber(Numeric.UnsignedByte);
            for (let i = 0; i < count; i++) {
                values.push(this.parseNumber(Numeric.Number));
            }
            // A full number list might spill over into its successor
            const isFull = count >= 0xff;
            if (isFull) {
                const peekedToken = this.bytes[this.offset];
                if (peekedToken === Token.NumberList) {
                    this.offset++;
                    continue;
                }
                if (peekedToken === Token.Number) {
                    values.push(this.parseNumber());
                }
            }
            break;
        }
        return new Float32Array(values);
    }

    private parseVec3(): vec3 {
        return this.parseNumberList().slice(0, 3);
    }

    // Enum parsers  // TODO: can these be unified somehow?

    private parseOff(): SCX.Off {
        const token = this.bytes[this.offset++];
        const enumValues = Object.values(SCX.Off);
        if (enumValues.includes(token)) return token;
        console.warn("Invalid off type.");
        return enumValues[0] as SCX.Off;
    }

    private parseLightType(): SCX.LightType {
        const token = this.bytes[this.offset++];
        const enumValues = Object.values(SCX.LightType);
        if (enumValues.includes(token)) return token;
        console.warn("Invalid light type.");
        return enumValues[0] as SCX.LightType;
    }

    private parseKeyframeChannel(): SCX.KeyframeAnimationChannel {
        const token = this.bytes[this.offset++];
        const enumValues = Object.values(SCX.KeyframeAnimationChannel);
        if (enumValues.includes(token)) return token;
        console.warn("Invalid keyframe channel.");
        return enumValues[0] as SCX.KeyframeAnimationChannel;
    }

    private parseExtrapolation(): SCX.Extrapolation {
        const token = this.bytes[this.offset++];
        const enumValues = Object.values(SCX.Extrapolation);
        if (enumValues.includes(token)) return token;
        console.warn("Invalid extrapolation.");
        return enumValues[0] as SCX.Extrapolation;
    }

    private parseInterpolation(): SCX.Interpolation {
        const token = this.bytes[this.offset++];
        const enumValues = Object.values(SCX.Interpolation);
        if (enumValues.includes(token)) return token;
        console.warn("Invalid interpolation.");
        return enumValues[0] as SCX.Interpolation;
    }

    // Minor type parsers

    private parseKeyframes(count: number): SCX.Keyframe[] {
        const keyframes = [];
        for (let i = 0; i < count; i++) {
            const [time, value, tangentIn, tangentOut] = [this.parseNumber(), ...this.parseVec3()];
            keyframes.push({ time, value, tangentIn, tangentOut });
        }
        return keyframes;
    }

    private parsePolygon(): SCX.Polygon {
        const polygon: SCX.Polygon = { verts: [0, 0, 0], shader: 0, smgroup: 0 };
        this.scanScope({
            [Token.Verts]: () => (polygon.verts = [this.parseNumber(), this.parseNumber(), this.parseNumber()]),
            [Token.Shader]: () => (polygon.shader = this.parseNumber()),
            [Token.SMGroup]: () => (polygon.smgroup = this.parseNumber()),
        });
        return polygon;
    }

    private parseAnimation(): SCX.KeyframeAnimation {
        const animation: SCX.KeyframeAnimation = {
            channel: SCX.KeyframeAnimationChannel.TransX,
            extrappre: SCX.Extrapolation.Constant,
            extrappost: SCX.Extrapolation.Constant,
            interp: SCX.Interpolation.Linear,
            keyframes: [],
        };
        let keyframeCount: number = 0;
        this.scanScope({
            [Token.Channel]: () => (animation.channel = this.parseKeyframeChannel()),
            [Token.ExtrapPre]: () => (animation.extrappre = this.parseExtrapolation()),
            [Token.ExtrapPost]: () => (animation.extrappost = this.parseExtrapolation()),
            [Token.Interp]: () => (animation.interp = this.parseInterpolation()),
            [Token.KeyCount]: () => (keyframeCount = this.parseNumber()),
            [Token.Keys]: () => this.scoped(() => (animation.keyframes = this.parseKeyframes(keyframeCount))),
        });
        return animation;
    }

    private parseTransform(): SCX.Transform {
        const transform: SCX.Transform = { trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
        this.scanScope({
            [Token.Trans]: () => (transform.trans = this.parseVec3()),
            [Token.Rot]: () => (transform.rot = this.parseVec3()),
            [Token.Scale]: () => (transform.scale = this.parseVec3()),
        });
        return transform;
    }

    private parseMesh(): SCX.Mesh[] {
        const mesh: SCX.Mesh = {
            shader: 0,
            vertexcount: 0,
            normals: new Float32Array(),
            texCoords: new Float32Array(),
            positions: new Float32Array(),
            indices: new Uint32Array(),
        };
        let polycount = 0;
        let polygons: SCX.Polygon[] = [];
        this.scanScope({
            [Token.Shader]: () => (mesh.shader = this.parseNumber()),
            [Token.VertexCount]: () => (mesh.vertexcount = this.parseNumber()),
            [Token.Normals]: () => this.scoped(() => (mesh.normals = this.parseNumberList())),
            [Token.UVCoords]: () => this.scoped(() => (mesh.texCoords = this.parseNumberList())),
            [Token.VertexPoints]: () => this.scoped(() => (mesh.positions = this.parseNumberList())),

            [Token.PolyCount]: () => (polycount = this.parseNumber()),
            [Token.Polygon]: () => (polygons = appended(polygons, this.parsePolygon())),
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
                indices: new Uint32Array(polygons.flatMap((polygon) => polygon.verts)),
            });
        }
        return meshes;
    }

    // Entity parsers

    private parseGlobal(): SCX.Global {
        const global: SCX.Global = { animinterval: [0, 0], framerate: 0, ambient: [0, 0, 0] };
        this.scanScope({
            [Token.Name]: () => (global.name = this.parseString()),
            [Token.TextureFolders]: () => (global.textureFolders = this.parseOff()),
            [Token.AnimInterval]: () => (global.animinterval = [this.parseNumber(), this.parseNumber()]),
            [Token.Framerate]: () => (global.framerate = this.parseNumber()),
            [Token.Ambient]: () => (global.ambient = this.parseVec3()),
        });
        return global;
    }

    private parseObject(): SCX.Object {
        const object: SCX.Object = { name: "", transform: { trans: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }, meshes: [] };
        this.scanScope({
            [Token.Name]: () => (object.name = this.parseString()),
            [Token.ID]: () => (object.id = this.parseNumber()),
            [Token.Anim]: () => (object.animations = appended(object.animations, this.parseAnimation())),
            [Token.Parent]: () => (object.parent = this.parseString()),
            [Token.ParentID]: () => (object.parent = this.parseString()),
            [Token.Transform]: () => (object.transform = this.parseTransform()),
            [Token.Mesh]: () => (object.meshes = this.parseMesh()),
        });

        // For now, we only test whether an object is flipped in object space.
        // It might be worth testing whether an object is flipped in world space.
        const scale = object.transform.scale;
        const isFlipped = Math.sign(scale[0] * scale[1] * scale[2]) < 0;
        if (isFlipped) {
            const normal = new Float32Array(3);
            for (const mesh of object.meshes) {
                for (let i = 0; i < mesh.vertexcount; i++) {
                    normal.set(mesh.normals.slice(i * 3, (i + 1) * 3));
                    vec3.negate(normal, normal);
                    mesh.normals.set(normal, i * 3);
                }
            }
        }
        return object;
    }

    private parseShader(): SCX.Shader {
        const shader: SCX.Shader = { name: "", id: 0, ambient: [0, 0, 0], diffuse: [0, 0, 0], specular: [0, 0, 0], opacity: 0, luminance: 0, blend: 0 };
        this.scanScope({
            [Token.Name]: () => (shader.name = this.parseString()),
            [Token.ID]: () => (shader.id = this.parseNumber()),
            [Token.Ambient]: () => (shader.ambient = this.parseVec3()),
            [Token.Diffuse]: () => (shader.diffuse = this.parseVec3()),
            [Token.Specular]: () => (shader.specular = this.parseVec3()),
            [Token.Opacity]: () => (shader.opacity = this.parseNumber()),
            [Token.Luminance]: () => (shader.luminance = this.parseNumber()),
            [Token.Texture]: () => (shader.texture = this.parseString()),
            [Token.Blend]: () => (shader.blend = this.parseNumber()),
        });
        return shader;
    }

    private parseLight(): SCX.Light {
        const light: SCX.Light = { name: "", type: SCX.LightType.Ambient, intensity: 0, color: vec3.fromValues(1, 1, 1) };
        this.scanScope({
            [Token.Name]: () => (light.name = this.parseString()),
            [Token.Type]: () => (light.type = this.parseLightType()),
            [Token.Pos]: () => (light.pos = this.parseVec3()),
            [Token.Dir]: () => (light.dir = this.parseVec3()),
            [Token.Umbra]: () => (light.umbra = this.parseNumber()),
            [Token.Penumbra]: () => (light.penumbra = this.parseNumber()),
            [Token.AttenStart]: () => (light.attenstart = this.parseNumber()),
            [Token.AttenEnd]: () => (light.attenend = this.parseNumber()),
            [Token.Color]: () => (light.color = this.parseVec3()),
            [Token.Intensity]: () => (light.intensity = this.parseNumber()),
            [Token.Off]: () => (light.off = this.parseBoolean()),
        });
        return light;
    }

    private parseCamera(): SCX.Camera {
        const camera: SCX.Camera = { name: "", fov: 0, nearclip: 0, farclip: 0, pos: vec3.create(), targetpos: vec3.create() };
        this.scanScope({
            [Token.Name]: () => (camera.name = this.parseString()),
            [Token.Anim]: () => (camera.animations = appended(camera.animations, this.parseAnimation())),
            [Token.Fov]: () => (camera.fov = this.parseNumber()),
            [Token.NearClip]: () => (camera.nearclip = this.parseNumber()),
            [Token.FarClip]: () => (camera.farclip = this.parseNumber()),
            [Token.Pos]: () => (camera.pos = this.parseVec3()),
            [Token.TargetPos]: () => (camera.targetpos = this.parseVec3()),
        });
        return camera;
    }

    private parseScene(): SCX.Scene {
        const scene: SCX.Scene = { shaders: [], global: { animinterval: [0, 0], framerate: 0, ambient: vec3.create() }, cameras: [], lights: [], objects: [] };
        this.scanScope({
            [Token.Scene]: () => (scene.global = this.parseGlobal()),
            [Token.Object]: () => scene.objects.push(this.parseObject()),
            [Token.Shader]: () => scene.shaders.push(this.parseShader()),
            [Token.Light]: () => scene.lights.push(this.parseLight()),
            [Token.Camera]: () => scene.cameras.push(this.parseCamera()),
        });
        return scene;
    }
}
