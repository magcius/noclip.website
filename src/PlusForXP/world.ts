import {
    GfxBuffer,
    GfxBufferFrequencyHint,
    GfxBufferUsage,
    GfxDevice,
    GfxFormat,
    GfxTexture,
    GfxTextureDimension,
    GfxTextureUsage,
} from "../gfx/platform/GfxPlatform";
import { SCX } from "./scx/types";
import { mat4, quat, vec3, vec4 } from "gl-matrix";
import { Camera } from "../Camera";
import { bakeLights } from "./bake_lights";
import { WorldData, Texture, EnvironmentMap, SceneNode, Material } from "./types";
import { Animation } from "./animation";
import { createSceneNode, createDataBuffer, updateNodeTransform, reparent, cloneTransform } from "./util";

export type ComputedEnvironmentMap = {
    texture: GfxTexture;
    matrix: mat4;
    tint: vec4;
};

export type UnbakedMesh = {
    node: SceneNode;
    mesh: SCX.Mesh;
    lights: SCX.Light[];
    shader: SCX.Shader;
    diffuseColorBuffer: GfxBuffer;
    sceneName: string;
};

export class World {
    private fallbackMaterial: Material;
    private unbakedMeshes: UnbakedMesh[] = [];

    public readonly rootNode: SceneNode;
    public readonly sceneRot: vec3 = vec3.fromValues(-Math.PI / 2, 0, 0);
    public readonly inverseSceneRot: vec3 = vec3.negate(vec3.create(), this.sceneRot);
    public readonly materialsByName = new Map<string, Material>();
    public readonly sceneNodesByName = new Map<string, SceneNode>();
    public readonly renderableNodes: SceneNode[] = [];
    public readonly animatableNodes: SceneNode[] = [];

    public readonly camerasByName = new Map<string, SCX.Camera>();
    public readonly customCamera: Camera;

    public readonly texturesByPath = new Map<string, Texture>();
    public readonly environmentMapsByID = new Map<string, ComputedEnvironmentMap>();
    public defaultTexture: GfxTexture;
    public defaultEnvMap: ComputedEnvironmentMap;

    constructor(
        private device: GfxDevice,
        data: WorldData,
    ) {
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

        this.rootNode = createSceneNode({ name: "root" }, { rot: this.sceneRot });
        for (const [name, { scene, envID }] of Object.entries(data.scenes)) {
            this.buildScene(name, scene, envID);
        }

        this.customCamera = new Camera();

        this.bakeLights();
        this.buildTextures(data.textures, data.environmentMaps);
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
            node.animations = Animation.build(node.animatedTransform!, camera.animations);
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
            node.animations = Animation.build(node.animatedTransform!, object.animations);
            node.animates = node.animations.length > 0;
            this.animatableNodes.push(node);
        }

        return node;
    }

    private buildTextures(textures: Texture[], environmentMaps: Record<string, EnvironmentMap>) {
        const device = this.device;

        for (const texture of textures) {
            this.texturesByPath.set(texture.path, texture);
        }

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

    destroy(device: GfxDevice): void {
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
        this.sceneNodesByName.clear();
        this.renderableNodes.length = 0;
        this.camerasByName.clear();
        this.rootNode.children = [];
    }
}
