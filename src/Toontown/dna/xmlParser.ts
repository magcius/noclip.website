// DNA XML parser for Toontown Rewritten files

import { vec3, vec4 } from "gl-matrix";
import {
  type BattleCell,
  type DNAAnimBuilding,
  type DNAAnimProp,
  type DNABaseline,
  type DNACornice,
  type DNADoor,
  type DNAFile,
  type DNAFlatBuilding,
  type DNAFlatDoor,
  type DNAGroup,
  type DNAInteractiveProp,
  type DNALandmarkBuilding,
  type DNANode,
  type DNANodeDef,
  type DNANodeTransform,
  type DNAProp,
  type DNASign,
  type DNASignGraphic,
  type DNASignText,
  type DNAStreet,
  type DNAVisGroup,
  type DNAWall,
  type DNAWindows,
  type ModelDeclaration,
  type StoredFont,
  type StoredNode,
  type StoredTexture,
  type SuitEdge,
  type SuitPoint,
  SuitPointType,
} from "./types";

const TEXT_NODE_TYPE = 3;
const ELEMENT_NODE_TYPE = 1;

function getElementChildren(element: Element): Element[] {
  const children: Element[] = [];
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === ELEMENT_NODE_TYPE) {
      children.push(node as Element);
    }
  }
  return children;
}

function getAttributeNumber(
  element: Element,
  name: string,
): number | undefined {
  const value = element.getAttribute(name);
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseNumber(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseVec3Element(
  element: Element,
  xName: string,
  yName: string,
  zName: string,
): vec3 {
  const x = parseNumber(element.getAttribute(xName), 0);
  const y = parseNumber(element.getAttribute(yName), 0);
  const z = parseNumber(element.getAttribute(zName), 0);
  return vec3.fromValues(x, y, z);
}

function parseColorElement(element: Element): vec4 {
  const r = parseNumber(element.getAttribute("r"), 1);
  const g = parseNumber(element.getAttribute("g"), 1);
  const b = parseNumber(element.getAttribute("b"), 1);
  const a = parseNumber(element.getAttribute("a"), 1);
  return vec4.fromValues(r, g, b, a);
}

function parseTransformChild(node: DNANodeTransform, child: Element): boolean {
  const tag = child.tagName.toLowerCase();
  switch (tag) {
    case "pos":
      node.pos = parseVec3Element(child, "x", "y", "z");
      return true;
    case "hpr":
    case "nhpr":
      node.hpr = parseVec3Element(child, "h", "p", "r");
      return true;
    case "scale":
      node.scale = parseVec3Element(child, "x", "y", "z");
      return true;
    default:
      return false;
  }
}

function getDirectText(element: Element): string {
  let result = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === TEXT_NODE_TYPE) {
      result += node.nodeValue ?? "";
    }
  }
  return result.replace(/\r\n/g, "\n");
}

function getTrimmedText(element: Element): string {
  return (element.textContent ?? "").trim();
}

function getNodeName(element: Element): string {
  return (
    element.getAttribute("name") ??
    element.getAttribute("id") ??
    element.getAttribute("zone") ??
    ""
  );
}

function parseSuitPointType(value: string | null): SuitPointType {
  if (!value) return SuitPointType.STREET_POINT;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) return numeric as SuitPointType;
  switch (value.toUpperCase()) {
    case "STREET_POINT":
      return SuitPointType.STREET_POINT;
    case "FRONT_DOOR_POINT":
      return SuitPointType.FRONT_DOOR_POINT;
    case "SIDE_DOOR_POINT":
      return SuitPointType.SIDE_DOOR_POINT;
    case "COGHQ_IN_POINT":
      return SuitPointType.COGHQ_IN_POINT;
    case "COGHQ_OUT_POINT":
      return SuitPointType.COGHQ_OUT_POINT;
    default:
      return SuitPointType.STREET_POINT;
  }
}

function parseSuitPoint(element: Element): SuitPoint {
  const index = getAttributeNumber(element, "id") ?? 0;
  const type = parseSuitPointType(element.getAttribute("type"));
  const x = parseNumber(element.getAttribute("x"), 0);
  const y = parseNumber(element.getAttribute("y"), 0);
  const z = parseNumber(element.getAttribute("z"), 0);
  const pos = vec3.fromValues(x, y, z);
  const building = getAttributeNumber(element, "building");
  if (building !== undefined) {
    return { index, type, pos, landmarkBuildingIndex: building };
  }
  return { index, type, pos };
}

