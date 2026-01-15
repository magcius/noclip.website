import { Contents, Geom, GeomNode, GeomPoints, PandaNode, RenderState } from "../nodes";
import type {
  GeomVertexArrayFormat,
  GeomVertexColumn,
  GeomVertexData,
} from "../nodes";
import { TextGlyph } from "./TextGlyph";

type VertexColumnInfo = {
  column: GeomVertexColumn;
  arrayFormat: GeomVertexArrayFormat;
  arrayIndex: number;
};

export class StaticTextFont {
  private glyphs = new Map<number, TextGlyph>();
  private _lineHeight = 1.0;
  private _spaceAdvance = 0.25;

  constructor(private fontRoot: PandaNode) {
    this.findCharacters(fontRoot, new RenderState());
  }

  get lineHeight(): number {
    return this._lineHeight;
  }

  get spaceAdvance(): number {
    return this._spaceAdvance;
  }

  getGlyph(charCode: number): TextGlyph | null {
    return this.glyphs.get(charCode) ?? null;
  }

  private findCharacters(node: PandaNode, netState: RenderState): void {
    const nextState = netState.compose(node.state);
    const name = node.name;

    if (/^\d+$/.test(name)) {
      const charCode = Number.parseInt(name, 10);
      const { polygonGeom, pointsGeom, state } = this.findCharacterGsets(
        node,
        nextState,
      );

      if (polygonGeom && pointsGeom) {
        const advance = this.extractAdvanceWidth(pointsGeom);
        this.glyphs.set(charCode, new TextGlyph(charCode, polygonGeom, state, advance));
      }
    } else if (name === "ds") {
      const { pointsGeom } = this.findCharacterGsets(node, nextState);
      if (pointsGeom) {
        this._lineHeight = this.extractLineHeight(pointsGeom);
        this._spaceAdvance = 0.25 * this._lineHeight;
      }
    } else {
      for (const [child] of node.children) {
        this.findCharacters(child, nextState);
      }
    }
  }

  private findCharacterGsets(
    node: PandaNode,
    netState: RenderState,
  ): {
    polygonGeom: Geom | null;
    pointsGeom: Geom | null;
    state: RenderState;
  } {
    let polygonGeom: Geom | null = null;
    let pointsGeom: Geom | null = null;
    let state: RenderState = netState;

    const visit = (current: PandaNode, currentState: RenderState) => {
      const nextState = currentState.compose(current.state);

      if (current instanceof GeomNode) {
        for (const { geom, state: geomState } of current.geoms) {
          let hasPoints = false;
          for (const prim of geom.primitives) {
            if (prim instanceof GeomPoints) {
              pointsGeom = geom;
              hasPoints = true;
              break;
            }
          }
          if (!hasPoints) {
            polygonGeom = geom;
            state = nextState.compose(geomState);
          }
        }
      }

      for (const [child] of current.children) {
        visit(child, nextState);
      }
    };

    visit(node, netState);
    return { polygonGeom, pointsGeom, state };
  }

  private extractAdvanceWidth(pointsGeom: Geom): number {
    return this.extractPointCoordinate(pointsGeom, 0, 0.5);
  }

  private extractLineHeight(pointsGeom: Geom): number {
    return this.extractPointCoordinate(pointsGeom, 2, 1.0);
  }

  private extractPointCoordinate(
    pointsGeom: Geom,
    axis: number,
    fallback: number,
  ): number {
    const point = this.readFirstPoint(pointsGeom);
    if (!point) return fallback;
    const value = point[axis];
    return Number.isFinite(value) ? value : fallback;
  }

  private readFirstPoint(pointsGeom: Geom): [number, number, number] | null {
    const vertexData = pointsGeom.data;
    if (!vertexData || !vertexData.format) return null;

    const columnInfo = this.findPositionColumn(vertexData);
    if (!columnInfo) return null;

    const arrayData = vertexData.arrays[columnInfo.arrayIndex];
    if (!arrayData) return null;

    const stride = columnInfo.arrayFormat.stride || columnInfo.column.totalBytes;
    if (!stride) return null;

    const vertexIndex = this.getFirstPointIndex(pointsGeom);
    const baseOffset = vertexIndex * stride + columnInfo.column.start;
    if (baseOffset + columnInfo.column.componentBytes > arrayData.buffer.byteLength) {
      return null;
    }

    const view = new DataView(
      arrayData.buffer.buffer,
      arrayData.buffer.byteOffset,
      arrayData.buffer.byteLength,
    );

    const readComponent = (offset: number): number => {
      if (columnInfo.column.componentBytes === 8) {
        return view.getFloat64(offset, true);
      }
      if (columnInfo.column.componentBytes === 4) {
        return view.getFloat32(offset, true);
      }
      return Number.NaN;
    };

    const componentStride = columnInfo.column.componentBytes;
    const x = readComponent(baseOffset);
    const y =
      columnInfo.column.numComponents > 1
        ? readComponent(baseOffset + componentStride)
        : 0;
    const z =
      columnInfo.column.numComponents > 2
        ? readComponent(baseOffset + componentStride * 2)
        : 0;

    return [x, y, z];
  }

  private findPositionColumn(vertexData: GeomVertexData): VertexColumnInfo | null {
    const format = vertexData.format;
    if (!format) return null;

    for (let arrayIndex = 0; arrayIndex < format.arrays.length; arrayIndex++) {
      const arrayFormat = format.arrays[arrayIndex];
      for (const column of arrayFormat.columns) {
        if (
          column.contents === Contents.Point ||
          column.name?.name === "vertex"
        ) {
          return { column, arrayFormat, arrayIndex };
        }
      }
    }

    return null;
  }

  private getFirstPointIndex(pointsGeom: Geom): number {
    for (const primitive of pointsGeom.primitives) {
      if (primitive instanceof GeomPoints) {
        return primitive.firstVertex;
      }
    }
    return 0;
  }
}
