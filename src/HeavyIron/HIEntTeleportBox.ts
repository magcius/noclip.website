import { vec3 } from "gl-matrix";
import { HIEnt, HIEntAsset, HIEntFlags, HIEntMoreFlags } from "./HIEnt.js";
import { HIGame, HIScene } from "./HIScene.js";
import { RwStream } from "./rw/rwcore.js";
import { strHash } from "./Util.js";
import { HIDynAsset } from "./HIDynAsset.js";
import { HIMarkerAsset } from "./HIMarkerAsset.js";

export class HIEntTeleportBoxAsset {
    public marker: number;
    public opened: number;
    public launchAngle: number;
    public camAngle: number;
    public targetID: number;

    constructor(stream: RwStream, game: HIGame) {
        this.marker = stream.readUint32();
        this.opened = stream.readUint32();
        if (game === HIGame.BFBB) {
            this.launchAngle = stream.readUint32();
        }
        this.camAngle = stream.readUint32();
        this.targetID = stream.readUint32();
    }
}

export class HIEntTeleportBox extends HIEnt {
    public tasset: HIEntTeleportBoxAsset;

    constructor(public dynAsset: HIDynAsset, stream: RwStream, scene: HIScene) {
        const tasset = new HIEntTeleportBoxAsset(stream, scene.game);

        const entAsset = new HIEntAsset();
        entAsset.id = dynAsset.id;
        entAsset.baseType = dynAsset.baseType;
        entAsset.linkCount = dynAsset.linkCount;
        entAsset.baseFlags = dynAsset.baseFlags;
        entAsset.flags = HIEntFlags.Visible;
        entAsset.subtype = 0;
        entAsset.pflags = 0;
        entAsset.moreFlags = HIEntMoreFlags.AnimColl;
        entAsset.surfaceID = 0;
        entAsset.ang = vec3.fromValues(0.0, 0.0, 0.0);
        entAsset.pos = vec3.fromValues(0.0, 0.0, 0.0);
        entAsset.scale = vec3.fromValues(1.0, 1.0, 1.0);
        entAsset.redMult = 1.0;
        entAsset.greenMult = 1.0;
        entAsset.blueMult = 1.0;
        entAsset.seeThru = 1.0;
        entAsset.seeThruSpeed = 1.0;
        entAsset.modelInfoID = strHash("teleportation_box_bind");
        entAsset.animListID = 0;

        super(entAsset, scene);
        this.readLinks(stream);
        this.tasset = tasset;

        const marker = scene.assetManager.findAsset(this.tasset.marker)?.runtimeData as HIMarkerAsset;
        if (marker) {
            vec3.copy(this.entAsset.pos, marker.pos);
        }

        this.parseModelInfo(this.entAsset.modelInfoID, scene);
    }
}