function parseModel(element: Element): ModelDeclaration {
  const path = element.getAttribute("path") ?? "";
  const scope = element.getAttribute("scope");
  const type: ModelDeclaration["type"] =
    scope === "hood"
      ? "hood_model"
      : scope === "place"
        ? "place_model"
        : "model";

  const nodes: StoredNode[] = [];
  for (const child of getElementChildren(element)) {
    if (child.tagName.toLowerCase() === "store_node") {
      nodes.push(parseStoreNode(child));
    }
  }

  return { path, type, nodes };
}

function parseStoreNode(element: Element): StoredNode {
  const category = element.getAttribute("root") ?? "";
  const code = element.getAttribute("code") ?? "";
  const nodeName = element.getAttribute("node") ?? undefined;
  return { category, code, nodeName };
}

function parseStoreTexture(element: Element): StoredTexture {
  const category = element.getAttribute("root") ?? "";
  const code = element.getAttribute("code") ?? "";
  const filename = element.getAttribute("path") ?? "";
  return { category, code, filename };
}

function parseStoreFont(element: Element): StoredFont {
  const category = element.getAttribute("root") ?? "";
  const code = element.getAttribute("code") ?? "";
  const filename = element.getAttribute("path") ?? "";
  return { category, code, filename };
}

function parseBattleCell(element: Element): BattleCell {
  const width = getAttributeNumber(element, "width") ?? 0;
  const height = getAttributeNumber(element, "height") ?? 0;
  const x = parseNumber(element.getAttribute("x"), 0);
  const y = parseNumber(element.getAttribute("y"), 0);
  const z = parseNumber(element.getAttribute("z"), 0);
  return { width, height, pos: vec3.fromValues(x, y, z) };
}

function parseSuitEdge(element: Element, zoneId: string): SuitEdge {
  const startPointIndex = getAttributeNumber(element, "a") ?? 0;
  const endPointIndex = getAttributeNumber(element, "b") ?? 0;
  return { startPointIndex, endPointIndex, zoneId };
}

function parseGroup(element: Element): DNAGroup {
  const name = getNodeName(element);
  const children: DNANode[] = [];

  for (const child of getElementChildren(element)) {
    const node = parseNode(child);
    if (node) {
      children.push(node);
    }
  }

  return { type: "group", name, children };
}

function parseVisGroup(element: Element): DNAVisGroup {
  const name = element.getAttribute("zone") ?? getNodeName(element);
  const visValue = element.getAttribute("vis") ?? "";
  const visibles =
    visValue.trim().length > 0 ? visValue.trim().split(/\s+/) : [];
  const suitEdges: SuitEdge[] = [];
  const battleCells: BattleCell[] = [];
  const children: DNANode[] = [];

  for (const child of getElementChildren(element)) {
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "suit_edge":
        suitEdges.push(parseSuitEdge(child, name));
        break;
      case "battle_cell":
        battleCells.push(parseBattleCell(child));
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          children.push(node);
        }
        break;
      }
    }
  }

  return { type: "visgroup", name, children, visibles, suitEdges, battleCells };
}

function parseNodeDef(element: Element): DNANodeDef {
  const name = getNodeName(element);
  const node: DNANodeDef = { type: "node", name, children: [] };

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(node, child)) continue;
    const childNode = parseNode(child);
    if (childNode) {
      node.children.push(childNode);
    }
  }

  return node;
}

function parseProp(element: Element): DNAProp {
  const name = getNodeName(element);
  const prop: DNAProp = {
    type: "prop",
    name,
    code: element.getAttribute("code") ?? "",
    children: [],
  };

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(prop, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        prop.color = parseColorElement(child);
        break;
      case "code":
        prop.code = getTrimmedText(child);
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          prop.children.push(node);
        }
        break;
      }
    }
  }

  return prop;
}

function parseAnimProp(element: Element): DNAAnimProp {
  const name = getNodeName(element);
  const prop: DNAAnimProp = {
    type: "anim_prop",
    name,
    code: element.getAttribute("code") ?? "",
    anim: element.getAttribute("anim") ?? "",
    children: [],
  };

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(prop, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        prop.color = parseColorElement(child);
        break;
      case "code":
        prop.code = getTrimmedText(child);
        break;
      case "anim":
        prop.anim = getTrimmedText(child);
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          prop.children.push(node);
        }
        break;
      }
    }
  }

  return prop;
}

