import type { MaterialData } from "../Geom";
import { TypedObject } from "./TypedObject";

export enum PandaCompareFunc {
  None = 0,
  Never = 1,
  Less = 2,
  Equal = 3,
  LessEqual = 4,
  Greater = 5,
  NotEqual = 6,
  GreaterEqual = 7,
  Always = 8,
}

export class RenderAttrib extends TypedObject {
  public applyToMaterial(_material: MaterialData) {
    throw new Error("Not implemented");
  }
}
