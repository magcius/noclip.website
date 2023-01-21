
import { assert, readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4, vec4 } from 'gl-matrix';
import { TextureFormat, decodeTexture, computeTextureByteSize, getTextureFormatFromGLFormat } from './pica_texture';
import { GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxMegaStateDescriptor, GfxCompareMode, GfxChannelWriteMask, GfxChannelBlendState } from '../gfx/platform/GfxPlatform';
import { makeMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { Color, colorNewFromRGBA8, colorNewFromRGBA } from '../Color';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';

export interface VatrChunk {
    dataBuffer: ArrayBufferSlice;
    positionByteOffset: number;
    colorByteOffset: number;
    normalByteOffset: number;
    texCoord0ByteOffset: number;
    texCoord1ByteOffset: number;
    texCoord2ByteOffset: number;
    boneIndicesByteOffset: number;
    boneWeightsByteOffset: number;
}

export const enum Version {
    Ocarina, Majora, LuigisMansion
}

export class CMB {
    public name: string;
    public version: Version;
    public textures: Texture[] = [];
    public vatrChunk: VatrChunk;

    public materials: Material[] = [];
    public bones: Bone[] = [];
    public sepds: Sepd[] = [];
    public meshs: Mesh[] = [];
    public indexBuffer: ArrayBufferSlice;
}

export interface Bone {
    boneId: number;
    parentBoneId: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    translationX: number;
    translationY: number;
    translationZ: number;
}

function readSklChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'skl ');

    const boneTableCount = view.getUint32(0x08, true);

    const bones: Bone[] = [];
    let boneTableIdx = 0x10;
    for (let i = 0; i < boneTableCount; i++) {
        const boneId = view.getInt16(boneTableIdx + 0x00, true) & 0x0FFF;
        const parentBoneId = view.getInt16(boneTableIdx + 0x02, true);

        const scaleX = view.getFloat32(boneTableIdx + 0x04, true);
        const scaleY = view.getFloat32(boneTableIdx + 0x08, true);
        const scaleZ = view.getFloat32(boneTableIdx + 0x0C, true);
        const rotationX = view.getFloat32(boneTableIdx + 0x10, true);
        const rotationY = view.getFloat32(boneTableIdx + 0x14, true);
        const rotationZ = view.getFloat32(boneTableIdx + 0x18, true);
        const translationX = view.getFloat32(boneTableIdx + 0x1C, true);
        const translationY = view.getFloat32(boneTableIdx + 0x20, true);
        const translationZ = view.getFloat32(boneTableIdx + 0x24, true);

        const bone: Bone = { boneId, parentBoneId, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ };
        bones.push(bone);

        boneTableIdx += 0x28;
        if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
            boneTableIdx += 0x04;
    }
    cmb.bones = bones;
}

export enum TextureFilter {
    NEAREST = 0x2600,
    LINEAR = 0x2601,
    NEAREST_MIPMAP_NEAREST = 0x2700,
    LINEAR_MIPMAP_NEAREST = 0x2701,
    NEAREST_MIPMAP_LINEAR = 0x2702,
    LINEAR_MIPMAP_LINEAR = 0x2703,
}

export enum TextureWrapMode {
    CLAMP = 0x2900,
    REPEAT = 0x2901,
    CLAMP_TO_EDGE = 0x812F,
    MIRRORED_REPEAT = 0x8370,
}

export interface TextureBinding {
    index: number;
    textureIdx: number;
    minFilter: TextureFilter;
    magFilter: TextureFilter;
    wrapS: TextureWrapMode;
    wrapT: TextureWrapMode;
}

export const enum CombineResultOpDMP {
    REPLACE                  = 0x1E01,
    MODULATE                 = 0x2100,
    ADD                      = 0x0104,
    ADD_SIGNED               = 0x8574,
    INTERPOLATE              = 0x8575,
    SUBTRACT                 = 0x84E7,
    DOT3_RGB                 = 0x86AE,
    DOT3_RGBA                = 0x86AF,
    MULT_ADD                 = 0x6401,
    ADD_MULT                 = 0x6402,
};

export const enum CombineScaleDMP {
    _1                       = 0x01,
    _2                       = 0x02,
    _4                       = 0x04,
};

export const enum CombineBufferInputDMP {
    PREVIOUS                 = 0x8578,
    PREVIOUS_BUFFER          = 0x8579,
};

