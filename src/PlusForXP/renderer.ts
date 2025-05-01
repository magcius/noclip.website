import {
    GfxBlendFactor,
    GfxBlendMode,
    GfxBufferFrequencyHint,
    GfxBufferUsage,
    GfxCompareMode,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxInputLayout,
    GfxRenderProgramDescriptor,
    GfxSampler,
    GfxTexture,
    GfxTextureDimension,
    GfxTextureUsage,
    GfxVertexBufferFrequency,
} from "../gfx/platform/GfxPlatform.js";
import { TextureBase, TextureHolder } from "../TextureHolder.js";
import { SCX } from "./scx/types.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { preprocessProgramObj_GLSL } from "../gfx/shaderc/GfxShaderCompiler.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { colorNewFromRGBA } from "../Color.js";
import { mat4, quat, vec3, vec4 } from "gl-matrix";
import { GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform.js";
import { Camera, CameraController } from "../Camera.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { bakeLights } from "./bake_lights.js";
import { Material, Texture, SceneNode, Simulation, EnvironmentMap, ComputedEnvironmentMap, UnbakedMesh } from "./types.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import Plus4XPProgram from "./program.js";
import { AnimationBuilder } from "./animation.js";
import * as UI from "../ui.js";
import { createSceneNode, createDataBuffer, updateNodeTransform, reparent, cloneTransform } from "./util.js";

type Context = {
    basePath: string;
    scenes: Record<string, { scene: SCX.Scene; envID?: string }>;
    textures: Texture[];
    environmentMaps: Record<string, EnvironmentMap>;
    cameras: [string, string][];
    simulateFunc?: () => Simulation;
};

export default class Renderer implements SceneGfx {
    private inputLayout: GfxInputLayout;
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private program: GfxRenderProgramDescriptor;
    private diffuseSampler: GfxSampler | null;
    private envSampler: GfxSampler | null;
    private fallbackMaterial: Material;

    private rootNode: SceneNode;
    private sceneRot: vec3 = vec3.fromValues(-Math.PI / 2, 0, 0);
    private inverseSceneRot: vec3 = vec3.negate(vec3.create(), this.sceneRot);
    private materialsByName = new Map<string, Material>();
    private sceneNodesByName = new Map<string, SceneNode>();
    private renderableNodes: SceneNode[] = [];
    private animatableNodes: SceneNode[] = [];

    private camerasByName = new Map<string, SCX.Camera>();
    private customCamera: Camera;
    private cameras: [string, string | null][];
    private activeCameraName: string | null = null;

    private unbakedMeshes: UnbakedMesh[] = [];
    private texturesByPath: Map<string, Texture>;
    private environmentMapsByID = new Map<string, ComputedEnvironmentMap>();
    private defaultTexture: GfxTexture;
    private defaultEnvMap: ComputedEnvironmentMap;

    private simulation: Simulation | null;
    private cameraSelect: UI.SingleSelect;
    private animating: boolean = true;
    private lastViewerCameraMatrix: string | null = null;
    private scratchViewMatrix = mat4.create();
    private scratchWorldInverseTransposeMatrix = mat4.create();

    constructor(
        private device: GfxDevice,
        context: Context,
        public textureHolder: TextureHolder<TextureBase>,
    ) {
        this.setupGraphics();

        this.rootNode = createSceneNode({ name: "root" }, { rot: this.sceneRot });
        for (const [name, { scene, envID }] of Object.entries(context.scenes)) {
            this.buildScene(name, scene, envID);
        }

        this.customCamera = new Camera();
        this.cameras = [["FreeCam", null], ...context.cameras];

        this.bakeLights();
        this.buildTextures(context.textures, context.environmentMaps);

        this.simulation = context.simulateFunc?.() ?? null;
        this.simulation?.setup?.(device, this.texturesByPath, this.materialsByName, this.sceneNodesByName);
    }

    private setupGraphics() {
        const device = this.device;
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
        this.fallbackMaterial = {
            shader: {
                name: "fallback",
                id: -1,
                ambient: vec3.create(),
                diffuse: vec3.fromValues(1, 1, 1),
                specular: vec3.fromValues(1, 1, 1),
                opacity: 1,
                luminance: 1,
                blend: 0,
            },
            gfxTexture: null,
        };
    }

    private buildScene(sceneName: string, scene: SCX.Scene, envID: string | undefined) {
        const sceneRoot: SceneNode = createSceneNode({ name: sceneName + "_root", parent: this.rootNode });
        this.sceneNodesByName.set(sceneRoot.name, sceneRoot);
        this.rootNode.children.push(sceneRoot);
        scene.lights.push({
            type: SCX.LightType.Ambient,
            name: "ambient",
            color: scene.global.ambient,
            intensity: 1,
        });

        for (const shader of scene.shaders) {
            this.buildMaterial(sceneName, shader);
        }

        for (const camera of scene.cameras) {
            this.buildCamera(sceneName, camera);
        }

        const nodes = new Map<string, SceneNode>();
        for (const object of scene.objects) {
            const node = this.buildObject(sceneName, scene, sceneRoot, object, envID);
            nodes.set(node.name, node);
        }
        for (const sceneNode of nodes.values()) {
            reparent(sceneNode, nodes.get(sceneNode.parentName ?? "") ?? sceneRoot);
        }
    }

    private buildMaterial(sceneName: string, shader: SCX.Shader) {
        const material = { shader, gfxTexture: null };
        this.materialsByName.set(sceneName + shader.id, material);
        return material;
    }

    private buildCamera(sceneName: string, camera: SCX.Camera) {
        const cameraName = sceneName + camera.name;
        const node: SceneNode = createSceneNode({ name: cameraName, loops: true }, { trans: camera.pos, rot: this.inverseSceneRot });
        this.sceneNodesByName.set(cameraName, node);
        reparent(node, this.rootNode);
        this.camerasByName.set(cameraName, camera);
        if (camera.animations !== undefined) {
            node.animatedTransform = cloneTransform(node.transform);
            node.animations = AnimationBuilder.build(node.animatedTransform!, camera.animations);
            node.animates = node.animations.length > 0;
            this.animatableNodes.push(node);
        }
        return node;
    }

    private buildObject(sceneName: string, scene: SCX.Scene, sceneRoot: SceneNode, object: SCX.Object, envID: string | undefined) {
        const device = this.device;
        const objectName = sceneName + object.name;
        const node: SceneNode = createSceneNode({
            name: objectName,
            parentName: object.parent === null ? undefined : sceneName + object.parent,
            transform: cloneTransform(object.transform),
            loops: true,
        });

        for (const mesh of object.meshes ?? []) {
            if (mesh.indices.length <= 0) {
                continue;
            }

            const material = this.materialsByName.get(sceneName + mesh.shader) ?? this.fallbackMaterial;
            if (material === this.fallbackMaterial) {
                console.warn(`Missing shader ${mesh.shader} on mesh in ${object.name} of scene ${sceneName}. Falling back to default material.`);
            }

            const diffuseColorBuffer = device.createBuffer(mesh.vertexcount * 4, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static);
            device.uploadBufferData(diffuseColorBuffer, 0, new Uint8Array(new Float32Array(mesh.vertexcount * 4).fill(1).buffer));

            const positionBuffer = createDataBuffer(device, GfxBufferUsage.Vertex, mesh.positions.buffer, mesh.dynamic);
            const normalBuffer = createDataBuffer(device, GfxBufferUsage.Vertex, mesh.normals.buffer, mesh.dynamic);
            const texcoordBuffer = createDataBuffer(device, GfxBufferUsage.Vertex, mesh.texCoords.buffer);
            const vertexAttributes = [
                { name: "position", ...(mesh.dynamic ? { data: mesh.positions } : null), buffer: positionBuffer, byteOffset: 0 },
                { name: "normal", ...(mesh.dynamic ? { data: mesh.normals } : null), buffer: normalBuffer, byteOffset: 0 },
                { name: "diffuseColor", buffer: diffuseColorBuffer, byteOffset: 0 },
                { name: "texCoord", buffer: texcoordBuffer, byteOffset: 0 },
            ];

            const indexBuffer = createDataBuffer(device, GfxBufferUsage.Index, mesh.indices.buffer);
            const indexBufferDescriptor = { buffer: indexBuffer, byteOffset: 0, ...(mesh.dynamic ? { data: mesh.indices } : null) };

            this.unbakedMeshes.push({ node, mesh, shader: material.shader, diffuseColorBuffer, sceneName, lights: scene.lights });

            node.meshes.push({
                inputLayout: this.inputLayout,
                vertexAttributes,
                indexBufferDescriptor,
                indexCount: mesh.indices.length,
                material,
                envID,
            });
        }

        this.sceneNodesByName.set(objectName, node);
        if (node.meshes.length > 0) {
            this.renderableNodes.push(node);
        }

        if (object.animations !== undefined) {
            node.animatedTransform = cloneTransform(node.transform);
            node.animations = AnimationBuilder.build(node.animatedTransform!, object.animations);
            node.animates = node.animations.length > 0;
            this.animatableNodes.push(node);
        }

        return node;
    }

    private buildTextures(textures: Texture[], environmentMaps: Record<string, EnvironmentMap>) {
        const device = this.device;

        this.texturesByPath = new Map(textures.map((texture) => [texture.path, texture]));

        for (const [envID, { texturePath, rotation, tint }] of Object.entries(environmentMaps)) {
            const envTexture = this.texturesByPath.get(texturePath)!;
            const texture = device.createTexture({
                ...envTexture,
                dimension: GfxTextureDimension.n2D,
                pixelFormat: GfxFormat.U8_RGBA_NORM,
                depthOrArrayLayers: 1,
                numLevels: 1,
                usage: GfxTextureUsage.Sampled,
            });
            device.uploadTextureData(texture, 0, [envTexture.rgba8]);
            const matrix = mat4.fromQuat(mat4.create(), quat.fromEuler(quat.create(), ...rotation));
            const computedTint = vec4.fromValues(...(tint ?? [1, 1, 1]), 1);
            this.environmentMapsByID.set(envID, { texture, matrix, tint: computedTint });
        }

        this.defaultTexture = device.createTexture({
            width: 1,
            height: 1,
            dimension: GfxTextureDimension.n2D,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            depthOrArrayLayers: 1,
            numLevels: 1,
            usage: GfxTextureUsage.Sampled,
        });
        this.defaultEnvMap = {
            texture: this.defaultTexture,
            matrix: mat4.create(),
            tint: vec4.fromValues(1, 1, 1, 1),
        };
        device.uploadTextureData(this.defaultTexture, 0, [new Uint8Array([0xff, 0x00, 0xff, 0xff])]);

        const requiredTextures = new Map<string, Texture>();
        for (const material of this.materialsByName.values()) {
            const texture = material.shader.texture === undefined ? null : (this.texturesByPath.get(material.shader.texture.replaceAll("\\", "/")) ?? null);

            if (texture === null) {
                continue;
            }

            const texturePath = texture.path;
            if (!requiredTextures.has(texturePath)) {
                const gfxTexture = device.createTexture({
                    ...texture,
                    dimension: GfxTextureDimension.n2D,
                    pixelFormat: GfxFormat.U8_RGBA_NORM,
                    depthOrArrayLayers: 1,
                    numLevels: 1,
                    usage: GfxTextureUsage.Sampled,
                });
                device.uploadTextureData(gfxTexture, 0, [texture.rgba8]);
                texture.gfxTexture = gfxTexture;
                requiredTextures.set(texturePath, texture);
            }
            material.gfxTexture = requiredTextures.get(texture?.path)?.gfxTexture ?? null;
        }
    }

    private bakeLights() {
        updateNodeTransform(this.rootNode, false, null, false);
        const transformedLightsBySceneName: Map<string, SCX.Light[]> = new Map();
        const rootTransform = this.rootNode.worldTransform;
        for (const { node, shader, mesh, diffuseColorBuffer, sceneName, lights } of this.unbakedMeshes) {
            if (!transformedLightsBySceneName.has(sceneName)) {
                transformedLightsBySceneName.set(
                    sceneName,
                    lights.map(
                        (light: SCX.Light): SCX.Light => ({
                            ...light,
                            pos: light.pos === undefined ? undefined : vec3.transformMat4(vec3.create(), light.pos, rootTransform),
                            dir: light.dir === undefined ? undefined : vec3.transformMat4(vec3.create(), light.dir, rootTransform),
                        }),
                    ),
                );
            }
            const diffuseColors = bakeLights(mesh, shader, node.worldTransform, transformedLightsBySceneName.get(sceneName)!);
            this.device.uploadBufferData(diffuseColorBuffer, 0, new Uint8Array(diffuseColors.buffer));
        }
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
            this.simulation?.update?.(viewerInput, this.sceneNodesByName, device);
            for (const node of this.animatableNodes) {
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

        updateNodeTransform(this.rootNode, false, null, this.animating);

        if (this.animating) {
            const cameraWorldPos = mat4.getTranslation(
                vec3.create(),
                this.activeCameraName !== null ? this.sceneNodesByName.get(this.activeCameraName)!.worldTransform : viewerInput.camera.worldMatrix,
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
                const camera: SCX.Camera = this.camerasByName.get(this.activeCameraName)!;
                const cameraNode: SceneNode = this.sceneNodesByName.get(this.activeCameraName)!;

                this.customCamera.clipSpaceNearZ = viewerInput.camera.clipSpaceNearZ;
                this.customCamera.setPerspective(camera.fov, viewerInput.camera.aspect, camera.nearclip, camera.farclip);

                const cameraWorldPos = mat4.getTranslation(vec3.create(), cameraNode.worldTransform);
                const targetWorldPos = vec3.transformMat4(vec3.create(), camera.targetpos, this.rootNode.worldTransform);
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
                    cameraOffset += fillMatrix4x4(cameraBuffer, cameraOffset, this.customCamera.projectionMatrix);
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

        for (const node of this.renderableNodes) {
            if (!node.worldVisible || node.isGhost !== ghosts) {
                continue;
            }

            for (const mesh of node.meshes!) {
                const envMap = (mesh.envID === undefined ? null : this.environmentMapsByID.get(mesh.envID)) ?? this.defaultEnvMap;
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
                        gfxTexture: mesh.material.gfxTexture ?? this.defaultTexture,
                        gfxSampler: this.diffuseSampler,
                        lateBinding: null,
                    },
                    {
                        gfxTexture: envMap.texture,
                        gfxSampler: this.envSampler,
                        lateBinding: null,
                    },
                ]);

                renderInst.setVertexInput(mesh.inputLayout, mesh.vertexAttributes, mesh.indexBufferDescriptor);

                renderInst.setDrawCount(mesh.indexCount);
                renderInstManager.submitRenderInst(renderInst);
            }
        }

        renderInstManager.popTemplate();
    }

    destroy(device: GfxDevice): void {
        this.simulation?.destroy(device);
        this.simulation = null;
        this.textureHolder.destroy(device);
        this.renderHelper.destroy();
        for (const material of this.materialsByName.values()) {
            if (material.gfxTexture !== null) {
                device.destroyTexture(material.gfxTexture);
                material.gfxTexture = null;
            }
        }
        this.materialsByName.clear();
        for (const node of this.sceneNodesByName.values()) {
            if (node.meshes === null || node.meshes.length === 0) {
                continue;
            }
            for (const { buffer } of node.meshes[0].vertexAttributes) {
                device.destroyBuffer(buffer);
            }
            for (const mesh of node.meshes) {
                device.destroyBuffer(mesh.indexBufferDescriptor.buffer);
            }
        }
        if (this.diffuseSampler !== null) {
            device.destroySampler(this.diffuseSampler);
        }
        this.diffuseSampler = null;
        if (this.envSampler !== null) {
            device.destroySampler(this.envSampler);
        }
        this.envSampler = null;
        this.sceneNodesByName.clear();
        this.renderableNodes.length = 0;
        this.camerasByName.clear();
        this.rootNode.children = [];
    }
}
