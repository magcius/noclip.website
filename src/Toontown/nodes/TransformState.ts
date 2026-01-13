import {
  mat4,
  quat,
  type ReadonlyMat4,
  type ReadonlyQuat,
  type ReadonlyVec3,
  type ReadonlyVec4,
  vec3,
} from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, CopyContext, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgBool,
  dbgFlags,
  dbgMat4,
  dbgVec3,
  dbgVec4,
} from "./debug";

// TransformState flags - matching Panda3D's flags
const F_IS_IDENTITY = 0x00000001;
const F_IS_SINGULAR = 0x00000002;
const F_SINGULAR_KNOWN = 0x00000004;
const F_COMPONENTS_GIVEN = 0x00000008;
const F_COMPONENTS_KNOWN = 0x00000010;
const F_HAS_COMPONENTS = 0x00000020;
const F_MAT_KNOWN = 0x00000040;
const F_IS_INVALID = 0x00000080;
const F_QUAT_GIVEN = 0x00000100;
const F_QUAT_KNOWN = 0x00000200;
const F_HPR_GIVEN = 0x00000400;
const F_HPR_KNOWN = 0x00000800;
const F_UNIFORM_SCALE = 0x00001000;
const F_IDENTITY_SCALE = 0x00002000;
const F_HAS_NONZERO_SHEAR = 0x00004000;

const TransformFlags = {
  Identity: F_IS_IDENTITY,
  Singular: F_IS_SINGULAR,
  SingularKnown: F_SINGULAR_KNOWN,
  ComponentsGiven: F_COMPONENTS_GIVEN,
  ComponentsKnown: F_COMPONENTS_KNOWN,
  HasComponents: F_HAS_COMPONENTS,
  MatrixKnown: F_MAT_KNOWN,
  Invalid: F_IS_INVALID,
  QuatGiven: F_QUAT_GIVEN,
  QuatKnown: F_QUAT_KNOWN,
  HprGiven: F_HPR_GIVEN,
  HprKnown: F_HPR_KNOWN,
  UniformScale: F_UNIFORM_SCALE,
  IdentityScale: F_IDENTITY_SCALE,
  HasNonzeroShear: F_HAS_NONZERO_SHEAR,
};

const EPSILON = 1e-6;

// Shared identity instances
const identityMatrix = mat4.create();
const identityQuat: ReadonlyQuat = quat.create();
const zeroVec3: ReadonlyVec3 = vec3.create();
const oneVec3: ReadonlyVec3 = vec3.fromValues(1, 1, 1);

/**
 * TransformState represents an immutable transformation with lazy computation.
 * Supports both componentwise (pos/hpr/scale) and matrix representations.
 */
export class TransformState extends BAMObject {
  // Flags for state tracking
  private _flags = F_IS_IDENTITY;

  // Component storage
  private _pos: vec3 = vec3.create();
  private _hpr: vec3 = vec3.create();
  private _scale: vec3 = vec3.fromValues(1, 1, 1);
  private _shear: vec3 = vec3.create();
  private _quat: quat = quat.create();
  private _normQuat: quat = quat.create();

  // Matrix storage
  private _mat: mat4 | null = null;
  private _invMat: mat4 | null = null;

  // ============================================
  // BAM Loading
  // ============================================

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    // Flags changed from uint16 to uint32 in BAM 5.2
    if (this._version.compare(new AssetVersion(5, 2)) >= 0) {
      this._flags = data.readUint32();
    } else {
      this._flags = data.readUint16();
    }

