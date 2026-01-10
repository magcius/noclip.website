export enum UsageHint {
  Client = 0,
  Stream = 1,
  Dynamic = 2,
  Static = 3,
  Unspecified = 4,
}

export enum NumericType {
  U8 = 0,
  U16 = 1,
  U32 = 2,
  PackedDCBA = 3,
  PackedDABC = 4,
  F32 = 5,
  F64 = 6,
  StdFloat = 7,
  I8 = 8,
  I16 = 9,
  I32 = 10,
  PackedUFloat = 11,
}

export enum Contents {
  Other = 0,
  Point = 1,
  ClipPoint = 2,
  Vector = 3,
  TexCoord = 4,
  Color = 5,
  Index = 6,
  MorphDelta = 7,
  Matrix = 8,
  Normal = 9,
}

export enum ShadeModel {
  Uniform = 0,
  Smooth = 1,
  FlatFirstVertex = 2,
  FlatLastVertex = 3,
}

export enum PrimitiveType {
  None = 0,
  Polygons = 1,
  Lines = 2,
  Points = 3,
  Patches = 4,
}

export enum AnimationType {
  None = 0,
  Panda = 1,
  Hardware = 2,
}

export enum BoundsType {
  Default = 0,
  Best = 1,
  Sphere = 2,
  Box = 3,
  Fastest = 4,
}

export const GeomRendering = {
  IndexedPoint: 1 << 0,
  IndexedOther: 1 << 16,
  Point: 1 << 1,
  PointUniformSize: 1 << 2,
  PerPointSize: 1 << 3,
  PointPerspective: 1 << 4,
  PointAspectRatio: 1 << 5,
  PointScale: 1 << 6,
  PointRotate: 1 << 7,
  PointSprite: 1 << 8,
  PointSpriteTexMatrix: 1 << 9,
  TriangleStrip: 1 << 10,
  TriangleFan: 1 << 11,
  LineStrip: 1 << 12,
  StripCutIndex: 1 << 17,
  FlatFirstVertex: 1 << 13,
  FlatLastVertex: 1 << 14,
  RenderModeWireframe: 1 << 18,
  RenderModePoint: 1 << 19,
  Adjacency: 1 << 20,
};
