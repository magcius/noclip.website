
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, assertExists } from "../util.js";
import * as AGLParameter from "./AGLParameter.js";

export interface LightEnvObject {
    type: string;
    name: string;
    calc_type: number;
    lut_name: string;
    effect: number;
    pow: number;
    pow_mip_max: number;
    enable_mip0: boolean;
    enable_mip1: boolean;
}

export interface LightMap {
    name: string;
    env_obj_ref_array: LightEnvObject[];
}

export interface AGLLightMap {
    lmap: LightMap[];
}

function parseLightEnvObj(p: AGLParameter.ParameterObject): LightEnvObject {
    const type = (AGLParameter.findWithName(p.parameters, 'type') as AGLParameter.ParameterString).value;
    const name = (AGLParameter.findWithName(p.parameters, 'name') as AGLParameter.ParameterString).value;
    const calc_type = (AGLParameter.findWithName(p.parameters, 'calc_type') as AGLParameter.ParameterNumber).value;
    const lut_name = (AGLParameter.findWithName(p.parameters, 'lut_name') as AGLParameter.ParameterString).value;
    const effect = (AGLParameter.findWithName(p.parameters, 'effect') as AGLParameter.ParameterNumber).value;
    const pow = (AGLParameter.findWithName(p.parameters, 'pow') as AGLParameter.ParameterNumber).value;
    const pow_mip_max = (AGLParameter.findWithName(p.parameters, 'pow_mip_max') as AGLParameter.ParameterNumber).value;
    const enable_mip0 = (AGLParameter.findWithName(p.parameters, 'enable_mip0') as AGLParameter.ParameterBool).value;
    const enable_mip1 = (AGLParameter.findWithName(p.parameters, 'enable_mip1') as AGLParameter.ParameterBool).value;
    return { type, name, calc_type, lut_name, effect, pow, pow_mip_max, enable_mip0, enable_mip1 };
}

function parseLightMap(p: AGLParameter.ParameterList): LightMap {
    const setting = assertExists(AGLParameter.findWithName(p.objects, 'setting'));
    const name = (AGLParameter.findWithName(setting.parameters, 'name') as AGLParameter.ParameterString).value;
    const env_obj_ref_array_prm = assertExists(AGLParameter.findWithName(p.lists, 'env_obj_ref_array'));
    const env_obj_ref_array: LightEnvObject[] = env_obj_ref_array_prm.objects.map((p) => parseLightEnvObj(p));
    return { name, env_obj_ref_array };
}

export function parse(buffer: ArrayBufferSlice): AGLLightMap {
    const prm = AGLParameter.parse(buffer);
    assert(prm.type === 'agllmap');
    const root = prm.root;
    assert(root.nameHash === AGLParameter.hashCode('param_root'));
    const lmap = root.lists.map((p) => parseLightMap(p));
    return { lmap };
}
