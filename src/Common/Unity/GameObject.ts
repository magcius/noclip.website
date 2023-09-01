
import { mat4, quat, vec3 } from "gl-matrix";
import type * as wasm from '../../../rust/pkg/index';
import type { UnityObject } from "../../../rust/pkg/index";
import { DeviceProgram } from "../../Program.js";
import { SceneContext } from "../../SceneBase.js";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary.js";
import { fillMatrix4x3 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxCullMode, GfxDevice, GfxFrontFaceMode } from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderInst, GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import { assert, assertExists, fallbackUndefined, nArray } from "../../util.js";
import { ViewerRenderInput } from "../../viewer.js";
import { AssetFile, AssetLocation, AssetObjectData, UnityAssetResourceType, UnityAssetSystem, UnityChannel, UnityMaterialData, UnityMeshData, createUnityAssetSystem } from "./AssetManager.js";
import { rust } from "../../rustlib.js";

interface WasmBindgenArray<T> {
    length: number;
    get(i: number): T;
    free(): void;
}

function loadWasmBindgenArray<T>(wasmArr: WasmBindgenArray<T>): T[] {
    const jsArr: T[] = Array<T>(wasmArr.length);
    for (let i = 0; i < wasmArr.length; i++)
        jsArr[i] = wasmArr.get(i);
    wasmArr.free();
    return jsArr;
}

export abstract class UnityComponent {
    public async load(level: UnityLevel): Promise<void> {
    }

    public spawn(level: UnityLevel): void {
    }

    public destroy(device: GfxDevice): void {
    }
}

function vec3FromVec3f(dst: vec3, src: wasm.Vec3f): void {
    vec3.set(dst, src.x, src.y, src.z);
}

function quatFromQuaternion(dst: quat, src: wasm.Quaternion): void {
    quat.set(dst, src.x, src.y, src.z, src.w);
}

const noclipSpaceFromUnitySpace = mat4.fromValues(
     -1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
);

export class Transform extends UnityComponent {
    public localPosition = vec3.create();
    public localRotation = quat.create();
    public localScale = vec3.create();
    public parent: Transform | null = null;
    public children: Transform[] = [];

    public modelMatrix = mat4.create();

    constructor(level: UnityLevel, public gameObject: GameObject, private wasmObj: wasm.Transform) {
        super();
        vec3FromVec3f(this.localPosition, wasmObj.local_position);
        quatFromQuaternion(this.localRotation, wasmObj.local_rotation);
        vec3FromVec3f(this.localScale, wasmObj.local_scale);
    }

    public override spawn(level: UnityLevel): void {
        super.spawn(level);
        this.parent = level.findComponentByPPtr(this.wasmObj.parent);
        this.children = loadWasmBindgenArray(this.wasmObj.get_children()).map((pptr) => {
            return assertExists(level.findComponentByPPtr<Transform>(pptr));
        });
        this.wasmObj.free();
        this.wasmObj = null!;
    }

    public updateModelMatrix(): void {
        mat4.fromRotationTranslationScale(this.modelMatrix, this.localRotation, this.localPosition, this.localScale);

        if (this.parent !== null)
            mat4.mul(this.modelMatrix, this.parent.modelMatrix, this.modelMatrix);
        else
            mat4.mul(this.modelMatrix, noclipSpaceFromUnitySpace, this.modelMatrix);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].updateModelMatrix();
    }

    public isVisible(): boolean {
        if (!this.gameObject.visible || !this.gameObject.isActive)
            return false;

        if (this.parent !== null)
            return this.parent.isVisible();

        return true;
    }
}

export class MeshFilter extends UnityComponent {
    public meshData: UnityMeshData | null = null;

    constructor(level: UnityLevel, public gameObject: GameObject, wasmObj: wasm.MeshFilter) {
        super();
        this.loadMeshData(level, wasmObj);
    }

