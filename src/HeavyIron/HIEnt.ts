import { mat4, vec3 } from "gl-matrix";
import { HIBase, HIBaseFlags } from "./HIBase.js";
import { HIScene } from "./HIScene.js";
import { HIModelInstance } from "./HIModel.js";
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

    constructor(stream: RwStream) {
        this.flags = stream.readUint8();
        this.subtype = stream.readUint8();
        this.pflags = stream.readUint8();
        this.moreFlags = stream.readUint8();
        stream.pos += 4; // padding
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

    constructor(stream: RwStream) {
        super(stream);
        this.entAsset = new HIEntAsset(stream);

        this.flags = this.entAsset.flags;
        this.moreFlags = this.entAsset.moreFlags;
        this.subType = this.entAsset.subtype;

        this.baseFlags |= HIBaseFlags.IsEntity;
    }

    public loadModel(clump: RpClump, scene: HIScene) {
        this.model = new HIModelInstance(clump.atomics[0], scene);
        for (let i = 1; i < clump.atomics.length; i++) {
            this.model.attach(new HIModelInstance(clump.atomics[i], scene));
        }
    }

    public parseModelInfo(assetID: number, scene: HIScene) {
        const clump = scene.models.get(assetID);
        if (clump) {
            this.loadModel(clump, scene);
        }
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

    public render(scene: HIScene, rw: RwEngine) {
        if (!this.isVisible()) return;
        if (!this.model) return;

        this.model.render(scene, rw);
    }
}