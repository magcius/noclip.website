// Structured debug representation for BAM objects

import type {
  ReadonlyMat4,
  ReadonlyVec2,
  ReadonlyVec3,
  ReadonlyVec4,
} from "gl-matrix";
import type { BAMObject } from "./base";

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/**
 * Types of debug values for structured representation
 */
export type DebugValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "ref"; obj: BAMObject | null }
  | { type: "refs"; objs: (BAMObject | null)[] }
  | { type: "vec2"; value: ReadonlyVec2 }
  | { type: "vec3"; value: ReadonlyVec3 }
  | { type: "vec4"; value: ReadonlyVec4 }
  | { type: "mat4"; value: ReadonlyMat4 }
  | { type: "color"; value: ReadonlyVec4 }
  | { type: "enum"; value: number; name: string }
  | { type: "flags"; value: number; names: string[] }
  | { type: "bytes"; length: number }
  | { type: "array"; items: DebugValue[]; compact?: boolean }
  | { type: "typedArray"; value: TypedArray; components?: number }
  | { type: "object"; fields: DebugInfo; compact?: boolean };

/**
 * A structured collection of named debug values
 */
export type DebugInfo = Map<string, DebugValue>;

// Helper functions to create DebugValue instances

export function dbgStr(value: string): DebugValue {
  return { type: "string", value };
}

export function dbgNum(value: number): DebugValue {
  return { type: "number", value };
}

export function dbgBool(value: boolean): DebugValue {
  return { type: "boolean", value };
}

export function dbgRef(obj: BAMObject | null): DebugValue {
  return { type: "ref", obj };
}

export function dbgRefs(objs: (BAMObject | null)[]): DebugValue {
  return { type: "refs", objs };
}

export function dbgVec2(value: ReadonlyVec2): DebugValue {
  return { type: "vec2", value };
}

export function dbgVec3(value: ReadonlyVec3): DebugValue {
  return { type: "vec3", value };
}

export function dbgTypedArray(
  value: TypedArray,
  components?: number,
): DebugValue {
  return { type: "typedArray", value, components: components };
}

export function dbgVec4(value: ReadonlyVec4): DebugValue {
  return { type: "vec4", value };
}

export function dbgMat4(value: ReadonlyMat4): DebugValue {
  return { type: "mat4", value };
}

export function dbgColor(value: ReadonlyVec4): DebugValue {
  return { type: "color", value };
}

export function dbgEnum<T extends number>(
  value: T,
  enumObj: Record<string, unknown>,
): DebugValue {
  const name = enumObj[value] as string | undefined;
  return { type: "enum", value, name: name ?? `Unknown(${value})` };
}

export function dbgFlags(
  value: number,
  flagDefs: Record<string, number>,
): DebugValue {
  const names: string[] = [];
  for (const [name, bit] of Object.entries(flagDefs)) {
    if (value & bit) {
      names.push(name);
    }
  }
  return { type: "flags", value, names };
}

export function dbgBytes(length: number): DebugValue {
  return { type: "bytes", length };
}

export function dbgArray(items: DebugValue[], compact?: boolean): DebugValue {
  return { type: "array", items, compact };
}

export function dbgObject(fields: DebugInfo, compact?: boolean): DebugValue {
  return { type: "object", fields, compact };
}

export function dbgFields(entries: [string, DebugValue][]): DebugInfo {
  return new Map(entries);
}

// Formatting functions for console output

function formatNumber(n: number): string {
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function formatVec(values: ReadonlyVec2 | ReadonlyVec3 | ReadonlyVec4): string {
  return `(${Array.from(values, formatNumber).join(", ")})`;
}

function formatMat(values: ReadonlyMat4, pad: string, pad1: string): string {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      row.push(formatNumber(values[i * 4 + j]));
    }
    rows.push(`${pad1}(${row.join(", ")})`);
  }
  return `[\n${rows.join(",\n")}\n${pad}]`;
}

