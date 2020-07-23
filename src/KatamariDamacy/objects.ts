
import { BINModelInstance, KatamariDamacyTextureHolder } from "./render";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { MissionSetupObjectSpawn } from "./bin";
import { mat4 } from "gl-matrix";
import { clamp } from "../MathHelpers";

type AnimFunc = (objectRenderer: ObjectRenderer, deltaTimeInFrames: number) => void;

export class ObjectRenderer {
    public modelInstance: BINModelInstance[] = [];
    private animFunc: AnimFunc | null = null;

    constructor(public objectSpawn: MissionSetupObjectSpawn) {
        this.animFunc = animFuncSelect(this.objectSpawn.objectId);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, textureHolder: KatamariDamacyTextureHolder, viewerInput: ViewerRenderInput) {
        const deltaTimeInFrames = clamp(viewerInput.deltaTime / 33.0, 0.0, 2.0);
        if (this.animFunc !== null)
            this.animFunc(this, deltaTimeInFrames);

        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].prepareToRender(renderInstManager, textureHolder, viewerInput);
    }

    public setVisible(visible: boolean): void {
        for (let i = 0; i < this.modelInstance.length; i++)
            this.modelInstance[i].setVisible(visible);
    }

    public setActiveAreaNo(areaNo: number): void {
        const visible = areaNo >= this.objectSpawn.dispOnAreaNo && ((areaNo < this.objectSpawn.dispOffAreaNo) || this.objectSpawn.dispOffAreaNo === -1);
        this.setVisible(visible);
    }
}

const enum Axis { X, Y, Z }

function rotateObject(modelInstance: BINModelInstance, deltaTimeInFrames: number, axis: Axis, value: number): void {
    // TODO(jstpierre): Empirically matched to game footage. I don't know why it runs super fast.
    const mult = 0.4;
    const angle = (value / -60.0) * deltaTimeInFrames * mult;

    if (axis === Axis.X)
        mat4.rotateX(modelInstance.modelMatrix, modelInstance.modelMatrix, angle);
    else if (axis === Axis.Y)
        mat4.rotateY(modelInstance.modelMatrix, modelInstance.modelMatrix, angle);
    else if (axis === Axis.Z)
        mat4.rotateZ(modelInstance.modelMatrix, modelInstance.modelMatrix, angle);
}

const enum ObjectId {
    WINDMILL01_G = 0x02c6,
}

function animFuncSelect(objectId: ObjectId): AnimFunc | null {
    if (objectId === ObjectId.WINDMILL01_G) return animFunc_WINDMILL01_G;
    return null;
}

function animFunc_WINDMILL01_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstance[1], deltaTimeInFrames, Axis.Z, 12.0);
}
