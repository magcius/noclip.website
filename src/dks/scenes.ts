
import * as Viewer from "../viewer";

import * as BYML from "../byml";
import * as MSB from "./msb";
import * as DCX from "./dcx";
import * as TPF from "./tpf";
import * as BHD from "./bhd";
import * as FLVER from "./flver";

import { GfxDevice, GfxHostAccessPass, GfxFormat, GfxTextureDimension } from "../gfx/platform/GfxPlatform";
import Progressable from "../Progressable";
import { fetchData } from "../fetch";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DDSTextureHolder } from "./dds";
import { assert } from "../util";
import { BasicRendererHelper } from "../oot3d/render";
import { FLVERData, SceneRenderer, FLVERInstance } from "./render";
import { mat4 } from "gl-matrix";

const pathBase = `data/dks/`;

interface CRG1Arc {
    Files: { [filename: string]: ArrayBufferSlice };
}

class ResourceSystem {
    public files = new Map<string, ArrayBufferSlice>();

    public mountCRG1(n: CRG1Arc): void {
        const filenames = Object.keys(n.Files);
        for (let i = 0; i < filenames.length; i++)
            this.files.set(filenames[i], n.Files[filenames[i]]);
    }

    public lookupFile(filename: string) {
        return this.files.get(filename);
    }
}

class DKSRenderer extends BasicRendererHelper implements Viewer.SceneGfx {
    private sceneRenderers: SceneRenderer[] = [];

    constructor(device: GfxDevice, public textureHolder: DDSTextureHolder, private modelHolder: ModelHolder) {
        super();
    }

    public addSceneRenderer(device: GfxDevice, sceneRenderer: SceneRenderer): void {
        this.sceneRenderers.push(sceneRenderer);
        sceneRenderer.addToViewRenderer(device, this.viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].destroy(device);
        this.textureHolder.destroy(device);
        this.modelHolder.destroy(device);
    }
}

class ModelHolder {
    public flverData: FLVERData[] = [];

    constructor(device: GfxDevice, flver: (FLVER.FLVER | undefined)[]) {
        for (let i = 0; i < flver.length; i++) {
            if (flver[i] !== undefined)
                this.flverData[i] = new FLVERData(device, flver[i]);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.flverData.length; i++)
            this.flverData[i].destroy(device);
    }
}

