import { mat4, quat, vec3 } from "gl-matrix";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { MobyInstance } from "../bin-gameplay";
import { LevelResources } from "../loader";
import { MobyUpdateKit, MobyImpl, ownPvars, updateTransformForTie } from "./moby";

export class TieRotationAnimator implements MobyImpl {
    private pvars: {
        groupId: number;
        // both unknowns are group indices
        unknown4: number;
        unknown8: number;
        angularVelocity: { x: number; y: number; z: number; };
        individualPivots: number;
    };

    constructor(private mobyInstance: MobyInstance, private resources: LevelResources) {
        const pv = ownPvars(mobyInstance, resources);
        this.pvars = {
            groupId: pv.getInt32(0x0),
            unknown4: pv.getInt32(0x4),
            unknown8: pv.getInt32(0x8),
            angularVelocity: pv.getFloat32_Xyz(0x10),
            individualPivots: pv.getInt32(0x1c),
        };
    }

    update(updateKit: MobyUpdateKit) {
        if (!this.resources.tieGroups) return;
        if (!this.resources.tieInstances) return;

        if (this.pvars.groupId === -1) return;
        const group = this.resources.tieGroups.groups[this.pvars.groupId];

        // Angular velocity is in degrees per second
        const elapsedAngle = updateKit.dt / 1000;
        const r = mat4.fromQuat(mat4.create(), quat.fromEuler(quat.create(),
            this.pvars.angularVelocity.x * elapsedAngle,
            this.pvars.angularVelocity.y * elapsedAngle,
            this.pvars.angularVelocity.z * elapsedAngle
        ));

        for (let j = 0; j < group.members.length; j++) {
            const member = group.members[j];
            if (member === undefined || member < 0) continue;

            const tie = this.resources.tieInstances[member];
            if (!tie) continue;

            if (this.pvars.individualPivots) {
                // rotate ties around their own origins
                tie.matrix = mat4.mul(mat4.create(), tie.matrix, r);
                updateTransformForTie(tie);
            } else {
                // rotate ties around this moby's origin
                const mobyPosition = vec3.fromValues(
                    this.mobyInstance.position.x,
                    this.mobyInstance.position.y,
                    this.mobyInstance.position.z,
                );
                const mobyRotation = mat4.fromQuat(mat4.create(), quat.fromEuler(quat.create(),
                    this.mobyInstance.rotation.x * (180 / Math.PI),
                    this.mobyInstance.rotation.y * (180 / Math.PI),
                    this.mobyInstance.rotation.z * (180 / Math.PI),
                ));
                const inverseMobyRotation = mat4.invert(mat4.create(), mobyRotation);
                if (!inverseMobyRotation) throw new Error("Moby rotation is not invertible");
                const rotationAroundMobyOrigin = mat4.create();
                mat4.mul(rotationAroundMobyOrigin, mobyRotation, r);
                mat4.mul(rotationAroundMobyOrigin, rotationAroundMobyOrigin, inverseMobyRotation);

                const tiePosition = mat4.getTranslation(vec3.create(), tie.matrix);
                vec3.subtract(tiePosition, tiePosition, mobyPosition);
                vec3.transformMat4(tiePosition, tiePosition, rotationAroundMobyOrigin);
                vec3.add(tiePosition, tiePosition, mobyPosition);

                tie.matrix = mat4.mul(mat4.create(), rotationAroundMobyOrigin, tie.matrix);
                tie.matrix[12] = tiePosition[0];
                tie.matrix[13] = tiePosition[1];
                tie.matrix[14] = tiePosition[2];
                updateTransformForTie(tie);
            }
        }

    }

    drawAfterTies(updateKit: MobyUpdateKit) {
    }

    drawAfterMobys(updateKit: MobyUpdateKit) {
    }

    destroy(device: GfxDevice) {
    }
}
