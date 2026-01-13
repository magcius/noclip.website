/** biome-ignore-all assist/source/organizeImports: custom sorted */

// Base types
export { BAMObject, getBAMObjectFactory, registerBAMObject } from "./base";

// Animation
export { AnimBundle } from "./AnimBundle";
export { AnimBundleNode } from "./AnimBundleNode";
export { AnimChannelMatrixXfmTable } from "./AnimChannelMatrixXfmTable";
export { AnimChannelScalarTable } from "./AnimChannelScalarTable";
export { AnimGroup } from "./AnimGroup";

// Character animation (pre-5.0)
export { Character } from "./Character";
export { CharacterJoint } from "./CharacterJoint";
export { CharacterJointBundle } from "./CharacterJointBundle";
export { CharacterSlider } from "./CharacterSlider";
export { ComputedVertices } from "./ComputedVertices";
export { MovingPartBase } from "./MovingPartBase";
export { MovingPartMatrix } from "./MovingPartMatrix";
export { MovingPartScalar } from "./MovingPartScalar";
export { PartBundle } from "./PartBundle";
export { PartGroup } from "./PartGroup";

// Collision
export { CollisionNode } from "./CollisionNode";
export { CollisionPlane } from "./CollisionPlane";
export { CollisionPolygon } from "./CollisionPolygon";
export { CollisionSolid } from "./CollisionSolid";
export { CollisionSphere } from "./CollisionSphere";
export { CollisionTube } from "./CollisionTube";

// Render state
export {
  RenderState,
  type RenderAttribEntry,
  MAX_PRIORITY,
} from "./RenderState";
export { TransparencyAttrib, TransparencyMode } from "./TransparencyAttrib";
export { RenderAttrib, PandaCompareFunc } from "./RenderAttrib";
export { AlphaTestAttrib } from "./AlphaTestAttrib";
export { ColorAttrib, ColorType } from "./ColorAttrib";
export { ColorScaleAttrib } from "./ColorScaleAttrib";
export { ColorWriteAttrib, ColorWriteChannels } from "./ColorWriteAttrib";
export { CullBinAttrib } from "./CullBinAttrib";
export { CullFaceAttrib, CullFaceMode } from "./CullFaceAttrib";
export { DepthTestAttrib } from "./DepthTestAttrib";
export { DepthWriteAttrib, DepthWriteMode } from "./DepthWriteAttrib";
export { TextureApplyAttrib, TextureApplyMode } from "./TextureApplyAttrib";

// Debug utilities
export type { DebugInfo, DebugValue } from "./debug";
export {
  dbgArray,
  dbgBool,
  dbgBytes,
  dbgColor,
  dbgEnum,
  dbgFields,
  dbgFlags,
  dbgNum,
  dbgObject,
  dbgRef,
  dbgRefs,
  dbgStr,
  dbgVec2,
  dbgVec3,
  dbgVec4,
  dbgMat4,
  formatDebugInfo,
} from "./debug";

// Geometry
export { Geom } from "./Geom";
export { GeomNode } from "./GeomNode";
export {
  GeomLines,
  GeomLinestrips,
  GeomPatches,
  GeomPoints,
  GeomPrimitive,
  GeomTriangles,
  GeomTrifans,
  GeomTristrips,
} from "./GeomPrimitive";
export { GeomBindType, LegacyGeom } from "./LegacyGeom";
export { GeomVertexArrayData } from "./GeomVertexArrayData";
export {
  GeomVertexArrayFormat,
  GeomVertexColumn,
} from "./GeomVertexArrayFormat";
export { GeomVertexData } from "./GeomVertexData";
export { GeomVertexAnimationSpec, GeomVertexFormat } from "./GeomVertexFormat";
export * from "./geomEnums";

// Core nodes
export { LODNode } from "./LODNode";
export { PandaNode } from "./PandaNode";
export { SequenceNode, PlayMode } from "./SequenceNode";
export { InternalName } from "./InternalName";
export { ModelNode, ModelRoot } from "./ModelNode";

// Curves
export { CubicCurveseg } from "./CubicCurveseg";
export { NurbsCurve, type NurbsCV } from "./NurbsCurve";
export { ParametricCurve, CurveType } from "./ParametricCurve";
export { PiecewiseCurve, type CurveSeg } from "./PiecewiseCurve";

// Effects
export { BillboardEffect } from "./BillboardEffect";
export { CharacterJointEffect } from "./CharacterJointEffect";
export { DecalEffect } from "./DecalEffect";
export { RenderEffects, RenderEffect } from "./RenderEffects";
export { CompassEffect, CompassEffectProperties } from "./CompassEffect";

// Textures
export { SamplerState } from "./SamplerState";
export { type TextureData, Texture } from "./Texture";
export { type StageNode, TextureAttrib } from "./TextureAttrib";
export {
  CombineMode,
  CombineOperand,
  CombineSource,
  TextureStage,
  TextureStageMode,
} from "./TextureStage";
export * from "./textureEnums";

// Transform state
export { TransformState } from "./TransformState";
