
import type { UnityObject } from "../../../rust/pkg/index";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { SceneContext } from "../../SceneBase";
import { AssetObjectData, UnityAssetSystem, RustModule, AssetLocation, UnityMeshData, UnityChannel } from "./AssetManager";
import type * as wasm from '../../../rust/pkg/index';
import { mat4, quat, vec3 } from "gl-matrix";
import { assert, assertExists, fallbackUndefined } from "../../util";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../../viewer";
import { DeviceProgram } from "../../Program";
import { fillMatrix4x3 } from "../../gfx/helpers/UniformBufferHelpers";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary";

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
    public spawn(runtime: UnityRuntime): void {
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

export class Transform extends UnityComponent {
    public localPosition = vec3.create();
    public localRotation = quat.create();
    public localScale = vec3.create();
    public parent: Transform | null = null;
    public children: Transform[] = [];

    public modelMatrix = mat4.create();

    constructor(runtime: UnityRuntime, public gameObject: GameObject, private wasmObj: wasm.Transform) {
        super();
        vec3FromVec3f(this.localPosition, wasmObj.local_position);
        quatFromQuaternion(this.localRotation, wasmObj.local_rotation);
        vec3FromVec3f(this.localScale, wasmObj.local_scale);
    }

    public override spawn(runtime: UnityRuntime): void {
        super.spawn(runtime);
        this.parent = runtime.findComponentByPPtr(this.wasmObj.parent);
        this.children = loadWasmBindgenArray(this.wasmObj.get_children()).map((pptr) => {
            return assertExists(runtime.findComponentByPPtr<Transform>(pptr));
        });
        this.wasmObj.free();
        this.wasmObj = null!;
    }

    public updateModelMatrix(): void {
        mat4.fromRotationTranslationScale(this.modelMatrix, this.localRotation, this.localPosition, this.localScale);

        if (this.parent !== null)
            mat4.mul(this.modelMatrix, this.parent.modelMatrix, this.modelMatrix);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].updateModelMatrix();
    }
}

export class MeshFilter extends UnityComponent {
    public meshData: UnityMeshData | null = null;

    constructor(runtime: UnityRuntime, public gameObject: GameObject, wasmObj: wasm.MeshFilter) {
        super();
        this.loadMeshData(runtime, wasmObj);
    }

    private async loadMeshData(runtime: UnityRuntime, wasmObj: wasm.MeshFilter) {
        this.meshData = await this.gameObject.location.file.fetchMeshData(runtime.assetSystem, wasmObj.mesh_ptr);
        wasmObj.free();
    }

    public override destroy(device: GfxDevice): void {
        if (this.meshData !== null)
            this.meshData.destroy(device);
    }
}

class ChunkProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

    public override both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ModelView;
};

layout(std140) uniform ub_ShapeParams {
    Mat4x3 u_ChunkModel;
};

varying vec2 v_LightIntensity;

#ifdef VERT
layout(location = ${UnityChannel.Vertex}) attribute vec3 a_Position;
layout(location = ${UnityChannel.Normal}) attribute vec3 a_Normal;

${GfxShaderLibrary.MulNormalMatrix}

