import { Token } from "./tokens";

export namespace SCX {
    type Named = { name: string; id?: number };
    type Animatable = { animations?: KeyframeAnimation[] };

    export type Vec2 = [number, number];
    export type Vec3 = [number, number, number];

    export type Shader = Named & {
        id: number;
        ambient: Vec3;
        diffuse: Vec3;
        specular: Vec3;
        opacity: number;
        luminance: number;
        texture?: string;
        blend: number;
    };

    export enum Off {
        Off = Token.Off,
    }

    export type Global = Partial<Named> & {
        animinterval: Vec2;
        framerate: number;
        ambient: Vec3;
        textureFolders?: Off;
    };

    export type Transform = {
        trans: Vec3;
        rot: Vec3;
        scale: Vec3;
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
            pos: Vec3;
            targetpos: Vec3;
        };

    export enum LightType {
        Spot = Token.Spot,
        Directional = Token.Directional,
        Point = Token.Point,
        Ambient = Token.Ambient,
    }

    export type Light = Named & {
        type: LightType;
        pos?: Vec3;
        dir?: Vec3;
        umbra?: number;
        penumbra?: number;
        attenstart?: number;
        attenend?: number;
        color?: Vec3;
        intensity?: number;
        off?: boolean;
    };

    export type Polygon = {
        verts: number[];
        shader: number;
        smgroup: number;
    };

    export type Mesh = {
        shader: number;
        vertexcount: number;
        normals: number[];
        texCoords: number[];
        positions: number[];
        indices: number[];

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