    private async loadMeshData(level: UnityLevel, wasmObj: wasm.MeshFilter) {
        const assetSystem = level.runtime.assetSystem;
        this.meshData = await assetSystem.fetchResource(UnityAssetResourceType.Mesh, this.gameObject.location, wasmObj.mesh_ptr);
        wasmObj.free();
    }
}

export class UnityShaderProgramBase extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

    public static Common = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
};

layout(std140) uniform ub_ShapeParams {
    // TODO(jstpierre): Skinned mesh
    Mat4x3 u_BoneMatrix[1];
};

#ifdef VERT
layout(location = ${UnityChannel.Vertex}) attribute vec3 a_Position;
layout(location = ${UnityChannel.Normal}) attribute vec3 a_Normal;
layout(location = ${UnityChannel.Tangent}) attribute vec3 a_Tangent;
layout(location = ${UnityChannel.TexCoord0}) attribute vec2 a_TexCoord0;
layout(location = ${UnityChannel.TexCoord1}) attribute vec2 a_TexCoord1;
layout(location = ${UnityChannel.TexCoord2}) attribute vec2 a_TexCoord2;
layout(location = ${UnityChannel.TexCoord3}) attribute vec2 a_TexCoord3;
layout(location = ${UnityChannel.TexCoord4}) attribute vec2 a_TexCoord4;
layout(location = ${UnityChannel.TexCoord5}) attribute vec2 a_TexCoord5;
layout(location = ${UnityChannel.TexCoord6}) attribute vec2 a_TexCoord6;
layout(location = ${UnityChannel.TexCoord7}) attribute vec2 a_TexCoord7;
layout(location = ${UnityChannel.BlendIndices}) attribute vec4 a_BlendIndices;
layout(location = ${UnityChannel.BlendWeight}) attribute vec4 a_BlendWeight;

${GfxShaderLibrary.MulNormalMatrix}
${GfxShaderLibrary.CalcScaleBias}

