import { mat4, vec3 } from 'gl-matrix';
import * as UI from '../ui';
import * as Viewer from "../viewer";
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { SceneContext } from '../SceneBase';

import { GameInfo, SFA_GAME_INFO } from './scenes';
import { Anim, SFAAnimationController, AnimLoader } from './animation';
import { SFARenderer } from './render';
import { Model, ModelCollection } from './models';
import { MaterialFactory } from './shaders';
import { getDebugOverlayCanvas2D, drawWorldSpaceLine, drawWorldSpacePoint } from '../DebugJunk';
import { SFATextureCollection, SFATexture } from './textures';

class ModelExhibitRenderer extends SFARenderer {
    private model: Model | null | undefined = undefined; // null: Failed to load. undefined: Not set.
    private modelNum = 1;
    private modelSelect: UI.Slider;

    private anim: Anim | null = null;
    private animNum = 0;
    private animSelect: UI.Slider;

    private displayBones: boolean = false;

    constructor(device: GfxDevice, animController: SFAAnimationController, private materialFactory: MaterialFactory, private texColl: SFATextureCollection, private modelColl: ModelCollection, private animLoader: AnimLoader) {
        super(device, animController);
    }

    public createPanels(): UI.Panel[] {
        const panel = new UI.Panel();

        panel.setTitle(UI.SAND_CLOCK_ICON, 'Model Exhibit');

        this.modelSelect = new UI.Slider();
        this.modelSelect.setLabel("Model #");
        this.modelSelect.setRange(0, 100);
        panel.contents.append(this.modelSelect.elem);

        this.animSelect = new UI.Slider();
        this.animSelect.setLabel("Animation #");
        this.animSelect.setRange(0, 100);
        panel.contents.append(this.animSelect.elem);

        const bonesSelect = new UI.Checkbox("Display Bones", false);
        bonesSelect.onchanged = () => {
            this.displayBones = bonesSelect.checked;
        };
        panel.contents.append(bonesSelect.elem);

        return [panel];
    }
    
    protected update(viewerInput: Viewer.ViewerRenderInput) {
        super.update(viewerInput);
        this.materialFactory.update(this.animController);
    }
    
    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        if (this.modelNum !== this.modelSelect.getValue()) {
            this.modelNum = this.modelSelect.getValue();
            this.model = undefined;
        }

        if (this.model === undefined) {
            try {
                this.model = this.modelColl.loadModel(device, this.materialFactory, this.modelNum);
                console.log(`Loaded model ${this.modelNum}`);
            } catch (e) {
                console.warn(`Failed to load model ${this.modelNum} due to exception:`);
                console.error(e);
                this.model = null;
            }
        }
        
        const animate = true;
        if (animate && this.model !== null) {
            if (this.animNum !== this.animSelect.getValue()) {
                this.animNum = this.animSelect.getValue();
                this.anim = null;
            }

            if (this.anim === null) {
                this.anim = this.animLoader.getAnim(this.animNum);
            }

            const keyframeNum = Math.floor((this.animController.animController.getTimeInSeconds() * 8) % this.anim.keyframes.length);
            const keyframe = this.anim.keyframes[keyframeNum];
            for (let i = 0; i < keyframe.poses.length && i < this.model.joints.length; i++) {
                const pose = keyframe.poses[i];
                const poseMtx = mat4.create();
                // mat4.rotateY(poseMtx, poseMtx, Math.sin(this.animController.animController.getTimeInSeconds()) / 2);
                mat4.fromTranslation(poseMtx, [pose.axes[0].translation, pose.axes[1].translation, pose.axes[2].translation]);
                mat4.scale(poseMtx, poseMtx, [pose.axes[0].scale, pose.axes[1].scale, pose.axes[2].scale]);
                mat4.rotateY(poseMtx, poseMtx, pose.axes[1].rotation);
                mat4.rotateX(poseMtx, poseMtx, pose.axes[0].rotation);
                mat4.rotateZ(poseMtx, poseMtx, pose.axes[2].rotation);

                const jointNum = this.anim.amap.getInt8(i);
                this.model.setJointPose(jointNum, poseMtx);
            }

            this.model.updateBoneMatrices();
        }

        // Render opaques

        this.beginPass(viewerInput);

        if (this.model !== null) {
            const mtx = mat4.create();
            this.renderModel(device, renderInstManager, viewerInput, mtx, this.model);
        }

        this.endPass(device);
        // TODO: render furs and translucents
    }

    private renderModel(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, model: Model) {
        model.prepareToRender(device, renderInstManager, viewerInput, matrix, this.sceneTexture, 0);

        if (this.displayBones) {
            // TODO: display bones as cones instead of lines
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 1; i < model.joints.length; i++) {
                const joint = model.joints[i];
                const jointMtx = mat4.clone(model.boneMatrices[i]);
                mat4.mul(jointMtx, jointMtx, matrix);
                const jointPt = vec3.create();
                mat4.getTranslation(jointPt, jointMtx);
                if (joint.parent != 0xff) {
                    const parentMtx = mat4.clone(model.boneMatrices[joint.parent]);
                    mat4.mul(parentMtx, parentMtx, matrix);
                    const parentPt = vec3.create();
                    mat4.getTranslation(parentPt, parentMtx);
                    drawWorldSpaceLine(ctx, viewerInput.camera, parentPt, jointPt);
                } else {
                    drawWorldSpacePoint(ctx, viewerInput.camera, jointPt);
                }
            }
        }
    }
}

export class SFAModelExhibitSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for character exhibit ...`);
        
        const subdir = 'swaphol'; // TODO: configurable

        const materialFactory = new MaterialFactory(device);
        const animController = new SFAAnimationController();
        const animLoader = new AnimLoader(this.gameInfo);
        await animLoader.create(context.dataFetcher, subdir);
        const texColl = new SFATextureCollection(this.gameInfo, false);
        await texColl.create(context.dataFetcher, subdir);
        const modelColl = new ModelCollection(texColl, animController, this.gameInfo);
        await modelColl.create(context.dataFetcher, subdir);

        return new ModelExhibitRenderer(device, animController, materialFactory, texColl, modelColl, animLoader);
    }
}