    if (this._flags & F_COMPONENTS_GIVEN) {
      this._pos = vec3.clone(data.readVec3() as vec3);

      if (this._flags & F_QUAT_GIVEN) {
        const pandaQuat = data.readVec4();
        pandaQuatToGlQuat(this._quat, pandaQuat);
        this._flags |= F_QUAT_KNOWN;
      } else {
        this._hpr = vec3.clone(data.readVec3() as vec3);
        this._flags |= F_HPR_GIVEN | F_HPR_KNOWN;
      }

      this._scale = vec3.clone(data.readVec3() as vec3);

      // Shear was added in BAM 4.6
      if (this._version.compare(new AssetVersion(4, 6)) >= 0) {
        this._shear = vec3.clone(data.readVec3() as vec3);
      }

      this._flags |= F_COMPONENTS_KNOWN | F_HAS_COMPONENTS;
      this.checkUniformScale();
      this.checkShear();
    }

    if (this._flags & F_MAT_KNOWN) {
      this._mat = mat4.clone(data.readMat4() as mat4);
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target._flags = this._flags;
    vec3.copy(target._pos, this._pos);
    vec3.copy(target._hpr, this._hpr);
    vec3.copy(target._scale, this._scale);
    vec3.copy(target._shear, this._shear);
    quat.copy(target._quat, this._quat);
    quat.copy(target._normQuat, this._normQuat);
    target._mat = this._mat;
    target._invMat = this._invMat;
  }

  // ============================================
  // Flag Accessors
  // ============================================

  get flags(): number {
    return this._flags;
  }
  set flags(value: number) {
    this._flags = value;
  }

  get isIdentity(): boolean {
    return (this._flags & F_IS_IDENTITY) !== 0;
  }

  get isInvalid(): boolean {
    return (this._flags & F_IS_INVALID) !== 0;
  }

  /** Returns true if transform was specified componentwise */
  componentsGiven(): boolean {
    return (this._flags & F_COMPONENTS_GIVEN) !== 0;
  }

  /** Returns true if transform can be decomposed into pos/hpr/scale */
  hasComponents(): boolean {
    this.checkComponents();
    return (this._flags & F_HAS_COMPONENTS) !== 0;
  }

  /** Returns true if scale is uniform across all axes */
  hasUniformScale(): boolean {
    this.checkComponents();
    return (this._flags & F_UNIFORM_SCALE) !== 0;
  }

  /** Returns true if transform has non-zero shear */
  hasNonzeroShear(): boolean {
    this.checkComponents();
    return (this._flags & F_HAS_NONZERO_SHEAR) !== 0;
  }

  /** Returns true if the matrix is singular (non-invertible) */
  isSingular(): boolean {
    if (!(this._flags & F_SINGULAR_KNOWN)) this.calcInverse();
    return (this._flags & F_IS_SINGULAR) !== 0;
  }

  // ============================================
  // Component Getters (with lazy computation)
  // ============================================

  get pos(): ReadonlyVec3 {
    if (this.isIdentity) return zeroVec3;
    this.checkComponents();
    return this._pos;
  }

  get hpr(): ReadonlyVec3 {
    if (this.isIdentity) return zeroVec3;
    this.checkHpr();
    return this._hpr;
  }

  get scale(): ReadonlyVec3 {
    if (this.isIdentity) return oneVec3;
    this.checkComponents();
    return this._scale;
  }

  get shear(): ReadonlyVec3 {
    if (this.isIdentity) return zeroVec3;
    this.checkComponents();
    return this._shear;
  }

  get quaternion(): ReadonlyQuat {
    if (this.isIdentity) return identityQuat;
    this.checkQuat();
    return this._quat;
  }

  get normQuat(): ReadonlyQuat {
    if (this.isIdentity) return identityQuat;
    this.checkNormQuat();
    return this._normQuat;
  }

  getUniformScale(): number {
    if (this.isIdentity) return 1;
    this.checkComponents();
    return this._scale[0];
  }

  // ============================================
  // Matrix Getters
  // ============================================

  getMatrix(): ReadonlyMat4 {
    if (this.isIdentity) return identityMatrix;
    if (this.isInvalid) return identityMatrix;
    this.checkMatrix();
    return this._mat!;
  }

  // For compatibility
  get matrix(): ReadonlyMat4 | null {
    if (this._flags & F_MAT_KNOWN) return this._mat;
    return null;
  }

