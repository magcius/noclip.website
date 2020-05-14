
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { vec4, vec3, mat4 } from "gl-matrix";
import { Color, colorNewFromRGBA } from "../Color";
import { unpackColorRGB32Exp, BaseMaterial, BaseMaterialProgram } from "./Materials";
import { SourceRenderContext, noclipSpaceFromSourceEngineSpace } from "./Main";
import { GfxInputLayout, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxFormat, GfxVertexBufferFrequency, GfxDevice, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxInputState } from "../gfx/platform/GfxPlatform";
import { transformVec3Mat4w0, computeModelMatrixSRT, transformVec3Mat4w1, MathConstants } from "../MathHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";

//#region Detail Models
const enum DetailPropOrientation { NORMAL, SCREEN_ALIGNED, SCREEN_ALIGNED_VERTICAL, }
const enum DetailPropType { MODEL, SPRITE, SHAPE_CROSS, SHAPE_TRI, }

interface DetailModel {
    pos: vec3;
    rot: vec3;
    detailModel: number;
    leaf: number;
    lighting: Color; // exp in alpha
    lightStyles: number;
    lightStyleCount: number;
    swayAmount: number;
    shapeAngle: number;
    shapeSize: number;
    type: DetailPropType;
    orientation: DetailPropOrientation;
    scale: number;
}

interface DetailSpriteDef {
    halfWidth: number;
    height: number;
    texcoord: vec4;
}

export interface DetailObjects {
    detailSpriteDict: DetailSpriteDef[];
    detailModels: DetailModel[];
    leafDetailModels: Map<number, DetailModel[]>;
}

export function deserializeGameLump_dprp(buffer: ArrayBufferSlice, version: number): DetailObjects {
    assert(version === 4);

    const dprp = buffer.createDataView();

    let idx = 0x00;

    const detailModelDict: string[] = [];
    const detailModelDictCount = dprp.getUint32(idx, true);
    idx += 0x04;
    for (let i = 0; i < detailModelDictCount; i++) {
        detailModelDict.push(readString(buffer, idx + 0x00, 0x80, true));
        idx += 0x80;
    }

    const detailSpriteDict: DetailSpriteDef[] = [];
    const detailSpriteDictCount = dprp.getUint32(idx, true);
    idx += 0x04;
    for (let i = 0; i < detailSpriteDictCount; i++) {
        const tlx = dprp.getFloat32(idx + 0x00, true);
        const tly = dprp.getFloat32(idx + 0x04, true);
        const lrx = dprp.getFloat32(idx + 0x08, true);
        const lry = dprp.getFloat32(idx + 0x0C, true);
        const textlx = dprp.getFloat32(idx + 0x10, true);
        const textly = dprp.getFloat32(idx + 0x14, true);
        const texlrx = dprp.getFloat32(idx + 0x18, true);
        const texlry = dprp.getFloat32(idx + 0x1C, true);
        const halfWidth = (lrx - tlx) * 0.5;
        const height = (lry - tly);
        const texcoord = vec4.fromValues(textlx, textly, texlrx, texlry);
        detailSpriteDict.push({ halfWidth, height, texcoord });
        idx += 0x20;
    }

    const detailModels: DetailModel[] = [];
    const detailModelCount = dprp.getUint32(idx, true);
    idx += 0x04;
    for (let i = 0; i < detailModelCount; i++) {
        const posX = dprp.getFloat32(idx + 0x00, true);
        const posY = dprp.getFloat32(idx + 0x04, true);
        const posZ = dprp.getFloat32(idx + 0x08, true);
        const rotX = dprp.getFloat32(idx + 0x0C, true);
        const rotY = dprp.getFloat32(idx + 0x10, true);
        const rotZ = dprp.getFloat32(idx + 0x14, true);
        const detailModel = dprp.getUint16(idx + 0x18, true);
        const leaf = dprp.getUint16(idx + 0x1A, true);
        const lightingExp = dprp.getUint8(idx + 0x1F);
        const lightingR = unpackColorRGB32Exp(dprp.getUint8(idx + 0x1C), lightingExp);
        const lightingG = unpackColorRGB32Exp(dprp.getUint8(idx + 0x1D), lightingExp);
        const lightingB = unpackColorRGB32Exp(dprp.getUint8(idx + 0x1E), lightingExp);
        const lightStyles = dprp.getInt32(idx + 0x20, true);
        const lightStyleCount = dprp.getUint8(idx + 0x24);
        const swayAmount = dprp.getUint8(idx + 0x25);
        const shapeAngle = dprp.getUint8(idx + 0x26);
        const shapeSize = dprp.getUint8(idx + 0x27);
        const orientation = dprp.getUint8(idx + 0x28);
        const type = dprp.getUint8(idx + 0x2C);
        const scale = dprp.getFloat32(idx + 0x30, true);
        const pos = vec3.fromValues(posX, posY, posZ);
        const rot = vec3.fromValues(rotX, rotY, rotZ);
        const lighting = colorNewFromRGBA(lightingR, lightingG, lightingB);
        detailModels.push({ pos, rot, detailModel, leaf, lighting, lightStyles, lightStyleCount, swayAmount, shapeAngle, shapeSize, orientation, type, scale });
        idx += 0x34;
    }

    const leafDetailModels = new Map<number, DetailModel[]>();
    for (let i = 0; i < detailModels.length; i++) {
        const leaf = detailModels[i].leaf;
        if (!leafDetailModels.has(leaf))
            leafDetailModels.set(leaf, []);
        leafDetailModels.get(leaf)!.push(detailModels[i]);
    }

    return { detailSpriteDict, detailModels, leafDetailModels };
}

