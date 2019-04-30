
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import * as Viewer from '../viewer';
import Progressable from "../Progressable";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { fetchData } from "../fetch";
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from "../rres/render";
import { mat4 } from "gl-matrix";

import * as ARC from './arc';
import * as BRRES from '../rres/brres';
import { assert, readString, assertExists, hexzero } from "../util";
import { calcModelMtx } from "../oot3d/cmb";
import { BasicRendererHelper } from "../oot3d/render";
import { GXRenderHelperGfx } from "../gx/gx_render";
import AnimationController from "../AnimationController";
import { GXMaterialHacks } from "../gx/gx_material";

const pathBase = `okami`;

interface SCREntry {
    index: number;
    materialFlags: number;
    modelMatrix: mat4;
}

interface SCR {
    instances: SCREntry[];
}

function parseSCR(buffer: ArrayBufferSlice): SCR {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'scr\0');
    // TODO(jstpierre): Figure out what this flag means. From casual looking
    // it seems to affect whether the fields are stored as int64 or float.
    const storageMode = view.getUint32(0x04);

    const numInstances = view.getUint16(0x08);
    const instances: SCREntry[] = [];

    let instancesTableIdx = 0x10;
    for (let i = 0; i < numInstances; i++) {
        const instanceOffs = view.getUint32(instancesTableIdx + 0x00);

        const mdbRelOffs = view.getInt32(instanceOffs + 0x00);
        let index: number;
        let materialFlags: number;

        const modelMatrix = mat4.create();
        if (storageMode === 0x01) {
            index = view.getUint32(instanceOffs + 0x04);
            materialFlags = view.getUint16(instanceOffs + 0x08);

            const scaleX = view.getInt16(instanceOffs + 0x1E) / 0x1000;
            const scaleY = view.getInt16(instanceOffs + 0x20) / 0x1000;
            const scaleZ = view.getInt16(instanceOffs + 0x22) / 0x1000;
            const rotationX = view.getInt16(instanceOffs + 0x24) / 0x800 * Math.PI;
            const rotationY = view.getInt16(instanceOffs + 0x26) / 0x800 * Math.PI;
            const rotationZ = view.getInt16(instanceOffs + 0x28) / 0x800 * Math.PI;
            const translationX = view.getInt16(instanceOffs + 0x2A);
            const translationY = view.getInt16(instanceOffs + 0x2C);
            const translationZ = view.getInt16(instanceOffs + 0x2E);
            calcModelMtx(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        } else if (storageMode === 0x00) {
            index = i;
            materialFlags = 0x00;

            const scaleX = view.getFloat32(instanceOffs + 0x08);
            const scaleY = view.getFloat32(instanceOffs + 0x0C);
            const scaleZ = view.getFloat32(instanceOffs + 0x10);
            const rotationX = view.getFloat32(instanceOffs + 0x14);
            const rotationY = view.getFloat32(instanceOffs + 0x18);
            const rotationZ = view.getFloat32(instanceOffs + 0x1C);
            const translationX = view.getFloat32(instanceOffs + 0x20);
            const translationY = view.getFloat32(instanceOffs + 0x24);
            const translationZ = view.getFloat32(instanceOffs + 0x28);
            calcModelMtx(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        }

        instances.push({ index, materialFlags, modelMatrix });
        instancesTableIdx += 0x04;
    }

    return { instances };
}

export class OkamiRenderer extends BasicRendererHelper {
    public modelInstances: MDL0ModelInstance[] = [];
    public models: MDL0Model[] = [];

    public animationController = new AnimationController();
    public textureHolder = new RRESTextureHolder();
    public renderHelper: GXRenderHelperGfx;

    constructor(device: GfxDevice) {
        super();
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);

        this.textureHolder.destroy(device);
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `vec4((0.5 * ${p.matSource}).rgb, 1.0)`,
};

class OkamiSCPArchiveData {
    private scrModels: MDL0Model[][] = [];
    public scr: SCR[] = [];
    public scpArc: ARC.Archive;

    constructor(device: GfxDevice, renderer: OkamiRenderer, scpArcBuffer: ArrayBufferSlice, isObject: boolean = false) {
        this.scpArc = ARC.parse(scpArcBuffer);

        if (this.scpArc.files.length === 0)
            return;

        // Load the textures.
        const brtFile = this.scpArc.files.find((file) => file.type === 'BRT');
        const textureRRES = BRRES.parse(brtFile.buffer);
        renderer.textureHolder.addRRESTextures(device, textureRRES);

        // Now load the models. For each model, we have an SCR file that tells
        // us how many instances to place.
        const scrFiles = this.scpArc.files.filter((file) => file.type === (isObject ? 'MD' : 'SCR'));
        const brsFiles = this.scpArc.files.filter((file) => file.type === 'BRS');
        assert(scrFiles.length === brsFiles.length);

        for (let i = 0; i < scrFiles.length; i++) {
            const scrFile = scrFiles[i];
            const brsFile = brsFiles[i];
            assert(scrFile.filename === brsFile.filename);

            this.scr.push(parseSCR(scrFile.buffer));
            const brs = BRRES.parse(brsFile.buffer);

            const mdl0Models: MDL0Model[] = [];
            for (let j = 0; j < brs.mdl0.length; j++) {
                const mdl0 = brs.mdl0[j];
                // XXX(jstpierre): Dumb hacks.
                for (let k = 0; k < mdl0.materials.length; k++) {
                    assert(mdl0.materials[k].gxMaterial.tevStages.length === 1);
                    mdl0.materials[k].gxMaterial.tevStages[0].texMap = 0;
                }

                const mdl0Model = new MDL0Model(device, renderer.renderHelper, brs.mdl0[j], materialHacks);
                renderer.models.push(mdl0Model);
                mdl0Models.push(mdl0Model);
            }
            this.scrModels.push(mdl0Models);
        }
    }

    public createInstances(device: GfxDevice, renderer: OkamiRenderer, modelMatrix: mat4): void {
        for (let i = 0; i < this.scr.length; i++) {
            const scr = this.scr[i];
            const mdl0Models = this.scrModels[i];

            for (let j = 0; j < scr.instances.length; j++) {
                const instance = scr.instances[j];
                const mdl0Model = mdl0Models[instance.index];
                const modelInstance = new MDL0ModelInstance(device, renderer.renderHelper, renderer.textureHolder, mdl0Model);
                // TODO(jstpierre): Sort properly
                modelInstance.setSortKeyLayer(this.scr.length - i);
                mat4.mul(modelInstance.modelMatrix, modelMatrix, instance.modelMatrix);
                renderer.modelInstances.push(modelInstance);
            }
        }
    }
}

class ModelCache {
    private fileProgressableCache = new Map<string, Progressable<ArrayBufferSlice>>();
    private scpArchiveProgressableCache = new Map<string, Progressable<OkamiSCPArchiveData>>();
    private scpArchiveCache = new Map<string, OkamiSCPArchiveData>();

    public waitForLoad(): Progressable<any> {
        const v: Progressable<any>[] = [... this.fileProgressableCache.values()];
        return Progressable.all(v).then(() => {
            // XXX(jstpierre): Don't ask.
            return null;
        });
    }

    private fetchFile(path: string, abortSignal: AbortSignal): Progressable<ArrayBufferSlice> {
        assert(!this.fileProgressableCache.has(path));
        const p = fetchData(path, abortSignal);
        this.fileProgressableCache.set(path, p);
        return p;
    }

    public fetchSCPArchive(device: GfxDevice, renderer: OkamiRenderer, archivePath: string, abortSignal: AbortSignal, isObject: boolean): Progressable<OkamiSCPArchiveData> {
        let p = this.scpArchiveProgressableCache.get(archivePath);

        if (p === undefined) {
            p = this.fetchFile(archivePath, abortSignal).then((data) => {
                return data;
            }).then((data) => {
                const scpArchiveData = new OkamiSCPArchiveData(device, renderer, data, isObject);
                this.scpArchiveCache.set(archivePath, scpArchiveData);
                return scpArchiveData;
            });
            this.scpArchiveProgressableCache.set(archivePath, p);
        }

        return p;
    }
}

const objectTypePrefixes: (string | null)[] = [
    null,
    'pl',
    'em',
    'et',
    'hm',
    'an',
    'wp',
    null,
    'ut',
    'gt',
    'it',
    'vt',
    'dr',
    'md',
    'es',
    null,
];

function getObjectFilename(objectTypeId: number, objectId: number): string | null {
    const prefix = objectTypePrefixes[objectTypeId];
    if (prefix === null)
        return null;
    return `${prefix}${hexzero(objectId, 2).toLowerCase()}.dat`;
}

class OkamiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private spawnObjectTable(device: GfxDevice, renderer: OkamiRenderer, modelCache: ModelCache, objTableFile: ArrayBufferSlice, abortSignal: AbortSignal): void {
        const view = objTableFile.createDataView();

        const tableCount = view.getUint16(0x00);
        let tableIdx = 0x04;
        for (let i = 0; i < tableCount; i++) {
            const objectTypeId = view.getUint8(tableIdx + 0x00);
            const objectId = view.getUint8(tableIdx + 0x01);

            const scaleX = view.getUint8(tableIdx + 0x04) / 0x10;
            const scaleY = view.getUint8(tableIdx + 0x05) / 0x10;
            const scaleZ = view.getUint8(tableIdx + 0x06) / 0x10;
            const rotationX = view.getInt8(tableIdx + 0x07) / 90 * Math.PI;
            const rotationY = view.getInt8(tableIdx + 0x08) / 90 * Math.PI;
            const rotationZ = view.getInt8(tableIdx + 0x09) / 90 * Math.PI;
            const translationX = view.getInt16(tableIdx + 0x0A);
            const translationY = view.getInt16(tableIdx + 0x0C);
            const translationZ = view.getInt16(tableIdx + 0x0E);
            // TODO(jstpierre): The rest of the spawn table.

            tableIdx += 0x20;

            const modelMatrix = mat4.create();
            calcModelMtx(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

            const filename = getObjectFilename(objectTypeId, objectId);
            if (filename === null)
                continue;

            modelCache.fetchSCPArchive(device, renderer, `${pathBase}/${filename}`, abortSignal, true).then((scpArcData) => {
                scpArcData.createInstances(device, renderer, modelMatrix);
            });
        }
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(`${pathBase}/${this.id}.dat`, abortSignal).then((datArcBuffer: ArrayBufferSlice) => {
            const renderer = new OkamiRenderer(device);

            const datArc = ARC.parse(datArcBuffer);

            // Look for the SCP file.
            const scpFile = datArc.files.find((file) => file.type === 'SCP');
            const scpData = new OkamiSCPArchiveData(device, renderer, scpFile.buffer);
    
            // Create the main instances.
            const rootModelMatrix = mat4.create();
            scpData.createInstances(device, renderer, rootModelMatrix);

            const modelCache = new ModelCache();

            // Spawn the object tables.
            const tscTableFile = datArc.files.find((file) => file.type === 'TSC');
            this.spawnObjectTable(device, renderer, modelCache, tscTableFile.buffer, abortSignal);

            // TODO(jstpierre): Don't spawn trees until we figure out how the depth buffer write thing works.
            // const treTableFile = datArc.files.find((file) => file.type === 'TRE');
            // this.spawnObjectTable(device, renderer, modelCache, treTableFile.buffer, abortSignal);

            return modelCache.waitForLoad().then(() => {
                renderer.renderHelper.finishBuilder(device, renderer.viewRenderer);
                return renderer;
            });
        });
    }
}

const id = 'okami';
const name = 'Okami';
const sceneDescs = [
    new OkamiSceneDesc('r100', 'r100'),
    new OkamiSceneDesc('r101', 'r101'),
    new OkamiSceneDesc('r102', 'r102'),
    new OkamiSceneDesc('r103', 'r103'),
    new OkamiSceneDesc('r104', 'r104'),
    new OkamiSceneDesc('r105', 'r105'),
    new OkamiSceneDesc('r106', 'r106'),
    new OkamiSceneDesc('r107', 'r107'),
    new OkamiSceneDesc('r108', 'r108'),
    new OkamiSceneDesc('r109', 'r109'),
    new OkamiSceneDesc('r10a', 'r10a'),
    new OkamiSceneDesc('r10b', 'r10b'),
    new OkamiSceneDesc('r10c', 'r10c'),
    new OkamiSceneDesc('r10d', 'r10d'),
    new OkamiSceneDesc('r10e', 'r10e'),
    new OkamiSceneDesc('r110', 'r110'),
    new OkamiSceneDesc('r111', 'r111'),
    new OkamiSceneDesc('r112', 'r112'),
    new OkamiSceneDesc('r113', 'r113'),
    new OkamiSceneDesc('r114', 'r114'),
    new OkamiSceneDesc('r115', 'r115'),
    new OkamiSceneDesc('r116', 'r116'),
    new OkamiSceneDesc('r117', 'r117'),
    new OkamiSceneDesc('r118', 'r118'),
    new OkamiSceneDesc('r119', 'r119'),
    new OkamiSceneDesc('r11a', 'r11a'),
    new OkamiSceneDesc('r11b', 'r11b'),
    new OkamiSceneDesc('r11c', 'r11c'),
    new OkamiSceneDesc('r11d', 'r11d'),
    new OkamiSceneDesc('r120', 'r120'),
    new OkamiSceneDesc('r122', 'r122'),
    new OkamiSceneDesc('r200', 'r200'),
    new OkamiSceneDesc('r201', 'r201'),
    new OkamiSceneDesc('r202', 'r202'),
    new OkamiSceneDesc('r203', 'r203'),
    new OkamiSceneDesc('r204', 'r204'),
    new OkamiSceneDesc('r205', 'r205'),
    new OkamiSceneDesc('r206', 'r206'),
    new OkamiSceneDesc('r207', 'r207'),
    new OkamiSceneDesc('r208', 'r208'),
    new OkamiSceneDesc('r209', 'r209'),
    new OkamiSceneDesc('r20a', 'r20a'),
    new OkamiSceneDesc('r20b', 'r20b'),
    new OkamiSceneDesc('r20c', 'r20c'),
    new OkamiSceneDesc('r20d', 'r20d'),
    new OkamiSceneDesc('r20e', 'r20e'),
    new OkamiSceneDesc('r20f', 'r20f'),
    new OkamiSceneDesc('r301', 'r301'),
    new OkamiSceneDesc('r302', 'r302'),
    new OkamiSceneDesc('r303', 'r303'),
    new OkamiSceneDesc('r304', 'r304'),
    new OkamiSceneDesc('r305', 'r305'),
    new OkamiSceneDesc('r306', 'r306'),
    new OkamiSceneDesc('r307', 'r307'),
    new OkamiSceneDesc('r308', 'r308'),
    new OkamiSceneDesc('r309', 'r309'),
    new OkamiSceneDesc('r30a', 'r30a'),
    new OkamiSceneDesc('r30b', 'r30b'),
    new OkamiSceneDesc('r30c', 'r30c'),
    new OkamiSceneDesc('r30d', 'r30d'),
    new OkamiSceneDesc('r310', 'r310'),
    new OkamiSceneDesc('r311', 'r311'),
    new OkamiSceneDesc('r312', 'r312'),
    new OkamiSceneDesc('r313', 'r313'),
    new OkamiSceneDesc('r314', 'r314'),
    new OkamiSceneDesc('rc00', 'rc00'),
    new OkamiSceneDesc('rc02', 'rc02'),
    new OkamiSceneDesc('re00', 're00'),
    new OkamiSceneDesc('re01', 're01'),
    new OkamiSceneDesc('re02', 're02'),
    new OkamiSceneDesc('re03', 're03'),
    new OkamiSceneDesc('re04', 're04'),
    new OkamiSceneDesc('rf01', 'rf01'),
    new OkamiSceneDesc('rf02', 'rf02'),
    new OkamiSceneDesc('rf03', 'rf03'),
    new OkamiSceneDesc('rf04', 'rf04'),
    new OkamiSceneDesc('rf06', 'rf06'),
    new OkamiSceneDesc('rf07', 'rf07'),
    new OkamiSceneDesc('rf08', 'rf08'),
    new OkamiSceneDesc('rf09', 'rf09'),
    new OkamiSceneDesc('rf0a', 'rf0a'),
    new OkamiSceneDesc('rf0c', 'rf0c'),
    new OkamiSceneDesc('rf10', 'rf10'),
    new OkamiSceneDesc('rf11', 'rf11'),
    new OkamiSceneDesc('rf12', 'rf12'),
    new OkamiSceneDesc('rf13', 'rf13'),
    new OkamiSceneDesc('rf20', 'rf20'),
    new OkamiSceneDesc('rf21', 'rf21'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
