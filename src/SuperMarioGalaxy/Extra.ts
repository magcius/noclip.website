
import { mat4, vec3 } from "gl-matrix";
import { MovementType, NameObj } from "./NameObj";
import { TicoRail } from "./Actors/NPC";
import { SceneObjHolder } from "./Main";
import { connectToScene, getRailTotalLength, vecKillElement } from "./ActorUtil";
import { randomRangeFloat, randomRangeInt } from "../MathHelpers";

function explerp(dst: vec3, target: vec3, k: number): void {
    dst[0] += (target[0] - dst[0]) * k;
    dst[1] += (target[1] - dst[1]) * k;
    dst[2] += (target[2] - dst[2]) * k;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
export class DayInTheLifeOfALumaController extends NameObj {
    private ticos: TicoRail[] = [];
    private ticoIndex: number = -1;
    private currentZoom: number;
    private switchCounter: number;
    private cameraCenter = vec3.create();
    private cameraEye = vec3.create();
    private cameraK = 1/8;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'DayInTheLifeOfALumaController');
        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, -1);
    }

    private pickNewTico(): void {
        while (true) {
            this.ticoIndex = randomRangeInt(0, this.ticos.length);
            const tico = this.ticos[this.ticoIndex];

            if (!tico.visibleAlive || !tico.visibleScenario)
                continue;

            // Never picked a stopped Tico.
            if (tico.isStopped(0))
                continue;

            break;
        }

        const tico = this.ticos[this.ticoIndex];
        const isShortRail = getRailTotalLength(tico) < 10000;
        this.currentZoom = isShortRail ? randomRangeFloat(500, 2500) : randomRangeFloat(1000, 3500);
        this.switchCounter = isShortRail ? 2000 : -1;
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        this.ticos = sceneObjHolder.nameObjHolder.nameObjs.filter((obj) => obj.name === 'TicoRail') as TicoRail[];
        this.pickNewTico();

        this.camera(1.0);
    }

    private camera(k: number = this.cameraK): void {
        const tico = this.ticos[this.ticoIndex];

        // Camera hax
        vec3.copy(scratchVec3a, tico.direction);
        vec3.set(scratchVec3b, 0, 1, 0);

        // XZ plane
        vecKillElement(scratchVec3c, scratchVec3a, scratchVec3b);
        // Jam the direction vector by this a ton to smooth out the Y axis.
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3c, 1);
        vec3.normalize(scratchVec3a, scratchVec3a);

        vec3.scaleAndAdd(scratchVec3a, tico.translation, scratchVec3a, -this.currentZoom);
        scratchVec3a[1] += 500;

        explerp(this.cameraEye, scratchVec3a, k);
        explerp(this.cameraCenter, tico.translation, k);
    }

    private tryPickNewTico(deltaTimeFrames: number): void {
        const tico = this.ticos[this.ticoIndex];

        // If the Tico isn't visible due to scenario reasons, force a new Tico.
        if (!tico.visibleScenario || !tico.visibleAlive)
            this.pickNewTico();

        if (tico.isStopped(0)) {
            // Each frame that we're stopped, there's a 1 in 200 chance that we switch.
            const rnd = randomRangeInt(0, 200);
            if (rnd === 0)
                this.pickNewTico();
        }

        // The ticos in the middle will never stop because of how they're set up.
        if (this.switchCounter >= 0) {
            this.switchCounter -= deltaTimeFrames;
            if (this.switchCounter <= 0)
                this.pickNewTico();
        }
    }

    public override movement(sceneObjHolder: SceneObjHolder): void {
        super.movement(sceneObjHolder);

        if (sceneObjHolder.inputManager.isKeyDownEventTriggered('Space'))
            this.pickNewTico();
        else
            this.tryPickNewTico(sceneObjHolder.deltaTimeFrames);
        this.camera();

        const camera = sceneObjHolder.viewerInput.camera;
        mat4.targetTo(camera.worldMatrix, this.cameraEye, this.cameraCenter, scratchVec3b);
        camera.worldMatrixUpdated();
    }
}
