
// @ts-ignore
import { readFileSync } from 'fs';
import { GfxDevice, GfxInputLayout, GfxInputState, GfxBuffer, GfxBufferUsage, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxVertexBufferDescriptor, GfxHostAccessPass, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { MeshLodLevel, Mesh, SCN, Sector, SectorFlag, Material, MatFlag } from "./scn";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { convertToTriangleIndexBuffer, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import { GfxRenderInstBuilder, GfxRenderInst, setSortKeyDepth, GfxRenderInstViewRenderer } from "../gfx/render/GfxRenderer";
import { GfxRenderBuffer } from "../gfx/render/GfxRenderBuffer";
import { AABB } from "../Geometry";
import { ViewerRenderInput } from "../viewer";
import { mat4 } from "gl-matrix";
import { computeViewMatrix, computeViewMatrixSkybox, computeViewSpaceDepthFromWorldSpaceAABB, Camera } from "../Camera";
import { fillMatrix4x3, fillVec4, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { nArray } from "../util";
import { TEXTextureHolder } from "./tex";
import { TextureMapping } from "../TextureHolder";

class THUG2Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_MeshParams = 2;

    private static program = readFileSync('src/thug2/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(THUG2Program.program);
    public both = THUG2Program.program;
}

class MeshLodLevelData {
    private indexBuffer: GfxBuffer;
    private vertexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    public indexCount: number;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, sector: Sector, public mesh: Mesh, public lodLevel: MeshLodLevel) {
        const indexData = convertToTriangleIndexBuffer(GfxTopology.TRISTRIP, lodLevel.indexData.createTypedArray(Uint16Array));
        this.indexCount = indexData.length;

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);
        this.vertexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX, lodLevel.packedVertexData);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
        vertexAttributeDescriptors.push({
            location: THUG2Program.a_Position, bufferIndex: 0, bufferByteOffset: 0,
            format: GfxFormat.F32_RGB, frequency: GfxVertexAttributeFrequency.PER_VERTEX,
        });

        if (sector.flags & SectorFlag.HAS_VERTEX_COLORS) {
            vertexAttributeDescriptors.push({
                location: THUG2Program.a_Color, bufferIndex: 0, bufferByteOffset: lodLevel.vertexColorOffset,
                format: GfxFormat.U8_RGBA_NORM, frequency: GfxVertexAttributeFrequency.PER_VERTEX,
            });
        }

        if (sector.flags & SectorFlag.HAS_TEXCOORDS) {
            vertexAttributeDescriptors.push({
                location: THUG2Program.a_TexCoord, bufferIndex: 0, bufferByteOffset: lodLevel.vertexTexCoordOffset,
                format: GfxFormat.F32_RG, frequency: GfxVertexAttributeFrequency.PER_VERTEX,
            });
        }

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
        });

        const vertexBuffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: lodLevel.vertexStride, },
        ];

        this.inputState = device.createInputState(this.inputLayout, vertexBuffers, { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x02 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

const bboxScratch = new AABB();
const modelMatrixScratch = mat4.create();
const modelViewMatrixScratch = mat4.create();
class MeshLodLevelInstance {
    private renderInst: GfxRenderInst;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, private lodLevelData: MeshLodLevelData) {
        this.renderInst = renderInstBuilder.pushRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.renderInst, THUG2Program.ub_MeshParams);
        this.renderInst.inputState = lodLevelData.inputState;
        this.renderInst.drawIndexes(lodLevelData.indexCount);
    }

    public prepareToRender(visible: boolean, isSkybox: boolean, meshParamsBuffer: GfxRenderBuffer, viewerInput: ViewerRenderInput): void {
        if (visible) {
            const modelMatrix = modelMatrixScratch;
            mat4.identity(modelMatrix);

            bboxScratch.transform(this.lodLevelData.mesh.bbox, modelMatrix);
            visible = viewerInput.camera.frustum.contains(bboxScratch);
        }

        this.renderInst.visible = visible;

        if (visible) {
            const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch);
            this.renderInst.sortKey = setSortKeyDepth(this.renderInst.sortKey, depth);

            if (isSkybox) {
                computeViewMatrixSkybox(modelViewMatrixScratch, viewerInput.camera);
            } else {
                computeViewMatrix(modelViewMatrixScratch, viewerInput.camera);
            }

            let offs = this.renderInst.getUniformBufferOffset(THUG2Program.ub_MeshParams);
            const mappedF32 = meshParamsBuffer.mapBufferF32(offs, 12);
            offs += fillMatrix4x3(mappedF32, offs, modelViewMatrixScratch);
        }
    }

    public destroy(device: GfxDevice): void {
    }
}

const textureMapping = nArray(4, () => new TextureMapping());
class MaterialInstance {
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice, textureHolder: TEXTextureHolder, renderInstBuilder: GfxRenderInstBuilder, public material: Material) {
        // TOOD(jstpierre): Generate program
        const program = new THUG2Program();
        program.defines.set('USE_VERTEX_COLOR', '1');
        if (material.alphaCutoff < 0xFF)
            program.defines.set('USE_ALPHATEST', '1');

        this.templateRenderInst = renderInstBuilder.newRenderInst();
        this.templateRenderInst.gfxProgram = device.createProgram(program);
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, THUG2Program.ub_MaterialParams);

        textureMapping[0].reset();

        if ((material.passes[0].flags & MatFlag.TEXTURED)) {
            const texPass0 = material.passes[0].textureChecksum.toString(16);
            textureHolder.fillTextureMapping(textureMapping[0], texPass0);
        }

        this.templateRenderInst.setSamplerBindingsFromTextureMappings(textureMapping);
    }

    public prepareToRender(materialParamsBuffer: GfxRenderBuffer, viewerInput: ViewerRenderInput): void {
        let offs = this.templateRenderInst.getUniformBufferOffset(THUG2Program.ub_MaterialParams);
        const mappedF32 = materialParamsBuffer.mapBufferF32(offs, 4);
        const alphaCutoff = this.material.alphaCutoff / 0xFF;
        offs += fillVec4(mappedF32, offs, alphaCutoff);
        // TODO(jstpierre): Texture animation?
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.templateRenderInst.gfxProgram);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