class DetailSpriteEntry {
    // bounding sphere in yup space
    public origin = vec3.create();
    public radius: number;

    // position = zup space.
    public halfWidth: number;
    public height: number;
    public pos: vec3;
    public texcoord: vec4;
    public cameraDepth: number = 0;
}

// Compute a rotation matrix given a forward direction, in Source Engine space.
function computeMatrixForForwardDir(dst: mat4, fwd: vec3, pos: vec3): void {
    let yaw = 0, pitch = 0;

    if (fwd[1] === 0 && fwd[0] === 0) {
        pitch = fwd[2] > 0 ? -MathConstants.TAU / 4 : MathConstants.TAU / 4;
    } else {
        yaw = Math.atan2(fwd[1], fwd[0]);
        pitch = Math.atan2(-fwd[2], Math.hypot(fwd[0], fwd[1]));
    }

    computeModelMatrixSRT(dst, 1, 1, 1, 0, pitch, yaw, pos[0], pos[1], pos[2]);
}

const scratchVec3 = vec3.create();
const scratchMatrix = mat4.create();
export class DetailSpriteLeafRenderer {
    private materialInstance: BaseMaterial | null = null;
    private inputLayout: GfxInputLayout;

    // For each sprite, store an origin and a radius for easy culling.
    private spriteEntries: DetailSpriteEntry[] = [];

    private vertexData: Float32Array;
    private indexData: Uint16Array;
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputState: GfxInputState;

