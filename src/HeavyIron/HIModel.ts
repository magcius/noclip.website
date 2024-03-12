import { mat4, vec3 } from "gl-matrix";
import { HIModelBucket } from "./HIModelBucket.js";
import { HIScene } from "./HIScene.js";
import { HILightKit } from "./HILightKit.js";
import { RwEngine, RwStream } from "./rw/rwcore.js";
import { RpAtomic, RpGeometryFlag } from "./rw/rpworld.js";
import { Color, OpaqueBlack, colorCopy, colorNewCopy } from "../Color.js";

export const enum HIPipeFlags {
    ZBUFFER_SHIFT             = 2,
    ZBUFFER_MASK              = (3<<ZBUFFER_SHIFT),
    ZBUFFER_DISABLE           = (1<<ZBUFFER_SHIFT),
    ZBUFFER_ZFIRST            = (2<<ZBUFFER_SHIFT),
    CULL_SHIFT                = 4,
    CULL_MASK                 = (3<<CULL_SHIFT),
    CULL_DOUBLESIDED          = (1<<CULL_SHIFT),
    CULL_FRONTONLY            = (2<<CULL_SHIFT),
    CULL_BACKTHENFRONT        = (3<<CULL_SHIFT),
    LIGHTING_SHIFT            = 6,
    LIGHTING_MASK             = (3<<LIGHTING_SHIFT),
    LIGHTING_PRELIGHTONLY     = (1<<LIGHTING_SHIFT),
    LIGHTING_KITPRELIGHT      = (2<<LIGHTING_SHIFT),
    SRCBLEND_SHIFT            = 8,
    SRCBLEND_MASK             = (15<<SRCBLEND_SHIFT),
    DESTBLEND_SHIFT           = 12,
    DESTBLEND_MASK            = (15<<DESTBLEND_SHIFT),
    FOG_SHIFT                 = 16,
    FOG_DISABLE               = (1<<FOG_SHIFT),
    LAYER_SHIFT               = 19,
    LAYER_MASK                = (31<<LAYER_SHIFT),
    ALPHADISCARD_SHIFT        = 24,
    ALPHADISCARD_MASK         = (255<<ALPHADISCARD_SHIFT)
}

export interface HIPipeInfo {
    modelHashID: number;
    subObjectBits: number;
    pipeFlags: number;
}

export class HIPipeInfoTable {
    public data: HIPipeInfo[] = [];

    constructor(stream: RwStream) {
        const count = stream.readInt32();
        for (let i = 0; i < count; i++) {
            const modelHashID = stream.readUint32();
            const subObjectBits = stream.readUint32();
            const pipeFlags = stream.readUint32();
            this.data.push({ modelHashID, subObjectBits, pipeFlags });
        }
    }
}

export interface HIModelAssetInst {
    modelID: number;
    flags: number;
    parent: number;
    bone: number;
    mat: mat4;
}

export class HIModelAssetInfo {
    public magic: number;
    public animTableID: number;
    public combatID: number;
    public brainID: number;
    public modelInst: HIModelAssetInst[] = [];

    constructor(stream: RwStream) {
        this.magic = stream.readUint32();
        const numModelInst = stream.readUint32();
        this.animTableID = stream.readUint32();
        this.combatID = stream.readUint32();
        this.brainID = stream.readUint32();

        for (let i = 0; i < numModelInst; i++) {
            const modelID = stream.readUint32();
            const flags = stream.readUint16();
            const parent = stream.readUint8();
            const bone = stream.readUint8();
            const mat = mat4.fromValues(
                stream.readFloat(), stream.readFloat(), stream.readFloat(), 0,
                stream.readFloat(), stream.readFloat(), stream.readFloat(), 0,
                stream.readFloat(), stream.readFloat(), stream.readFloat(), 0,
                stream.readFloat(), stream.readFloat(), stream.readFloat(), 1
            );
            this.modelInst.push({ modelID, flags, parent, bone, mat });
        }
    }
}

export const enum HIModelFlags {
    Visible = 0x1,
    LODNoRender = 0x400
}

const oldMaterialColors: Color[] = [];