class SectorData {
    public meshLodLevelDatas: MeshLodLevelData[] = [];

    constructor(device: GfxDevice, public sector: Sector) {
        for (let i = 0; i < sector.meshes.length; i++)
            this.meshLodLevelDatas[i] = new MeshLodLevelData(device, sector, sector.meshes[i], sector.meshes[i].lodLevels[0]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshLodLevelDatas.length; i++)
            this.meshLodLevelDatas[i].destroy(device);
    }
}

export class SectorInstance {
    private meshLodLevelInstances: MeshLodLevelInstance[] = [];

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, materialInstances: MaterialInstance[], private sectorData: SectorData) {
        for (let i = 0; i < sectorData.meshLodLevelDatas.length; i++) {
            const lodLevelData = sectorData.meshLodLevelDatas[i];
            const materialChecksum = lodLevelData.mesh.materialChecksum;
            const materialInstance = materialInstances.find((materialInstance) => materialInstance.material.materialChecksum === materialChecksum);
            renderInstBuilder.pushTemplateRenderInst(materialInstance.templateRenderInst);
            this.meshLodLevelInstances[i] = new MeshLodLevelInstance(device, renderInstBuilder, lodLevelData);
            renderInstBuilder.popTemplateRenderInst();
        }
    }

    public prepareToRender(visible: boolean, isSkybox: boolean, meshParamsBuffer: GfxRenderBuffer, viewerInput: ViewerRenderInput): void {
        if (visible) {
            const modelMatrix = modelMatrixScratch;
            mat4.identity(modelMatrix);

            bboxScratch.transform(this.sectorData.sector.bbox, modelMatrix);
            visible = viewerInput.camera.frustum.contains(bboxScratch);
        }

        for (let i = 0; i < this.meshLodLevelInstances.length; i++)
            this.meshLodLevelInstances[i].prepareToRender(visible, isSkybox, meshParamsBuffer, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshLodLevelInstances.length; i++)
            this.meshLodLevelInstances[i].destroy(device);
    }
}

export class SCNData {
    public sectorDatas: SectorData[] = [];

    constructor(device: GfxDevice, public scn: SCN) {
        for (let i = 0; i < scn.sectors.length; i++)
            this.sectorDatas[i] = new SectorData(device, scn.sectors[i]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.sectorDatas.length; i++)
            this.sectorDatas[i].destroy(device);
    }
}

export class SCNInstance {
    public materialInstances: MaterialInstance[] = [];
    public sectorInstances: SectorInstance[] = [];

    constructor(device: GfxDevice, textureHolder: TEXTextureHolder, renderInstBuilder: GfxRenderInstBuilder, private scnData: SCNData) {
        for (let i = 0; i < scnData.scn.materials.length; i++)
            this.materialInstances[i] = new MaterialInstance(device, textureHolder, renderInstBuilder, scnData.scn.materials[i]);
        for (let i = 0; i < scnData.sectorDatas.length; i++)
            this.sectorInstances[i] = new SectorInstance(device, renderInstBuilder, this.materialInstances, scnData.sectorDatas[i]);;
    }

    public prepareToRender(materialParamsBuffer: GfxRenderBuffer, meshParamsBuffer: GfxRenderBuffer, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].prepareToRender(materialParamsBuffer, viewerInput);
        for (let i = 0; i < this.sectorInstances.length; i++)
            this.sectorInstances[i].prepareToRender(true, false, meshParamsBuffer, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
        for (let i = 0; i < this.sectorInstances.length; i++)
            this.sectorInstances[i].destroy(device);
    }
}

export class SceneRenderer {
    private sceneParamsBuffer: GfxRenderBuffer;
    private materialParamsBuffer: GfxRenderBuffer;
    private meshParamsBuffer: GfxRenderBuffer;
    private templateRenderInst: GfxRenderInst;
    public renderInstBuilder: GfxRenderInstBuilder;
    public scnInstances: SCNInstance[] = [];

    constructor(device: GfxDevice) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
        this.meshParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MeshParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 4 }, // Material
            { numUniformBuffers: 1, numSamplers: 0 }, // Mesh
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.materialParamsBuffer, this.meshParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, THUG2Program.programReflection, bindingLayouts, uniformBuffers);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, THUG2Program.ub_SceneParams);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);
        let offs = this.templateRenderInst.getUniformBufferOffset(THUG2Program.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.scnInstances.length; i++)
            this.scnInstances[i].prepareToRender(this.materialParamsBuffer, this.meshParamsBuffer, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.meshParamsBuffer.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.meshParamsBuffer.destroy(device);

        for (let i = 0; i < this.scnInstances.length; i++)
            this.scnInstances[i].destroy(device);
    }
}