export const enum CombineSourceDMP {
    TEXTURE0                 = 0x84C0,
    TEXTURE1                 = 0x84C1,
    TEXTURE2                 = 0x84C2,
    TEXTURE3                 = 0x84C3,
    CONSTANT                 = 0x8576,
    PRIMARY_COLOR            = 0x8577,
    PREVIOUS                 = 0x8578,
    PREVIOUS_BUFFER          = 0x8579,
    FRAGMENT_PRIMARY_COLOR   = 0x6210,
    FRAGMENT_SECONDARY_COLOR = 0x6211,
};

export const enum CombineOpDMP {
    SRC_COLOR                = 0x0300,
    ONE_MINUS_SRC_COLOR      = 0x0301,
    SRC_ALPHA                = 0x0302,
    ONE_MINUS_SRC_ALPHA      = 0x0303,
    SRC_R                    = 0x8580,
    SRC_G                    = 0x8581,
    SRC_B                    = 0x8582,
    ONE_MINUS_SRC_R          = 0x8583,
    ONE_MINUS_SRC_G          = 0x8584,
    ONE_MINUS_SRC_B          = 0x8585,
};

export interface TextureCombiner {
    combineRGB: CombineResultOpDMP;
    combineAlpha: CombineResultOpDMP;
    scaleRGB: CombineScaleDMP;
    scaleAlpha: CombineScaleDMP;
    bufferInputRGB: CombineBufferInputDMP;
    bufferInputAlpha: CombineBufferInputDMP;
    source0RGB: CombineSourceDMP;
    source1RGB: CombineSourceDMP;
    source2RGB: CombineSourceDMP;
    op0RGB: CombineOpDMP;
    op1RGB: CombineOpDMP;
    op2RGB: CombineOpDMP;
    source0Alpha: CombineSourceDMP;
    source1Alpha: CombineSourceDMP;
    source2Alpha: CombineSourceDMP;
    op0Alpha: CombineOpDMP;
    op1Alpha: CombineOpDMP;
    op2Alpha: CombineOpDMP;
    constantIndex: number;
}

export interface TextureEnvironment {
    textureCombiners: TextureCombiner[];
    combinerBufferColor: Color;
}

export const enum TextureCoordinatorMappingMethod {
    None,
    UvCoordinateMap,
    CameraCubeEnvMap,
    CameraSphereEnvMap,
    ProjectionMap,
}

export interface TextureCoordinator {
    sourceCoordinate: number;
    mappingMethod: TextureCoordinatorMappingMethod;
    referenceCamera: number;
    matrixMode: number;
    textureMatrix: mat4;
}

export interface Material {
    index: number;
    textureBindings: TextureBinding[];
    textureCoordinators: TextureCoordinator[];
    constantColors: Color[];
    textureEnvironment: TextureEnvironment;
    alphaTestFunction: GfxCompareMode;
    alphaTestReference: number;
    renderFlags: GfxMegaStateDescriptor;
    isTransparent: boolean;
    polygonOffset: number;
    isVertexLightingEnabled: boolean;
    isFogEnabled: boolean;
    diffuseColor: Color;
    ambientColor: Color;
}

export function calcTexMtx(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    const theta = rotation * Math.PI;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    mat4.identity(dst);

    dst[0]  = scaleS *  cosR;
    dst[1]  = scaleT * -sinR;
    dst[4]  = scaleS *  sinR;
    dst[5]  = scaleT *  cosR;
    dst[12] = scaleS * ((-0.5 * cosR) - (0.5 * sinR - 0.5) - translationS);
    dst[13] = scaleT * ((-0.5 * cosR) + (0.5 * sinR - 0.5) + translationT) + 1;
}

function translateCullModeFlags(cullModeFlags: number): GfxCullMode {
    switch (cullModeFlags) {
    case 0x00:
        return GfxCullMode.FrontAndBack;
    case 0x01:
        return GfxCullMode.Back;
    case 0x02:
        return GfxCullMode.Front;
    case 0x03:
        return GfxCullMode.None;
    default:
        throw "whoops";
    }
}