export class DKSSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public fetchCRG1Arc(resourceSystem: ResourceSystem, archiveName: string, abortSignal: AbortSignal): Progressable<void> {
        return fetchData(`${pathBase}/${archiveName}`, abortSignal).then((buffer) => {
            const crg1Arc = BYML.parse<CRG1Arc>(buffer, BYML.FileType.CRG1)
            resourceSystem.mountCRG1(crg1Arc);
        });
    }

    private loadTextureTPFDCX(device: GfxDevice, textureHolder: DDSTextureHolder, resourceSystem: ResourceSystem, baseName: string): void {
        const buffer = resourceSystem.lookupFile(`${baseName}.tpf.dcx`);
        const decompressed = new ArrayBufferSlice(DCX.decompressBuffer(buffer));
        const tpf = TPF.parse(decompressed);
        textureHolder.addTextures(device, tpf.textures);
    }

    private loadTextureBHD(device: GfxDevice, textureHolder: DDSTextureHolder, resourceSystem: ResourceSystem, baseName: string): void {
        const bhdBuffer = resourceSystem.lookupFile(`${baseName}.tpfbhd`);
        const bdtBuffer = resourceSystem.lookupFile(`${baseName}.tpfbdt`);
        const bhd = BHD.parse(bhdBuffer, bdtBuffer);
        for (let i = 0; i < bhd.fileRecords.length; i++) {
            const r = bhd.fileRecords[i];
            assert(r.name.endsWith('.tpf.dcx'));
            const decompressed = new ArrayBufferSlice(DCX.decompressBuffer(r.buffer));
            const tpf = TPF.parse(decompressed);
            assert(tpf.textures.length === 1);
            const key1 = r.name.replace(/\\/g, '').replace('.tpf.dcx', '').toLowerCase();
            const key2 = tpf.textures[0].name.toLowerCase();
            assert(key1 === key2);
            // WTF do we do if we have more than one texture?
            textureHolder.addTextures(device, tpf.textures);
        }
    }

    private modelMatrixFromPart(m: mat4, part: MSB.Part): void {
        mat4.translate(m, m, part.translation);
        mat4.rotateX(m, m, part.rotation[0] * Math.PI / 180);
        mat4.rotateY(m, m, part.rotation[1] * Math.PI / 180);
        mat4.rotateZ(m, m, part.rotation[2] * Math.PI / 180);
        mat4.scale(m, m, part.scale);
        const modelScale = 100;
        mat4.scale(m, m, [modelScale, modelScale, modelScale]);
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        const resourceSystem = new ResourceSystem();

        const arcName = `${this.id}_arc.crg1`;
        return this.fetchCRG1Arc(resourceSystem, arcName, abortSignal).then(() => {
            const textureHolder = new DDSTextureHolder();

            const whiteDummy = device.createTexture({
                dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA_SRGB,
                width: 1, height: 1, depth: 1, numLevels: 1,
            });
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(whiteDummy, 0, [new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF])]);
            device.submitPass(hostAccessPass);
            textureHolder.setTextureOverride('WhiteDummy', { gfxTexture: whiteDummy, width: 1, height: 1, flipY: false }, false);

            const msbPath = `/map/MapStudio/${this.id}.msb`;
            const msbBuffer = resourceSystem.lookupFile(msbPath);
            const msb = MSB.parse(msbBuffer, this.id);

            const flver: (FLVER.FLVER | undefined)[] = [];
            for (let i = 0; i < msb.models.length; i++) {
                if (msb.models[i].type === 0) {
                    const flverBuffer = resourceSystem.lookupFile(msb.models[i].flverPath);
                    flver[i] = FLVER.parse(new ArrayBufferSlice(DCX.decompressBuffer(flverBuffer)));
                }
            }

            const modelHolder = new ModelHolder(device, flver);

            const mapKey = this.id.slice(0, 3) // "m10"
            this.loadTextureBHD(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_0000`);
            this.loadTextureBHD(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_0001`);
            this.loadTextureBHD(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_0002`);
            this.loadTextureBHD(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_0003`);
            this.loadTextureTPFDCX(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_9999`);

            const sceneRenderer = new SceneRenderer(device);
            for (let i = 0; i < msb.parts.length; i++) {
                const part = msb.parts[i];
                if (part.type === 0) {
                    const flverData = modelHolder.flverData[part.modelIndex];

                    const instance = new FLVERInstance(device, sceneRenderer.renderInstBuilder, textureHolder, flverData);
                    this.modelMatrixFromPart(instance.modelMatrix, part);

                    sceneRenderer.flverInstances.push(instance);
                }
            }

            const renderer = new DKSRenderer(device, textureHolder, modelHolder);
            renderer.addSceneRenderer(device, sceneRenderer);
            return renderer;
        });
    }
}

const id = 'dks';
const name = "Dark Souls";

const sceneDescs = [
    new DKSSceneDesc('m10_01_00_00', "Undead Burg / Parish"),
    new DKSSceneDesc('m10_00_00_00', "The Depths"),
    new DKSSceneDesc('m10_02_00_00', "Firelink Shrine"),
    new DKSSceneDesc('m11_00_00_00', "Painted World"),
    new DKSSceneDesc('m12_00_00_00', "Darkroot Forest"),
    new DKSSceneDesc('m12_00_00_01', "Darkroot Basin"),
    new DKSSceneDesc('m12_01_00_00', "Royal Wood"),
    new DKSSceneDesc('m13_00_00_00', "The Catacombs"),
    new DKSSceneDesc('m13_01_00_00', "Tomb of the Giants"),
    new DKSSceneDesc('m13_02_00_00', "Ash Lake"),
    new DKSSceneDesc('m14_00_00_00', "Blighttown"),
    new DKSSceneDesc('m14_01_00_00', "Demon Ruins"),
    new DKSSceneDesc('m15_00_00_00', "Sen's Fortress"),
    new DKSSceneDesc('m15_01_00_00', "Anor Londo"),
    new DKSSceneDesc('m16_00_00_00', "New Londo Ruins"),
    new DKSSceneDesc('m17_00_00_00', "Duke's Archives / Crystal Caves"),
    new DKSSceneDesc('m18_00_00_00', "Kiln of the First Flame"),
    new DKSSceneDesc('m18_01_00_00', "Undead Asylum"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