  getInverseMatrix(): ReadonlyMat4 {
    if (this.isIdentity) return identityMatrix;
    if (this.isSingular()) return identityMatrix;
    return this._invMat!;
  }

  // ============================================
  // Lazy Computation
  // ============================================

  private checkComponents(): void {
    if (!(this._flags & F_COMPONENTS_KNOWN)) {
      this.calcComponents();
    }
  }

  private checkMatrix(): void {
    if (!(this._flags & F_MAT_KNOWN)) {
      this.calcMatrix();
    }
  }

  private checkHpr(): void {
    this.checkComponents();
    if (!(this._flags & F_HPR_KNOWN)) {
      // HPR not known but quat is - convert
      if (this._flags & F_QUAT_KNOWN) {
        quatToHpr(this._hpr, this._quat);
        this._flags |= F_HPR_KNOWN;
      }
    }
  }

  private checkQuat(): void {
    this.checkComponents();
    if (!(this._flags & F_QUAT_KNOWN)) {
      // Quat not known but HPR is - convert
      if (this._flags & F_HPR_KNOWN) {
        hprToQuat(this._quat, this._hpr);
        this._flags |= F_QUAT_KNOWN;
      }
    }
  }

  private checkNormQuat(): void {
    this.checkQuat();
    quat.normalize(this._normQuat, this._quat);
  }

  private checkUniformScale(): void {
    const sx = this._scale[0];
    const sy = this._scale[1];
    const sz = this._scale[2];

    if (Math.abs(sx - sy) < EPSILON && Math.abs(sy - sz) < EPSILON) {
      this._flags |= F_UNIFORM_SCALE;
      if (Math.abs(sx - 1) < EPSILON) {
        this._flags |= F_IDENTITY_SCALE;
      }
    }
  }

  private checkShear(): void {
    if (
      Math.abs(this._shear[0]) > EPSILON ||
      Math.abs(this._shear[1]) > EPSILON ||
      Math.abs(this._shear[2]) > EPSILON
    ) {
      this._flags |= F_HAS_NONZERO_SHEAR;
    }
  }

  /**
   * Decompose matrix into pos/scale/rotation components.
   * Sets F_HAS_COMPONENTS if decomposition succeeds.
   */
  private calcComponents(): void {
    if (this._flags & F_COMPONENTS_KNOWN) return;

    if (this._flags & F_IS_IDENTITY) {
      vec3.zero(this._pos);
      vec3.zero(this._hpr);
      vec3.set(this._scale, 1, 1, 1);
      vec3.zero(this._shear);
      quat.identity(this._quat);
      this._flags |=
        F_HAS_COMPONENTS |
        F_COMPONENTS_KNOWN |
        F_HPR_KNOWN |
        F_QUAT_KNOWN |
        F_UNIFORM_SCALE |
        F_IDENTITY_SCALE;
      return;
    }

    // Must have been created from matrix
    if (!(this._flags & F_MAT_KNOWN)) {
      // This shouldn't happen, but handle gracefully
      this._flags |= F_COMPONENTS_KNOWN;
      return;
    }

    const m = this._mat!;

    // Extract translation (always possible)
    mat4.getTranslation(this._pos, m);

    // Extract scale
    mat4.getScaling(this._scale, m);

    // Check for zero scale (singular matrix)
    if (
      Math.abs(this._scale[0]) < EPSILON ||
      Math.abs(this._scale[1]) < EPSILON ||
      Math.abs(this._scale[2]) < EPSILON
    ) {
      this._flags |= F_COMPONENTS_KNOWN | F_IS_SINGULAR | F_SINGULAR_KNOWN;
      return;
    }

    // Extract rotation as quaternion
    mat4.getRotation(this._quat, m);
    this._flags |= F_QUAT_KNOWN;

    // Compute HPR from quaternion
    quatToHpr(this._hpr, this._quat);
    this._flags |= F_HPR_KNOWN;

    // TODO: Extract shear if needed
    // For now, assume no shear from matrix decomposition
    vec3.zero(this._shear);

    this._flags |= F_HAS_COMPONENTS | F_COMPONENTS_KNOWN;
    this.checkUniformScale();
    this.checkShear();
  }

