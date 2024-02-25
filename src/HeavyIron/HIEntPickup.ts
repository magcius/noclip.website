import { mat4 } from "gl-matrix";
import { HIEnt } from "./HIEnt.js";
import { HIModelInstance } from "./HIModel.js";
import { HIScene } from "./HIScene.js";
import { RwEngine, RwStream } from "./rw/rwcore.js";

export interface HIAssetPickup {
    pickupHash: number;
    pickupType: number;
    pickupIndex: number;
    pickupFlags: number;
    quantity: number;
    modelID: number;
    animID: number;
}

export class HIAssetPickupTable {
    public entries: HIAssetPickup[] = [];

    constructor(stream: RwStream) {
        const magic = stream.readUint32();
        const count = stream.readUint32();

        for (let i = 0; i < count; i++) {
            const pickupHash = stream.readUint32();
            const pickupType = stream.readUint8();
            const pickupIndex = stream.readUint8();
            const pickupFlags = stream.readUint16();
            const quantity = stream.readUint32();
            const modelID = stream.readUint32();
            const animID = stream.readUint32();
            this.entries.push({ pickupHash, pickupType, pickupIndex, pickupFlags, quantity, modelID, animID });
        }
    }
}

export class HIEntPickupAsset {
    public pickupHash: number;
    public pickupFlags: number;
    public pickupValue: number;

    constructor(stream: RwStream) {
        this.pickupHash = stream.readUint32();
        this.pickupFlags = stream.readUint16();
        this.pickupValue = stream.readUint16();
    }
}

export class HIEntPickup extends HIEnt {
    public pickupAsset: HIEntPickupAsset;

    constructor(stream: RwStream, scene: HIScene) {
        super(stream, scene);
        this.pickupAsset = new HIEntPickupAsset(stream);
        this.readLinks(stream);
    }

    public override setup(scene: HIScene): void {
        let pickupEntry = scene.pickupTable.entries[0];
        for (const pick of scene.pickupTable.entries) {
            if (this.pickupAsset.pickupHash === pick.pickupHash) {
                pickupEntry = pick;
                break;
            }
        }
        const clump = scene.models.get(pickupEntry.modelID);
        if (clump) {
            this.model = new HIModelInstance(clump.atomics[0], scene);
        }

        super.setup(scene);
    }

    public override render() {}
}

export class HIEntPickupManager {
    private pickups: HIEntPickup[] = [];
    private pickupOrientation = mat4.create();

    public add(pkup: HIEntPickup) {
        this.pickups.push(pkup);
    }

    public update(scene: HIScene, dt: number) {
        mat4.rotateY(this.pickupOrientation, this.pickupOrientation, Math.PI * dt);
    }
    
    public render(scene: HIScene, rw: RwEngine) {
        scene.lightKitManager.enable(null, rw.world, scene);

        const src = this.pickupOrientation;
        for (const pkup of this.pickups) {
            if (!pkup.isVisible()) continue;
            if (!pkup.model) continue;
            if (scene.camera.cullModel(pkup.model.data, pkup.model.mat, rw)) continue;

            const dst = pkup.model.mat;
            mat4.set(dst,
                     src[0], src[1], src[2], src[3],
                     src[4], src[5], src[6], src[7],
                     src[8], src[9], src[10], src[11],
                     dst[12], dst[13], dst[14], dst[15]);

            pkup.model.renderSingle(scene, rw);
        }
    }
}