function parseInteractiveProp(element: Element): DNAInteractiveProp {
  const name = getNodeName(element);
  const cellId =
    getAttributeNumber(element, "cell_id") ??
    getAttributeNumber(element, "cellId") ??
    0;
  const prop: DNAInteractiveProp = {
    type: "interactive_prop",
    name,
    code: element.getAttribute("code") ?? "",
    anim: element.getAttribute("anim") ?? "",
    cellId,
    children: [],
  };

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(prop, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        prop.color = parseColorElement(child);
        break;
      case "code":
        prop.code = getTrimmedText(child);
        break;
      case "anim":
        prop.anim = getTrimmedText(child);
        break;
      case "cell_id":
        prop.cellId = Number(getTrimmedText(child)) || 0;
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          prop.children.push(node);
        }
        break;
      }
    }
  }

  return prop;
}

function parseStreet(element: Element): DNAStreet {
  const name = getNodeName(element);
  const street: DNAStreet = {
    type: "street",
    name,
    code: element.getAttribute("code") ?? "",
    streetTexture: "",
    sidewalkTexture: "",
    children: [],
  };

  const textures: string[] = [];
  const colors: vec4[] = [];

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(street, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "texture":
        textures.push(getTrimmedText(child));
        break;
      case "color":
        colors.push(parseColorElement(child));
        break;
      case "code":
        street.code = getTrimmedText(child);
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          street.children.push(node);
        }
        break;
      }
    }
  }

  if (textures.length > 0) street.streetTexture = textures[0];
  if (textures.length > 1) street.sidewalkTexture = textures[1];
  if (textures.length > 2) street.curbTexture = textures[2];

  if (colors.length > 0) street.streetColor = colors[0];
  if (colors.length > 1) street.sidewalkColor = colors[1];
  if (colors.length > 2) street.curbColor = colors[2];

  return street;
}

function parseFlatBuilding(element: Element): DNAFlatBuilding {
  const name = getNodeName(element);
  const width =
    getAttributeNumber(element, "width") ??
    getAttributeNumber(element, "w") ??
    0;
  const building: DNAFlatBuilding = {
    type: "flat_building",
    name,
    width,
    walls: [],
    children: [],
  };

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(building, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "wall":
        building.walls.push(parseWall(child));
        break;
      case "width":
        building.width = Number(getTrimmedText(child)) || building.width;
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          building.children.push(node);
        }
        break;
      }
    }
  }

  return building;
}

function parseWall(element: Element): DNAWall {
  const wall: DNAWall = {
    type: "wall",
    name: "",
    height: getAttributeNumber(element, "height") ?? 0,
    code: element.getAttribute("code") ?? "",
    color: vec4.fromValues(1, 1, 1, 1),
    children: [],
  };

  for (const child of getElementChildren(element)) {
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        wall.color = parseColorElement(child);
        break;
      case "windows":
        wall.windows = parseWindows(child);
        break;
      case "cornice":
        wall.cornice = parseCornice(child);
        break;
      case "code":
        wall.code = getTrimmedText(child);
        break;
      case "height":
        wall.height = Number(getTrimmedText(child)) || wall.height;
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          wall.children.push(node);
        }
        break;
      }
    }
  }

  return wall;
}

function parseWindows(element: Element): DNAWindows {
  const windows: DNAWindows = {
    type: "windows",
    code: element.getAttribute("code") ?? "",
    color: vec4.fromValues(1, 1, 1, 1),
    count: getAttributeNumber(element, "count") ?? 1,
  };

  for (const child of getElementChildren(element)) {
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        windows.color = parseColorElement(child);
        break;
      case "code":
        windows.code = getTrimmedText(child);
        break;
      case "count":
        windows.count = Number(getTrimmedText(child)) || windows.count;
        break;
      default:
        break;
    }
  }

  return windows;
}

function parseCornice(element: Element): DNACornice {
  const cornice: DNACornice = {
    type: "cornice",
    code: element.getAttribute("code") ?? "",
    color: vec4.fromValues(1, 1, 1, 1),
  };

  for (const child of getElementChildren(element)) {
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        cornice.color = parseColorElement(child);
        break;
      case "code":
        cornice.code = getTrimmedText(child);
        break;
      default:
        break;
    }
  }

  return cornice;
}

function parseDoor(element: Element): DNADoor {
  const door: DNADoor = {
    type: "door",
    name: "",
    code: element.getAttribute("code") ?? "",
    color: vec4.fromValues(1, 1, 1, 1),
    children: [],
  };

  for (const child of getElementChildren(element)) {
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        door.color = parseColorElement(child);
        break;
      case "code":
        door.code = getTrimmedText(child);
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          door.children.push(node);
        }
        break;
      }
    }
  }

  return door;
}