function formatColor(rgba: ReadonlyVec4): string {
  const [r, g, b, a] = rgba.map((v) => Math.round(v * 255));
  if (a === 255) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${formatNumber(rgba[3])})`;
}

function formatValueCompact(value: DebugValue): string {
  switch (value.type) {
    case "string":
      return `"${value.value}"`;
    case "number":
      return formatNumber(value.value);
    case "boolean":
      return value.value ? "true" : "false";
    case "ref":
      if (value.obj === null) return "null";
      return `[${value.obj.constructor.name}]`;
    case "refs":
      if (value.objs.length === 0) return "[]";
      if (value.objs.length <= 4) {
        const refs = value.objs
          .map((obj) => {
            if (obj === null) return "null";
            return `[${obj.constructor.name}]`;
          })
          .join(", ");
        return `[${refs}]`;
      }
      return `[${value.objs.length} refs]`;
    case "vec2":
    case "vec3":
    case "vec4":
      return formatVec(value.value);
    case "mat4":
      return formatMat(value.value, "", "");
    case "color":
      return formatColor(value.value);
    case "enum":
      return value.name;
    case "flags":
      if (value.names.length === 0) return "0";
      return value.names.join(" | ");
    case "bytes":
      return `<${value.length} bytes>`;
    case "array":
      if (value.items.length === 0) return "[]";
      return `[${value.items.map((i) => formatValueCompact(i)).join(", ")}]`;
    case "typedArray":
      return `<${value.value.length / (value.components || 1)} items>`;
    case "object":
      return formatDebugInfoCompact(value.fields);
  }
}

function formatValue(value: DebugValue, indent: number = 0): string {
  const pad = "  ".repeat(indent);
  const pad1 = "  ".repeat(indent + 1);

  switch (value.type) {
    case "string":
      return `"${value.value}"`;
    case "number":
      return formatNumber(value.value);
    case "boolean":
      return value.value ? "true" : "false";
    case "ref": {
      if (value.obj === null) return "null";
      return `${value.obj.constructor.name} ${formatDebugInfo(value.obj.getDebugInfo(), indent)}`;
    }
    case "refs": {
      if (value.objs.length === 0) return "[]";
      const refs = value.objs
        .map((obj) => {
          if (obj === null) return "null";
          return `${obj.constructor.name} ${formatDebugInfo(obj.getDebugInfo(), indent)}`;
        })
        .join(", ");
      return `[${refs}]`;
    }
    case "vec2":
    case "vec3":
    case "vec4":
      return formatVec(value.value);
    case "mat4":
      return formatMat(value.value, pad, pad1);
    case "color":
      return formatColor(value.value);
    case "enum":
      return value.name;
    case "flags":
      if (value.names.length === 0) return "0";
      return value.names.join(" | ");
    case "bytes":
      return `<${value.length} bytes>`;
    case "array":
      if (value.items.length === 0) return "[]";
      if (value.compact) {
        return `[${value.items.map((i) => formatValueCompact(i)).join(", ")}]`;
      }
      if (
        value.items.length <= 3 &&
        value.items.every((i) => i.type !== "object")
      ) {
        return `[${value.items.map((i) => formatValue(i, 0)).join(", ")}]`;
      }
      return `[\n${value.items.map((i) => `${pad1}${formatValue(i, indent + 1)}`).join(",\n")}\n${pad}]`;
    case "typedArray":
      return `<${value.value.length / (value.components || 1)} items>`;
    case "object":
      if (value.compact) {
        return formatDebugInfoCompact(value.fields);
      }
      return formatDebugInfo(value.fields, indent);
  }
}

/**
 * Format a DebugInfo map as a compact single-line string
 */
function formatDebugInfoCompact(info: DebugInfo): string {
  if (info.size === 0) {
    return "{}";
  }

  const parts: string[] = [];
  for (const [key, value] of info) {
    parts.push(`${key}: ${formatValueCompact(value)}`);
  }

  return `{${parts.join(", ")}}`;
}

/**
 * Format a DebugInfo map as a readable string
 */
export function formatDebugInfo(info: DebugInfo, indent: number = 0): string {
  const pad = "  ".repeat(indent);
  const pad1 = "  ".repeat(indent + 1);

  if (info.size === 0) {
    return "{}";
  }

  const lines: string[] = ["{"];
  for (const [key, value] of info) {
    const formattedValue = formatValue(value, indent + 1);
    lines.push(`${pad1}${key}: ${formattedValue}`);
  }
  lines.push(`${pad}}`);

  return lines.join("\n");
}