    constructor(renderContext: SourceRenderContext, private objects: DetailObjects, public leaf: number) {
        const device = renderContext.device, cache = renderContext.cache;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: BaseMaterialProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: BaseMaterialProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        // Create a vertex buffer for our detail sprites.

        let vertexCount = 0;
        let indexCount = 0;
        const detailModels = this.objects.leafDetailModels.get(this.leaf)!;
        for (let i = 0; i < detailModels.length; i++) {
            const detailModel = detailModels[i];

            if (detailModel.type === DetailPropType.SPRITE && detailModel.orientation === DetailPropOrientation.SCREEN_ALIGNED_VERTICAL) {
                const desc = objects.detailSpriteDict[detailModel.detailModel];

                // Four vertices & six indices per quad.
                vertexCount += 4;
                indexCount += 6;

                // Compute bounding sphere for sprite.
                const entry = new DetailSpriteEntry();
                entry.halfWidth = desc.halfWidth;
                entry.height = desc.height;
                entry.radius = Math.hypot(entry.halfWidth, entry.height * 0.5);
                vec3.copy(entry.origin, detailModel.pos);
                // Sprite is planted at bottom center. Adjust to true center.
                entry.origin[2] += entry.height * 0.5;
                // Pre-translate into zup.
                transformVec3Mat4w0(entry.origin, noclipSpaceFromSourceEngineSpace, entry.origin);
                entry.pos = detailModel.pos;
                entry.texcoord = desc.texcoord;

                this.spriteEntries.push(entry);
            }

            // TODO(jstpierre): Cross & Tri shapes.
        }

        this.vertexData = new Float32Array(vertexCount * 5);
        this.indexData = new Uint16Array(indexCount);

        this.vertexBuffer = device.createBuffer((this.vertexData.byteLength + 3) >>> 2, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.DYNAMIC);
        this.indexBuffer = device.createBuffer((this.indexData.byteLength + 3) >>> 2, GfxBufferUsage.INDEX, GfxBufferFrequencyHint.DYNAMIC);
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        this.bindMaterial(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, viewMatrixZUp: mat4): void {
        if (this.materialInstance === null)
            return;

        // Upload new sprite data.
        const vertexData = this.vertexData;
        const indexData = this.indexData;

        // TODO(jstpierre): Sort models based on distance to camera.
        let vertexOffs = 0;
        let vertexBase = 0;
        let indexOffs = 0;

        // Build sort list.
        const sortList: DetailSpriteEntry[] = [];
        for (let i = 0; i < this.spriteEntries.length; i++) {
            const entry = this.spriteEntries[i];
            if (!viewerInput.camera.frustum.containsSphere(entry.origin, entry.radius))
                continue;
            // compute distance from camera
            entry.cameraDepth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, entry.origin);
            sortList.push(entry);
        }
        sortList.sort((a, b) => b.cameraDepth - a.cameraDepth);

        for (let i = 0; i < sortList.length; i++) {
            const entry = sortList[i];

            vec3.sub(scratchVec3, renderContext.cameraPos, entry.pos);
            scratchVec3[2] = 0.0;
            computeMatrixForForwardDir(scratchMatrix, scratchVec3, entry.pos);
            // mat4.fromTranslation(scratchMatrix, entry.pos);

            // top left
            vec3.set(scratchVec3, 0, -entry.halfWidth, -entry.height);
            transformVec3Mat4w1(scratchVec3, scratchMatrix, scratchVec3);
            vertexData[vertexOffs++] = scratchVec3[0];
            vertexData[vertexOffs++] = scratchVec3[1];
            vertexData[vertexOffs++] = scratchVec3[2];
            vertexData[vertexOffs++] = entry.texcoord[0];
            vertexData[vertexOffs++] = entry.texcoord[1];

            // top right
            vec3.set(scratchVec3, 0, entry.halfWidth, -entry.height);
            transformVec3Mat4w1(scratchVec3, scratchMatrix, scratchVec3);
            vertexData[vertexOffs++] = scratchVec3[0];
            vertexData[vertexOffs++] = scratchVec3[1];
            vertexData[vertexOffs++] = scratchVec3[2];
            vertexData[vertexOffs++] = entry.texcoord[2];
            vertexData[vertexOffs++] = entry.texcoord[1];

            // bottom right
            vec3.set(scratchVec3, 0, entry.halfWidth, 0);
            transformVec3Mat4w1(scratchVec3, scratchMatrix, scratchVec3);
            vertexData[vertexOffs++] = scratchVec3[0];
            vertexData[vertexOffs++] = scratchVec3[1];
            vertexData[vertexOffs++] = scratchVec3[2];
            vertexData[vertexOffs++] = entry.texcoord[2];
            vertexData[vertexOffs++] = entry.texcoord[3];

            // bottom left
            vec3.set(scratchVec3, 0, -entry.halfWidth, 0);
            transformVec3Mat4w1(scratchVec3, scratchMatrix, scratchVec3);
            vertexData[vertexOffs++] = scratchVec3[0];
            vertexData[vertexOffs++] = scratchVec3[1];
            vertexData[vertexOffs++] = scratchVec3[2];
            vertexData[vertexOffs++] = entry.texcoord[0];
            vertexData[vertexOffs++] = entry.texcoord[3];

            indexData[indexOffs++] = vertexBase + 0;
            indexData[indexOffs++] = vertexBase + 1;
            indexData[indexOffs++] = vertexBase + 2;
            indexData[indexOffs++] = vertexBase + 0;
            indexData[indexOffs++] = vertexBase + 2;
            indexData[indexOffs++] = vertexBase + 3;

            vertexBase += 4;
        }

        const device = renderContext.device;
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexData.buffer));
        hostAccessPass.uploadBufferData(this.indexBuffer, 0, new Uint8Array(this.indexData.buffer));
        device.submitPass(hostAccessPass);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        mat4.identity(scratchMatrix);
        this.materialInstance.setOnRenderInst(renderContext, renderInst, scratchMatrix);
        renderInst.drawIndexes(indexOffs);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }

    private async bindMaterial(renderContext: SourceRenderContext) {
        const materialCache = renderContext.materialCache;
        this.materialInstance = await materialCache.createMaterialInstance(renderContext, `detail/detailsprites`);
    }
}
//#endregion
