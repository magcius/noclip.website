
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import * as Viewer from '../viewer';
import Progressable from "../Progressable";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { fetchData, downloadBufferSlice } from "../fetch";
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from "../rres/render";
import { mat4 } from "gl-matrix";

import * as ARC from './arc';
import * as BRRES from '../rres/brres';
import { assert, readString, hexdump } from "../util";
import { calcModelMtx } from "../oot3d/cmb";
import { BasicRendererHelper } from "../oot3d/render";
import { GXRenderHelperGfx } from "../gx/gx_render";
import AnimationController from "../AnimationController";
import { GfxRendererLayer } from "../gfx/render/GfxRenderer";

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
    assert(view.getUint32(0x04) === 0x01);

    const numInstances = view.getUint16(0x08);
    const instances: SCREntry[] = [];

    let instancesTableIdx = 0x10;
    for (let i = 0; i < numInstances; i++) {
        const instanceOffs = view.getUint32(instancesTableIdx + 0x00);

        const mdbRelOffs = view.getInt32(instanceOffs + 0x00);
        const index = view.getUint32(instanceOffs + 0x04);
        const materialFlags = view.getUint16(instanceOffs + 0x08);

        const modelMatrix = mat4.create();
        const scaleX = 1; // view.getInt16(instanceOffs + 0x1E);
        const scaleY = 1; // view.getInt16(instanceOffs + 0x20);
        const scaleZ = 1; // view.getInt16(instanceOffs + 0x22);
        const rotationX = view.getInt16(instanceOffs + 0x24) / 0x80 * Math.PI;
        const rotationY = view.getInt16(instanceOffs + 0x26) / 0x80 * Math.PI;
        const rotationZ = view.getInt16(instanceOffs + 0x28) / 0x80 * Math.PI;
        const translationX = view.getInt16(instanceOffs + 0x2A);
        const translationY = view.getInt16(instanceOffs + 0x2C);
        const translationZ = view.getInt16(instanceOffs + 0x2E);
        calcModelMtx(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

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

        this.renderHelper.destroy(device);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

class OkamiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(device: GfxDevice): Progressable<Viewer.SceneGfx> {
        return fetchData(`${pathBase}/${this.id}.dat`).then((buffer: ArrayBufferSlice) => {
            const datArc = ARC.parse(buffer);

            const renderer = new OkamiRenderer(device);

            // Look for the SCP file -- contains the stage models.
            const scpFile = datArc.files.find((file) => file.type === 'SCP');
            const scpArc = ARC.parse(scpFile.buffer);

            // Load the textures.
            const brtFile = scpArc.files.find((file) => file.type === 'BRT');
            const textureRRES = BRRES.parse(brtFile.buffer);
            renderer.textureHolder.addRRESTextures(device, textureRRES);

            // Now load the models. For each model, we have an SCR file that tells
            // us how many instances to place.
            const scrFiles = scpArc.files.filter((file) => file.type === 'SCR');
            const brsFiles = scpArc.files.filter((file) => file.type === 'BRS');
            assert(scrFiles.length === brsFiles.length);

            for (let i = 0; i < scrFiles.length; i++) {
                const scrFile = scrFiles[i];
                const brsFile = brsFiles[i];
                assert(scrFile.filename === brsFile.filename);

                const scr = parseSCR(scrFile.buffer);
                const brs = BRRES.parse(brsFile.buffer);
                assert(brs.mdl0.length === scr.instances.length);

                for (let j = 0; j < scr.instances.length; j++) {
                    const instance = scr.instances[j];

                    const mdl0Model = new MDL0Model(device, renderer.renderHelper, brs.mdl0[j]);
                    renderer.models.push(mdl0Model);

                    const modelInstance = new MDL0ModelInstance(device, renderer.renderHelper, renderer.textureHolder, mdl0Model);
                    modelInstance.setSortKeyLayer(scrFiles.length - i);
                    mat4.copy(modelInstance.modelMatrix, instance.modelMatrix);
                    renderer.modelInstances.push(modelInstance);
                }
            }

            renderer.renderHelper.finishBuilder(device, renderer.viewRenderer);

            return renderer;
        });
    }
}

const id = 'okami';
const name = 'Okami';
const sceneDescs = [
    new OkamiSceneDesc('r100', 'r100'),
    new OkamiSceneDesc('r101', 'r101'),
    new OkamiSceneDesc('r102', 'r102'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
