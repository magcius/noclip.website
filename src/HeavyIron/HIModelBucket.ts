import { vec3 } from "gl-matrix";
import { HIModelFlags, HIModelInstance, HIPipeFlags } from "./HIModel.js";
import { HIScene } from "./HIScene.js";
import { RwBlendFunction, RwCullMode, RwEngine } from "./rw/rwcore.js";
import { RpAtomic } from "./rw/rpworld.js";

export interface HIModelBucket {
    data: RpAtomic;
    pipeFlags: number;
    list: HIModelInstance | null;
}

interface HIModelAlphaBucket {
    data?: RpAtomic;
    minst?: HIModelInstance;
    sortValue: number;
    layer: number;
}

const scratchVec3 = vec3.create();

export class HIModelBucketManager {
    public enabled = false;

    private bucketList: HIModelBucket[] = [];
    private alphaList: HIModelAlphaBucket[] = [];
    private alphaCurr = 0;

    constructor() {
        // TODO: use 256 instead of 512 once we have distance culling
        for (let i = 0; i < 512; i++) {
            this.alphaList.push({ sortValue: Infinity, layer: 0 });
        }
    }

    public deinit() {
        this.bucketList.length = 0;
        this.alphaList.length = 0;
    }

    public insertBucket(data: RpAtomic, pipeFlags: number) {
        this.bucketList.push({ data, pipeFlags, list: null });
    }

    public getBucket(data: RpAtomic) {
        for (const bucket of this.bucketList) {
            if (bucket.data === data) {
                return bucket;
            }
        }
        return null;
    }

    public begin() {
        for (const bucket of this.bucketList) {
            bucket.list = null;
        }
        this.enabled = true;
    }

    public add(minst: HIModelInstance, scene: HIScene, rw: RwEngine) {
        if (!(minst.flags & HIModelFlags.Visible)) return;
        if (scene.camera.cullModel(minst.data, minst.mat, rw)) return;

        if ((minst.pipeFlags & HIPipeFlags.LIGHTING_MASK) !== HIPipeFlags.LIGHTING_PRELIGHTONLY) {
            minst.lightKit = scene.lightKitManager.lastLightKit;
        }

        // TODO: Use RpAtomic.worldBoundingSphere instead
        const sph = minst.data.geometry.morphTargets[0].boundingSphere;
        const pos = scratchVec3;
        vec3.set(pos, sph[0], sph[1], sph[2]);
        vec3.transformMat4(pos, pos, minst.mat);

        const camdot = rw.camera.worldMatrix[8] * (pos[0] - rw.camera.worldMatrix[12]) +
                       rw.camera.worldMatrix[9] * (pos[1] - rw.camera.worldMatrix[13]) +
                       rw.camera.worldMatrix[10] * (pos[2] - rw.camera.worldMatrix[14]);

        if (minst.pipeFlags & (HIPipeFlags.SRCBLEND_MASK | HIPipeFlags.DESTBLEND_MASK)) {
            if (this.alphaCurr < this.alphaList.length) {
                this.alphaList[this.alphaCurr].data = minst.bucket.data;
                this.alphaList[this.alphaCurr].minst = minst;
                this.alphaList[this.alphaCurr].sortValue = camdot;
                this.alphaList[this.alphaCurr].layer = (minst.pipeFlags & HIPipeFlags.LAYER_MASK) >>> HIPipeFlags.LAYER_SHIFT;
                this.alphaCurr++;
            }
        } else {
            minst.bucketNext = minst.bucket.list;
            minst.bucket.list = minst;
        }
    }

    public renderOpaque(scene: HIScene, rw: RwEngine) {
        this.enabled = false;

        for (const bucket of this.bucketList) {
            let minst = bucket.list;
            while (minst) {
                scene.lightKitManager.enable(minst.lightKit, rw.world);
                minst.renderSingle(rw);
                minst = minst.bucketNext;
            }

            // Reset for next frame
            bucket.list = null;
        }
    }

    public renderAlpha(scene: HIScene, rw: RwEngine) {
        if (this.alphaCurr) {
            this.alphaList.sort((a, b) => {
                if (a.layer > b.layer) return -1;
                if (a.layer < b.layer) return 1;
                if (a.sortValue < b.sortValue) return -1;
                if (a.sortValue > b.sortValue) return 1;
                return 0;
            });
        }

        const fog = scene.camera.fog;

        for (let i = 0; i < this.alphaCurr; i++) {
            const minst = this.alphaList[i].minst!;

            scene.lightKitManager.enable(minst.lightKit, rw.world);

            let srcBlend = ((minst.pipeFlags & HIPipeFlags.SRCBLEND_MASK) >>> HIPipeFlags.SRCBLEND_SHIFT);
            let dstBlend = ((minst.pipeFlags & HIPipeFlags.DESTBLEND_MASK) >>> HIPipeFlags.DESTBLEND_SHIFT);

            if (srcBlend === RwBlendFunction.NABLEND) {
                srcBlend = RwBlendFunction.SRCALPHA;
            }
            if (dstBlend === RwBlendFunction.NABLEND) {
                dstBlend = RwBlendFunction.INVSRCALPHA;
            }

            let zwrite = true;
            if ((minst.pipeFlags & HIPipeFlags.ZBUFFER_MASK) === HIPipeFlags.ZBUFFER_DISABLE) {
                zwrite = false;
            }

            let cull = RwCullMode.NONE;
            if ((minst.pipeFlags & HIPipeFlags.CULL_MASK) === HIPipeFlags.CULL_FRONTONLY) {
                cull = RwCullMode.BACK;
            }

            rw.renderState.srcBlend = srcBlend;
            rw.renderState.destBlend = dstBlend;
            rw.renderState.zWriteEnable = zwrite;
            rw.renderState.cullMode = cull;

            if (minst.pipeFlags & HIPipeFlags.FOG_DISABLE) {
                scene.camera.fog = undefined;
            } else {
                scene.camera.fog = fog;
            }
            scene.camera.setFogRenderStates(rw);

            if ((minst.pipeFlags & HIPipeFlags.CULL_MASK) === HIPipeFlags.CULL_BACKTHENFRONT) {
                rw.renderState.cullMode = RwCullMode.FRONT;
                minst.renderSingle(rw);
                rw.renderState.cullMode = RwCullMode.BACK;
                minst.renderSingle(rw);
            } else if ((minst.pipeFlags & HIPipeFlags.ZBUFFER_MASK) === HIPipeFlags.ZBUFFER_ZFIRST) {
                // TODO not tested - the OG game does something different here
                rw.renderState.zWriteEnable = true;
                minst.renderSingle(rw);
                rw.renderState.zWriteEnable = false;
                minst.renderSingle(rw);
            } else {
                minst.renderSingle(rw);
            }
        }

        scene.camera.fog = fog;
        
        // Reset for next frame
        for (let i = 0; i < this.alphaCurr; i++) {
            this.alphaList[i].sortValue = Infinity;
            this.alphaList[i].layer = 0;
        }
        this.alphaCurr = 0;
    }
}