  /**
   * Compose matrix from pos/hpr/scale components.
   */
  private calcMatrix(): void {
    if (this._flags & F_MAT_KNOWN) return;

    if (this._flags & F_IS_IDENTITY) {
      this._mat = mat4.create();
      this._flags |= F_MAT_KNOWN;
      return;
    }

    // Must have components
    if (!(this._flags & F_COMPONENTS_KNOWN)) {
      this.calcComponents();
    }

    this._mat = mat4.create();

    // Get rotation quaternion
    this.checkQuat();

    mat4.fromRotationTranslationScale(
      this._mat,
      this._quat,
      this._pos,
      this._scale,
    );

    // TODO: Apply shear if non-zero

    this._flags |= F_MAT_KNOWN;
  }

  /**
   * Calculate inverse matrix.
   */
  private calcInverse(): void {
    if (this._flags & F_SINGULAR_KNOWN) return;

    this.checkMatrix();

    this._invMat = mat4.create();
    const result = mat4.invert(this._invMat, this._mat!);

    if (!result) {
      this._flags |= F_IS_SINGULAR | F_SINGULAR_KNOWN;
      this._invMat = null;
    } else {
      this._flags |= F_SINGULAR_KNOWN;
    }
  }

  // ============================================
  // Composition Operations
  // ============================================

  /**
   * Returns a new TransformState representing this * other.
   * Prefers componentwise composition when possible.
   */
  compose(other: TransformState): TransformState {
    // Handle identity cases
    if (this.isIdentity) return other;
    if (other.isIdentity) return this;

    // Handle invalid cases
    if (this.isInvalid) return this;
    if (other.isInvalid) return other;

    // Check if we can compose componentwise
    if (this.canComposeComponentwise(other)) {
      return this.composeComponentwise(other);
    }

    // Fall back to matrix composition
    const result = mat4.create();
    mat4.multiply(result, this.getMatrix(), other.getMatrix());
    return TransformState.fromMatrix(result);
  }

  /**
   * Check if componentwise composition is possible and beneficial.
   */
  private canComposeComponentwise(other: TransformState): boolean {
    return (
      this.hasUniformScale() &&
      !this.hasNonzeroShear() &&
      !other.hasNonzeroShear() &&
      ((this.componentsGiven() && other.hasComponents()) ||
        (other.componentsGiven() && this.hasComponents()))
    );
  }

  /**
   * Componentwise composition: this * other
   * Requires uniform scale and no shear.
   */
  private composeComponentwise(other: TransformState): TransformState {
    const pos = vec3.clone(this.pos);
    const q = quat.clone(this.normQuat);
    const scale = this.getUniformScale();

    // new_pos = this.pos + this.quat * (other.pos * this.scale)
    const rotatedPos = vec3.create();
    vec3.scale(rotatedPos, other.pos, scale);
    vec3.transformQuat(rotatedPos, rotatedPos, q);
    vec3.add(pos, pos, rotatedPos);

    // new_quat = this.quat * other.quat (apply parent rotation first, then child)
    const newQuat = quat.create();
    quat.multiply(newQuat, q, other.normQuat);

    // new_scale = other.scale * this.scale
    const newScale = vec3.create();
    vec3.scale(newScale, other.scale, scale);

    return TransformState.fromPosQuatScale(pos, newQuat, newScale);
  }

  // ============================================
  // Component Modification
  // ============================================

  /**
   * Returns a new TransformState with the specified scale, preserving pos and rotation.
   */
  setScale(scale: ReadonlyVec3): TransformState {
    this.checkComponents();
    return TransformState.fromPosQuatScale(this._pos, this.normQuat, scale);
  }

