import { colorFromRGBA, colorNewCopy, colorNewFromRGBA, colorNewFromRGBA8, White } from '../Color';
import { Shader, ShaderLayer, ShaderFlags, ShaderAttrFlags } from './materials';
import { dataSubarray } from './util';

interface ShaderFields {
    isAncient?: boolean;
    isBeta?: boolean;
    size: number;
    numLayers: number;
    layers: number;
}

export const SFA_SHADER_FIELDS: ShaderFields = {
    size: 0x44,
    numLayers: 0x41,
    layers: 0x24,
};

export const SFADEMO_MODEL_SHADER_FIELDS: ShaderFields = {
    size: 0x44,
    numLayers: 0x41,
    layers: 0x24, // ???
};

export const SFADEMO_MAP_SHADER_FIELDS: ShaderFields = {
    size: 0x40,
    numLayers: 0x3b,
    layers: 0x24, // ???
};

export const BETA_MODEL_SHADER_FIELDS: ShaderFields = {
    isBeta: true,
    size: 0x38,
    numLayers: 0x36,
    layers: 0x20,
};

export const ANCIENT_MAP_SHADER_FIELDS: ShaderFields = {
    isAncient: true,
    size: 0x3c,
    numLayers: 0x3a,
    layers: 0x24,
};

function parseTexId(data: DataView, offs: number, texIds: number[]): number | null {
    const texNum = data.getUint32(offs);
    return texNum !== 0xffffffff ? texIds[texNum] : null;
}

function parseShaderLayer(data: DataView, texIds: number[]): ShaderLayer {
    const scrollingTexMtx = data.getUint8(0x6);
    return {
        texId: parseTexId(data, 0x0, texIds),
        tevMode: data.getUint8(0x4),
        enableTexChainStuff: data.getUint8(0x5),
        scrollingTexMtx: scrollingTexMtx || undefined,
    };
}

export function parseShader(data: DataView, fields: ShaderFields, texIds: number[], normalFlags: number, lightFlags: number, texMtxCount: number): Shader {
    const shader: Shader = {
        layers: [],
        flags: 0,
        attrFlags: 0,
        hasHemisphericProbe: false,
        hasAuxTex1: false,
        hasAuxTex2: false,
        auxTex2Num: 0xffffffff,
        furRegionsTexId: null,
        color: colorNewCopy(White),
        normalFlags,
        lightFlags,
        texMtxCount,
    };

    let numLayers = data.getUint8(fields.numLayers);
    if (numLayers > 2) {
        console.warn(`Number of shader layers greater than maximum (${numLayers} / 2)`);
        numLayers = 2;
    }
    for (let i = 0; i < numLayers; i++) {
        const layer = parseShaderLayer(dataSubarray(data, fields.layers + i * 8), texIds);
        shader.layers.push(layer);
    }

    if (fields.isAncient) {
        shader.isAncient = true;
        shader.attrFlags = ShaderAttrFlags.CLR; // FIXME: where is this field if present?
        shader.flags = ShaderFlags.CullBackface;
    } else if (fields.isBeta) {
        shader.isBeta = true;
        shader.attrFlags = data.getUint8(0x34);
        shader.flags = 0; // TODO: where is this field?
        shader.hasHemisphericProbe = data.getUint32(0x8) === 1;
        shader.hasAuxTex1 = data.getUint32(0x14) === 1;
        shader.hasAuxTex2 = !!(data.getUint8(0x37) & 0x40); // !!(data.getUint8(0x37) & 0x80);
    } else {
        shader.flags = data.getUint32(0x3c);
        shader.attrFlags = data.getUint8(0x40);
        shader.hasHemisphericProbe = data.getUint32(0x8) !== 0;
        shader.hasAuxTex1 = data.getUint32(0x14) !== 0;
        shader.auxTex2Num = data.getUint32(0x34);
        shader.hasAuxTex2 = shader.auxTex2Num != 0xffffffff;
        shader.furRegionsTexId = parseTexId(data, 0x38, texIds);
        colorFromRGBA(shader.color,
            data.getUint8(0x4) / 0xff,
            data.getUint8(0x5) / 0xff,
            data.getUint8(0x6) / 0xff,
            1.0);
    }

    // console.log(`loaded shader: ${JSON.stringify(shader, null, '\t')}`);

    return shader;
}