import {
    GfxBlendFactor,
    GfxBlendMode,
    GfxCompareMode,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxInputLayout,
    GfxRenderProgramDescriptor,
    GfxSampler,
    GfxVertexBufferFrequency,
} from "../gfx/platform/GfxPlatform";
import { TextureBase, TextureHolder } from "../TextureHolder";
import { SCX } from "./scx/types";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { preprocessProgramObj_GLSL } from "../gfx/shaderc/GfxShaderCompiler";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { colorNewFromRGBA } from "../Color";
import { mat4, vec3 } from "gl-matrix";
import { GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform";
import { CameraController } from "../Camera";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { SceneNode, Simulation, WorldData } from "./types";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import Plus4XPProgram from "./program";
import * as UI from "../ui";
import { updateNodeTransform } from "./util";
import { World } from "./world";

export default class Renderer implements SceneGfx {
    private inputLayout: GfxInputLayout;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private program: GfxRenderProgramDescriptor;
    private diffuseSampler: GfxSampler;
    private envSampler: GfxSampler;

    private world: World;

    private cameras: [string, string | null][];
    private activeCameraName: string | null = null;

    private simulation: Simulation | null;
    private cameraSelect: UI.SingleSelect;
    private animating: boolean = true;
    private lastViewerCameraMatrix: string | null = null;
    private scratchViewMatrix = mat4.create();
    private scratchWorldInverseTransposeMatrix = mat4.create();

    constructor(
        device: GfxDevice,
        worldData: WorldData,
        public textureHolder: TextureHolder<TextureBase>,
    ) {
        this.setupGraphics(device);
        this.world = new World(device, worldData);
        this.cameras = [["FreeCam", null], ...worldData.cameras];
        this.simulation = worldData.simulateFunc?.() ?? null;
        this.simulation?.setup?.(device, this.world);
    }

    private setupGraphics(device: GfxDevice) {
        setAttachmentStateSimple(
            { cullMode: GfxCullMode.Back },
            {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            },
        );
        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // position
                { location: 1, bufferIndex: 1, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // normal
                { location: 2, bufferIndex: 2, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 }, // diffuseColor
                { location: 3, bufferIndex: 3, format: GfxFormat.F32_RG, bufferByteOffset: 0 }, // texCoord
            ],
            vertexBufferDescriptors: [
                { byteStride: 3 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 3 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 4 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 2 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
        });
        this.renderHelper = new GfxRenderHelper(device);
        this.program = preprocessProgramObj_GLSL(device, new Plus4XPProgram());
        const samplerDescriptor = {
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
        };
        this.diffuseSampler = device.createSampler(samplerDescriptor);
        this.envSampler = device.createSampler(samplerDescriptor);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.04);
    }

    public createPanels(): UI.Panel[] {
        const cameraPanel = new UI.Panel();
        cameraPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        cameraPanel.setTitle(UI.EYE_ICON, "Vantage Points");
        this.cameraSelect = new UI.SingleSelect();
        this.cameraSelect.setStrings(this.cameras.map((a) => a[0]));
        this.cameraSelect.onselectionchange = (strIndex: number) => {
            const choice = this.cameras[strIndex];
            this.activeCameraName = choice[1];
            this.lastViewerCameraMatrix = null;
        };
        this.cameraSelect.selectItem(1); // TODO: persist through serialize/deserialize
        cameraPanel.contents.appendChild(this.cameraSelect.elem);

        return [cameraPanel];
    }

    /*
    serializeSaveState?(dst: ArrayBuffer, offs: number): number {}
    deserializeSaveState?(src: ArrayBuffer, offs: number, byteLength: number): number {}
    onstatechanged?: (() => void) | undefined;
    */

    render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const { deltaTime } = viewerInput;
        this.animating = deltaTime > 0;

        if (this.animating) {
            this.simulation?.update?.(device, viewerInput);
            for (const node of this.world.animatableNodes) {
                if (!node.animates) {
                    continue;
                }
                node.animations.forEach((anim) => anim.update(deltaTime / 1000, node.loops));
            }
        }

        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const renderPassDescriptor = makeAttachmentClearDescriptor(colorNewFromRGBA(0, 0, 0));
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, renderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");

        updateNodeTransform(this.world.rootNode, false, null, this.animating);

        if (this.animating) {
            const cameraWorldPos = mat4.getTranslation(
                vec3.create(),
                this.activeCameraName !== null ? this.world.sceneNodesByName.get(this.activeCameraName)!.worldTransform : viewerInput.camera.worldMatrix,
            );
            this.simulation?.render(this.renderHelper, builder, cameraWorldPos);
        }

        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.prepareToRender(viewerInput, renderInstManager);
        this.renderHelper.renderGraph.execute(builder);
        this.simulation?.renderReset();
        this.renderInstListMain.reset();
    }

    private prepareToRender(viewerInput: ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(Plus4XPProgram.bindingLayouts);
        const gfxProgram = renderInstManager.gfxRenderCache.createProgramSimple(this.program);
        template.setGfxProgram(gfxProgram);

        const cameraViewMatrix: mat4 = mat4.create();

        updateCameraParams: {
            let cameraOffset = template.allocateUniformBuffer(Plus4XPProgram.ub_CameraParams, 16 * 3 /*3 Mat4x4*/);
            const cameraBuffer = template.mapUniformBufferF32(Plus4XPProgram.ub_CameraParams);

            this.lastViewerCameraMatrix ??= [...viewerInput.camera.worldMatrix].join("_");

            if (this.activeCameraName !== null) {
                const camera: SCX.Camera = this.world.camerasByName.get(this.activeCameraName)!;
                const cameraNode: SceneNode = this.world.sceneNodesByName.get(this.activeCameraName)!;

                this.world.customCamera.clipSpaceNearZ = viewerInput.camera.clipSpaceNearZ;
                this.world.customCamera.setPerspective(camera.fov, viewerInput.camera.aspect, camera.nearclip, camera.farclip);

                const cameraWorldPos = mat4.getTranslation(vec3.create(), cameraNode.worldTransform);
                const targetWorldPos = vec3.transformMat4(vec3.create(), camera.targetpos, this.world.rootNode.worldTransform);
                const relativePos = vec3.sub(vec3.create(), targetWorldPos, cameraWorldPos);
                mat4.fromTranslation(this.scratchViewMatrix, cameraWorldPos);
                mat4.rotateY(this.scratchViewMatrix, this.scratchViewMatrix, -Math.PI / 2 - Math.atan2(relativePos[2], relativePos[0]));
                mat4.rotateX(this.scratchViewMatrix, this.scratchViewMatrix, Math.atan2(relativePos[1], Math.sqrt(relativePos[0] ** 2 + relativePos[2] ** 2)));

                if (this.activeCameraName !== null && this.lastViewerCameraMatrix !== [...viewerInput.camera.worldMatrix].join("_")) {
                    this.cameraSelect.selectItem(0);
                    mat4.copy(viewerInput.camera.worldMatrix, this.scratchViewMatrix);
                    viewerInput.camera.worldMatrixUpdated();
                    cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, viewerInput.camera.projectionMatrix);
                } else {
                    cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, this.world.customCamera.projectionMatrix);
                }
                mat4.invert(this.scratchViewMatrix, this.scratchViewMatrix);
                cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, this.scratchViewMatrix);
                mat4.copy(cameraViewMatrix, this.scratchViewMatrix);
            } else {
                cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, viewerInput.camera.projectionMatrix);
                cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, viewerInput.camera.viewMatrix);
                mat4.copy(cameraViewMatrix, viewerInput.camera.viewMatrix);
            }

            mat4.invert(this.scratchViewMatrix, cameraViewMatrix);
            cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, this.scratchViewMatrix);
        }

        renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderSceneNodeMeshes(renderInstManager, false);
        this.renderSceneNodeMeshes(renderInstManager, true);
        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    private renderSceneNodeMeshes(renderInstManager: GfxRenderInstManager, ghosts: boolean) {
        renderInstManager.pushTemplate().setMegaStateFlags({
            depthCompare: ghosts ? GfxCompareMode.Always : GfxCompareMode.GreaterEqual,
            depthWrite: !ghosts,
        });

        for (const node of this.world.renderableNodes) {
            if (!node.worldVisible || node.isGhost !== ghosts) {
                continue;
            }

            for (const mesh of node.meshes!) {
                const envMap = (mesh.envID === undefined ? null : this.world.environmentMapsByID.get(mesh.envID)) ?? this.world.defaultEnvMap;
                const renderInst = renderInstManager.newRenderInst();
                updateObjectParams: {
                    let objectOffset = renderInst.allocateUniformBuffer(Plus4XPProgram.ub_ObjectParams, 16 * 3 + 4 + 4 /*Mat4x3 * 3 + vec4 * 2*/);
                    const object = renderInst.mapUniformBufferF32(Plus4XPProgram.ub_ObjectParams);
                    objectOffset += fillMatrix4x4(object, objectOffset, node.worldTransform);

                    mat4.invert(this.scratchWorldInverseTransposeMatrix, node.worldTransform);
                    mat4.transpose(this.scratchWorldInverseTransposeMatrix, this.scratchWorldInverseTransposeMatrix);
                    objectOffset += fillMatrix4x4(object, objectOffset, this.scratchWorldInverseTransposeMatrix);

                    objectOffset += fillMatrix4x4(object, objectOffset, envMap.matrix);
                    objectOffset += fillVec4(object, objectOffset, ...(envMap.tint as [number, number, number, number]));

                    {
                        object[objectOffset] = mesh.material.gfxTexture === null ? 1 : 0;
                        objectOffset++;
                    }
                }

                renderInst.setSamplerBindingsFromTextureMappings([
                    {
                        gfxTexture: mesh.material.gfxTexture ?? this.world.defaultTexture,
                        gfxSampler: this.diffuseSampler,
                        lateBinding: null,
                    },
                    {
                        gfxTexture: envMap.texture,
                        gfxSampler: this.envSampler,
                        lateBinding: null,
                    },
                ]);

                renderInst.setVertexInput(this.inputLayout, mesh.vertexAttributes, mesh.indexBufferDescriptor);

                renderInst.setDrawCount(mesh.indexCount);
                renderInstManager.submitRenderInst(renderInst);
            }
        }

        renderInstManager.popTemplate();
    }

    destroy(device: GfxDevice): void {
        this.simulation?.destroy(device);
        this.simulation = null;
        this.world.destroy(device);
        this.textureHolder.destroy(device);
        this.renderHelper.destroy();
        device.destroySampler(this.diffuseSampler);
        device.destroySampler(this.envSampler);
    }
}