  /**
   * Returns a new TransformState with the specified uniform scale, preserving pos and rotation.
   */
  setUniformScale(scale: number): TransformState {
    return this.setScale(vec3.fromValues(scale, scale, scale));
  }

  /**
   * Returns a new TransformState with the specified pos, preserving rotation and scale.
   */
  setPos(pos: ReadonlyVec3): TransformState {
    this.checkComponents();
    return TransformState.fromPosQuatScale(pos, this.normQuat, this._scale);
  }

  // ============================================
  // Factory Methods
  // ============================================

  static makeIdentity(): TransformState {
    const state = new TransformState();
    state._flags =
      F_IS_IDENTITY |
      F_COMPONENTS_KNOWN |
      F_HAS_COMPONENTS |
      F_HPR_KNOWN |
      F_QUAT_KNOWN |
      F_UNIFORM_SCALE |
      F_IDENTITY_SCALE;
    return state;
  }

  static makeInvalid(): TransformState {
    const state = new TransformState();
    state._flags =
      F_IS_INVALID |
      F_SINGULAR_KNOWN |
      F_IS_SINGULAR |
      F_COMPONENTS_KNOWN |
      F_MAT_KNOWN;
    return state;
  }

  static fromMatrix(matrix: ReadonlyMat4): TransformState {
    // Check for identity
    if (mat4.equals(matrix, identityMatrix)) {
      return TransformState.makeIdentity();
    }

    const state = new TransformState();
    state._flags = F_MAT_KNOWN;
    state._mat = mat4.clone(matrix);
    return state;
  }

  static fromPos(pos: ReadonlyVec3): TransformState {
    const state = new TransformState();
    state._flags =
      F_COMPONENTS_KNOWN |
      F_HAS_COMPONENTS |
      F_HPR_KNOWN |
      F_QUAT_KNOWN |
      F_UNIFORM_SCALE |
      F_IDENTITY_SCALE;
    vec3.copy(state._pos, pos);
    // Check for identity
    if (vec3.equals(state._pos, zeroVec3)) {
      state._flags |= F_IS_IDENTITY;
    }
    return state;
  }

  static fromPosHprScale(
    pos: ReadonlyVec3 | null | undefined,
    hpr: ReadonlyVec3 | null | undefined,
    scale: ReadonlyVec3 | null | undefined,
  ): TransformState {
    const state = new TransformState();
    state._flags = F_COMPONENTS_GIVEN | F_COMPONENTS_KNOWN | F_HAS_COMPONENTS;

    if (pos) vec3.copy(state._pos, pos);
    if (hpr) {
      vec3.copy(state._hpr, hpr);
      state._flags |= F_HPR_GIVEN | F_HPR_KNOWN;
    }
    if (scale) vec3.copy(state._scale, scale);

    state.checkUniformScale();
    state.checkShear();

    // Check for identity
    if (
      vec3.equals(state._pos, zeroVec3) &&
      vec3.equals(state._hpr, zeroVec3) &&
      vec3.equals(state._scale, oneVec3)
    ) {
      state._flags |= F_IS_IDENTITY;
    }

    return state;
  }

  static fromPosQuatScale(
    pos: ReadonlyVec3,
    quaternion: ReadonlyQuat,
    scale: ReadonlyVec3,
  ): TransformState {
    const state = new TransformState();
    state._flags =
      F_COMPONENTS_GIVEN |
      F_QUAT_GIVEN |
      F_COMPONENTS_KNOWN |
      F_QUAT_KNOWN |
      F_HAS_COMPONENTS;

    vec3.copy(state._pos, pos);
    quat.copy(state._quat, quaternion);
    vec3.copy(state._scale, scale);

    state.checkUniformScale();
    state.checkShear();
    return state;
  }

  // ============================================
  // Debug
  // ============================================

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();

    if (this.isIdentity) {
      info.set("identity", dbgBool(true));
      return info;
    }

    info.set("flags", dbgFlags(this._flags, TransformFlags));

