import { type mat4, vec2, vec3 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import { CollisionSolid } from "./CollisionSolid";
import {
  type DebugInfo,
  dbgArray,
  dbgMat4,
  dbgNum,
  dbgObject,
  dbgTypedArray,
  dbgVec2,
  dbgVec3,
} from "./debug";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export class PointDef {
  public p = vec2.create();
  public v = vec2.create();

  load(data: DataStream) {
    this.p = data.readVec2();
    this.v = data.readVec2();
  }

  getDebugInfo(): DebugInfo {
    const info: DebugInfo = new Map();
    info.set("p", dbgVec2(this.p));
    info.set("v", dbgVec2(this.v));
    return info;
  }
}

export class CollisionBox extends CollisionSolid {
  public center = vec3.create();
  public min = vec3.create();
  public max = vec3.create();
  public vertices: Float32Array = new Float32Array(0);
  public radius = 0;
  public x = 0;
  public y = 0;
  public z = 0;
  public planes: Float32Array = new Float32Array(0);
  public to2dMatrices: mat4[] = new Array(6);
  public points: PointDef[][] = new Array(6);

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.center = data.readVec3();
    this.min = data.readVec3();
    this.max = data.readVec3();
    this.vertices = data.readFloat32Array(8 * 3);

    this.radius = data.readFloat32();
    this.x = data.readFloat32();
    this.y = data.readFloat32();
    this.z = data.readFloat32();

    this.planes = data.readFloat32Array(6 * 4);

    // this.to2dMatrices = new Array(6);
    for (let i = 0; i < 6; i++) {
      this.to2dMatrices[i] = data.readMat4();
    }

    // this.points = new Array(6);
    for (let i = 0; i < 6; i++) {
      const size = data.readUint16();
      this.points[i] = new Array(size);
      for (let j = 0; j < size; j++) {
        const point = new PointDef();
        point.load(data);
        this.points[i][j] = point;
      }
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    vec3.copy(target.center, this.center);
    vec3.copy(target.min, this.min);
    vec3.copy(target.max, this.max);
    target.radius = this.radius;
    target.x = this.x;
    target.y = this.y;
    target.z = this.z;
    target.vertices = this.vertices;
    target.planes = this.planes;
    target.to2dMatrices = this.to2dMatrices;
    target.points = this.points;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("center", dbgVec3(this.center));
    info.set("min", dbgVec3(this.min));
    info.set("max", dbgVec3(this.max));
    info.set("vertices", dbgTypedArray(this.vertices, 3));
    info.set("radius", dbgNum(this.radius));
    info.set("x", dbgNum(this.x));
    info.set("y", dbgNum(this.y));
    info.set("z", dbgNum(this.z));
    info.set("planes", dbgTypedArray(this.planes, 4));
    info.set("to2dMatrices", dbgArray(this.to2dMatrices.map(dbgMat4)));
    info.set(
      "points",
      dbgArray(
        this.points.map((pointArray) =>
          dbgArray(pointArray.map((point) => dbgObject(point.getDebugInfo()))),
        ),
      ),
    );
    return info;
  }
}

registerTypedObject("CollisionBox", CollisionBox);
