import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import type { DebugInfo } from "./debug";

export type BAMObjectFactory<T extends BAMObject = BAMObject> = new () => T;

// Central registry for BAM object factories.
// Node modules register themselves by calling registerBAMObject().
const objectFactories = new Map<string, BAMObjectFactory>();

export function registerBAMObject<T extends BAMObject>(
  name: string,
  factory: BAMObjectFactory<T>,
): void {
  if (objectFactories.has(name)) {
    throw new Error(`Object type "${name}" is already registered`);
  }
  objectFactories.set(name, factory as unknown as BAMObjectFactory);
}

export function registerBAMObjectAlias(
  name: string,
  aliasTarget: string,
): void {
  const factory = objectFactories.get(aliasTarget);
  if (!factory) {
    throw new Error(
      `Cannot create alias "${name}": target "${aliasTarget}" not registered`,
    );
  }
  objectFactories.set(name, factory);
}

export function getBAMObjectFactory(
  name: string,
): BAMObjectFactory | undefined {
  return objectFactories.get(name);
}

const DEFAULT_VERSION = new AssetVersion(0, 0);

export class CopyContext {
  private _objects = new Map<BAMObject, BAMObject>();

  // Overload signatures to match input nullability
  clone<T extends BAMObject>(obj: T): T;
  clone<T extends BAMObject>(obj: T | null): T | null;
  clone<T extends BAMObject>(obj: T | null): T | null {
    if (!obj) return null;
    const existing = this._objects.get(obj);
    if (existing) return existing as T;
    return obj.clone(this);
  }

  cloneArray<T extends BAMObject>(arr: T[]): T[] {
    return arr.map((item) => this.clone(item));
  }

  add<T extends BAMObject>(obj: T, clone: T) {
    this._objects.set(obj, clone);
  }

  get<T extends BAMObject>(obj: T): T | null {
    return (this._objects.get(obj) ?? null) as T | null;
  }
}

export class BAMObject {
  protected _version = DEFAULT_VERSION;

  load(file: BAMFile, _data: DataStream) {
    this._version = file.header.version;
  }

  copyTo(target: this, _ctx: CopyContext) {
    target._version = this._version;
  }

  clone(ctx = new CopyContext()): this {
    const target = new (this.constructor as new () => this)();
    ctx.add(this, target);
    this.copyTo(target, ctx);
    return target;
  }

  /**
   * Returns structured debug information for this object.
   * Subclasses should override to include their specific fields.
   */
  getDebugInfo(): DebugInfo {
    return new Map();
  }
}

export function readObjectRefs(
  file: BAMFile,
  data: DataStream,
  numRefs: number,
): BAMObject[] {
  const refs: BAMObject[] = [];
  for (let i = 0; i < numRefs; i++) {
    const ref = data.readObjectId();
    const obj = file.getObject(ref);
    if (!obj) throw new Error(`Object reference @${ref} not found`);
    refs.push(obj);
  }
  return refs;
}

export function readTypedRefs<T extends BAMObject>(
  file: BAMFile,
  data: DataStream,
  numRefs: number,
  clazz: new (...args: any[]) => T,
): T[] {
  const refs: T[] = [];
  for (let i = 0; i < numRefs; i++) {
    const ref = data.readObjectId();
    const obj = file.getTyped(ref, clazz);
    if (!obj) throw new Error(`Object reference @${ref} not found`);
    refs.push(obj);
  }
  return refs;
}
