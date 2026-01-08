// Structured debug representation for BAM objects

/**
 * Types of debug values for structured representation
 */
export type DebugValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "ref"; objectId: number }
  | { type: "refs"; objectIds: number[] }
  | { type: "vec2"; value: [number, number] }
  | { type: "vec3"; value: [number, number, number] }
  | { type: "vec4"; value: [number, number, number, number] }
  | { type: "mat4"; value: number[] }
  | { type: "color"; value: [number, number, number, number] }
  | { type: "enum"; value: number; name: string }
  | { type: "flags"; value: number; names: string[] }
  | { type: "bytes"; length: number }
  | { type: "array"; items: DebugValue[]; compact?: boolean }
  | { type: "object"; fields: DebugInfo; compact?: boolean };

/**
 * A structured collection of named debug values
 */
export type DebugInfo = Map<string, DebugValue>;

/**
 * Accessor for extra debug info.
 */
export interface DebugAccessor {
  getTypeName(objectId: number): string | undefined;
}

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

export function dbgRef(objectId: number): DebugValue {
  return { type: "ref", objectId };
}

export function dbgRefs(objectIds: number[]): DebugValue {
  return { type: "refs", objectIds };
}

export function dbgVec2(value: [number, number]): DebugValue {
  return { type: "vec2", value };
}

export function dbgVec3(value: [number, number, number]): DebugValue {
  return { type: "vec3", value };
}

export function dbgVec4(value: [number, number, number, number]): DebugValue {
  return { type: "vec4", value };
}

export function dbgMat4(value: number[]): DebugValue {
  return { type: "mat4", value };
}

export function dbgColor(value: [number, number, number, number]): DebugValue {
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

function formatVec(values: number[]): string {
  return `(${values.map(formatNumber).join(", ")})`;
}

function formatMat(values: number[]): string {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      row.push(formatNumber(values[i * 4 + j]));
    }
    rows.push(`(${row.join(", ")})`);
  }
  return `[${rows.join(", ")}]`;
}

function formatColor(rgba: [number, number, number, number]): string {
  const [r, g, b, a] = rgba.map((v) => Math.round(v * 255));
  if (a === 255) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${formatNumber(rgba[3])})`;
}

function formatValueCompact(
  value: DebugValue,
  accessor?: DebugAccessor,
): string {
  switch (value.type) {
    case "string":
      return `"${value.value}"`;
    case "number":
      return formatNumber(value.value);
    case "boolean":
      return value.value ? "true" : "false";
    case "ref": {
      if (value.objectId === 0) return "null";
      const typeName = accessor?.getTypeName(value.objectId);
      return typeName
        ? `@${value.objectId} (${typeName})`
        : `@${value.objectId}`;
    }
    case "refs":
      if (value.objectIds.length === 0) return "[]";
      if (value.objectIds.length <= 4) {
        const refs = value.objectIds
          .map((id) => {
            if (id === 0) return "null";
            const typeName = accessor?.getTypeName(id);
            return typeName ? `@${id} (${typeName})` : `@${id}`;
          })
          .join(", ");
        return `[${refs}]`;
      }
      return `[${value.objectIds.length} refs]`;
    case "vec2":
    case "vec3":
    case "vec4":
      return formatVec(value.value);
    case "mat4":
      return formatMat(value.value);
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
      return `[${value.items.map((i) => formatValueCompact(i, accessor)).join(", ")}]`;
    case "object":
      return formatDebugInfoCompact(value.fields, accessor);
  }
}

function formatValue(
  value: DebugValue,
  indent: number = 0,
  accessor?: DebugAccessor,
): string {
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
      if (value.objectId === 0) return "null";
      const typeName = accessor?.getTypeName(value.objectId);
      return typeName
        ? `@${value.objectId} (${typeName})`
        : `@${value.objectId}`;
    }
    case "refs": {
      if (value.objectIds.length === 0) return "[]";
      if (value.objectIds.length <= 4) {
        const refs = value.objectIds
          .map((id) => {
            if (id === 0) return "null";
            const typeName = accessor?.getTypeName(id);
            return typeName ? `@${id} (${typeName})` : `@${id}`;
          })
          .join(", ");
        return `[${refs}]`;
      }
      return `[${value.objectIds.length} refs]`;
    }
    case "vec2":
    case "vec3":
    case "vec4":
      return formatVec(value.value);
    case "mat4":
      return formatMat(value.value);
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
        return `[${value.items.map((i) => formatValueCompact(i, accessor)).join(", ")}]`;
      }
      if (
        value.items.length <= 3 &&
        value.items.every((i) => i.type !== "object")
      ) {
        return `[${value.items.map((i) => formatValue(i, 0)).join(", ")}]`;
      }
      return `[\n${value.items.map((i) => `${pad1}${formatValue(i, indent + 1, accessor)}`).join(",\n")}\n${pad}]`;
    case "object":
      if (value.compact) {
        return formatDebugInfoCompact(value.fields, accessor);
      }
      return formatDebugInfo(value.fields, indent, accessor);
  }
}

/**
 * Format a DebugInfo map as a compact single-line string
 */
function formatDebugInfoCompact(
  info: DebugInfo,
  accessor?: DebugAccessor,
): string {
  if (info.size === 0) {
    return "{}";
  }

  const parts: string[] = [];
  for (const [key, value] of info) {
    parts.push(`${key}: ${formatValueCompact(value, accessor)}`);
  }

  return `{${parts.join(", ")}}`;
}

/**
 * Format a DebugInfo map as a readable string
 */
export function formatDebugInfo(
  info: DebugInfo,
  indent: number = 0,
  accessor?: DebugAccessor,
): string {
  const pad = "  ".repeat(indent);
  const pad1 = "  ".repeat(indent + 1);

  if (info.size === 0) {
    return "{}";
  }

  const lines: string[] = ["{"];
  for (const [key, value] of info) {
    const formattedValue = formatValue(value, indent + 1, accessor);
    lines.push(`${pad1}${key}: ${formattedValue}`);
  }
  lines.push(`${pad}}`);

  return lines.join("\n");
}