function readMatsChunk(cmb: CMB, buffer: ArrayBufferSlice) {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'mats');
    const materialCount = view.getUint32(0x08, true);

    let materialDataSize = 0x15C;
    if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
        materialDataSize += 0x10;

    let offs = 0x0C;

    const textureCombinerSettingsTableOffs = offs + (materialCount * materialDataSize);

    for (let i = 0; i < materialCount; i++) {
        const isFragmentLightingEnabled = !!view.getUint8(offs + 0x00);
        const isVertexLightingEnabled = !!view.getUint8(offs + 0x01);
        //(M-1): Hack until fog is implemented for Luigi's Mansion
        const isFogEnabled = (cmb.version === Version.LuigisMansion) ? false : !!view.getUint8(offs + 0x02);
        const isBlendEnabled = !!view.getUint8(offs + 0x03);

        const cullModeFlags = view.getUint8(offs + 0x04);
        assert(cullModeFlags >= 0x00 && cullModeFlags <= 0x03);
        const cullMode = translateCullModeFlags(cullModeFlags);

        const isPolygonOffsetEnabled = view.getUint8(offs + 0x05);
        const polygonOffsetUnit = view.getInt8(offs + 0x07);
        const polygonOffset = isPolygonOffsetEnabled ? polygonOffsetUnit / 0xFFFE : 0;

        const textureBindingTableCount = view.getUint32(offs + 0x08);
        const textureCoordinatorTableCount = view.getUint32(offs + 0x0C);

        let bindingOffs = offs + 0x10;
        const textureBindings: TextureBinding[] = [];
        for (let j = 0; j < 3; j++) {
            const textureIdx = view.getInt16(bindingOffs + 0x00, true);
            let minFilter = view.getUint16(bindingOffs + 0x04, true);
            // HACK(jstpierre): Force trilinear filtering. Looks much better.
            if (minFilter === TextureFilter.LINEAR_MIPMAP_NEAREST)
                minFilter = TextureFilter.LINEAR_MIPMAP_LINEAR;
            const magFilter = view.getUint16(bindingOffs + 0x06, true);
            const wrapS = view.getUint16(bindingOffs + 0x08, true);
            const wrapT = view.getUint16(bindingOffs + 0x0A, true);
            const minLod = view.getFloat32(bindingOffs + 0x10, true);
            const lodBias = view.getFloat32(bindingOffs + 0x14, true);
            const borderColorR = view.getUint8(bindingOffs + 0x14);
            const borderColorG = view.getUint8(bindingOffs + 0x15);
            const borderColorB = view.getUint8(bindingOffs + 0x16);
            const borderColorA = view.getUint8(bindingOffs + 0x17);
            textureBindings.push({ index: j, textureIdx, minFilter, magFilter, wrapS, wrapT });
            bindingOffs += 0x18;
        }

        let coordinatorsOffs = offs + 0x58;
        const textureCoordinators: TextureCoordinator[] = [];
        for (let j = 0; j < 3; j++) {
            // TODO(jstpierre): Unsure about how these are packed...
            const sourceCoordinate = view.getUint8(coordinatorsOffs + 0x00);
            const referenceCamera = view.getUint8(coordinatorsOffs + 0x01);
            const mappingMethod: TextureCoordinatorMappingMethod = view.getUint8(coordinatorsOffs + 0x02);
            const matrixMode = view.getUint8(coordinatorsOffs + 0x03);
            const scaleS = view.getFloat32(coordinatorsOffs + 0x04, true);
            const scaleT = view.getFloat32(coordinatorsOffs + 0x08, true);
            const translationS = view.getFloat32(coordinatorsOffs + 0x0C, true);
            const translationT = view.getFloat32(coordinatorsOffs + 0x10, true);
            const rotation = view.getFloat32(coordinatorsOffs + 0x14, true);
            const textureMatrix = mat4.create();
            calcTexMtx(textureMatrix, scaleS, scaleT, rotation, translationS, translationT);
            textureCoordinators.push({ sourceCoordinate, mappingMethod, referenceCamera, matrixMode, textureMatrix });
            coordinatorsOffs += 0x18;
        }

        const emissionColor = colorNewFromRGBA8(view.getUint32(offs + 0xA0, false));
        const ambientColor = colorNewFromRGBA8(view.getUint32(offs + 0xA4, false));
        const diffuseColor = colorNewFromRGBA8(view.getUint32(offs + 0xA8, false));
        const specularColor0 = colorNewFromRGBA8(view.getUint32(offs + 0xAC, false));
        const specularColor1 = colorNewFromRGBA8(view.getUint32(offs + 0xB0, false));

        const constantColors: Color[] = [];
        constantColors[0] = colorNewFromRGBA8(view.getUint32(offs + 0xB4, false));
        constantColors[1] = colorNewFromRGBA8(view.getUint32(offs + 0xB8, false));
        constantColors[2] = colorNewFromRGBA8(view.getUint32(offs + 0xBC, false));
        constantColors[3] = colorNewFromRGBA8(view.getUint32(offs + 0xC0, false));
        constantColors[4] = colorNewFromRGBA8(view.getUint32(offs + 0xC4, false));
        constantColors[5] = colorNewFromRGBA8(view.getUint32(offs + 0xC8, false));

        const bufferColorR = view.getFloat32(offs + 0xCC, true);
        const bufferColorG = view.getFloat32(offs + 0xD0, true);
        const bufferColorB = view.getFloat32(offs + 0xD4, true);
        const bufferColorA = view.getFloat32(offs + 0xD8, true);

        const bumpTextureIndex = view.getUint16(offs + 0xDC, true);
        const bumpMode = view.getUint16(offs + 0xDE, true);
        const isBumpRenormalize = !!view.getUint32(offs + 0xE0, true);

        const layerConfig = view.getUint32(offs + 0xE4, true);
        const fresnelSelector = view.getUint16(offs + 0xE8, true);
        const isClampHighlight = !!view.getUint8(offs + 0xEA);
        const isDistribution0Enabled = !!view.getUint8(offs + 0xEB);
        const isDistribution1Enabled = !!view.getUint8(offs + 0xEC);
        const isGeometricFactor0Enabled = !!view.getUint8(offs + 0xED);
        const isGeometricFactor1Enabled = !!view.getUint8(offs + 0xEE);
        const isReflectionEnabled = !!view.getUint8(offs + 0xEF);

        // Fragment lighting table.
        const distibution0SamplerIsAbs = !!view.getUint8(offs + 0xF0);
        const distibution0SamplerIndex = view.getInt8(offs + 0xF1);
        const distibution0SamplerInput = view.getUint16(offs + 0xF2, true);
        const distibution0SamplerScale = view.getUint32(offs + 0xF4, true);

        const distibution1SamplerIsAbs = !!view.getUint8(offs + 0xF8);
        const distibution1SamplerIndex = view.getInt8(offs + 0xF9);
        const distibution1SamplerInput = view.getUint16(offs + 0xFA, true);
        const distibution1SamplerScale = view.getUint32(offs + 0xFC, true);

        const reflectanceRSamplerIsAbs = !!view.getUint8(offs + 0x100);
        const reflectanceRSamplerIndex = view.getInt8(offs + 0x101);
        const reflectanceRSamplerInput = view.getUint16(offs + 0x102, true);
        const reflectanceRSamplerScale = view.getUint32(offs + 0x104, true);

        const reflectanceGSamplerIsAbs = !!view.getUint8(offs + 0x108);
        const reflectanceGSamplerIndex = view.getInt8(offs + 0x109);
        const reflectanceGSamplerInput = view.getUint16(offs + 0x10A, true);
        const reflectanceGSamplerScale = view.getUint32(offs + 0x10C, true);

        const reflectanceBSamplerIsAbs = !!view.getUint8(offs + 0x110);
        const reflectanceBSamplerIndex = view.getInt8(offs + 0x111);
        const reflectanceBSamplerInput = view.getUint16(offs + 0x112, true);
        const reflectanceBSamplerScale = view.getUint32(offs + 0x114, true);

        const fresnelSamplerIsAbs = !!view.getUint8(offs + 0x118);
        const fresnelSamplerIndex = view.getInt8(offs + 0x110);
        const fresnelSamplerInput = view.getUint16(offs + 0x11A, true);
        const fresnelSamplerScale = view.getUint32(offs + 0x11C, true);

        const textureCombinerTableCount = view.getUint32(offs + 0x120, true);
        const textureCombiners: TextureCombiner[] = [];
        let textureCombinerTableIdx = offs + 0x124;
        for (let i = 0; i < textureCombinerTableCount; i++) {
            const textureCombinerIndex = view.getUint16(textureCombinerTableIdx + 0x00, true);
            const cmbOffs = textureCombinerSettingsTableOffs + textureCombinerIndex * 0x28;

            const combineRGB: CombineResultOpDMP          = view.getUint16(cmbOffs + 0x00, true);
            const combineAlpha: CombineResultOpDMP        = view.getUint16(cmbOffs + 0x02, true);
            const scaleRGB: CombineScaleDMP               = view.getUint16(cmbOffs + 0x04, true);
            const scaleAlpha: CombineScaleDMP             = view.getUint16(cmbOffs + 0x06, true);
            const bufferInputRGB: CombineBufferInputDMP   = view.getUint16(cmbOffs + 0x08, true);
            const bufferInputAlpha: CombineBufferInputDMP = view.getUint16(cmbOffs + 0x0A, true);
            const source0RGB: CombineSourceDMP            = view.getUint16(cmbOffs + 0x0C, true);
            const source1RGB: CombineSourceDMP            = view.getUint16(cmbOffs + 0x0E, true);
            const source2RGB: CombineSourceDMP            = view.getUint16(cmbOffs + 0x10, true);
            const op0RGB: CombineOpDMP                    = view.getUint16(cmbOffs + 0x12, true);
            const op1RGB: CombineOpDMP                    = view.getUint16(cmbOffs + 0x14, true);
            const op2RGB: CombineOpDMP                    = view.getUint16(cmbOffs + 0x16, true);
            const source0Alpha: CombineSourceDMP          = view.getUint16(cmbOffs + 0x18, true);
            const source1Alpha: CombineSourceDMP          = view.getUint16(cmbOffs + 0x1A, true);
            const source2Alpha: CombineSourceDMP          = view.getUint16(cmbOffs + 0x1C, true);
            const op0Alpha: CombineOpDMP                  = view.getUint16(cmbOffs + 0x1E, true);
            const op1Alpha: CombineOpDMP                  = view.getUint16(cmbOffs + 0x20, true);
            const op2Alpha: CombineOpDMP                  = view.getUint16(cmbOffs + 0x22, true);
            const constantIndex                           = view.getUint32(cmbOffs + 0x24, true);
            assert(constantIndex < 6);

            textureCombiners.push({
                combineRGB, combineAlpha, scaleRGB, scaleAlpha, bufferInputRGB, bufferInputAlpha,
                source0RGB, source1RGB, source2RGB, op0RGB, op1RGB, op2RGB,
                source0Alpha, source1Alpha, source2Alpha, op0Alpha, op1Alpha, op2Alpha,
                constantIndex,
            });

            textureCombinerTableIdx += 0x02;
        }

        const alphaTestEnabled = !!view.getUint8(offs + 0x130);
        const alphaTestReference = (view.getUint8(offs + 0x131) / 0xFF);
        const alphaTestFunction: GfxCompareMode = alphaTestEnabled ? view.getUint16(offs + 0x132, true) : GfxCompareMode.Always;

        const depthTestEnabled = !!view.getUint8(offs + 0x134);
        const depthWriteEnabled = !!view.getUint8(offs + 0x135);
        const depthTestFunction: GfxCompareMode = depthTestEnabled ? view.getUint16(offs + 0x136, true) : GfxCompareMode.Always;

        const blendMode = view.getUint8(offs + 0x138);
        const blendEnabled = blendMode !== 0;

        // Making a guess that this is LogicOpEnabled / LogicOp.
        assert(view.getUint8(offs + 0x139) == 0);
        assert(view.getUint16(offs + 0x13A, true) == 0);

        const blendSrcFactorRGB: GfxBlendFactor = blendEnabled ? view.getUint16(offs + 0x13C, true) : GfxBlendFactor.One;
        const blendDstFactorRGB: GfxBlendFactor = blendEnabled ? view.getUint16(offs + 0x13E, true) : GfxBlendFactor.Zero;
        const blendFunctionRGB: GfxBlendMode = blendEnabled ? view.getUint16(offs + 0x140, true) : GfxBlendMode.Add;
        const rgbBlendState: GfxChannelBlendState = {
            blendMode: blendFunctionRGB,
            blendDstFactor: blendDstFactorRGB,
            blendSrcFactor: blendSrcFactorRGB,
        };
        // TODO(jstpierre): What is at 0x142? Logic op?
        const blendSrcFactorAlpha: GfxBlendFactor = blendEnabled ? view.getUint16(offs + 0x144, true) : GfxBlendFactor.One;
        const blendDstFactorAlpha: GfxBlendFactor = blendEnabled ? view.getUint16(offs + 0x146, true) : GfxBlendFactor.Zero;
        const blendFunctionAlpha: GfxBlendMode = blendEnabled ? view.getUint16(offs + 0x148, true) : GfxBlendMode.Add;
        const alphaBlendState: GfxChannelBlendState = {
            blendMode: blendFunctionAlpha,
            blendDstFactor: blendDstFactorAlpha,
            blendSrcFactor: blendSrcFactorAlpha,
        };
        const blendColorR = view.getFloat32(offs + 0x14C, true);
        const blendColorG = view.getFloat32(offs + 0x150, true);
        const blendColorB = view.getFloat32(offs + 0x154, true);
        const blendColorA = view.getFloat32(offs + 0x158, true);
        const blendConstant = colorNewFromRGBA(blendColorR, blendColorG, blendColorB, blendColorA);

        const isTransparent = blendEnabled;
        const renderFlags = makeMegaState({
            attachmentsState: [
                {
                    channelWriteMask: GfxChannelWriteMask.AllChannels,
                    rgbBlendState,
                    alphaBlendState,
                },
            ],
            blendConstant,
            depthCompare: reverseDepthForCompareMode(depthTestFunction),
            depthWrite: depthWriteEnabled,
            cullMode,
        });

        const combinerBufferColor = colorNewFromRGBA(bufferColorR, bufferColorG, bufferColorB, bufferColorA);
        const textureEnvironment = { textureCombiners, combinerBufferColor };
        cmb.materials.push({ index: i, textureBindings, textureCoordinators, constantColors, textureEnvironment, alphaTestFunction, alphaTestReference, renderFlags, isTransparent, polygonOffset, isVertexLightingEnabled, isFogEnabled, ambientColor, diffuseColor });

        offs += 0x15C;

        if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion) {
            // Stencil.
            offs += 0x10;
        }
    }
}

