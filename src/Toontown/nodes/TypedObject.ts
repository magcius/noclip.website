import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import type { DebugInfo } from "./debug";

export type TypedObjectFactory<T extends TypedObject = TypedObject> =
  new () => T;

// Central registry for TypedObject factories.
// Node modules register themselves by calling registerTypedObject().
const objectFactories = new Map<string, TypedObjectFactory>();

export function registerTypedObject<T extends TypedObject>(
  name: string,
  factory: TypedObjectFactory<T>,
): void {
  if (objectFactories.has(name)) {
    throw new Error(`Object type "${name}" is already registered`);
  }
  objectFactories.set(name, factory as unknown as TypedObjectFactory);
}

export function getTypedObjectFactory(
  name: string,
): TypedObjectFactory | undefined {
  return objectFactories.get(name);
}

const DEFAULT_VERSION = new AssetVersion(0, 0);

export class CopyContext {
  private _objects = new Map<TypedObject, TypedObject>();

  // Overload signatures to match input nullability
  clone<T extends TypedObject>(obj: T): T;
  clone<T extends TypedObject>(obj: T | null): T | null;
  clone<T extends TypedObject>(obj: T | null): T | null {
    if (!obj) return null;
    const existing = this._objects.get(obj);
    if (existing) return existing as T;
    return obj.clone(this);
  }

  cloneArray<T extends TypedObject>(obj: T[]): T[];
  cloneArray<T extends TypedObject>(obj: (T | null)[]): (T | null)[];
  cloneArray<T extends TypedObject>(arr: T[]): T[] {
    return arr.map((item) => this.clone(item));
  }

  add<T extends TypedObject>(obj: T, clone: T) {
    this._objects.set(obj, clone);
  }

  get<T extends TypedObject>(obj: T): T | null {
    return (this._objects.get(obj) ?? null) as T | null;
  }
}

export class TypedObject {
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
): TypedObject[] {
  const refs: TypedObject[] = [];
  for (let i = 0; i < numRefs; i++) {
    const ref = data.readObjectId();
    const obj = file.getObject(ref);
    if (!obj) throw new Error(`Object reference @${ref} not found`);
    refs.push(obj);
  }
  return refs;
}

export function readTypedRefs<T extends TypedObject>(
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
