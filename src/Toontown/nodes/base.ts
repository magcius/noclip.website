import type { BAMFile } from "../bam";
import type { AssetVersion, DataStream } from "../common";
import { type DebugInfo, dbgFields, dbgNum } from "./debug";

export type BAMObjectFactory<T extends BAMObject = BAMObject> = new (
  objectId: number,
  file: BAMFile,
  data: DataStream,
) => T;

// Central registry for BAM object factories.
// Node modules register themselves by calling registerBAMObject().
const objectFactories = new Map<string, BAMObjectFactory>();

export function registerBAMObject(
  name: string,
  factory: BAMObjectFactory,
): void {
  objectFactories.set(name, factory);
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

export class BAMObject {
  protected _version: AssetVersion;
  protected _typeName: string;

  constructor(
    public objectId: number,
    file: BAMFile,
    _data: DataStream,
  ) {
    this._version = file.header.version;
    this._typeName = file.getTypeName(this.objectId) ?? "Unknown";
  }

  /**
   * Returns structured debug information for this object.
   * Subclasses should override to include their specific fields.
   */
  getDebugInfo(): DebugInfo {
    return dbgFields([["objectId", dbgNum(this.objectId)]]);
  }

  /**
   * Returns the BAM type name for this object from the file's type registry.
   */
  getTypeName(): string {
    return this._typeName;
  }
}