Mat4x3 CalcWorldFromLocalMatrix() {
    return u_BoneMatrix[0];
}
#endif
`;
}

export abstract class UnityMaterialInstance {
    public abstract prepareToRender(renderInst: GfxRenderInst): void;
}

export class MeshRenderer extends UnityComponent {
    private staticBatchSubmeshStart = 0;
    private staticBatchSubmeshCount = 0;
    private visible = true;
    private modelMatrix = mat4.create();
    private materials: (UnityMaterialInstance | null)[];

    constructor(level: UnityLevel, public gameObject: GameObject, private header: wasm.MeshRenderer) {
        super();
        this.visible = header.enabled;
        this.staticBatchSubmeshStart = header.static_batch_info.first_submesh;
        this.staticBatchSubmeshCount = header.static_batch_info.submesh_count;
    }

    public override async load(level: UnityLevel) {
        const materials = this.header.get_materials();
        this.materials = nArray(materials.length, () => null);
        for (let i = 0; i < materials.length; i++) {
            const materialPPtr = materials.get(i)!;
            // Don't wait on materials, we can render them as they load in...
            this.fetchMaterial(level, i, materialPPtr);
            materialPPtr.free();
        }
        materials.free();
    }

    private async fetchMaterial(level: UnityLevel, i: number, pptr: wasm.PPtr) {
        const runtime = level.runtime;
        const materialData = await runtime.assetSystem.fetchResource(UnityAssetResourceType.Material, this.gameObject.location, pptr);
        if (materialData === null)
            return;

        this.materials[i] = runtime.materialFactory.createMaterialInstance(runtime, materialData);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.visible || !this.gameObject.isVisible())
            return;

        const meshFilter = this.gameObject.getComponent(MeshFilter);
        if (meshFilter === null)
            return;

        const meshData = meshFilter.meshData;
        if (meshData === null)
            return;

        // TODO(jstpierre): AABB culling

        if (this.staticBatchSubmeshCount > 0) {
            mat4.copy(this.modelMatrix, noclipSpaceFromUnitySpace);
        } else {
            // TODO(jstpierre): Skinned meshes
            const transform = assertExists(this.gameObject.getComponent(Transform));
            mat4.copy(this.modelMatrix, transform.modelMatrix);
        }

        const template = renderInstManager.pushTemplateRenderInst();

        let offs = template.allocateUniformBuffer(UnityShaderProgramBase.ub_ShapeParams, 12);
        const mapped = template.mapUniformBufferF32(UnityShaderProgramBase.ub_ShapeParams);

        offs += fillMatrix4x3(mapped, offs, this.modelMatrix);

        template.setVertexInput(meshData.inputLayout, meshData.vertexBuffers, meshData.indexBuffer);

        let submeshIndex = 0;
        const submeshCount = this.staticBatchSubmeshCount !== 0 ? this.staticBatchSubmeshCount : meshData.submeshes.length;
        for (let i = 0; i < this.materials.length; i++) {
            const submesh = meshData.submeshes[this.staticBatchSubmeshStart + submeshIndex];
            if (submeshIndex < submeshCount - 1)
                submeshIndex++;

            const material = this.materials[i];
            if (material === null)
                continue;

            const renderInst = renderInstManager.newRenderInst();
            material.prepareToRender(renderInst);
            const firstIndex = submesh.first_byte / meshData.indexBufferStride;
            renderInst.drawIndexes(submesh.index_count, firstIndex);
            renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW });
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public override destroy(device: GfxDevice): void {
        this.header.free();
    }
}

export class GameObject {
    public name: string;
    public layer = 0;
    public isActive = true;
    public visible = true;
    public components: UnityComponent[] = [];

    constructor(public location: AssetLocation, private header: wasm.GameObject) {
        this.name = this.header.name;
    }

    public async load(level: UnityLevel) {
        const components = loadWasmBindgenArray(this.header.get_components());
        await Promise.all(components.map(async (pptr) => {
            const data = await level.runtime.assetSystem.fetchPPtr(this.location, pptr);
            pptr.free();
            const loadPromise = level.loadComponent(this, data);
            if (loadPromise !== null)
                await loadPromise;
        }));
    }

    public getComponent<T extends UnityComponent>(constructor: ComponentConstructor<T, any>): T | null {
        for (let i = 0; i < this.components.length; i++)
            if (this.components[i] instanceof constructor)
                return this.components[i] as T;
        return null;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.components.length; i++)
            this.components[i].destroy(device);
        this.header.free();
    }

    public isVisible(): boolean {
        return this.getComponent(Transform)!.isVisible();
    }
}

interface WasmFromBytes<T> {
    from_bytes(data: Uint8Array, assetInfo: wasm.AssetInfo): any;
}

interface ComponentConstructor<CompT, WasmT> {
    new(level: UnityLevel, gameObject: GameObject, wasm: WasmT): CompT;
}

export abstract class UnityMaterialFactory {
    public abstract createMaterialInstance(runtime: UnityRuntime, materialData: UnityMaterialData): UnityMaterialInstance;
}

class UnityLevel {
    public gameObjects: GameObject[] = [];
    public components = new Map<number, UnityComponent>();
    public rootGameObjects: GameObject[] = [];

    constructor(public runtime: UnityRuntime) {
    }

    public findGameObjectByPPtr(pptr: wasm.PPtr): GameObject | null {
        assert(pptr.file_index === 0);
        if (pptr.path_id === 0)
            return null;
        return fallbackUndefined(this.gameObjects.find((obj) => obj.location.pathID === pptr.path_id), null);
    }

    public findComponentByPPtr<T extends UnityComponent>(pptr: wasm.PPtr): T | null {
        assert(pptr.file_index === 0);
        if (pptr.path_id === 0)
            return null;
        return assertExists(this.components.get(pptr.path_id)) as unknown as T;
    }

    private loadOneComponent<CompT extends UnityComponent, WasmT>(obj: AssetObjectData, gameObject: GameObject, fromBytes: WasmFromBytes<WasmT>, constructor: ComponentConstructor<CompT, WasmT>): Promise<void> {
        const wasmObj = fromBytes.from_bytes(obj.data, obj.assetInfo);
        const comp = new constructor(this, gameObject, wasmObj);
        gameObject.components.push(comp);
        this.components.set(obj.location.pathID, comp);
        return comp.load(this);
    }

    public loadComponent(gameObject: GameObject, obj: AssetObjectData): Promise<void> | null {
        if (obj.classID === rust.UnityClassID.Transform) {
            return this.loadOneComponent(obj, gameObject, rust.Transform, Transform);
        } else if (obj.classID === rust.UnityClassID.RectTransform) {
            // HACK(jstpierre)
            return this.loadOneComponent(obj, gameObject, rust.Transform, Transform);
        } else if (obj.classID === rust.UnityClassID.MeshFilter) {
            return this.loadOneComponent(obj, gameObject, rust.MeshFilter, MeshFilter);
        } else if (obj.classID === rust.UnityClassID.MeshRenderer) {
            return this.loadOneComponent(obj, gameObject, rust.MeshRenderer, MeshRenderer);
        } else {
            return null;
        }
    }

    public async loadLevel(assetFile: AssetFile) {
        const assetSystem = this.runtime.assetSystem;

        // Instantiate all the GameObjects.
        const loadGameObject = async (unityObject: UnityObject) => {
            const pathID = unityObject.path_id;
            const objData = await assetFile.fetchObject(pathID);
            const wasmGameObject = rust.GameObject.from_bytes(objData.data, assetFile.assetInfo);
            const gameObject = new GameObject(objData.location, wasmGameObject);
            gameObject.isActive = wasmGameObject.is_active;
            gameObject.layer = wasmGameObject.layer;
            this.gameObjects.push(gameObject);
            await gameObject.load(this);
        };

        const promises = [];
        for (let i = 0; i < assetFile.unityObject.length; i++) {
            const unityObject = assetFile.unityObject[i];
            if (unityObject.class_id !== rust.UnityClassID.GameObject)
                continue;

            promises.push(loadGameObject(unityObject));
        }

        await assetSystem.waitForLoad();
        await Promise.all(promises);

        // Spawn all the components.
        for (const component of this.components.values())
            component.spawn(this);

        await assetSystem.waitForLoad();

        this.rootGameObjects = this.gameObjects.filter((obj) => {
            const transform = assertExists(obj.getComponent(Transform));
            return transform.parent === null;
        });

        for (let i = 0; i < this.rootGameObjects.length; i++)
            assertExists(this.rootGameObjects[i].getComponent(Transform)).updateModelMatrix();
    }

    public getComponents<T extends UnityComponent>(constructor: ComponentConstructor<T, any>): T[] {
        return this.gameObjects.flatMap((gameObject) => {
            return gameObject.components.filter((comp) => comp instanceof constructor) as T[];
        });
    }

    public destroy(device: GfxDevice): void {
        this.components.clear();
        for (let i = 0; i < this.gameObjects.length; i++)
            this.gameObjects[i].destroy(device);
    }
}

export class UnityRuntime {
    public levels: UnityLevel[] = [];
    public materialFactory: UnityMaterialFactory;

    constructor(public context: SceneContext, public assetSystem: UnityAssetSystem) {
    }

    public async loadLevel(filename: string) {
        const assetFile = this.assetSystem.fetchAssetFile(filename, false);
        await assetFile.waitForHeader();

        const level = new UnityLevel(this);
        await level.loadLevel(assetFile);

        this.levels.push(level);
    }

    public update(): void {
        this.assetSystem.update();
    }

    public getComponents<T extends UnityComponent>(constructor: ComponentConstructor<T, any>): T[] {
        return this.levels.flatMap((level) => {
            return level.getComponents(constructor);
        });
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.levels.length; i++)
            this.levels[i].destroy(device);
    }
}

export async function createUnityRuntime(context: SceneContext, basePath: string): Promise<UnityRuntime> {
    const assetSystem = await createUnityAssetSystem(context, basePath);
    return new UnityRuntime(context, assetSystem);
}
