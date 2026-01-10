import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgFields,
  dbgNum,
  dbgObject,
  dbgRef,
} from "./debug";

export interface RenderAttribEntry {
  attrib: RenderAttrib;
  priority: number;
}

export class RenderState extends BAMObject {
  public attribs: RenderAttribEntry[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    const numAttribs = data.readUint16();
    this.attribs = new Array(numAttribs);
    for (let i = 0; i < numAttribs; i++) {
      const attribRef = data.readObjectId();
      const attrib = file.getTyped(attribRef, RenderAttrib);
      if (!attrib)
        throw new Error(`RenderState: Invalid attrib ref @${attribRef}`);
      const priority = data.readInt32();
      this.attribs[i] = { attrib, priority };
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.attribs = this.attribs.map(({ attrib, priority }) => ({
      attrib: attrib.clone(),
      priority,
    }));
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
    const result = new RenderState();
    let added = false;
    for (const entry of this.attribs) {
      if (entry.attrib.constructor.name === attrib.constructor.name) {
        if (!added) {
          result.attribs.push({ attrib, priority });
        }
        added = true;
      } else {
        result.attribs.push(entry);
      }
    }
    if (!added) {
      result.attribs.push({ attrib, priority });
    }
    return result;
  }

  /**
   * Composes this RenderState with another, prioritizing the attributes of the other.
   * If an attribute is present in both states, the one with the higher priority is used.
   */
  compose(other: RenderState) {
    const result = this.clone();
    for (const entry of other.attribs) {
      const existing = result.attribs.findIndex(
        (a) => a.attrib.constructor.name === entry.attrib.constructor.name,
      );
      if (existing === -1) {
        result.attribs.push(entry);
      } else if (entry.priority >= result.attribs[existing].priority) {
        result.attribs[existing] = entry;
      }
    }
    return result;
  }
}

export class RenderAttrib extends BAMObject {}

registerBAMObject("RenderState", RenderState);