export interface TextureLevel {
    width: number;
    height: number;
    pixels: Uint8Array;
    name: string;
}

export interface Texture {
    name: string;
    width: number;
    height: number;
    format: TextureFormat;
    levels: TextureLevel[];
}

export function parseTexChunk(buffer: ArrayBufferSlice, texData: ArrayBufferSlice | null, cmbName: string = ''): Texture[] {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'tex ');
    const count = view.getUint32(0x08, true);
    let offs = 0x0C;

    const textures: Texture[] = [];
    for (let i = 0; i < count; i++) {
        const size = view.getUint32(offs + 0x00, true);
        const maxLevel = view.getUint16(offs + 0x04, true);
        const isETC1 = view.getUint8(offs + 0x06);
        const isCubeMap = view.getUint8(offs + 0x07);
        const width = view.getUint16(offs + 0x08, true);
        const height = view.getUint16(offs + 0x0A, true);
        const glFormat = view.getUint32(offs + 0x0C, true);
        let dataOffs = view.getUint32(offs + 0x10, true);
        const dataEnd = dataOffs + size;
        const texName = readString(buffer, offs + 0x14, 0x10);
        // TODO(jstpierre): Maybe find another way to dedupe? Name seems inconsistent.
        const name = `${cmbName}/${i}/${texName}`;
        offs += 0x24;

        const levels: TextureLevel[] = [];

        const format = getTextureFormatFromGLFormat(glFormat);

        if (texData !== null) {
            let mipWidth = width, mipHeight = height;
            for (let i = 0; i < maxLevel; i++) {
                const pixels = decodeTexture(format, mipWidth, mipHeight, texData.slice(dataOffs, dataEnd));
                levels.push({ name, width: mipWidth, height: mipHeight, pixels });
                dataOffs += computeTextureByteSize(format, mipWidth, mipHeight);
                mipWidth /= 2;
                mipHeight /= 2;
            }
        }

        textures.push({ name, format, width, height, levels });
    }

    return textures;
}