function parseFlatDoor(element: Element): DNAFlatDoor {
  const door: DNAFlatDoor = {
    type: "flat_door",
    name: "",
    code: element.getAttribute("code") ?? "",
    color: vec4.fromValues(1, 1, 1, 1),
    children: [],
  };

  for (const child of getElementChildren(element)) {
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        door.color = parseColorElement(child);
        break;
      case "code":
        door.code = getTrimmedText(child);
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          door.children.push(node);
        }
        break;
      }
    }
  }

  return door;
}

function parseLandmarkBuilding(element: Element): DNALandmarkBuilding {
  const name = getNodeName(element);
  const building: DNALandmarkBuilding = {
    type: "landmark_building",
    name,
    code: element.getAttribute("code") ?? "",
    title: "",
    children: [],
  };

  const buildingType = element.getAttribute("type");
  if (buildingType) building.buildingType = buildingType;

  const article = element.getAttribute("article");
  if (article) building.article = article;

  const titleAttr = element.getAttribute("title");
  if (titleAttr) building.title = titleAttr;

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(building, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        building.wallColor = parseColorElement(child);
        break;
      case "title":
        building.title = getTrimmedText(child);
        break;
      case "article":
        building.article = getTrimmedText(child);
        break;
      case "building_type":
        building.buildingType = getTrimmedText(child);
        break;
      case "code":
        building.code = getTrimmedText(child);
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          building.children.push(node);
        }
        break;
      }
    }
  }

  return building;
}

function parseAnimBuilding(element: Element): DNAAnimBuilding {
  const name = getNodeName(element);
  const building: DNAAnimBuilding = {
    type: "anim_building",
    name,
    code: element.getAttribute("code") ?? "",
    title: "",
    anim: element.getAttribute("anim") ?? "",
    children: [],
  };

  const buildingType = element.getAttribute("type");
  if (buildingType) building.buildingType = buildingType;

  const article = element.getAttribute("article");
  if (article) building.article = article;

  const titleAttr = element.getAttribute("title");
  if (titleAttr) building.title = titleAttr;

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(building, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        building.wallColor = parseColorElement(child);
        break;
      case "title":
        building.title = getTrimmedText(child);
        break;
      case "article":
        building.article = getTrimmedText(child);
        break;
      case "building_type":
        building.buildingType = getTrimmedText(child);
        break;
      case "anim":
        building.anim = getTrimmedText(child);
        break;
      case "code":
        building.code = getTrimmedText(child);
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          building.children.push(node);
        }
        break;
      }
    }
  }

  return building;
}

function parseSign(element: Element): DNASign {
  const sign: DNASign = {
    type: "sign",
    name: "",
    baselines: [],
    children: [],
  };

  const code = element.getAttribute("code");
  if (code) sign.code = code;

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(sign, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        sign.color = parseColorElement(child);
        break;
      case "baseline":
        sign.baselines.push(parseBaseline(child));
        break;
      case "code":
        sign.code = getTrimmedText(child);
        break;
      default: {
        const node = parseNode(child);
        if (node) {
          sign.children.push(node);
        }
        break;
      }
    }
  }

  return sign;
}

function parseBaseline(element: Element): DNABaseline {
  const baseline: DNABaseline = {
    type: "baseline",
    items: [],
  };

  const code = element.getAttribute("code");
  if (code) baseline.code = code;

  const flags = element.getAttribute("flags");
  if (flags !== null) baseline.flags = flags;

  const width = getAttributeNumber(element, "width");
  if (width !== undefined) baseline.width = width;

  const height = getAttributeNumber(element, "height");
  if (height !== undefined) baseline.height = height;

  const indent = getAttributeNumber(element, "indent");
  if (indent !== undefined) baseline.indent = indent;

  const kern = getAttributeNumber(element, "kern");
  if (kern !== undefined) baseline.kern = kern;

  const wiggle = getAttributeNumber(element, "wiggle");
  if (wiggle !== undefined) baseline.wiggle = wiggle;

  const stumble = getAttributeNumber(element, "stumble");
  if (stumble !== undefined) baseline.stumble = stumble;

  const stomp = getAttributeNumber(element, "stomp");
  if (stomp !== undefined) baseline.stomp = stomp;

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(baseline, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        baseline.color = parseColorElement(child);
        break;
      case "text":
        baseline.items.push(...parseSignText(child));
        break;
      case "graphic":
        baseline.items.push(parseSignGraphic(child));
        break;
      case "code":
        baseline.code = getTrimmedText(child);
        break;
      case "flags":
        baseline.flags = getTrimmedText(child);
        break;
      case "width":
        baseline.width = Number(getTrimmedText(child)) || baseline.width;
        break;
      case "height":
        baseline.height = Number(getTrimmedText(child)) || baseline.height;
        break;
      case "indent":
        baseline.indent = Number(getTrimmedText(child)) || baseline.indent;
        break;
      case "kern":
        baseline.kern = Number(getTrimmedText(child)) || baseline.kern;
        break;
      case "wiggle":
        baseline.wiggle = Number(getTrimmedText(child)) || baseline.wiggle;
        break;
      case "stumble":
        baseline.stumble = Number(getTrimmedText(child)) || baseline.stumble;
        break;
      case "stomp":
        baseline.stomp = Number(getTrimmedText(child)) || baseline.stomp;
        break;
      default:
        console.warn(`Unknown baseline child: ${child.tagName}`);
        break;
    }
  }

  return baseline;
}

