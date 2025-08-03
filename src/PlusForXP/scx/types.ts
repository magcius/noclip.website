
import { vec2, vec3 } from "gl-matrix";
import { Token } from "./tokens.js";

export namespace SCX {
    type Named = { name: string; id?: number };
    type Animatable = { animations?: KeyframeAnimation[] };

    export type Shader = Named & {
        id: number;
        ambient: vec3;
        diffuse: vec3;
        specular: vec3;
        opacity: number;
        luminance: number;
        texture?: string;
        blend: number;
    };

    export enum Off {
        Off = Token.Off,
    }

    export type Global = Partial<Named> & {
        animinterval: vec2;
        framerate: number;
        ambient: vec3;
        textureFolders?: Off;
    };

    export type Transform = {
        trans: vec3;
        rot: vec3;
        scale: vec3;
    };

    export enum KeyframeAnimationChannel {
        TransX = Token.TransX,
        TransY = Token.TransY,
        TransZ = Token.TransZ,
        RotX = Token.RotX,
        RotY = Token.RotY,
        RotZ = Token.RotZ,
        ScaleX = Token.ScaleX,
        ScaleY = Token.ScaleY,
        ScaleZ = Token.ScaleZ,
    }

    export enum Interpolation {
        Linear = Token.Linear,
        Hermite = Token.Hermite,
    }

    export enum Extrapolation {
        Cycle = Token.Cycle,
        Constant = Token.Constant,
        Oscillate = Token.Oscillate,
    }

    export type KeyframeAnimation = {
        channel: KeyframeAnimationChannel;
        extrappre: Extrapolation;
        extrappost: Extrapolation;
        interp: Interpolation;
        keyframes: Keyframe[];
    };

    export type Keyframe = {
        time: number;
        value: number;
        tangentIn: number;
        tangentOut: number;
    };

    export type Camera = Named &
        Animatable & {
            fov: number;
            nearclip: number;
            farclip: number;
            pos: vec3;
            targetpos: vec3;
        };

    export enum LightType {
        Spot = Token.Spot,
        Directional = Token.Directional,
        Point = Token.Point,
        Ambient = Token.Ambient,
    }

    export type Light = Named & {
        type: LightType;
        pos?: vec3;
        dir?: vec3;
        umbra?: number;
        penumbra?: number;
        attenstart?: number;
        attenend?: number;
        color: vec3;
        intensity: number;
        off?: boolean;
    };

    export type Polygon = {
        verts: [number, number, number];
        shader: number;
        smgroup: number;
    };

    export type Mesh = {
        shader: number;
        vertexcount: number;
        normals: Float32Array;
        texCoords: Float32Array;
        positions: Float32Array;
        indices: Uint32Array;

        dynamic?: boolean;
    };

    export type Object = Named &
        Animatable & {
            parent?: string;
            transform: Transform;
            meshes: Mesh[];
        };

    export type Scene = {
        global: Global;
        shaders: Shader[];
        cameras: Camera[];
        lights: Light[];
        objects: Object[];
    };
}
