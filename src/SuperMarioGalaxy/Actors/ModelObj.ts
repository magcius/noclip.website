import { LiveActor, ZoneAndLayer } from "../LiveActor";
import { SceneObjHolder } from "../Main";
import { mat4 } from "gl-matrix";
import { connectToScene } from "../ActorUtil";
import { DrawBufferType, MovementType, CalcAnimType } from "../NameObj";
import { ViewerRenderInput } from "../../viewer";

export class ModelObj extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private transformMatrix: mat4 | null, drawBufferType: DrawBufferType, movementType: MovementType, calcAnimType: CalcAnimType) {
        super(zoneAndLayer, sceneObjHolder, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        if (this.transformMatrix !== null)
            mat4.getTranslation(this.translation, this.transformMatrix);
        if (movementType < -1)
            movementType = 0x08;
        if (calcAnimType < -1)
            calcAnimType = 0x23;
        if (drawBufferType < -1)
            drawBufferType = DrawBufferType.NO_SHADOWED_MAP_OBJ;
        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
    }

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (this.transformMatrix !== null) {
            mat4.getTranslation(this.translation, this.transformMatrix);
            mat4.copy(this.modelInstance!.modelMatrix, this.transformMatrix);
        } else {
            super.calcAndSetBaseMtx(sceneObjHolder, viewerInput);
        }
    }
}

export function createModelObjBloomModel(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    const bloomModel = new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, DrawBufferType.BLOOM_MODEL, -2, -2);
    return bloomModel;
}

export function createModelObjMapObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, 0x08, -2, -2);
}
