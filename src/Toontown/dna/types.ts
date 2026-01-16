// Toontown DNA format data types

import type { vec3, vec4 } from "gl-matrix";

// ============================================
// Suit Point Types
// ============================================

export enum SuitPointType {
  STREET_POINT = 0,
  FRONT_DOOR_POINT = 1,
  SIDE_DOOR_POINT = 2,
  COGHQ_IN_POINT = 3,
  COGHQ_OUT_POINT = 4,
}

export interface SuitPoint {
  index: number;
  type: SuitPointType;
  pos: vec3;
  landmarkBuildingIndex?: number;
}

export interface SuitEdge {
  startPointIndex: number;
  endPointIndex: number;
  zoneId: string;
}

export interface BattleCell {
  width: number;
  height: number;
  pos: vec3;
}

// ============================================
// Storage/Resource Types
// ============================================

export interface StoredNode {
  category: string;
  code: string;
  nodeName?: string;
}

export interface StoredTexture {
  category: string;
  code: string;
  filename: string;
}

export interface StoredFont {
  category: string;
  code: string;
  filename: string;
}

export interface ModelDeclaration {
  path: string;
  type: "model" | "hood_model" | "place_model";
  nodes: StoredNode[];
}

// ============================================
// Node Types
// ============================================

export type DNANodeType =
  | "group"
  | "visgroup"
  | "node"
  | "prop"
  | "anim_prop"
  | "interactive_prop"
  | "street"
  | "flat_building"
  | "landmark_building"
  | "anim_building"
  | "wall"
  | "windows"
  | "door"
  | "flat_door"
  | "cornice"
  | "sign"
  | "baseline"
  | "text"
  | "graphic";

// ============================================
// Base Node Interfaces
// ============================================

export interface DNAGroupBase {
  type: DNANodeType;
  name: string;
  children: DNANode[];
}

export interface DNANodeTransform {
  pos?: vec3;
  hpr?: vec3;
  scale?: vec3;
}

// ============================================
// Node Definitions
// ============================================

export interface DNAGroup extends DNAGroupBase {
  type: "group";
}

export interface DNAVisGroup extends DNAGroupBase {
  type: "visgroup";
  visibles: string[];
  suitEdges: SuitEdge[];
  battleCells: BattleCell[];
}

export interface DNANodeDef extends DNAGroupBase, DNANodeTransform {
  type: "node";
}

export interface DNAProp extends DNAGroupBase, DNANodeTransform {
  type: "prop";
  code: string;
  color?: vec4;
}

export interface DNAAnimProp extends DNAGroupBase, DNANodeTransform {
  type: "anim_prop";
  code: string;
  anim: string;
  color?: vec4;
}

export interface DNAInteractiveProp extends DNAGroupBase, DNANodeTransform {
  type: "interactive_prop";
  code: string;
  anim: string;
  cellId: number;
  color?: vec4;
}

export interface DNAStreet extends DNAGroupBase, DNANodeTransform {
  type: "street";
  code: string;
  streetTexture: string;
  sidewalkTexture: string;
  curbTexture?: string;
  streetColor?: vec4;
  sidewalkColor?: vec4;
  curbColor?: vec4;
}

export interface DNAFlatBuilding extends DNAGroupBase, DNANodeTransform {
  type: "flat_building";
  width: number;
  walls: DNAWall[];
}

export interface DNAWall extends DNAGroupBase {
  type: "wall";
  height: number;
  code: string;
  color: vec4;
  windows?: DNAWindows;
  cornice?: DNACornice;
}

export interface DNAWindows {
  type: "windows";
  code: string;
  color: vec4;
  count: number;
}

export interface DNACornice {
  type: "cornice";
  code: string;
  color: vec4;
}

export interface DNADoor extends DNAGroupBase {
  type: "door";
  code: string;
  color: vec4;
}

export interface DNAFlatDoor extends DNAGroupBase {
  type: "flat_door";
  code: string;
  color: vec4;
}

export interface DNALandmarkBuilding extends DNAGroupBase, DNANodeTransform {
  type: "landmark_building";
  code: string;
  buildingType?: string;
  article?: string;
  title: string;
  wallColor?: vec4;
}

export interface DNAAnimBuilding extends DNAGroupBase, DNANodeTransform {
  type: "anim_building";
  code: string;
  buildingType?: string;
  article?: string;
  title: string;
  anim: string;
  wallColor?: vec4;
}

// ============================================
// Sign Types
// ============================================

export interface DNASign extends DNAGroupBase, DNANodeTransform {
  type: "sign";
  code?: string;
  color?: vec4;
  baselines: DNABaseline[];
}

export interface DNABaseline extends DNANodeTransform {
  type: "baseline";
  code?: string;
  color?: vec4;
  width?: number;
  height?: number;
  indent?: number;
  kern?: number;
  wiggle?: number;
  stumble?: number;
  stomp?: number;
  flags?: string;
  items: (DNASignText | DNASignGraphic)[];
}

export interface DNASignText extends DNANodeTransform {
  type: "text";
  letters: string;
  code?: string;
  color?: vec4;
}

export interface DNASignGraphic extends DNANodeTransform {
  type: "graphic";
  code: string;
  color?: vec4;
  width?: number;
  height?: number;
}

// ============================================
// Union Types
// ============================================

export type DNANode =
  | DNAGroup
  | DNAVisGroup
  | DNANodeDef
  | DNAProp
  | DNAAnimProp
  | DNAInteractiveProp
  | DNAStreet
  | DNAFlatBuilding
  | DNALandmarkBuilding
  | DNAAnimBuilding
  | DNADoor
  | DNAFlatDoor
  | DNASign;

// ============================================
// Top-Level File Structure
// ============================================

export interface DNAFile {
  suitPoints: SuitPoint[];
  models: ModelDeclaration[];
  storedTextures: StoredTexture[];
  storedFonts: StoredFont[];
  root: DNANode[];
}