    if (this._flags & F_COMPONENTS_GIVEN || this._flags & F_COMPONENTS_KNOWN) {
      info.set("position", dbgVec3(this._pos));

      if (this._flags & F_QUAT_GIVEN || this._flags & F_QUAT_KNOWN) {
        info.set("quaternion", dbgVec4(this._quat as unknown as ReadonlyVec4));
      }
      if (this._flags & F_HPR_GIVEN || this._flags & F_HPR_KNOWN) {
        info.set("rotation", dbgVec3(this._hpr));
      }

      info.set("scale", dbgVec3(this._scale));
      info.set("shear", dbgVec3(this._shear));
    }

    if (this._mat) {
      info.set("matrix", dbgMat4(this._mat));
    }

    return info;
  }
}

registerBAMObject("TransformState", TransformState);

/**
 * Convert HPR (heading, pitch, roll) in degrees to quaternion.
 * Panda3D convention (Z-up):
 *   H = rotation around up (Z)
 *   P = rotation around right (X)
 *   R = rotation around forward (Y)
 * Quaternion order: R * P * H (apply H first, then P, then R)
 */
function hprToQuat(out: quat, hpr: ReadonlyVec3): quat {
  const h = ((hpr[0] * Math.PI) / 180) * 0.5;
  const p = ((hpr[1] * Math.PI) / 180) * 0.5;
  const r = ((hpr[2] * Math.PI) / 180) * 0.5;

  // Create quaternions for each rotation
  // quat = (w, x, y, z) in Panda3D, but gl-matrix uses (x, y, z, w)
  // quat.set(c, v[0]*s, v[1]*s, v[2]*s) in Panda3D becomes:
  // gl-matrix: [v[0]*s, v[1]*s, v[2]*s, c]

  // Heading: rotation around Z (up)
  const qH = quat.fromValues(0, 0, Math.sin(h), Math.cos(h));

  // Pitch: rotation around X (right)
  const qP = quat.fromValues(Math.sin(p), 0, 0, Math.cos(p));

  // Roll: rotation around Y (forward)
  const qR = quat.fromValues(0, Math.sin(r), 0, Math.cos(r));

  // Panda3D order: quat_r * quat_p * quat_h
  quat.multiply(out, qR, qP);
  quat.multiply(out, out, qH);
  return out;
}

/**
 * Convert quaternion to HPR (heading, pitch, roll) in degrees.
 */
function quatToHpr(out: vec3, q: ReadonlyQuat): vec3 {
  // Extract rotation angles from quaternion
  // Based on Panda3D's decompose_matrix implementation
  const mat = mat4.create();
  mat4.fromQuat(mat, q);

  // Extract HPR from rotation matrix
  // Panda3D convention
  const sp = -mat[2]; // -m02 (pitch sine)

  if (sp >= 1.0 - EPSILON) {
    // Gimbal lock at +90 degrees
    out[1] = 90;
    out[0] = Math.atan2(-mat[4], mat[5]) * (180 / Math.PI); // heading
    out[2] = 0;
  } else if (sp <= -1.0 + EPSILON) {
    // Gimbal lock at -90 degrees
    out[1] = -90;
    out[0] = Math.atan2(-mat[4], mat[5]) * (180 / Math.PI);
    out[2] = 0;
  } else {
    out[1] = Math.asin(sp) * (180 / Math.PI); // pitch
    out[0] = Math.atan2(mat[1], mat[0]) * (180 / Math.PI); // heading
    out[2] = Math.atan2(mat[6], mat[10]) * (180 / Math.PI); // roll
  }

  return out;
}

/**
 * Convert Panda3D quaternion format (w, x, y, z) to gl-matrix format (x, y, z, w)
 */
function pandaQuatToGlQuat(out: quat, pandaQuat: ReadonlyVec4): quat {
  out[0] = pandaQuat[1]; // x
  out[1] = pandaQuat[2]; // y
  out[2] = pandaQuat[3]; // z
  out[3] = pandaQuat[0]; // w
  return out;
}