function readTexChunk(cmb: CMB, buffer: ArrayBufferSlice, texData: ArrayBufferSlice | null): void {
    cmb.textures = parseTexChunk(buffer, texData, cmb.name);
}

function readVatrChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'vatr');
    const fullBufferSize = view.getUint32(0x04, true);

    let idx = 0x0C;

    function readSlice(baseOffs: number = 0): number {
        const size = view.getUint32(idx + 0x00, true);
        const offs = view.getUint32(idx + 0x04, true);
        idx += 0x08;

        if (size === 0)
            return -1;
        else
            return offs - baseOffs;
    }

    const baseOffs = readSlice();
    const dataBuffer = buffer.slice(baseOffs, fullBufferSize);

    const positionByteOffset = 0;
    const normalByteOffset = readSlice(baseOffs);

    let tangentByteOffset = 0;
    if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
        tangentByteOffset = readSlice(baseOffs);

    const colorByteOffset = readSlice(baseOffs);
    const texCoord0ByteOffset = readSlice(baseOffs);
    const texCoord1ByteOffset = readSlice(baseOffs);
    const texCoord2ByteOffset = readSlice(baseOffs);

    const boneIndicesByteOffset = readSlice(baseOffs);
    const boneWeightsByteOffset = readSlice(baseOffs);

    cmb.vatrChunk = {
        dataBuffer,
        positionByteOffset,
        normalByteOffset,
        colorByteOffset,
        texCoord0ByteOffset,
        texCoord1ByteOffset,
        texCoord2ByteOffset,
        boneIndicesByteOffset,
        boneWeightsByteOffset,
    };
}

