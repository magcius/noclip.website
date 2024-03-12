import { HIBase } from "./HIBase.js";
import { HIScene } from "./HIScene.js";
import { JSP } from "./JSP.js";
import { RwBlendFunction, RwEngine, RwStream } from "./rw/rwcore.js";

export class HIEnvAsset {
    public bspAssetID: number;
    public startCameraAssetID: number;
    public climateFlags: number;
    public climateStrengthMin: number;
    public climateStrengthMax: number;
    public bspLightKit: number;
    public objectLightKit: number;
    public padF1: number;
    public bspCollisionAssetID: number;
    public bspFXAssetID: number;
    public bspCameraAssetID: number;
    public bspMapperID: number;
    public bspMapperCollisionID: number;
    public bspMapperFXID: number;
    public loldHeight: number;

    constructor(stream: RwStream) {
        this.bspAssetID = stream.readUint32();
        this.startCameraAssetID = stream.readUint32();
        this.climateFlags = stream.readUint32();
        this.climateStrengthMin = stream.readFloat();
        this.climateStrengthMax = stream.readFloat();
        this.bspLightKit = stream.readUint32();
        this.objectLightKit = stream.readUint32();
        this.padF1 = stream.readFloat();
        this.bspCollisionAssetID = stream.readUint32();
        this.bspFXAssetID = stream.readUint32();
        this.bspCameraAssetID = stream.readUint32();
        this.bspMapperID = stream.readUint32();
        this.bspMapperCollisionID = stream.readUint32();
        this.bspMapperFXID = stream.readUint32();
        this.loldHeight = stream.readFloat();
    }
}

export class HIEnv extends HIBase {
    public envAsset: HIEnvAsset;
    
    constructor(stream: RwStream, scene: HIScene, public jsp: JSP) {
        super(stream, scene);
        this.envAsset = new HIEnvAsset(stream);
        this.readLinks(stream);
    }

    public render(scene: HIScene, rw: RwEngine) {
        rw.renderState.srcBlend = RwBlendFunction.SRCALPHA;
        rw.renderState.destBlend = RwBlendFunction.INVSRCALPHA;
        
        this.jsp.render(scene, rw);
    }
}