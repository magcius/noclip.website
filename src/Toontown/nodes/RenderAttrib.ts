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
  /**
   * Implements the composition of two RenderAttrib instances.
   * Most of the time, the other attrib will simply override this one.
   */
  compose(other: this): this {
    return other;
  }

  /**
   * Whether this attrib can be overridden by a lower-priority attrib.
   */
  lowerAttribCanOverride(): boolean {
    return false;
  }

  public applyToMaterial(_material: MaterialData) {
    throw new Error("Not implemented");
  }
}
