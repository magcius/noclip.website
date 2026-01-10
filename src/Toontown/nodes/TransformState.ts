import { mat4, quat, vec3, vec4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgBool,
  dbgFlags,
  dbgMat4,
  dbgVec3,
  dbgVec4,
} from "./debug";

// TransformState flags
const F_IS_IDENTITY = 0x00001;
const F_COMPONENTS_GIVEN = 0x00008;
const F_MATRIX_KNOWN = 0x00040;
const F_QUAT_GIVEN = 0x00100;

const TransformFlags = {
  Identity: F_IS_IDENTITY,
  ComponentsGiven: F_COMPONENTS_GIVEN,
  MatrixKnown: F_MATRIX_KNOWN,
  QuatGiven: F_QUAT_GIVEN,
};

export class TransformState extends BAMObject {
  public flags = 0;
  public position = vec3.create();
  public quaternion = vec4.fromValues(1, 0, 0, 0);
  public rotation = vec3.create();
  public scale = vec3.fromValues(1, 1, 1);
  public shear = vec3.create();
  public matrix: mat4 | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    // Flags changed from uint16 to uint32 in BAM 5.2
    if (this._version.compare(new AssetVersion(5, 2)) >= 0) {
      this.flags = data.readUint32();
    } else {
      this.flags = data.readUint16();
    }

    if (this.flags & F_COMPONENTS_GIVEN) {
      this.position = data.readVec3();

      if (this.flags & F_QUAT_GIVEN) {
        this.quaternion = data.readVec4();
      } else {
        this.rotation = data.readVec3();
      }

      this.scale = data.readVec3();

      // Shear was added in BAM 4.6
      if (this._version.compare(new AssetVersion(4, 6)) >= 0) {
        this.shear = data.readVec3();
      }
    }

    if (this.flags & F_MATRIX_KNOWN) {
      this.matrix = data.readMat4();
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.flags = this.flags;
    vec3.copy(target.position, this.position);
    vec4.copy(target.quaternion, this.quaternion);
    vec3.copy(target.rotation, this.rotation);
    vec3.copy(target.scale, this.scale);
    vec3.copy(target.shear, this.shear);
    target.matrix = this.matrix ? mat4.clone(this.matrix) : null;
  }

  get isIdentity(): boolean {
    return (this.flags & F_IS_IDENTITY) !== 0;
  }

  getMatrix(): mat4 {
    if (this.isIdentity) {
      return mat4.create();
    }

    // If matrix is directly available, use it
    if (this.matrix) {
      return mat4.clone(this.matrix);
    }

    // Convert quaternion or euler angles to quaternion
    const out = mat4.create();
    const q = quat.create();
    if (
      this.quaternion[0] !== 1 ||
      this.quaternion[1] !== 0 ||
      this.quaternion[2] !== 0 ||
      this.quaternion[3] !== 0
    ) {
      // Panda3D quaternion is (r, i, j, k) = (w, x, y, z)
      quat.set(
        q,
        this.quaternion[1],
        this.quaternion[2],
        this.quaternion[3],
        this.quaternion[0],
      );
    } else if (
      this.rotation[0] !== 0 ||
      this.rotation[1] !== 0 ||
      this.rotation[2] !== 0
    ) {
      // HPR (heading, pitch, roll) to quaternion
      // Panda3D: H = rotation around Z, P = rotation around X, R = rotation around Y
      const h = (this.rotation[0] * Math.PI) / 180;
      const p = (this.rotation[1] * Math.PI) / 180;
      const r = (this.rotation[2] * Math.PI) / 180;

      // Create quaternion from HPR (Panda3D order)
      const qH = quat.create();
      quat.setAxisAngle(qH, [0, 0, 1], h);
      const qP = quat.create();
      quat.setAxisAngle(qP, [1, 0, 0], p);
      const qR = quat.create();
      quat.setAxisAngle(qR, [0, 1, 0], r);
      quat.multiply(q, qH, qP);
      quat.multiply(q, q, qR);
    }

    mat4.fromRotationTranslationScale(out, q, this.position, this.scale);

    // TODO: Handle shear if needed
    return out;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();

    if (this.isIdentity) {
      info.set("identity", dbgBool(true));
      return info;
    }

    info.set("flags", dbgFlags(this.flags, TransformFlags));

    if (this.flags & F_COMPONENTS_GIVEN) {
      info.set("position", dbgVec3(this.position));

      if (this.flags & F_QUAT_GIVEN) {
        info.set("quaternion", dbgVec4(this.quaternion));
      } else {
        info.set("rotation", dbgVec3(this.rotation));
      }

      info.set("scale", dbgVec3(this.scale));
      info.set("shear", dbgVec3(this.shear));
    }

    if (this.matrix) {
      info.set("matrix", dbgMat4(this.matrix));
    }

    return info;
  }

  static fromMatrix(matrix: mat4): TransformState {
    const state = new TransformState();
    state.matrix = matrix;
    return state;
  }

  static fromPosHprScale(
    pos: vec3 | null | undefined,
    hpr: vec3 | null | undefined,
    scale: vec3 | null | undefined,
  ): TransformState {
    const state = new TransformState();
    if (pos) vec3.copy(state.position, pos);
    if (hpr) vec3.copy(state.rotation, hpr);
    if (scale) vec3.copy(state.scale, scale);
    return state;
  }
}

registerBAMObject("TransformState", TransformState);
