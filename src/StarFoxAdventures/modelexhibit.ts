import { mat4, vec3 } from 'gl-matrix';
import * as UI from '../ui.js';
import * as Viewer from "../viewer.js";
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { SceneContext } from '../SceneBase.js';
import { White } from '../Color.js';
import { getDebugOverlayCanvas2D, drawWorldSpaceLine, drawWorldSpacePoint } from '../DebugJunk.js';

import { GameInfo, SFA_GAME_INFO } from './scenes.js';
import { Anim, SFAAnimationController, AnimCollection, AmapCollection, ModanimCollection, applyAnimationToModel } from './animation.js';
import { SFARenderer, SceneRenderContext } from './render.js';
import { ModelFetcher, ModelInstance, ModelRenderContext } from './models.js';
import { MaterialFactory } from './materials.js';
import { dataSubarray, readUint16 } from './util.js';
import { TextureFetcher, SFATextureFetcher } from './textures.js';
import { ModelVersion } from './modelloader.js';
import { downloadBufferSlice } from '../DownloadUtils.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';

class ModelExhibitRenderer extends SFARenderer {
    private modelInst: ModelInstance | null | undefined = undefined; // undefined: Not set. null: Failed to load.
    private modelNum = 1;
    private modelSelect: UI.TextEntry;

    private modanim: DataView | null | undefined = undefined;
    private amap: DataView | null | undefined = undefined;
    private generatedAmap: DataView | null = null;
    private anim: Anim | null | undefined = undefined;
    private modelAnimNum = 0;
    private animSelect: UI.TextEntry;

    private displayBones: boolean = false;
    private useGlobalAnimNum: boolean = false;
    private autogenAmap: boolean = false;

    constructor(context: SceneContext, private subdir: string, animController: SFAAnimationController, materialFactory: MaterialFactory, private texFetcher: TextureFetcher, private modelFetcher: ModelFetcher, private animColl: AnimCollection, private amapColl: AmapCollection, private modanimColl: ModanimCollection) {
        super(context, animController, materialFactory);
    }

    public createPanels(): UI.Panel[] {
        const panel = new UI.Panel();

        panel.setTitle(UI.SAND_CLOCK_ICON, 'Model Exhibit');

        this.modelSelect = new UI.TextEntry();
        this.modelSelect.ontext = (s: string) => {
            const newNum = Number.parseInt(s);
            if (!Number.isNaN(newNum)) {
                this.modelNum = newNum;
                this.modelInst = undefined;
            }
        };
        //this.modelSelect.setLabel("Model #");
        //this.modelSelect.setRange(0, 200 /*this.modelColl.getNumModels()*/);
        panel.contents.append(this.modelSelect.elem);

        this.animSelect = new UI.TextEntry();
        this.animSelect.ontext = (s: string) => {
            const newNum = Number.parseInt(s);
            if (!Number.isNaN(newNum)) {
                this.modelAnimNum = newNum;
                this.anim = undefined;
                this.generatedAmap = null;
            }
        }
        // this.animSelect.setLabel("Animation #");
        // this.animSelect.setRange(0, 200 /*this.animLoader.getNumAnims()*/);
        panel.contents.append(this.animSelect.elem);

        const bonesSelect = new UI.Checkbox("Display bones", false);
        bonesSelect.onchanged = () => {
            this.displayBones = bonesSelect.checked;
        };
        panel.contents.append(bonesSelect.elem);

        const useGlobalAnimSelect = new UI.Checkbox("Use global animation number", false);
        useGlobalAnimSelect.onchanged = () => {
            this.useGlobalAnimNum = useGlobalAnimSelect.checked;
        };
        panel.contents.append(useGlobalAnimSelect.elem);

        const autogenAmapSelect = new UI.Checkbox("Autogenerate AMAP", false);
        autogenAmapSelect.onchanged = () => {
            this.autogenAmap = autogenAmapSelect.checked;
            this.generatedAmap = null;
        };
        panel.contents.append(autogenAmapSelect.elem);

        return [panel];
    }

