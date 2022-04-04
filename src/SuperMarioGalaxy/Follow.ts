
import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { computeModelMatrixR, setMatrixTranslation } from "../MathHelpers";
import { assert, assertExists } from "../util";
import { connectToSceneMapObjMovement } from "./ActorUtil";
import { JMapInfoIter, JMapLinkInfo } from "./JMapInfo";
import { getJMapInfoRotate, getJMapInfoTrans, LiveActor } from "./LiveActor";
import { SceneObj, SceneObjHolder } from "./Main";
import { NameObj } from "./NameObj";

type BaseMatrixFollowValidator = unknown;

class BaseMatrixFollowTarget {
    public host: LiveActor | null = null;

    public inverseMtx = mat4.create();
    private hostBaseMtx: ReadonlyMat4 | null = null;

    constructor(public linkInfo: JMapLinkInfo) {
    }

    public set(host: LiveActor, hostBaseMtx: ReadonlyMat4 | null, validator: BaseMatrixFollowValidator | null = null) {
        this.host = host;
        this.hostBaseMtx = hostBaseMtx;
        // Validator is used by BossStinkBug and RunawayRabbit
        assert(validator === null);
    }

    private getHostBaseMtx(dst: mat4): void {
        if (this.hostBaseMtx !== null)
            mat4.copy(dst, this.hostBaseMtx);
        else
            mat4.copy(dst, assertExists(this.host!.getBaseMtx()));
    }

    public calcFollowMatrix(dst: mat4): void {
        this.getHostBaseMtx(dst);
        mat4.mul(dst, dst, this.inverseMtx);
    }

    public isValid(): boolean {
        return true;
    }
}

export abstract class BaseMatrixFollower {
    public followTarget: BaseMatrixFollowTarget | null = null;

    constructor(protected host: NameObj, public linkInfo: JMapLinkInfo) {
    }

    public calcFollowMatrix(dst: mat4): void {
        this.followTarget!.calcFollowMatrix(dst);
    }

    public getFollowTargetActor(): LiveActor {
        return assertExists(this.followTarget!.host);
    }

    public isEnableFollow(): boolean {
        return this.followTarget !== null && this.followTarget.host !== null;
    }

    public isValid(): boolean {
        return this.followTarget!.isValid();
    }

    public abstract update(sceneObjHolder: SceneObjHolder): void;
}

const scratchVec3 = vec3.create();
function getJMapInfoMatrixFromRT(dst: mat4, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    getJMapInfoRotate(scratchVec3, sceneObjHolder, infoIter);
    computeModelMatrixR(dst, scratchVec3[0], scratchVec3[1], scratchVec3[2]);
    getJMapInfoTrans(scratchVec3, sceneObjHolder, infoIter);
    setMatrixTranslation(dst, scratchVec3);
}

export class BaseMatrixFollowTargetHolder extends NameObj {
    private followers: BaseMatrixFollower[] = [];
    private followTargets: BaseMatrixFollowTarget[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'BaseMatrixFollowTargetHolder');
        connectToSceneMapObjMovement(sceneObjHolder, this);
    }

    private findFollowTarget(linkInfo: JMapLinkInfo | null): BaseMatrixFollowTarget | null {
        if (linkInfo === null)
            return null;
        for (let i = 0; i < this.followTargets.length; i++)
            if (this.followTargets[i].linkInfo.equals(linkInfo))
                return this.followTargets[i];
        return null;
    }

    public setFollowTargetInfo(sceneObjHolder: SceneObjHolder, host: LiveActor, infoIter: JMapInfoIter, hostBaseMtx: ReadonlyMat4 | null, validator: BaseMatrixFollowValidator | null = null) {
        const linkInfo = JMapLinkInfo.createLinkedInfo(sceneObjHolder, infoIter);
        const followTarget = this.findFollowTarget(linkInfo);
        if (followTarget !== null) {
            getJMapInfoMatrixFromRT(followTarget.inverseMtx, sceneObjHolder, infoIter);
            mat4.invert(followTarget.inverseMtx, followTarget.inverseMtx);

            followTarget.set(host, hostBaseMtx, validator);
        }
    }

    public addFollower(follower: BaseMatrixFollower): void {
        this.followers.push(follower);
        let followTarget = this.findFollowTarget(follower.linkInfo);
        if (followTarget === null) {
            followTarget = new BaseMatrixFollowTarget(follower.linkInfo);
            this.followTargets.push(followTarget);
        }
        follower.followTarget = followTarget;
    }

    public override movement(sceneObjHolder: SceneObjHolder): void {
        super.movement(sceneObjHolder);

        for (let i = 0; i < this.followers.length; i++) {
            const follower = this.followers[i];
            if (follower.isEnableFollow())
                follower.update(sceneObjHolder);
        }
    }
}

export function addBaseMatrixFollower(sceneObjHolder: SceneObjHolder, follower: BaseMatrixFollower): void {
    sceneObjHolder.create(SceneObj.BaseMatrixFollowTargetHolder);
    sceneObjHolder.baseMatrixFollowTargetHolder!.addFollower(follower);
}

export function addBaseMatrixFollowTarget(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter, hostBaseMtx: ReadonlyMat4 | null = null, validator: BaseMatrixFollowValidator | null = null): void {
    sceneObjHolder.create(SceneObj.BaseMatrixFollowTargetHolder);
    sceneObjHolder.baseMatrixFollowTargetHolder!.setFollowTargetInfo(sceneObjHolder, actor, infoIter, hostBaseMtx, validator);
}
