import { mat4, vec3 } from "gl-matrix";
import { HIBase, HIBaseFlags } from "./HIBase.js";
import { HIGame, HIScene } from "./HIScene.js";
import { HIModelAssetInfo, HIModelInstance } from "./HIModel.js";
import { RwEngine, RwStream } from "./rw/rwcore.js";
import { HILightKit } from "./HILightKit.js";
import { RpClump } from "./rw/rpworld.js";

export const enum HIEntFlags {
    Visible = 0x1
}

export class HIEntAsset {
    public flags: number;
    public subtype: number;
    public pflags: number;
    public moreFlags: number;
    public surfaceID: number;
    public ang: vec3;
    public pos: vec3;
    public scale: vec3;
    public redMult: number;
    public greenMult: number;
    public blueMult: number;
    public seeThru: number;
    public seeThruSpeed: number;
    public modelInfoID: number;
    public animListID: number;

    constructor(stream: RwStream, game: HIGame) {
        this.flags = stream.readUint8();
        this.subtype = stream.readUint8();
        this.pflags = stream.readUint8();
        this.moreFlags = stream.readUint8();
        if (game === HIGame.BFBB) {
            stream.pos += 4; // padding
        }
        this.surfaceID = stream.readUint32();
        this.ang = stream.readVec3();
        this.pos = stream.readVec3();
        this.scale = stream.readVec3();
        this.redMult = stream.readFloat();
        this.greenMult = stream.readFloat();
        this.blueMult = stream.readFloat();
        this.seeThru = stream.readFloat();
        this.seeThruSpeed = stream.readFloat();
        this.modelInfoID = stream.readUint32();
        this.animListID = stream.readUint32();
    }
}

export abstract class HIEnt extends HIBase {
    public entAsset: HIEntAsset;
    public flags: number;
    public moreFlags: number;
    public subType: number;
    public model: HIModelInstance | null = null;
    public lightKit: HILightKit | null = null;

    constructor(stream: RwStream, scene: HIScene) {
        super(stream, scene);
        this.entAsset = new HIEntAsset(stream, scene.game);

        this.flags = this.entAsset.flags;
        this.moreFlags = this.entAsset.moreFlags;
        this.subType = this.entAsset.subtype;

        this.baseFlags |= HIBaseFlags.IsEntity;
    }

    public override setup(scene: HIScene): void {
        super.setup(scene);

        if (this.model) {
            this.model.redMultiplier = this.entAsset.redMult;
            this.model.greenMultiplier = this.entAsset.greenMult;
            this.model.blueMultiplier = this.entAsset.blueMult;
            this.model.alpha = this.entAsset.seeThru;
        }
    }

    public parseModelInfo(assetID: number, scene: HIScene) {
        if (assetID === 0) return;
        
        if (scene.models.has(assetID)) {
            this.loadModel(scene.models.get(assetID)!, scene);
        } else if (scene.modelInfos.has(assetID)) {
            this.model = this.recurseModelInfo(scene.modelInfos.get(assetID)!, scene);
        } else {
            console.warn(`Model info ID not found: 0x${assetID}`);
        }
    }

    public loadModel(clump: RpClump, scene: HIScene) {
        this.model = new HIModelInstance(clump.atomics[0], scene);
        for (let i = 1; i < clump.atomics.length; i++) {
            this.model.attach(new HIModelInstance(clump.atomics[i], scene));
        }
    }

    private recurseModelInfo(info: HIModelAssetInfo, scene: HIScene): HIModelInstance | null {
        const tempInst: HIModelInstance[] = [];
        tempInst.length = info.modelInst.length;

        for (let i = 0; i < info.modelInst.length; i++) {
            const inst = info.modelInst[i];
            if (scene.models.has(inst.modelID)) {
                const clump = scene.models.get(inst.modelID)!;
                if (i === 0) {
                    tempInst[i] = new HIModelInstance(clump.atomics[0], scene);
                    for (let j = 1; j < clump.atomics.length; j++) {
                        tempInst[i].attach(new HIModelInstance(clump.atomics[j], scene));
                    }
                } else {
                    tempInst[i] = new HIModelInstance(clump.atomics[0], scene, inst.flags, inst.bone);
                    tempInst[inst.parent]!.attach(tempInst[i]);
                    for (let j = 1; j < clump.atomics.length; j++) {
                        tempInst[i].attach(new HIModelInstance(clump.atomics[j], scene));
                    }
                }
            } else if (scene.modelInfos.has(inst.modelID)) {
                const info = scene.modelInfos.get(inst.modelID)!;
                const minst = this.recurseModelInfo(info, scene);
                if (!minst) return null;

                tempInst[i] = minst;
                if (i !== 0) {
                    tempInst[i].flags |= inst.flags;
                    tempInst[i].boneIndex = inst.bone;
                    tempInst[inst.parent].attach(tempInst[i]);
                }
            } else {
                console.warn(`Model ID not found: 0x${inst.modelID}`);
                return null;
            }
        }

        return tempInst[0];
    }

    public isVisible() {
        return (this.flags & HIEntFlags.Visible) !== 0;
    }

    public show() {
        this.flags |= HIEntFlags.Visible;
    }

    public hide() {
        this.flags &= ~HIEntFlags.Visible;
    }

    public override reset(scene: HIScene) {
        super.reset(scene);

        if (this.model) {
            const mat = mat4.create();

            mat4.translate(mat, mat, this.entAsset.pos);
            
            mat4.rotateY(mat, mat, this.entAsset.ang[0]);
            mat4.rotateX(mat, mat, this.entAsset.ang[1]);
            mat4.rotateZ(mat, mat, this.entAsset.ang[2]);
            
            mat4.scale(mat, mat, this.entAsset.scale);
            
            mat4.copy(this.model.mat, mat);
        }
    }

    public beginUpdate(scene: HIScene, dt: number) {
        if (this.model) {
            this.model.update(dt);
        }
    }

    public endUpdate(scene: HIScene, dt: number) {
        if (this.model) {
            this.model.eval();
        }
    }

    public update(scene: HIScene, dt: number) {
        this.beginUpdate(scene, dt);

        // update physics, motion, etc.

        this.endUpdate(scene, dt);
    }

    public render(scene: HIScene, rw: RwEngine) {
        if (!this.isVisible() && !scene.renderHacks.showAllEntities) return;
        if (!this.model) return;

        this.model.render(scene, rw);
    }
}