void mainVS() {
    gl_Position = Mul(u_Projection, Mul(u_ModelView, Mul(_Mat4x4(u_ChunkModel), vec4(a_Position, 1.0))));
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    vec3 normal = MulNormalMatrix(u_ChunkModel, normalize(a_Normal));
    float t_LightIntensityF = dot(-normal, t_LightDirection);
    float t_LightIntensityB = dot( normal, t_LightDirection);
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 color = vec4(.4, .4, .4, 1.0);
    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.5 * t_LightIntensity;
    gl_FragColor = sqrt(color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0));
}
#endif
`;
}

export class MeshRenderer extends UnityComponent {
    private staticBatchSubmeshStart = 0;
    private staticBatchSubmeshCount = 0;
    private visible = true;
    private modelMatrix = mat4.create();
    private program = new ChunkProgram();
    // private materials: Material[] = [];

    constructor(runtime: UnityRuntime, public gameObject: GameObject, wasmObj: wasm.MeshRenderer) {
        super();
        this.visible = wasmObj.enabled;
        this.staticBatchSubmeshStart = wasmObj.static_batch_info.first_submesh;
        this.staticBatchSubmeshCount = wasmObj.static_batch_info.submesh_count;
        wasmObj.free();
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.visible || !this.gameObject.visible)
            return;

        const meshFilter = this.gameObject.getComponent(MeshFilter);
        if (meshFilter === null)
            return;

        const meshData = meshFilter.meshData;
        if (meshData === null)
            return;

        // TODO(jstpierre): AABB culling

        if (this.staticBatchSubmeshCount > 0) {
            mat4.identity(this.modelMatrix);
        } else {
            // TODO(jstpierre): Skinned meshes
            const transform = assertExists(this.gameObject.getComponent(Transform));
            mat4.copy(this.modelMatrix, transform.modelMatrix);
        }

        const template = renderInstManager.pushTemplateRenderInst();

        let offs = template.allocateUniformBuffer(ChunkProgram.ub_ShapeParams, 12);
        const mapped = template.mapUniformBufferF32(ChunkProgram.ub_ShapeParams);

        offs += fillMatrix4x3(mapped, offs, this.modelMatrix);

        template.setInputLayoutAndState(meshData.inputLayout, meshData.inputState);

        const chunkProgram = renderInstManager.gfxRenderCache.createProgram(this.program);
        template.setGfxProgram(chunkProgram);

        const submeshCount = this.staticBatchSubmeshCount !== 0 ? this.staticBatchSubmeshCount : meshData.submeshes.length;
        for (let i = 0; i < submeshCount; i++) {
            const renderInst = renderInstManager.newRenderInst();
            const submesh = meshData.submeshes[this.staticBatchSubmeshStart + i];
            const firstIndex = submesh.first_byte / meshData.indexBufferStride;
            renderInst.drawIndexes(submesh.index_count, firstIndex);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

export class GameObject {
    public layer = 0;
    public isActive = true;
    public visible = true;
    public components: UnityComponent[] = [];

    constructor(public location: AssetLocation, public name: string) {
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
    }
}

let _wasm: RustModule | null = null;
async function loadWasm(): Promise<RustModule> {
    if (_wasm === null) {
        _wasm = await import('../../../rust/pkg/index');
    }
    return _wasm;
}

interface WasmFromBytes<T> {
    from_bytes(data: Uint8Array, assetInfo: wasm.AssetInfo): any;
}

interface ComponentConstructor<CompT, WasmT> {
    new(runtime: UnityRuntime, gameObject: GameObject, wasm: WasmT): CompT;
}

export class UnityRuntime {
    public gameObjects: GameObject[] = [];
    public components = new Map<number, UnityComponent>();
    public rootGameObjects: GameObject[] = [];
    public assetSystem: UnityAssetSystem;

    constructor(private wasm: RustModule, public context: SceneContext, basePath: string) {
        this.assetSystem = new UnityAssetSystem(this.wasm, context.device, context.dataFetcher, basePath);
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

    private loadOneComponent<CompT extends UnityComponent, WasmT>(obj: AssetObjectData, gameObject: GameObject, fromBytes: WasmFromBytes<WasmT>, constructor: ComponentConstructor<CompT, WasmT>): CompT {
        const wasmObj = fromBytes.from_bytes(obj.data, obj.assetInfo);
        const comp = new constructor(this, gameObject, wasmObj);
        gameObject.components.push(comp);
        this.components.set(obj.location.pathID, comp);
        return comp;
    }

    private loadComponent(gameObject: GameObject, obj: AssetObjectData) {
        if (obj.classID === this.wasm.UnityClassID.Transform) {
            this.loadOneComponent(obj, gameObject, this.wasm.Transform, Transform);
        } else if (obj.classID === this.wasm.UnityClassID.RectTransform) {
            // HACK(jstpierre)
            this.loadOneComponent(obj, gameObject, this.wasm.Transform, Transform);
        } else if (obj.classID === this.wasm.UnityClassID.MeshFilter) {
            this.loadOneComponent(obj, gameObject, this.wasm.MeshFilter, MeshFilter);
        } else if (obj.classID === this.wasm.UnityClassID.MeshRenderer) {
            this.loadOneComponent(obj, gameObject, this.wasm.MeshRenderer, MeshRenderer);
        }
    }

    public async loadLevel(filename: string) {
        const assetFile = await this.assetSystem.fetchAssetFile(filename);

        // Instantiate all the GameObjects.
        const loadGameObject = async (unityObject: UnityObject) => {
            const pathID = unityObject.path_id;
            const objData = await assetFile.fetchObject(pathID);
            const wasmGameObject = this.wasm.GameObject.from_bytes(objData.data, assetFile.assetInfo);
            const gameObject = new GameObject(objData.location, wasmGameObject.name);
            gameObject.isActive = wasmGameObject.is_active;
            gameObject.layer = wasmGameObject.layer;
            this.gameObjects.push(gameObject);

            const components = loadWasmBindgenArray(wasmGameObject.get_components());
            await Promise.all(components.map(async (pptr) => {
                const promise = assetFile.fetchPPtr(this.assetSystem, pptr);
                pptr.free();
                const data = await promise;
                this.loadComponent(gameObject, data);
            }));
            wasmGameObject.free();
        };

        for (let i = 0; i < assetFile.unityObject.length; i++) {
            const unityObject = assetFile.unityObject[i];
            if (unityObject.class_id !== this.wasm.UnityClassID.GameObject)
                continue;

            loadGameObject(unityObject);
        }

        await this.assetSystem.waitForLoad();

        // Spawn all the components.
        for (const component of this.components.values())
            component.spawn(this);

        await this.assetSystem.waitForLoad();

        this.rootGameObjects = this.gameObjects.filter((obj) => {
            const transform = assertExists(obj.getComponent(Transform));
            return transform.parent === null;
        });

        for (let i = 0; i < this.rootGameObjects.length; i++)
            assertExists(this.rootGameObjects[i].getComponent(Transform)).updateModelMatrix();
    }

    public getComponents<T extends UnityComponent>(constructor: ComponentConstructor<T, any>): T[] {
        return this.gameObjects.map((gameObject) => {
            return gameObject.components.filter((comp) => comp instanceof constructor) as T[];
        }).flat();
    }

    public update(): void {
        this.assetSystem.update();
    }

    public destroy(device: GfxDevice): void {
        this.components.clear();
        for (let i = 0; i < this.gameObjects.length; i++)
            this.gameObjects[i].destroy(device);
        this.assetSystem.destroy(device);
    }
}

export async function createUnityRuntime(context: SceneContext, basePath: string): Promise<UnityRuntime> {
    const wasm = await loadWasm();
    const runtime = await context.dataShare.ensureObject(`UnityRuntime/${basePath}`, async () => {
        return new UnityRuntime(wasm, context, basePath);
    });
    return runtime;
}
