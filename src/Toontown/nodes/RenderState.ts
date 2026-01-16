import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import {
  type DebugInfo,
  dbgArray,
  dbgFields,
  dbgNum,
  dbgObject,
  dbgRef,
} from "./debug";
import { RenderAttrib } from "./RenderAttrib";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

export interface RenderAttribEntry {
  attrib: RenderAttrib;
  priority: number;
}

export const MAX_PRIORITY = 1000000000;

interface RenderAttribConstructor<T extends RenderAttrib> {
  new (...args: any[]): T;
}

export class RenderState extends TypedObject {
  public _attribs: RenderAttribEntry[] = [];

  get attribs(): ReadonlyArray<Readonly<RenderAttribEntry>> {
    return this._attribs;
  }

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    const numAttribs = data.readUint16();
    const attribs = new Array(numAttribs);
    for (let i = 0; i < numAttribs; i++) {
      const attribRef = data.readObjectId();
      const attrib = file.getTyped(attribRef, RenderAttrib);
      if (!attrib)
        throw new Error(`RenderState: Invalid attrib ref @${attribRef}`);
      const priority = data.readInt32();
      attribs[i] = { attrib, priority };
    }
    this._attribs = attribs;
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target._attribs = this._attribs.map(
      ({ attrib, priority }): RenderAttribEntry => ({
        attrib: ctx.clone(attrib),
        priority,
      }),
    );
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set(
      "attribs",
      dbgArray(
        this.attribs.map(({ attrib, priority }) =>
          dbgObject(
            dbgFields([
              ["ref", dbgRef(attrib)],
              ["priority", dbgNum(priority)],
            ]),
            // true,
          ),
        ),
      ),
    );
    return info;
  }

  /**
   * Creates a new RenderState, appending the given attribute and priority.
   * Unconditionally overrides existing attributes of the same type, ignoring priority.
   */
  withAttrib(attrib: RenderAttrib, priority = 0) {
    const result: RenderAttribEntry[] = [];
    let added = false;
    for (const entry of this.attribs) {
      if (entry.attrib.constructor === attrib.constructor) {
        if (!added) {
          result.push({ attrib, priority });
        }
        added = true;
      } else {
        result.push(entry);
      }
    }
    if (!added) {
      result.push({ attrib, priority });
    }
    const state = new RenderState();
    state._attribs = result;
    return state;
  }

  /**
   * Composes this RenderState with another, prioritizing the attributes of the other.
   * If an attribute is present in both states, the one with the higher priority is used.
   */
  compose(other: RenderState | null) {
    if (!other || other.attribs.length === 0) return this;
    if (this.attribs.length === 0) return other;
    const result = this.attribs.slice();
    for (const entry of other.attribs) {
      const existing = result.findIndex(
        (a) => a.attrib.constructor === entry.attrib.constructor,
      );
      if (existing === -1) {
        result.push(entry);
      } else if (entry.priority >= result[existing].priority) {
        result[existing] = entry;
      }
    }
    const state = new RenderState();
    state._attribs = result;
    return state;
  }

  get<T extends RenderAttrib>(
    attribType: RenderAttribConstructor<T>,
  ): T | null {
    const entry = this.attribs.find((a) => a.attrib.constructor === attribType);
    return entry ? (entry.attrib as T) : null;
  }

  static make(priority: number, ...attribs: RenderAttrib[]): RenderState {
    const state = new RenderState();
    state._attribs = attribs.map((attrib) => ({ attrib, priority }));
    return state;
  }
}

registerTypedObject("RenderState", RenderState);
