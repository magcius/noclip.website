import { mat4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { CameraController } from "../Camera.js";
import { computeModelMatrixSRT } from "../MathHelpers.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { Checkbox, COOL_BLUE_COLOR, Panel, RENDER_HACKS_ICON } from "../ui.js";
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform.js";
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { BLEND_PASSES, readMaterials as readLevelMaterials, readMeshes } from "./EGP2.js";
import { readPlacements } from "./OLV.js";
import { applyGlowAlpha, buildModel, makeTexture, Model, ModelBuilderPart, ModelInstance, SopranosRenderer } from "./Render.js";
import { readItems, readMaterials as readPropMaterials, readSections, wornItems } from "./SGP2.js";
import { AlphaMode, BlendMode, prepareTexture, readGeometryTextures, TextureInfo } from "./Texture.js";
import { SCENES } from "./SceneList.js";

const pathBase = `Sopranos`;

class SopranosSceneRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private renderer: SopranosRenderer;

    constructor(device: GfxDevice, textures: GfxTexture[], instances: ModelInstance[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.renderer = new SopranosRenderer(this.renderHelper.renderCache, textures, instances);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        this.renderer.prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender();

        builder.execute();
        this.renderInstListMain.reset();
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(0.15);
    }

    public createPanels(): Panel[] {
        const panel = new Panel();
        panel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        panel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
        const props = new Checkbox('Show props and cast', true);
        props.onchanged = () => {
            this.renderer.showProps = props.checked;
        };
        panel.contents.appendChild(props.elem);
        return [panel];
    }

    public destroy(device: GfxDevice): void {
        this.renderer.destroy(device);
        this.renderHelper.destroy();
    }
}

function baseName(name: string): string {
    return name.split('/').pop()!.toLowerCase();
}

class TextureCache {
    public textures: GfxTexture[] = [];
    public alphaModes: AlphaMode[] = [];
    public blendModes: BlendMode[] = [];
    private cache = new Map<string, number>();

    constructor(private device: GfxDevice) {
    }

    public add(key: string, data: ArrayBufferSlice, info: TextureInfo, isProp: boolean): number {
        const found = this.cache.get(key);
        if (found !== undefined) {
            return found;
        }
        const decoded = prepareTexture(data, info, isProp);
        if (decoded === null) {
            this.cache.set(key, -1);
            return -1;
        }
        const index = this.textures.length;
        this.textures.push(makeTexture(this.device, decoded));
        this.alphaModes.push(decoded.alphaMode);
        this.blendModes.push(decoded.blendMode);
        this.cache.set(key, index);
        return index;
    }
}

function buildLevel(device: GfxDevice, cache: TextureCache, data: ArrayBufferSlice): Model | null {
    const materials = readLevelMaterials(data);
    const byRecord = new Map<number, TextureInfo>();
    for (const info of readGeometryTextures(data)) {
        byRecord.set(info.recordOffset, info);
    }
    const materialTexture = materials.map((material, index) => {
        const info = material.textureOffset !== 0 ? byRecord.get(material.textureOffset) : undefined;
        return info !== undefined ? cache.add(`level:${index}:${info.recordOffset}`, data, info, false) : -1;
    });

    const meshes = readMeshes(data);

    const parts: ModelBuilderPart[] = [];
    for (const mesh of meshes) {
        const texture = mesh.material >= 0 && mesh.material < materialTexture.length ? materialTexture[mesh.material] : -1;
        const blendMode = texture >= 0 ? cache.blendModes[texture] : BlendMode.Default;
        const glow = texture >= 0 && cache.alphaModes[texture] === AlphaMode.Glow;
        if (glow) {
            applyGlowAlpha(mesh.colors);
        }
        const alphaMode = glow ? AlphaMode.Glow
            : BLEND_PASSES.has(mesh.pass) ? AlphaMode.Blend : AlphaMode.Opaque;
        parts.push({ texture, alphaMode, blendMode, positions: mesh.positions, texcoords: mesh.texcoords, colors: mesh.colors, indices: mesh.indices });
    }
    return buildModel(device, parts);
}

function buildProp(device: GfxDevice, cache: TextureCache, library: ArrayBufferSlice, libraryIndex: number, images: Map<string, TextureInfo>, offset: number, size: number): Model | null {
    const section = library.subarray(offset, size);
    const materials = readPropMaterials(section);
    const parts: ModelBuilderPart[] = [];
    for (const item of wornItems(readItems(section), materials)) {
        for (const group of item.groups) {
            const names = group.material < materials.length ? materials[group.material] : [];
            let texture = -1;
            for (const name of names) {
                const info = images.get(baseName(name));
                if (info === undefined) {
                    continue;
                }
                texture = cache.add(`prop:${libraryIndex}:${baseName(name)}`, library, info, true);
                if (texture >= 0) {
                    break;
                }
            }
            const alphaMode = texture >= 0 ? cache.alphaModes[texture] : AlphaMode.Opaque;
            parts.push({ texture, alphaMode, blendMode: BlendMode.Default, positions: group.positions, texcoords: group.texcoords, colors: null, indices: group.indices });
        }
    }
    return buildModel(device, parts);
}

class SopranosSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string, private geometry: string, private libraries: string[], private placements: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const [level, objects, ...libraries] = await Promise.all([
            context.dataFetcher.fetchData(`${pathBase}/${this.geometry}`),
            context.dataFetcher.fetchData(`${pathBase}/${this.placements}`),
            ...this.libraries.map((path) => context.dataFetcher.fetchData(`${pathBase}/${path}`)),
        ]);

        const cache = new TextureCache(device);
        const instances: ModelInstance[] = [];
        const shell = buildLevel(device, cache, level);
        if (shell !== null) {
            instances.push({ model: shell, modelMatrix: mat4.create(), isProp: false });
        }

        const sections = new Map<string, { library: number, offset: number, size: number }>();
        const images: Map<string, TextureInfo>[] = [];
        for (let i = 0; i < libraries.length; i++) {
            for (const section of readSections(libraries[i])) {
                const key = baseName(section.name);
                // Skip nude sections.
                if (key.includes('nude')) {
                    continue;
                }
                if (!sections.has(key)) {
                    sections.set(key, { library: i, offset: section.offset, size: section.size });
                }
            }
            const byName = new Map<string, TextureInfo>();
            for (const info of readGeometryTextures(libraries[i])) {
                const key = baseName(info.name);
                if (!byName.has(key)) {
                    byName.set(key, info);
                }
            }
            images.push(byName);
        }

        const models = new Map<string, Model | null>();
        for (const placement of readPlacements(objects)) {
            if (placement.x === 0 && placement.y === 0) {
                continue;
            }
            const key = placement.prototype.toLowerCase();
            if (!models.has(key)) {
                const found = sections.get(key);
                models.set(key, found === undefined ? null : buildProp(device, cache, libraries[found.library], found.library, images[found.library], found.offset, found.size));
            }
            const model = models.get(key)!;
            if (model === null) {
                continue;
            }
            const modelMatrix = mat4.create();
            computeModelMatrixSRT(modelMatrix, 1, 1, 1, 0, placement.rotation, 0, placement.x, placement.z, -placement.y);
            instances.push({ model, modelMatrix, isProp: true });
        }

        return new SopranosSceneRenderer(device, cache.textures, instances);
    }
}

const id = 'Sopranos';
const name = 'The Sopranos: Road to Respect';
const sceneDescs = SCENES.map((scene) => typeof scene === 'string' ? scene : new SopranosSceneDesc(scene.id, scene.name, scene.geometry, scene.libraries, scene.placements));

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
