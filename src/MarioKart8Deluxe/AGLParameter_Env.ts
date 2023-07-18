
import { ReadonlyVec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color } from "../Color.js";
import { assert, assertExists } from "../util.js";
import * as AGLParameter from "./AGLParameter.js";

interface DirectionalLight {
    nameHash: number;
    enable: boolean;
    name: string;
    group: string;
    DiffuseColor: Color;
    SpecularColor: Color;
    BacksideColor: Color;
    Intensity: number;
    Direction: ReadonlyVec3;
    ViewCoordinate: boolean;
}

function parseDirectionalLight(p: AGLParameter.ParameterObject): DirectionalLight {
    const nameHash = p.nameHash;
    const enable = (AGLParameter.findWithName(p.parameters, 'enable') as AGLParameter.ParameterBool).value;
    const name = (AGLParameter.findWithName(p.parameters, 'name') as AGLParameter.ParameterString).value;
    const group = (AGLParameter.findWithName(p.parameters, 'group') as AGLParameter.ParameterString).value;
    const DiffuseColor = (AGLParameter.findWithName(p.parameters, 'DiffuseColor') as AGLParameter.ParameterColor).value;
    const SpecularColor = (AGLParameter.findWithName(p.parameters, 'SpecularColor') as AGLParameter.ParameterColor).value;
    const BacksideColor = (AGLParameter.findWithName(p.parameters, 'BacksideColor') as AGLParameter.ParameterColor).value;
    const Intensity = (AGLParameter.findWithName(p.parameters, 'Intensity') as AGLParameter.ParameterNumber).value;
    const Direction = (AGLParameter.findWithName(p.parameters, 'Direction') as AGLParameter.ParameterVec3).value;
    const ViewCoordinate = (AGLParameter.findWithName(p.parameters, 'ViewCoordinate') as AGLParameter.ParameterBool).value;
    return { nameHash, enable, name, group, DiffuseColor, SpecularColor, BacksideColor, Intensity, Direction, ViewCoordinate };
}

interface HemisphereLight {
    nameHash: number;
    enable: boolean;
    name: string;
    group: string;
    SkyColor: Color;
    GroundColor: Color;
    Intensity: number;
    Direction: ReadonlyVec3;
}

function parseHemisphereLight(p: AGLParameter.ParameterObject): HemisphereLight {
    const nameHash = p.nameHash;
    const enable = (AGLParameter.findWithName(p.parameters, 'enable') as AGLParameter.ParameterBool).value;
    const name = (AGLParameter.findWithName(p.parameters, 'name') as AGLParameter.ParameterString).value;
    const group = (AGLParameter.findWithName(p.parameters, 'group') as AGLParameter.ParameterString).value;
    const SkyColor = (AGLParameter.findWithName(p.parameters, 'SkyColor') as AGLParameter.ParameterColor).value;
    const GroundColor = (AGLParameter.findWithName(p.parameters, 'GroundColor') as AGLParameter.ParameterColor).value;
    const Intensity = (AGLParameter.findWithName(p.parameters, 'Intensity') as AGLParameter.ParameterNumber).value;
    const Direction = (AGLParameter.findWithName(p.parameters, 'Direction') as AGLParameter.ParameterVec3).value;
    return { nameHash, enable, name, group, SkyColor, GroundColor, Intensity, Direction };
}

export interface AGLEnv {
    DirectionalLight: DirectionalLight[];
    HemisphereLight: HemisphereLight[];
}

export function parse(buffer: ArrayBufferSlice): AGLEnv {
    const prm = AGLParameter.parse(buffer);
    assert(prm.type === 'aglenv');
    const root = prm.root;
    assert(root.nameHash === AGLParameter.hashCode('param_root'));
    const DirectionalLight = AGLParameter.findWithName(root.lists, 'DirectionalLight')!.objects.map((p) => parseDirectionalLight(p));
    const HemisphereLight = AGLParameter.findWithName(root.lists, 'HemisphereLight')!.objects.map((p) => parseHemisphereLight(p));
    return { DirectionalLight, HemisphereLight };
}