function parseSignText(element: Element): DNASignText[] {
  const text: DNASignText = {
    type: "text",
    letters: "",
  };

  const lettersAttr = element.getAttribute("letters");
  if (lettersAttr !== null) {
    text.letters = lettersAttr;
  }

  const code = element.getAttribute("code");
  if (code) text.code = code;

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(text, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        text.color = parseColorElement(child);
        break;
      case "letters":
        text.letters = getTrimmedText(child);
        break;
      case "code":
        text.code = getTrimmedText(child);
        break;
      default:
        console.warn(`Unknown sign child: ${child.tagName}`);
        break;
    }
  }

  if (!text.letters) {
    const raw = getDirectText(element);
    if (raw.trim().length > 0) {
      text.letters = raw;
    }
  }

  // Split into individual text elements per letter
  return text.letters.split("").map((letter) => ({ ...text, letters: letter }));
}

function parseSignGraphic(element: Element): DNASignGraphic {
  const graphic: DNASignGraphic = {
    type: "graphic",
    code: element.getAttribute("code") ?? "",
  };

  const width = getAttributeNumber(element, "width");
  if (width !== undefined) graphic.width = width;

  const height = getAttributeNumber(element, "height");
  if (height !== undefined) graphic.height = height;

  for (const child of getElementChildren(element)) {
    if (parseTransformChild(graphic, child)) continue;
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "color":
        graphic.color = parseColorElement(child);
        break;
      case "width":
        graphic.width = Number(getTrimmedText(child)) || graphic.width;
        break;
      case "height":
        graphic.height = Number(getTrimmedText(child)) || graphic.height;
        break;
      case "code":
        graphic.code = getTrimmedText(child);
        break;
      default:
        break;
    }
  }

  return graphic;
}

function parseNode(element: Element): DNANode | null {
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case "group":
      return parseGroup(element);
    case "visgroup":
      return parseVisGroup(element);
    case "node":
      return parseNodeDef(element);
    case "prop":
      return parseProp(element);
    case "anim_prop":
      return parseAnimProp(element);
    case "interactive_prop":
      return parseInteractiveProp(element);
    case "street":
      return parseStreet(element);
    case "flat_building":
      return parseFlatBuilding(element);
    case "landmark_building":
      return parseLandmarkBuilding(element);
    case "anim_building":
      return parseAnimBuilding(element);
    case "door":
      return parseDoor(element);
    case "flat_door":
      return parseFlatDoor(element);
    case "sign":
      return parseSign(element);
    default:
      return null;
  }
}

function parseScene(element: Element, file: DNAFile): void {
  for (const child of getElementChildren(element)) {
    const node = parseNode(child);
    if (node) {
      file.root.push(node);
    }
  }
}

function parseStorage(element: Element, file: DNAFile): void {
  for (const child of getElementChildren(element)) {
    const tag = child.tagName.toLowerCase();
    switch (tag) {
      case "model":
        file.models.push(parseModel(child));
        break;
      case "store_texture":
        file.storedTextures.push(parseStoreTexture(child));
        break;
      case "store_font":
        file.storedFonts.push(parseStoreFont(child));
        break;
      default:
        break;
    }
  }
}

export function parseDNAXML(input: string): DNAFile {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is not available for XML DNA parsing");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(input, "application/xml");
  const root = doc.documentElement;
  if (!root) {
    throw new Error("XML DNA document is empty");
  }

  if (root.tagName.toLowerCase() === "parsererror") {
    throw new Error("XML DNA document could not be parsed");
  }

  const file: DNAFile = {
    suitPoints: [],
    models: [],
    storedTextures: [],
    storedFonts: [],
    root: [],
  };

  for (const element of Array.from(
    root.getElementsByTagName("store_suit_point"),
  )) {
    file.suitPoints.push(parseSuitPoint(element));
  }

  const tag = root.tagName.toLowerCase();
  if (tag === "storage") {
    parseStorage(root, file);
  } else {
    parseScene(root, file);
  }

  return file;
}
