import { LiveActor, ZoneAndLayer } from "../LiveActor";
import { SceneObjHolder } from "../Main";
import { mat4 } from "gl-matrix";
import { connectToScene } from "../ActorUtil";
import { DrawBufferType, MovementType, CalcAnimType } from "../NameObj";

export class ModelObj<T extends number = number> extends LiveActor<T> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private transformMatrix: mat4 | null, drawBufferType: DrawBufferType | -2, movementType: MovementType | -2, calcAnimType: CalcAnimType | -2) {
        super(zoneAndLayer, sceneObjHolder, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        if (this.transformMatrix !== null)
            mat4.getTranslation(this.translation, this.transformMatrix);
        if (drawBufferType === -2)
            drawBufferType = DrawBufferType.NoShadowedMapObj;
        if (movementType === -2)
            movementType = MovementType.MapObjDecoration;
        if (calcAnimType === -2)
            calcAnimType = CalcAnimType.MapObjDecoration;
        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
        this.initEffectKeeper(sceneObjHolder, null);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        if (this.transformMatrix !== null) {
            mat4.getTranslation(this.translation, this.transformMatrix);
            mat4.copy(this.modelInstance!.modelMatrix, this.transformMatrix);
        } else {
            super.calcAndSetBaseMtx(sceneObjHolder);
        }
    }
}

export function createModelObjBloomModel(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4 | null): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, DrawBufferType.BloomModel, -2, -2);
}

export function createModelObjMapObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4 | null): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, DrawBufferType.MapObj, -2, -2);
}

export function createModelObjMapObjStrongLight(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4 | null): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, DrawBufferType.MapObjStrongLight, -2, -2);
}
