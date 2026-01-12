import { mat4, ReadonlyMat4 } from "gl-matrix";
import {
  RenderState,
  GeomNode,
  CullBinAttrib,
  TransparencyAttrib,
  TransparencyMode,
  AlphaTestAttrib,
  PandaCompareFunc,
  DepthWriteAttrib,
  DepthWriteMode,
  MAX_PRIORITY,
  DecalEffect,
} from "./nodes";
import { CachedGeometryData } from "./geom";
import { AABB } from "../Geometry";
import { pandaToNoclip } from "./render";
import { computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";

export type CullableObject = {
  geomNode: GeomNode;
  geomData: CachedGeometryData | null;
  renderState: RenderState;
  modelMatrix: mat4;
};

abstract class CullBin {
  abstract add(obj: CullableObject): void;
  abstract finish(): CullableObject[];
}

/** Render in insertion order (no sorting) */
class CullBinUnsorted extends CullBin {
  protected objects: CullableObject[] = [];

  add(obj: CullableObject): void {
    this.objects.push(obj);
  }

  finish(): CullableObject[] {
    const result = this.objects;
    this.objects = [];
    return result;
  }
}

type CullBinFixedObject = {
  obj: CullableObject;
  drawOrder: number;
};

/** Sort by fixed draw_order from CullBinAttrib */
class CullBinFixed extends CullBin {
  protected objects: CullBinFixedObject[] = [];

  add(obj: CullableObject): void {
    const drawOrder = obj.renderState.get(CullBinAttrib)?.drawOrder ?? 0;
    this.objects.push({ obj, drawOrder });
  }

  finish(): CullableObject[] {
    const result = this.objects;
    this.objects = [];
    result.sort((a, b) => a.drawOrder - b.drawOrder);
    return result.map(({ obj }) => obj);
  }
}

const scratchAABB = new AABB();

type CullBinSortedObject = {
  obj: CullableObject;
  depth: number;
};

abstract class CullBinSorted extends CullBin {
  protected objects: CullBinSortedObject[] = [];

  constructor(private viewMatrix: ReadonlyMat4) {
    super();
  }

  add(obj: CullableObject): void {
    let aabb: AABB;
    if (obj.geomData) {
      aabb = obj.geomData.aabb;
    } else {
      aabb = obj.geomNode.getBoundingBox();
    }
    scratchAABB.transform(aabb, obj.modelMatrix);
    scratchAABB.transform(scratchAABB, pandaToNoclip);
    const depth = computeViewSpaceDepthFromWorldSpaceAABB(
      this.viewMatrix,
      scratchAABB,
    );
    this.objects.push({ obj, depth });
  }
}

/** Sort back-to-front by depth (for transparency) */
class CullBinBackToFront extends CullBinSorted {
  finish(): CullableObject[] {
    const result = this.objects;
    this.objects = [];
    result.sort((a, b) => b.depth - a.depth);
    return result.map(({ obj }) => obj);
  }
}

/** Sort front-to-back by depth (for early-Z optimization) */
class CullBinFrontToBack extends CullBinSorted {
  finish(): CullableObject[] {
    const result = this.objects;
    this.objects = [];
    result.sort((a, b) => a.depth - b.depth);
    return result.map(({ obj }) => obj);
  }
}

function getCullBinName(obj: CullableObject): string {
  const cullBinAttrib = obj.renderState.get(CullBinAttrib);
  if (cullBinAttrib && cullBinAttrib.binName.length > 0)
    return cullBinAttrib.binName;
  const transparencyAttrib = obj.renderState.get(TransparencyAttrib);
  if (
    transparencyAttrib &&
    (transparencyAttrib.mode === TransparencyMode.Alpha ||
      transparencyAttrib.mode === TransparencyMode.Dual)
  )
    return "transparent";
  return "opaque";
}

const ALPHA_BINARY_LEVEL = 0.5;
const ALPHA_DUAL_OPAQUE_LEVEL = 252.0 / 256.0;

// Render attributes for TransparencyMode.Alpha
const ALPHA_STATE: RenderState = RenderState.make(
  0,
  AlphaTestAttrib.create(PandaCompareFunc.Greater, 0),
);

// Render attributes for TransparencyMode.Binary
const BINARY_STATE: RenderState = RenderState.make(
  0,
  AlphaTestAttrib.create(PandaCompareFunc.GreaterEqual, ALPHA_BINARY_LEVEL),
  TransparencyAttrib.create(TransparencyMode.None),
);

// Render attributes for TransparencyMode.Dual (transparent pass)
const DUAL_TRANSPARENT_STATE: RenderState = RenderState.make(
  0,
  AlphaTestAttrib.create(PandaCompareFunc.Greater, 0),
  DepthWriteAttrib.create(DepthWriteMode.Off),
  TransparencyAttrib.create(TransparencyMode.Alpha),
);

// Render attributes for TransparencyMode.Dual (transparent pass with decals)
const DUAL_TRANSPARENT_STATE_DECALS: RenderState = RenderState.make(
  MAX_PRIORITY,
  AlphaTestAttrib.create(PandaCompareFunc.Greater, ALPHA_DUAL_OPAQUE_LEVEL),
  DepthWriteAttrib.create(DepthWriteMode.Off),
  TransparencyAttrib.create(TransparencyMode.Alpha),
);

// Render attributes for TransparencyMode.Dual (opaque pass)
const DUAL_OPAQUE_STATE: RenderState = RenderState.make(
  0,
  AlphaTestAttrib.create(
    PandaCompareFunc.GreaterEqual,
    ALPHA_DUAL_OPAQUE_LEVEL,
  ),
  TransparencyAttrib.create(TransparencyMode.None),
);

/**
 * Collects objects into cull bins during scene traversal,
 * sorting them appropriately for rendering.
 */
export class BinCollector {
  private bins: Map<string, CullBin> = new Map();

  constructor(viewMatrix: ReadonlyMat4) {
    this.bins.set("background", new CullBinFixed()); // 10
    this.bins.set("ground", new CullBinFixed()); // 14 (Toontown)
    this.bins.set("shadow", new CullBinFixed()); // 15 (Toontown)
    this.bins.set("opaque", new CullBinFrontToBack(viewMatrix)); // 20
    this.bins.set("transparent", new CullBinBackToFront(viewMatrix)); // 30
    this.bins.set("fixed", new CullBinFixed()); // 40
    this.bins.set("unsorted", new CullBinUnsorted()); // 50
    this.bins.set("gui-popup", new CullBinUnsorted()); // 60 (Toontown)
  }

  add(obj: CullableObject) {
    let transparencyAttrib = obj.renderState.get(TransparencyAttrib);
    switch (transparencyAttrib?.mode) {
      case TransparencyMode.Alpha:
        obj = {
          ...obj,
          renderState: obj.renderState.compose(ALPHA_STATE),
        };
        break;
      case TransparencyMode.Binary:
        obj = {
          ...obj,
          renderState: obj.renderState.compose(BINARY_STATE),
        };
        break;
      case TransparencyMode.Dual: {
        const cullBinAttrib = obj.renderState.get(CullBinAttrib);
        if (cullBinAttrib === null || cullBinAttrib.binName.length === 0) {
          const transparentState =
            obj.geomNode.effects.get(DecalEffect) !== null
              ? DUAL_TRANSPARENT_STATE_DECALS
              : DUAL_TRANSPARENT_STATE;
          this.getBin("transparent").add({
            ...obj,
            renderState: obj.renderState.compose(transparentState),
          });
          this.getBin("opaque").add({
            ...obj,
            renderState: obj.renderState.compose(DUAL_OPAQUE_STATE),
          });
          return;
        }
        // If the object is assigned to a specific bin, fall through
        break;
      }
    }
    this.getBin(getCullBinName(obj)).add(obj);
  }

  finish(): CullableObject[] {
    const result: CullableObject[] = [];
    for (const bin of this.bins.values()) {
      result.push(...bin.finish());
    }
    return result;
  }

  private getBin(name: string): CullBin {
    let bin = this.bins.get(name);
    if (!bin) {
      console.warn(`Unknown cull bin name: ${name}`);
      bin = new CullBinFixed();
      this.bins.set(name, bin);
    }
    return bin;
  }
}