export class Mesh {
    public sepdIdx: number;
    public matsIdx: number;
}

function readMshsChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'mshs');
    const count = view.getUint32(0x08, true);
    const opaqueMeshCount = view.getUint16(0x0C, true);
    const idCount = view.getUint16(0x0E, true);
    let idx = 0x10;
    for (let i = 0; i < count; i++) {
        const mesh = new Mesh();
        mesh.sepdIdx = view.getUint16(idx + 0x00, true);
        mesh.matsIdx = view.getUint8(idx + 0x02);
        cmb.meshs.push(mesh);

        if (cmb.version === Version.Ocarina)
            idx += 0x04;
        else if (cmb.version === Version.Majora)
            idx += 0x0C;
        else if (cmb.version === Version.LuigisMansion)
            idx += 0x58;
    }
}

export enum DataType {
    Byte   = 0x1400,
    UByte  = 0x1401,
    Short  = 0x1402,
    UShort = 0x1403,
    Int    = 0x1404,
    UInt   = 0x1405,
    Float  = 0x1406,
}

export class Prm {
    public indexType: DataType;
    public count: number;
    public offset: number;
}

function readPrmChunk(cmb: CMB, buffer: ArrayBufferSlice): Prm {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'prm ');

    const prm = new Prm();
    prm.indexType = view.getUint32(0x10, true);
    prm.count = view.getUint16(0x14, true);
    // No idea why this is always specified in terms of shorts, even when the indexType is byte...
    prm.offset = view.getUint16(0x16, true) * 2;

    return prm;
}

