import { type ReadonlyVec3, vec3, type vec4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import {
  BAMObject,
  type BAMObjectFactory,
  CopyContext,
  getBAMObjectFactory,
  registerBAMObject,
} from "./base";
import { ColorAttrib } from "./ColorAttrib";
import { ColorScaleAttrib } from "./ColorScaleAttrib";
import {
  type DebugInfo,
  dbgArray,
  dbgEnum,
  dbgFields,
  dbgNum,
  dbgObject,
  dbgRef,
  dbgStr,
} from "./debug";
import { BoundsType } from "./geomEnums";
import type { RenderAttrib } from "./RenderAttrib";
import { type RenderEffect, RenderEffects } from "./RenderEffects";
import { RenderState } from "./RenderState";
import { TransformState } from "./TransformState";

export class PandaNode extends BAMObject {
  public name: string = "";
  public state = new RenderState();
  public transform = new TransformState();
  public effects = new RenderEffects();
  public drawControlMask = 0;
  public drawShowMask = 0xffffffff;
  public intoCollideMask = 0;
  public boundsType = BoundsType.Default;
  public tags = new Map<string, string>();
  public parents: PandaNode[] = [];
  public children: [PandaNode, number][] = [];
  public stashed: [PandaNode, number][] = [];

  get parent(): PandaNode | null {
    return this.parents.length > 0 ? this.parents[0] : null;
  }

  addChild(child: PandaNode, sort: number = 0): void {
    child.parents.push(this);
    this.children.push([child, sort]);
    this.children.sort((a, b) => a[1] - b[1]);
  }

  removeChild(child: PandaNode): void {
    const index = this.children.findIndex(([c, _]) => c === child);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
    const parentIndex = child.parents.indexOf(this);
    if (parentIndex !== -1) {
      child.parents.splice(parentIndex, 1);
    }
  }

  reparentTo(target: PandaNode, sort: number = 0): void {
    for (const parent of this.parents.slice()) {
      parent.removeChild(this);
    }
    target.addChild(this, sort);
  }

  /**
   * Finds the first descendant matching a Panda3D-style path query.
   *
   * Query syntax:
   * - "name" - exact name match (direct child)
   * - "*" - any single node
   * - "**" - zero or more nodes (recursive search)
   * - "door_*_flat" - glob pattern with wildcards
   * - "** /name" - find "name" anywhere in subtree (no space in actual query)
   * - "+GeomNode" - match by type (includes subtypes)
   * - "-GeomNode" - match exact type only
   * - "=tagKey" - match nodes with tag
   * - "=tagKey=value" - match nodes with tag value
   * - ";+i" - flags: +i (case insensitive), +s (include stashed)
   *
   * @example
   * node.find("door_*_flat")      // direct child matching glob
   * node.find("** / *door_origin") // any descendant matching glob (no spaces)
   * node.find("** /+GeomNode")    // any GeomNode descendant (no space)
   * node.find("** /=DNACode")     // any node with DNACode tag (no space)
   */
  find(query: string): PandaNode | null {
    const results = this.findAllMatches(query, 1);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Finds all descendants matching a Panda3D-style path query.
   * See `find()` for query syntax documentation.
   *
   * @param query The path query string
   * @param maxMatches Maximum number of results (-1 for unlimited)
   */
  findAllMatches(query: string, maxMatches = -1): PandaNode[] {
    const parsed = parseQuery(query);
    const results: PandaNode[] = [];

    if (parsed.components.length === 0) {
      return results;
    }

    // Use breadth-first search with level tracking
    // Each entry: [node, componentIndex, inMatchMany]
    type SearchEntry = [PandaNode, number, boolean];
    const queue: SearchEntry[] = [];

    // Start by matching children against the first component
    const firstComponent = parsed.components[0];
    const isMatchMany = firstComponent.type === ComponentType.MatchMany;

    // Get initial children to search
    const getChildren = (
      node: PandaNode,
      component: QueryComponent | undefined,
      flags: QueryFlags,
    ): PandaNode[] => {
      const children: PandaNode[] = [];

      // Normal children (unless stashedOnly)
      if (!component?.stashedOnly) {
        for (const [child] of node.children) {
          children.push(child);
        }
      }

      // Stashed children (if flag set or stashedOnly)
      if (flags.returnStashed || component?.stashedOnly) {
        for (const [child] of node.stashed) {
          children.push(child);
        }
      }

      return children;
    };

    // Initialize queue with children of root
    for (const child of getChildren(this, firstComponent, parsed.flags)) {
      if (isMatchMany) {
        // ** matches zero nodes, so also try matching next component
        queue.push([child, 0, true]);
      } else if (matchesComponent(child, firstComponent, parsed.flags)) {
        queue.push([child, 1, false]);
      }
    }

    // BFS traversal
    while (queue.length > 0) {
      const [node, componentIdx, inMatchMany] = queue.shift()!;

      // Check if we've matched all components (found a result)
      if (componentIdx >= parsed.components.length) {
        results.push(node);
        if (maxMatches > 0 && results.length >= maxMatches) {
          return results;
        }
        continue;
      }

      const component = parsed.components[componentIdx];
      const isCurrentMatchMany = component.type === ComponentType.MatchMany;

      if (inMatchMany) {
        // We're in a ** section - try both advancing and staying
        // First, try matching against the NEXT component (advance past **)
        const nextIdx = componentIdx + 1;
        if (nextIdx < parsed.components.length) {
          const nextComponent = parsed.components[nextIdx];
          if (matchesComponent(node, nextComponent, parsed.flags)) {
            // This node matches the component after **, advance past both
            queue.push([node, nextIdx + 1, false]);
          }
        } else {
          // ** is the last component, this node matches
          results.push(node);
          if (maxMatches > 0 && results.length >= maxMatches) {
            return results;
          }
        }

        // Continue searching children (stay in ** mode)
        for (const child of getChildren(node, component, parsed.flags)) {
          queue.push([child, componentIdx, true]);
        }
      } else if (isCurrentMatchMany) {
        // Starting a new ** section
        // ** can match zero nodes, so also try matching next component on current children
        for (const child of getChildren(node, component, parsed.flags)) {
          queue.push([child, componentIdx, true]);
        }
      } else {
        // Normal component - match and advance
        const children = getChildren(node, component, parsed.flags);
        for (const child of children) {
          if (matchesComponent(child, component, parsed.flags)) {
            queue.push([child, componentIdx + 1, false]);
          }
        }
      }
    }

    return results;
  }

  /** TypeScript-friendly search by constructor type (searches entire subtree) */
  findNodeByType<T extends PandaNode>(
    type: new (...args: any[]) => T,
  ): T | null {
    // Breadth-first search
    const queue: PandaNode[] = [this];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node instanceof type) return node as T;
      for (const [child] of node.children) {
        queue.push(child);
      }
    }
    return null;
  }

  /** TypeScript-friendly search for all nodes of a constructor type */
  findAllNodesByType<T extends PandaNode>(
    type: new (...args: any[]) => T,
  ): T[] {
    const results: T[] = [];
    const queue: PandaNode[] = [this];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node instanceof type) results.push(node as T);
      for (const [child] of node.children) {
        queue.push(child);
      }
    }
    return results;
  }

  traverse(visitor: (node: PandaNode) => void): void {
    visitor(this);
    for (const [child, _] of this.children) {
      child.traverse(visitor);
    }
  }

  attachNewNode(name: string): PandaNode {
    const node = PandaNode.create(name);
    this.addChild(node);
    return node;
  }

  setAttrib(attrib: RenderAttrib, priority = 0) {
    this.state = this.state.withAttrib(attrib, priority);
  }

  setColor(color: vec4) {
    this.setAttrib(ColorAttrib.flat(color));
  }

  setColorScale(scale: vec4) {
    this.setAttrib(ColorScaleAttrib.make(scale));
  }

  setPosHprScale(pos: ReadonlyVec3, hpr: ReadonlyVec3, scale: ReadonlyVec3) {
    this.transform = TransformState.fromPosHprScale(pos, hpr, scale);
  }

  set pos(pos: ReadonlyVec3) {
    this.setPosHprScale(pos, this.transform.hpr, this.transform.scale);
  }

  set hpr(hpr: ReadonlyVec3) {
    this.setPosHprScale(this.transform.pos, hpr, this.transform.scale);
  }

  setH(h: number) {
    this.hpr = vec3.fromValues(h, this.transform.hpr[1], this.transform.hpr[2]);
  }

  set p(pitch: number) {
    this.hpr = vec3.fromValues(this.transform.hpr[0], pitch, this.transform.hpr[2]);
  }

  set scale(scale: ReadonlyVec3) {
    this.setPosHprScale(this.transform.pos, this.transform.hpr, scale);
  }

  /**
   * Returns the net (world) transform of this node by composing
   * all ancestor transforms from root to this node.
   */
  get netTransform(): TransformState {
    const parent = this.parent;
    if (!parent) {
      return this.transform;
    }
    return parent.netTransform.compose(this.transform);
  }

  setEffect(effect: RenderEffect) {
    this.effects = this.effects.withEffect(effect);
  }

  get pos(): ReadonlyVec3 {
    return this.transform.pos;
  }

  hide() {
    this.drawControlMask = 0xffffffff;
    this.drawShowMask = 0;
  }

  show(): void {
    this.drawControlMask = 0;
    this.drawShowMask = 0xffffffff;
  }

  showThrough(): void {
    this.drawControlMask |= 1 << 31;
    this.drawShowMask |= 1 << 31;
  }

  adjustDrawMask(showMask: number, hideMask: number, clearMask: number): void {
    this.drawControlMask =
      (this.drawControlMask | showMask | hideMask) & ~clearMask;
    this.drawShowMask =
      ((this.drawShowMask | showMask) & ~hideMask) |
      (~this.drawControlMask >>> 0);
  }

  hideMask(cameraMask: number): void {
    this.drawControlMask |= cameraMask;
    this.drawShowMask &= ~cameraMask;
  }

  showMask(cameraMask: number): void {
    this.drawControlMask &= ~cameraMask;
  }

  showThroughMask(cameraMask: number): void {
    this.drawControlMask |= cameraMask;
    this.drawShowMask |= cameraMask;
  }

  setName(name: string) {
    this.name = name;
  }

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.name = data.readString();

    const state = file.getTyped(data.readObjectId(), RenderState);
    if (state) this.state = state;
    const transform = file.getTyped(data.readObjectId(), TransformState);
    if (transform) this.transform = transform;
    const effects = file.getTyped(data.readObjectId(), RenderEffects);
    if (effects) this.effects = effects;

    // Draw mask handling
    if (this._version.compare(new AssetVersion(6, 2)) >= 0) {
      this.drawControlMask = data.readUint32();
      this.drawShowMask = data.readUint32();
    } else {
      let drawMask = data.readUint32();
      if (drawMask === 0) {
        this.drawControlMask = 1 << 31;
        this.drawShowMask = 0x7fffffff;
      } else if (drawMask === 0xfffffff) {
        this.drawControlMask = 0;
        this.drawShowMask = 0xffffffff;
      } else {
        drawMask &= 0x7fffffff;
        this.drawControlMask = ~drawMask & 0xffffffff;
        this.drawShowMask = drawMask;
      }
    }

    // into_collide_mask was added in BAM 6.0 (unconditional),
    // but earlier versions may have had it conditionally
    if (this._version.compare(new AssetVersion(6, 0)) >= 0) {
      this.intoCollideMask = data.readUint32();
    }

    // bounds_type added in BAM 6.19
    if (this._version.compare(new AssetVersion(6, 19)) >= 0) {
      this.boundsType = data.readUint8() as BoundsType;
    }

    // In BAM 6.0+, tags come BEFORE parents/children/stashed
    // In BAM < 6.0, tags come AFTER parents/children/stashed
    const isNewFormat = this._version.compare(new AssetVersion(6, 0)) >= 0;

    if (isNewFormat) {
      // New format: tags first
      const numTags = data.readUint32();
      for (let i = 0; i < numTags; i++) {
        const tag = data.readString();
        const value = data.readString();
        this.tags.set(tag, value);
      }
    }

    // Parents will be registered later; read the IDs for now
    const numParents = data.readUint16();
    for (let i = 0; i < numParents; i++) {
      data.readObjectId();
    }

    // Children
    const numChildren = data.readUint16();
    this.children = new Array(numChildren);
    for (let i = 0; i < numChildren; i++) {
      const ref = file.getTyped(data.readObjectId(), PandaNode);
      if (!ref) throw new Error(`Child reference @${ref} not found in file`);
      ref.parents.push(this);
      const sort = data.readUint32();
      this.children[i] = [ref, sort];
    }
    this.children.sort((a, b) => a[1] - b[1]);

    // Stashed
    const numStashed = data.readUint16();
    this.stashed = new Array(numStashed);
    for (let i = 0; i < numStashed; i++) {
      const ref = file.getTyped(data.readObjectId(), PandaNode);
      if (!ref) throw new Error(`Stashed reference @${ref} not found in file`);
      // if (ref instanceof PandaNode) ref.parents.push(this); ?
      const sort = data.readUint32();
      this.stashed[i] = [ref, sort];
    }

    // Old format: tags come after parents/children/stashed
    if (!isNewFormat && this._version.compare(new AssetVersion(4, 4)) >= 0) {
      const numTags = data.readUint32();
      for (let i = 0; i < numTags; i++) {
        const tag = data.readString();
        const value = data.readString();
        this.tags.set(tag, value);
      }
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.name = this.name;
    target.state = ctx.clone(this.state);
    target.transform = ctx.clone(this.transform);
    target.effects = ctx.clone(this.effects);
    target.drawControlMask = this.drawControlMask;
    target.drawShowMask = this.drawShowMask;
    target.intoCollideMask = this.intoCollideMask;
    target.boundsType = this.boundsType;
    target.tags = new Map(this.tags);
  }

  override clone(ctx = new CopyContext()): this {
    const target = super.clone(ctx);
    for (const [child, sort] of this.children) {
      target.addChild(ctx.clone(child), sort);
    }
    return target;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("state", dbgRef(this.state));
    info.set("transform", dbgRef(this.transform));
    info.set("effects", dbgRef(this.effects));

    if (this.drawControlMask !== 0 || this.drawShowMask !== 0xffffffff) {
      info.set("drawControlMask", dbgNum(this.drawControlMask));
      info.set("drawShowMask", dbgNum(this.drawShowMask));
    }

    if (this.intoCollideMask !== 0) {
      info.set("intoCollideMask", dbgNum(this.intoCollideMask));
    }

    if (this._version.compare(new AssetVersion(6, 19)) >= 0) {
      info.set("boundsType", dbgEnum(this.boundsType, BoundsType));
    }

    if (this.tags.size > 0) {
      const tagInfo: DebugInfo = new Map();
      for (const [key, value] of this.tags) {
        tagInfo.set(key, dbgStr(value));
      }
      info.set("tags", dbgObject(tagInfo));
    }

    if (this.children.length > 0) {
      info.set(
        "children",
        dbgArray(
          this.children.map(([ref, sort]) =>
            dbgObject(
              dbgFields([
                ["sort", dbgNum(sort)],
                ["ref", dbgRef(ref)],
              ]),
            ),
          ),
        ),
      );
    }

    if (this.stashed.length > 0) {
      info.set(
        "stashed",
        dbgArray(
          this.stashed.map(([ref, sort]) =>
            dbgObject(
              dbgFields([
                ["sort", dbgNum(sort)],
                ["ref", dbgRef(ref)],
              ]),
            ),
          ),
        ),
      );
    }

    return info;
  }

  static create(name: string): PandaNode {
    const node = new PandaNode();
    node.name = name;
    return node;
  }
}

