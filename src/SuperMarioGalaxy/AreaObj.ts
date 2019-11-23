
import { vec3, mat4 } from "gl-matrix";
import { JMapInfoIter, getJMapInfoScale } from "./JMapInfo";
import { SceneObjHolder, getObjectName } from "./Main";
import { getJMapInfoTrans, getJMapInfoRotate, ZoneAndLayer } from "./LiveActor";
import { computeModelMatrixR } from "../MathHelpers";
import { AABB } from "../Geometry";
import { vecKillElement } from "./MiscActor";
import { NameObj } from "./NameObj";

interface AreaFormBase {
    // TODO(jstpierre): followMtx
    isInVolume(v: vec3): boolean;
}

export const enum AreaFormType {
    Cube,
    CubeGround,
    Sphere,
    Cylinder,
    Bowl,
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchMatrix = mat4.create();

function makeWorldMtxFromPlacement(dst: mat4, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
    computeModelMatrixR(dst, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
    getJMapInfoTrans(scratchVec3a, sceneObjHolder, infoIter);
    dst[12] = scratchVec3a[0];
    dst[13] = scratchVec3a[1];
    dst[14] = scratchVec3a[2];
}

function multTranspose(dst: vec3, a: vec3, m: mat4): void {
    const dx = a[0] - m[12];
    const dy = a[1] - m[13];
    const dz = a[2] - m[14];
    dst[0] = dx*m[0] + dy*m[1] + dz*m[2];
    dst[1] = dx*m[4] + dy*m[5] + dz*m[6];
    dst[2] = dx*m[8] + dy*m[9] + dz*m[10];
}

class AreaFormCube implements AreaFormBase {
    private worldMatrix = mat4.create();
    private aabb = new AABB();

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, type: AreaFormType) {
        makeWorldMtxFromPlacement(this.worldMatrix, sceneObjHolder, infoIter);

        getJMapInfoScale(scratchVec3a, infoIter);
        this.aabb.minX = -0.5 * scratchVec3a[0] * 1000;
        this.aabb.minY = -0.5 * scratchVec3a[1] * 1000;
        this.aabb.minZ = -0.5 * scratchVec3a[2] * 1000;
        this.aabb.maxX =  0.5 * scratchVec3a[0] * 1000;
        this.aabb.maxY =  0.5 * scratchVec3a[1] * 1000;
        this.aabb.maxZ =  0.5 * scratchVec3a[2] * 1000;

        if (type === AreaFormType.CubeGround)
            this.aabb.minY += 0.5 * scratchVec3a[1] * 1000;
    }

    private calcWorldMtx(dst: mat4): void {
        mat4.copy(dst, this.worldMatrix);
    }

    public isInVolume(v: vec3): boolean {
        this.calcWorldMtx(scratchMatrix);
        multTranspose(scratchVec3a, v, scratchMatrix);
        return this.aabb.containsPoint(scratchVec3a);
    }
}

class AreaFormSphere implements AreaFormBase {
    private pos = vec3.create();
    private radiusSq: number;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        getJMapInfoTrans(this.pos, sceneObjHolder, infoIter);
        // TODO(jstpierre): Rotate
        getJMapInfoScale(scratchVec3a, infoIter);
        const radius = scratchVec3a[0] * 500;
        this.radiusSq = radius * radius;
    }

    private calcPos(dst: vec3): void {
        vec3.copy(dst, this.pos);
    }

    public isInVolume(v: vec3): boolean {
        this.calcPos(scratchVec3a);

        vec3.sub(scratchVec3a, scratchVec3a, v);
        const mag = vec3.squaredLength(scratchVec3a);
        return mag < this.radiusSq;
    }
}

class AreaFormCylinder implements AreaFormBase {
    private pos = vec3.create();
    private upVec = vec3.create();
    private radiusSq: number;
    private height: number;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        getJMapInfoTrans(this.pos, sceneObjHolder, infoIter);

        getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
        computeModelMatrixR(scratchMatrix, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);

        vec3.set(scratchVec3a, 0, 1, 0);
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMatrix);
        vec3.normalize(this.upVec, scratchVec3a);

        getJMapInfoScale(scratchVec3a, infoIter);
        const radius = scratchVec3a[0] * 500;
        this.radiusSq = radius * radius;
        this.height = scratchVec3a[1] * 500;
    }

    private calcPos(dst: vec3): void {
        vec3.copy(dst, this.pos);
    }

    private calcUpVec(dst: vec3): void {
        vec3.copy(dst, this.upVec);
    }

    public isInVolume(v: vec3): boolean {
        this.calcPos(scratchVec3a);
        this.calcUpVec(scratchVec3b);

        vec3.sub(scratchVec3a, scratchVec3a, v);
        const dot = vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);
        if (dot >= 0.0 && dot <= this.height) {
            const mag = vec3.squaredLength(scratchVec3a);
            if (mag < this.radiusSq)
                return true;
        }

        return false;
    }
}

class AreaFormBowl implements AreaFormBase {
    private pos = vec3.create();
    private upVec = vec3.create();
    private radiusSq: number;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        getJMapInfoTrans(this.pos, sceneObjHolder, infoIter);

        getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
        computeModelMatrixR(scratchMatrix, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);

        vec3.set(scratchVec3a, 0, 1, 0);
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMatrix);
        vec3.normalize(this.upVec, scratchVec3a);

        getJMapInfoScale(scratchVec3a, infoIter);
        const radius = scratchVec3a[0] * 500;
        this.radiusSq = radius * radius;
    }

    public isInVolume(v: vec3): boolean {
        vec3.sub(scratchVec3a, this.pos, v);

        const mag = vec3.squaredLength(scratchVec3a);
        if (mag < this.radiusSq) {
            const dot = vec3.dot(scratchVec3a, this.upVec);
            if (dot < 0.0)
                return true;
        }

        return false;
    }
}

export class AreaObj extends NameObj {
    private form: AreaFormBase;
    private aliveScenario: boolean = true;

    constructor(private zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(sceneObjHolder, getObjectName(infoIter));

        if (formType === AreaFormType.Cube)
            this.form = new AreaFormCube(sceneObjHolder, infoIter, AreaFormType.Cube);
        else if (formType === AreaFormType.CubeGround)
            this.form = new AreaFormCube(sceneObjHolder, infoIter, AreaFormType.CubeGround);
        else if (formType === AreaFormType.Sphere)
            this.form = new AreaFormSphere(sceneObjHolder, infoIter);
        else if (formType === AreaFormType.Cylinder)
            this.form = new AreaFormCylinder(sceneObjHolder, infoIter);
        else if (formType === AreaFormType.Bowl)
            this.form = new AreaFormBowl(sceneObjHolder, infoIter);

        // TODO(jstpierre): Push to AreaObjMgr?
    }

    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        this.aliveScenario = sceneObjHolder.spawner.checkAliveScenario(this.zoneAndLayer);
    }

    public isInVolume(v: vec3): boolean {
        return this.aliveScenario && this.form.isInVolume(v);
    }
}

export class AreaObjMgr<T extends AreaObj> extends NameObj {
    public areaObj: T[] = [];

    constructor(sceneObjHolder: SceneObjHolder, name: string) {
        super(sceneObjHolder, name);
    }

    public entry(areaObj: T): void {
        this.areaObj.push(areaObj);
    }

    public find_in(v: vec3): T | null {
        for (let i = 0; i < this.areaObj.length; i++)
            if (this.areaObj[i].isInVolume(v))
                return this.areaObj[i];
        return null;
    }
}