export const enum SkinningMode {
    SINGLE_BONE = 0x00,
    RIGID_SKINNING = 0x01,
    SMOOTH_SKINNING = 0x02,
}

// "Primitive Set"
export interface Prms {
    prm: Prm;
    skinningMode: SkinningMode;
    boneTable: Uint16Array;
}

function readPrmsChunk(cmb: CMB, buffer: ArrayBufferSlice): Prms {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'prms');

    const prmCount = view.getUint32(0x08, true);
    assert(prmCount === 1);

    const skinningMode: SkinningMode = view.getUint16(0x0C, true);

    const boneTableCount = view.getUint16(0x0E, true);
    assert(boneTableCount < 0x10);
    const boneTable = new Uint16Array(boneTableCount);

    let boneTableIdx = view.getUint32(0x10, true);
    for (let i = 0; i < boneTableCount; i++) {
        boneTable[i] = view.getUint16(boneTableIdx, true);
        boneTableIdx += 0x02;
    }

    // This is likely an array of primitives in the set, but 3DS models are probably
    // rarely enough to over the bone table limit...
    const prmOffs = view.getUint32(0x14, true);

    const prm = readPrmChunk(cmb, buffer.slice(prmOffs));

    return { prm, skinningMode, boneTable };
}

export const enum SepdVertexAttribMode {
    ARRAY = 0,
    CONSTANT = 1,
}

export interface SepdVertexAttrib {
    mode: SepdVertexAttribMode;
    start: number;
    scale: number;
    dataType: DataType;
    constant: vec4;
}

export class Sepd {
    public prms: Prms[] = [];

    public position!: SepdVertexAttrib;
    public normal!: SepdVertexAttrib;
    public tangent: SepdVertexAttrib | null = null;
    public color!: SepdVertexAttrib;
    public texCoord0!: SepdVertexAttrib;
    public texCoord1!: SepdVertexAttrib;
    public texCoord2!: SepdVertexAttrib;
    public boneIndices!: SepdVertexAttrib;
    public boneWeights!: SepdVertexAttrib;

    public boneDimension: number;
    public useVertexColors: boolean;
}