registerBAMObject("PandaNode", PandaNode);

/**
 * Matches a string against a glob pattern with `*` and `?` wildcards.
 * - `*` matches zero or more characters
 * - `?` matches exactly one character
 */
function matchGlob(
  pattern: string,
  text: string,
  caseInsensitive = false,
): boolean {
  if (caseInsensitive) {
    pattern = pattern.toLowerCase();
    text = text.toLowerCase();
  }

  let pi = 0; // pattern index
  let ti = 0; // text index
  let starIdx = -1;
  let matchIdx = 0;

  while (ti < text.length) {
    if (
      pi < pattern.length &&
      (pattern[pi] === "?" || pattern[pi] === text[ti])
    ) {
      pi++;
      ti++;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starIdx = pi;
      matchIdx = ti;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      ti = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < pattern.length && pattern[pi] === "*") {
    pi++;
  }

  return pi === pattern.length;
}

/** Types of path components in a query */
enum ComponentType {
  MatchOne, // * - match any single node
  MatchMany, // ** - match zero or more nodes
  MatchName, // exact name match
  MatchGlob, // glob pattern (contains * or ?)
  MatchType, // +TypeName - match by type (inexact, includes subtypes)
  MatchExactType, // -TypeName - match exact type only
  MatchTag, // =tagKey - has tag
  MatchTagValue, // =tagKey=value - tag with specific value
}

interface QueryComponent {
  type: ComponentType;
  pattern?: string; // for name/glob matching
  typeName?: string; // for type matching
  typeConstructor?: BAMObjectFactory; // resolved constructor for type matching
  tagKey?: string; // for tag matching
  tagValue?: string; // for tag value matching
  stashedOnly?: boolean; // @@ prefix - only match in stashed children
}

interface QueryFlags {
  caseInsensitive: boolean;
  returnHidden: boolean;
  returnStashed: boolean;
}

interface ParsedQuery {
  components: QueryComponent[];
  flags: QueryFlags;
}

/**
 * Parses a Panda3D-style path query string.
 *
 * Syntax:
 * - Path components separated by `/`
 * - `*` matches any single node
 * - `**` matches zero or more nodes (recursive)
 * - `name` matches exact name
 * - `name*pattern` glob pattern matching
 * - `+TypeName` matches nodes of type or derived type
 * - `-TypeName` matches nodes of exact type only
 * - `=tagKey` matches nodes with tag
 * - `=tagKey=value` matches nodes with tag value
 * - `@@component` matches only in stashed children
 * - `;flags` at end: +i (case insensitive), +h (hidden), +s (stashed)
 */
function parseQuery(query: string): ParsedQuery {
  const flags: QueryFlags = {
    caseInsensitive: false,
    returnHidden: true,
    returnStashed: false,
  };

  // Extract flags from end of query
  const flagsIdx = query.indexOf(";");
  if (flagsIdx !== -1) {
    const flagStr = query.slice(flagsIdx + 1);
    query = query.slice(0, flagsIdx);

    for (let i = 0; i < flagStr.length; i++) {
      const sign = flagStr[i];
      if (sign !== "+" && sign !== "-") continue;
      const flag = flagStr[++i];
      const value = sign === "+";
      switch (flag) {
        case "i":
          flags.caseInsensitive = value;
          break;
        case "h":
          flags.returnHidden = value;
          break;
        case "s":
          flags.returnStashed = value;
          break;
      }
    }
  }

  const parts = query.split("/").filter((p) => p.length > 0);
  const components: QueryComponent[] = [];

  for (let part of parts) {
    const component: QueryComponent = { type: ComponentType.MatchName };

    // Check for @@ prefix (stashed only)
    if (part.startsWith("@@")) {
      component.stashedOnly = true;
      part = part.slice(2);
    }

    if (part === "*") {
      component.type = ComponentType.MatchOne;
    } else if (part === "**") {
      if (component.stashedOnly) {
        throw new Error("@@** is undefined; use @@*/** or **/@@* instead");
      }
      component.type = ComponentType.MatchMany;
    } else if (part.startsWith("+")) {
      component.type = ComponentType.MatchType;
      component.typeName = part.slice(1);
      component.typeConstructor = getBAMObjectFactory(component.typeName);
    } else if (part.startsWith("-")) {
      component.type = ComponentType.MatchExactType;
      component.typeName = part.slice(1);
      component.typeConstructor = getBAMObjectFactory(component.typeName);
    } else if (part.startsWith("=")) {
      const equalsIdx = part.indexOf("=", 1);
      if (equalsIdx !== -1) {
        component.type = ComponentType.MatchTagValue;
        component.tagKey = part.slice(1, equalsIdx);
        component.tagValue = part.slice(equalsIdx + 1);
      } else {
        component.type = ComponentType.MatchTag;
        component.tagKey = part.slice(1);
      }
    } else if (part.includes("*") || part.includes("?")) {
      component.type = ComponentType.MatchGlob;
      component.pattern = part;
    } else {
      component.type = ComponentType.MatchName;
      component.pattern = part;
    }

    components.push(component);
  }

  return { components, flags };
}

/** Checks if a node matches a single query component */
function matchesComponent(
  node: PandaNode,
  component: QueryComponent,
  flags: QueryFlags,
): boolean {
  switch (component.type) {
    case ComponentType.MatchOne:
    case ComponentType.MatchMany:
      return true;

    case ComponentType.MatchName:
      if (flags.caseInsensitive) {
        return node.name.toLowerCase() === component.pattern!.toLowerCase();
      }
      return node.name === component.pattern;

    case ComponentType.MatchGlob:
      return matchGlob(component.pattern!, node.name, flags.caseInsensitive);

    case ComponentType.MatchType:
      // Check by constructor name first, then by instanceof if registered
      if (node.constructor.name === component.typeName) return true;
      if (
        component.typeConstructor &&
        node instanceof component.typeConstructor
      )
        return true;
      return false;

    case ComponentType.MatchExactType:
      // Exact match by constructor name
      return node.constructor.name === component.typeName;

    case ComponentType.MatchTag:
      return node.tags.has(component.tagKey!);

    case ComponentType.MatchTagValue: {
      const value = node.tags.get(component.tagKey!);
      if (value === undefined) return false;
      if (
        component.tagValue!.includes("*") ||
        component.tagValue!.includes("?")
      ) {
        return matchGlob(component.tagValue!, value, flags.caseInsensitive);
      }
      if (flags.caseInsensitive) {
        return value.toLowerCase() === component.tagValue!.toLowerCase();
      }
      return value === component.tagValue;
    }

    default:
      return false;
  }
}