    public downloadModel() {
        if (this.modelInst !== null && this.modelInst !== undefined) {
            downloadBufferSlice(`model_${this.subdir}_${this.modelNum}${this.modelInst.model.version === ModelVersion.Beta ? '_beta' : ''}.bin`, ArrayBufferSlice.fromView(this.modelInst.model.modelData));
        }
    }

    public setAmapNum(num: number | null) {
        if (num === null) {
            this.amap = null;
        } else {
            this.amap = this.amapColl.getAmap(num);
            console.log(`Amap ${num} has ${this.amap.byteLength} entries`);
        }
    }

    private getGlobalAnimNum(modelAnimNum: number): number {
        return readUint16(this.modanim!, 0, modelAnimNum);
    }

    private getAmapForModelAnim(modelAnimNum: number): DataView {
        const printAmap = (amap: DataView) => {
            let s = '';
            for (let i = 0; i < amap.byteLength; i++) {
                s += `${amap.getInt8(i)},`;
            }
            console.log(`Amap: ${s}`);
        };

        if (this.autogenAmap) {
            if (this.generatedAmap === null) {
                let generatedAmap = [0];

                // Perform a breadth-first search on the model joint hierarchy.
                // The output matches most AMAP tables, except Fox.
                let curCluster = [0];
                while (curCluster.length > 0) {
                    const prevCluster = curCluster; // This is safe because curCluster is set to a new array.
                    curCluster = [];

                    for (let i = 0; i < prevCluster.length; i++) {
                        for (let j = 0; j < this.modelInst!.model.joints.length; j++) {
                            const joint = this.modelInst!.model.joints[j];
                            if (joint.parent === prevCluster[i]) {
                                curCluster.push(j);
                            }
                        }
                    }

                    for (let i = 0; i < curCluster.length; i++) {
                        generatedAmap.push(curCluster[i]);
                    }
                }
                
                this.generatedAmap = new DataView(new Int8Array(generatedAmap).buffer);
                printAmap(this.generatedAmap);
            }

            return this.generatedAmap;
        } else {
            const stride = (((this.modelInst!.model.joints.length + 8) / 8)|0) * 8;
            // console.log(`getting amap for model ${this.modelNum} anim ${modelAnimNum} at file offset 0x${(this.amap!.byteOffset + modelAnimNum * stride).toString(16)}`)
            const amap = dataSubarray(this.amap!, modelAnimNum * stride, stride);

            if (this.generatedAmap === null) {
                this.generatedAmap = new DataView(new Int8Array(1).buffer);
                printAmap(amap);
            }

            return amap;
        }
    }
    