// "Separate Data Shape"
function readSepdChunk(cmb: CMB, buffer: ArrayBufferSlice): Sepd {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'sepd');
    const count = view.getUint16(0x08, true);
    const flags = view.getUint16(0x0A, true);

    const sepd = new Sepd();

    const centerX = view.getFloat32(0x0C, true);
    const centerY = view.getFloat32(0x10, true);
    const centerZ = view.getFloat32(0x14, true);
    const offsX = view.getFloat32(0x18, true);
    const offsY = view.getFloat32(0x1C, true);
    const offsZ = view.getFloat32(0x20, true);

    if (cmb.version === Version.LuigisMansion) {
        const minX = view.getFloat32(0x24, true);
        const minY = view.getFloat32(0x28, true);
        const minZ = view.getFloat32(0x2C, true);
        const maxX = view.getFloat32(0x30, true);
        const maxY = view.getFloat32(0x34, true);
        const maxZ = view.getFloat32(0x38, true);
    }

    let sepdArrIdx = cmb.version === Version.LuigisMansion ? 0x3C : 0x24;

    function readVertexAttrib(): SepdVertexAttrib {
        const start = view.getUint32(sepdArrIdx + 0x00, true);
        const scale = view.getFloat32(sepdArrIdx + 0x04, true);
        const dataType: DataType = view.getUint16(sepdArrIdx + 0x08, true);
        const mode: SepdVertexAttribMode = view.getUint16(sepdArrIdx + 0x0A, true);
        const c0 = view.getFloat32(sepdArrIdx + 0x0C, true);
        const c1 = view.getFloat32(sepdArrIdx + 0x10, true);
        const c2 = view.getFloat32(sepdArrIdx + 0x14, true);
        const c3 = view.getFloat32(sepdArrIdx + 0x18, true);
        const constant: vec4 = vec4.fromValues(c0, c1, c2, c3);
        sepdArrIdx += 0x1C;
        return { start, scale, dataType, mode, constant };
    }

    let bitIdx = cmb.version !== Version.Ocarina ? 3 : 2;

    sepd.useVertexColors = ((flags >> bitIdx) & 1) !== 0;
    sepd.position = readVertexAttrib();
    sepd.normal = readVertexAttrib();

    if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
        sepd.tangent = readVertexAttrib();

    sepd.color = readVertexAttrib();
    sepd.texCoord0 = readVertexAttrib();
    sepd.texCoord1 = readVertexAttrib();
    sepd.texCoord2 = readVertexAttrib();
    sepd.boneIndices = readVertexAttrib();
    sepd.boneWeights = readVertexAttrib();

    // take you to the next dimension, the
    sepd.boneDimension = view.getUint16(sepdArrIdx + 0x00, true);

    sepdArrIdx += 0x04;

    for (let i = 0; i < count; i++) {
        const prmsOffs = view.getUint16(sepdArrIdx + 0x00, true);
        sepd.prms.push(readPrmsChunk(cmb, buffer.slice(prmsOffs)));
        sepdArrIdx += 0x02;
        // sanity check.
        assert(sepd.prms[i].skinningMode === sepd.prms[0].skinningMode);
    }

    return sepd;
}

function readShpChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'shp ');
    const count = view.getUint32(0x08, true);

    let offs = 0x10;
    for (let i = 0; i < count; i++) {
        const sepdOffs = view.getUint16(offs, true);
        const sepd = readSepdChunk(cmb, buffer.slice(sepdOffs));
        cmb.sepds.push(sepd);
        offs += 0x02;
    }
}

function readSklmChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'sklm');
    const mshsChunkOffs = view.getUint32(0x08, true);
    readMshsChunk(cmb, buffer.slice(mshsChunkOffs));

    const shpChunkOffs = view.getUint32(0x0C, true);
    readShpChunk(cmb, buffer.slice(shpChunkOffs));
}

export function parse(buffer: ArrayBufferSlice): CMB {
    const view = buffer.createDataView();
    const cmb = new CMB();

    assert(readString(buffer, 0x00, 0x04) === 'cmb ');

    const size = view.getUint32(0x04, true);
    cmb.name = readString(buffer, 0x10, 0x10);

    const numChunks = view.getUint32(0x08, true);
    if (numChunks === 0x0F)
        cmb.version = Version.LuigisMansion;
    else if (numChunks === 0x0A)
        cmb.version = Version.Majora
    else if (numChunks === 0x06)
        cmb.version = Version.Ocarina;
    else
        throw "whoops";

    let chunkIdx = 0x24;

    const sklChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readSklChunk(cmb, buffer.slice(sklChunkOffs));

    if (cmb.version === Version.Majora || cmb.version === Version.LuigisMansion)
        chunkIdx += 0x04; // Qtrs

    const matsChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readMatsChunk(cmb, buffer.slice(matsChunkOffs));

    const texDataOffs = view.getUint32(chunkIdx + 0x14, true);

    const texChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;

    readTexChunk(cmb, buffer.slice(texChunkOffs), texDataOffs !== 0 ? buffer.slice(texDataOffs) : null);

    const sklmChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readSklmChunk(cmb, buffer.slice(sklmChunkOffs));

    chunkIdx += 0x04; // Luts

    const vatrChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readVatrChunk(cmb, buffer.slice(vatrChunkOffs));

    const idxDataOffs = view.getUint32(chunkIdx, true);

    const idxDataCount = view.getUint32(0x20, true);
    cmb.indexBuffer = buffer.slice(idxDataOffs, idxDataOffs + idxDataCount * 2);

    return cmb;
}