export class HIModelInstance {
    public next: HIModelInstance | null = null;
    public parent: HIModelInstance | null = null;
    public flags: number;
    public boneIndex: number;
    public mat: mat4 = mat4.create();
    public bucket: HIModelBucket;
    public bucketNext: HIModelInstance | null = null;
    public lightKit: HILightKit | null = null;
    public pipeFlags = 0;
    public redMultiplier = 1.0;
    public greenMultiplier = 1.0;
    public blueMultiplier = 1.0;
    public alpha = 1.0;
    public fadeStart = 9e37;
    public fadeEnd = 1e38;
    
    constructor(public data: RpAtomic, scene: HIScene, flags: number = 0, boneIndex: number = 0) {
        this.flags = flags | HIModelFlags.Visible;
        this.boneIndex = boneIndex;
        this.bucket = scene.modelBucketManager.getBucket(data)!;
        this.pipeFlags = this.bucket.pipeFlags;
        this.alpha = data.geometry.materials[0].color.a;
    }

    public attach(inst: HIModelInstance) {
        let curr: HIModelInstance | null = this;
        while (curr.next) {
            curr = curr.next;
        }
        curr.next = inst;

        inst.parent = this;
    }

    public show() {
        this.flags |= HIModelFlags.Visible;
    }

    public hide() {
        this.flags &= ~HIModelFlags.Visible;
    }

    public isVisible() {
        return ((this.flags & (HIModelFlags.Visible | HIModelFlags.LODNoRender)) === HIModelFlags.Visible);
    }

    public update(dt: number) {
    }

    public eval() {
        let modelInst: HIModelInstance | null = this;
        while (modelInst) {
            modelInst.evalSingle();
            modelInst = modelInst.next;
        }
    }

    public evalSingle() {
        if (this.parent) {
            mat4.copy(this.mat, this.parent.mat);
        }
    }

    public render(scene: HIScene, rw: RwEngine) {
        let modelInst: HIModelInstance | null = this;
        while (modelInst) {
            if (scene.modelBucketManager.enabled) {
                scene.modelBucketManager.add(modelInst, scene, rw);
            } else {
                modelInst.renderSingle(scene, rw);
            }
            modelInst = modelInst.next;
        }
    }

    public renderSingle(scene: HIScene, rw: RwEngine) {
        if (!this.isVisible()) return;

        for (let i = oldMaterialColors.length; i < this.data.geometry.materials.length; i++) {
            oldMaterialColors.push(colorNewCopy(OpaqueBlack));
        }
        for (let i = 0; i < this.data.geometry.materials.length; i++) {
            colorCopy(oldMaterialColors[i], this.data.geometry.materials[i].color);
        }

        const oldflag = this.data.geometry.flags;

        this.data.geometry.flags |= RpGeometryFlag.MODULATEMATERIALCOLOR;

        for (const material of this.data.geometry.materials) {
            material.color.r *= this.redMultiplier;
            material.color.g *= this.greenMultiplier;
            material.color.b *= this.blueMultiplier;
            material.color.a = this.alpha;
        }

        if (!scene.renderHacks.lighting) {
            this.data.geometry.flags &= ~RpGeometryFlag.LIGHT;
        }

        if (!scene.renderHacks.vertexColors) {
            this.data.geometry.flags &= ~RpGeometryFlag.PRELIT;
        }

        if (this.lightKit && (this.pipeFlags & HIPipeFlags.LIGHTING_MASK) !== HIPipeFlags.LIGHTING_KITPRELIGHT) {
            this.data.geometry.flags &= ~RpGeometryFlag.PRELIT;
        }

        scene.modelManager.render(this.data, this.mat, rw);

        for (let i = 0; i < this.data.geometry.materials.length; i++) {
            colorCopy(this.data.geometry.materials[i].color, oldMaterialColors[i]);
        }

        this.data.geometry.flags = oldflag;
    }
}

export class HIModelManager {
    public hackDisablePrelight = false;
    
    public render(model: RpAtomic, mat: mat4, rw: RwEngine) {
        mat4.copy(model.frame.matrix, mat);

        const oldflag = model.geometry.flags;

        if (this.hackDisablePrelight) {
            model.geometry.flags &= ~RpGeometryFlag.PRELIT;
        }

        model.render(rw);

        model.geometry.flags = oldflag;
    }
}