    protected override update(viewerInput: Viewer.ViewerRenderInput) {
        super.update(viewerInput);
        this.materialFactory.update(this.animController);
    }
    
    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {
        if (this.modelInst === undefined) {
            try {
                this.modelAnimNum = 0;
                this.modanim = this.modanimColl.getModanim(this.modelNum);
                this.amap = this.amapColl.getAmap(this.modelNum);
                this.modelInst = this.modelFetcher.createModelInstance(this.modelNum);
                console.log(`Loaded model ${this.modelNum}`);
                console.log(`Model ${this.modelNum} has ${this.modelInst.model.joints.length} joints`);
            } catch (e) {
                console.warn(`Failed to load model ${this.modelNum} due to exception:`);
                console.error(e);
                this.modelInst = null;
            }
        }
        
        const animate = true;
        if (animate && this.modelInst !== null && this.modelInst !== undefined) {
            if (this.anim === undefined) {
                try {
                    let globalAnimNum;
                    if (this.useGlobalAnimNum) {
                        globalAnimNum = this.modelAnimNum;
                    } else {
                        globalAnimNum = this.getGlobalAnimNum(this.modelAnimNum);
                    }
                    this.anim = this.animColl.getAnim(globalAnimNum);
                    console.log(`Loaded anim ${this.modelAnimNum} (global #${globalAnimNum})`);
                    console.log(`Anim ${this.modelAnimNum} has ${this.anim.keyframes[0].poses.length} poses`);
                } catch (e) {
                    console.warn(`Failed to load animation ${this.modelAnimNum} due to exception:`);
                    console.error(e);
                    this.anim = null;
                }
            }

            if (this.anim !== null && this.anim !== undefined) {
                try {
                    applyAnimationToModel(this.animController.animController.getTimeInSeconds() * 8, this.modelInst, this.anim, this.modelAnimNum);
                } catch (e) {
                    console.warn(`Failed to animate model due to exception:`);
                    console.error(e);
                    this.anim = null;
                    this.modelInst.resetPose();
                }
            }
        }

        // TODO: Render background (configurable?)

        // Render opaques

        // this.beginPass(sceneCtx.viewerInput);

        if (this.modelInst !== null) {
            const mtx = mat4.create();
            this.renderModel(device, renderInstManager, sceneCtx, mtx, this.modelInst);
        }

        // this.endPass(device);
        // TODO: render furs and translucents
    }

    private renderModel(device: GfxDevice, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext, matrix: mat4, modelInst: ModelInstance) {
        const modelCtx: ModelRenderContext = {
            sceneCtx,
            showDevGeometry: true,
            ambienceIdx: 0,
            outdoorAmbientColor: White,
            setupLights: () => {},
        };

        modelInst.addRenderInsts(device, renderInstManager, modelCtx, null, matrix);

        if (this.displayBones) {
            // TODO: display bones as cones instead of lines
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 1; i < modelInst.model.joints.length; i++) {
                const joint = modelInst.model.joints[i];
                const jointMtx = mat4.clone(modelInst.skeletonInst!.getJointMatrix(i));
                mat4.mul(jointMtx, jointMtx, matrix);
                const jointPt = vec3.create();
                mat4.getTranslation(jointPt, jointMtx);
                if (joint.parent !== 0xff) {
                    const parentMtx = mat4.clone(modelInst.skeletonInst!.getJointMatrix(joint.parent));
                    mat4.mul(parentMtx, parentMtx, matrix);
                    const parentPt = vec3.create();
                    mat4.getTranslation(parentPt, parentMtx);
                    drawWorldSpaceLine(ctx, sceneCtx.viewerInput.camera.clipFromWorldMatrix, parentPt, jointPt);
                } else {
                    drawWorldSpacePoint(ctx, sceneCtx.viewerInput.camera.clipFromWorldMatrix, jointPt);
                }
            }
        }
    }
}

export class SFAModelExhibitSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, private subdir: string, private modelVersion: ModelVersion, private gameInfo: GameInfo = SFA_GAME_INFO) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for model exhibit ...`);

        const materialFactory = new MaterialFactory(device);
        const animController = new SFAAnimationController();

        const modanimColl = await ModanimCollection.create(this.gameInfo, context.dataFetcher);
        const amapColl = await AmapCollection.create(this.gameInfo, context.dataFetcher);
        const animColl = await AnimCollection.create(this.gameInfo, context.dataFetcher, this.subdir);
        const texFetcher = await SFATextureFetcher.create(this.gameInfo, context.dataFetcher, this.modelVersion === ModelVersion.Beta);
        await texFetcher.loadSubdirs([this.subdir], context.dataFetcher);
        const modelFetcher = await ModelFetcher.create(this.gameInfo, Promise.resolve(texFetcher), materialFactory, animController, this.modelVersion);
        await modelFetcher.loadSubdirs([this.subdir], context.dataFetcher);

        return new ModelExhibitRenderer(context, this.subdir, animController, materialFactory, texFetcher, modelFetcher, animColl, amapColl, modanimColl);
    }
}
