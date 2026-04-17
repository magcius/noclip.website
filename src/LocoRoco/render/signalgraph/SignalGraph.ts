/*
 * Extracts the signal graph from the BLV into nodes that can be laid out and displayed.
 * 
 * petton-svn, 2026.
 */

import {
  BlvFile,
  RootObject,
  SubRoot,
  LocoObject,
  InputSignalId,
  InSignalPtr,
  OutSignal,
  PropTypeId,
  ObjectProperty,
  SignalIdentifier,
  Polygon,
  PolygonComponent,
  PropCollisionMesh,
  PropSpring
} from "../../lib/blv.js";

export interface Socket {
  readonly propName: string;
  y: number; // Y offset within the node, set by renderer before layout
}

export interface InputSocket extends Socket {
  readonly signalIdentifier: SignalIdentifier;
}

export interface OutputSocket extends Socket {
  readonly signalIdentifiers: SignalIdentifier[];
}

export interface DisplayedProperty {
  readonly name: string;
  readonly value: string;
}

export interface SignalNode {
   name: string;
  readonly objectType: string;
  readonly inputSockets: InputSocket[];
  readonly outputSockets: OutputSocket[];
  readonly innerGraph: SignalGraph | null; // non-null for reference/animsaisei
  readonly owner: LocoObject | RootObject;
  readonly displayedProperties: DisplayedProperty[];
  layoutX: number;
  layoutY: number;
  w: number; // rendered pixel width; set by renderer after measuring, used by layout for overlap avoidance
  h: number; // rendered pixel height; same
}

export interface SignalEdge {
  readonly fromNode: SignalNode;
  readonly fromSockIdx: number;
  readonly toNode: SignalNode;
  readonly toSockIdx: number;
}

export interface SignalGraph {
  readonly name: string;
  readonly nodes: SignalNode[];
  readonly edges: SignalEdge[];
}

// Recursively checks whether a LocoObject has a node anywhere in the graph.
export function hasNodeFor(graph: SignalGraph, target: LocoObject|RootObject|SubRoot): boolean {
  for (const n of graph.nodes) {
    if (n.owner === target) return true;
    if (n.innerGraph && hasNodeFor(n.innerGraph, target)) return true;
  }
  return false;
}

export function componentCollisionPropertyName(i : number) : string {
  return `component${i}_collision`
}

const DISPLAY_PROP_TYPES = new Set([
  PropTypeId.Bool,
  PropTypeId.Int,
  PropTypeId.Float,
  PropTypeId.StringPtr,
  PropTypeId.Angle,
  PropTypeId.VariableName,
]);

function getDisplayedProperties(obj: LocoObject): DisplayedProperty[] {
  const result: DisplayedProperty[] = [];
  for (const prop of obj.properties) {
    if (!DISPLAY_PROP_TYPES.has(prop.typeId)) continue;
    if (prop.valueCount !== 1) continue;
    if (prop.typeId === PropTypeId.Bool && prop.name === "visibility") continue;
    if (prop.typeId === PropTypeId.Angle && prop.name === "rotZ") continue;
    if (prop.typeId === PropTypeId.StringPtr && !prop.value?.value) continue;
    result.push({ name: prop.name, value: prop.formatValue() });
  }
  return result;
}

export function extractSignalGraph(blvFile: BlvFile): SignalGraph {
  const subRootCache = new Map<SubRoot, SignalGraph>();

  function buildForRoot(root: SubRoot|RootObject, name: string): SignalGraph {
    const sr = root instanceof RootObject ? root.subRoot : root as SubRoot;

    // Return the graph if we've already built it.
    let cached = subRootCache.get(sr)
    if (cached) return cached;
    const graph: SignalGraph = { name, nodes: [], edges: [] };
    subRootCache.set(sr, graph);

    function outputSignalIds(p : ObjectProperty) : SignalIdentifier[] {
      if (p.typeId !== PropTypeId.FFTerminatedIntList) {
        throw Error("Expected FFTerminatedIntList")
      }
      if (p.valueCount !== 1) {
        throw Error("FFTerminatedIntList property cannot be an array")
      }
      return p.value as SignalIdentifier[]
    }

    function iterProp(p : ObjectProperty, f : (value: any) => void) {
      if (Array.isArray(p.value)) {
        p.value.forEach(f);
      } else {
        f(p.value);
      }
    }

    function pushPolygonSockets(outs: OutputSocket[], name: string, p: Polygon) {
      p.components.forEach((comp, compIdx) => {
        if (comp.onCollisionSignals) {
          outs.push({
            propName: name + "_comp" + compIdx,
            signalIdentifiers: comp.onCollisionSignals,
            y: 0,
          });
        }
      })
    }

    // Collect input and output sockets from a LocoObject's signal-related properties.
    function collectSockets(obj: LocoObject): { ins: InputSocket[]; outs: OutputSocket[] } {
      const ins: InputSocket[] = [];
      const outs: OutputSocket[] = [];

      // Otherwise, collect all the sockets for this node based on signal properties
      for (const prop of obj.properties) {
        if (prop.typeId === PropTypeId.InputSignal) {
          const vals =
            prop.valueCount > 1
              ? (prop.value as InputSignalId[])
              : [prop.value as InputSignalId];
          for (const v of vals) {
            ins.push({
              propName: prop.name,
              signalIdentifier: v.unk0,
              y: 0,
            });
          }
        } else if (prop.typeId === PropTypeId.InSignalPtr) {
          const inPtrs =
            prop.valueCount > 1
              ? (prop.value as InSignalPtr[])
              : [prop.value as InSignalPtr];
          for (const inPtr of inPtrs) {
            if (inPtr.unk0) {
              for (const idx of inPtr.unk0) {
                // If the SubRoot has no signals, we're done here.
                const propName = 
                    !sr.signalList ? "unknown"
                    : idx > sr.signalList.signals.length ? "unknown"
                    : sr.signalList.signals[idx].signalName1;
                ins.push({
                  propName,
                  signalIdentifier: idx,
                  y: 0,
                });
              }
            }
          }
        } else if (prop.typeId === PropTypeId.FFTerminatedIntList) {
          outs.push({ propName: prop.name, signalIdentifiers: outputSignalIds(prop), y: 0 });
        } else if (prop.typeId === PropTypeId.OutSignalPtrList) {
          for (const outSig of prop.value as OutSignal[])
            outs.push({
              propName: outSig.propertyName,
              signalIdentifiers: outSig.signalIds,
              y: 0,
            });
        } else if (prop.typeId === PropTypeId.Polygon) {
          iterProp(prop, (x: Polygon) => {
            pushPolygonSockets(outs, prop.name, x)
          })
        } else if (prop.typeId === PropTypeId.CollisionMesh47 || prop.typeId === PropTypeId.CollisionMesh48) {
          iterProp(prop, (x: PropCollisionMesh) => {
            pushPolygonSockets(outs, prop.name, x.unk5)
          })
        } else if (prop.typeId === PropTypeId.Spring) {
          iterProp(prop, (x: PropSpring) => {
            pushPolygonSockets(outs, prop.name, x.unk5)
          })
        }
      }
      return { ins, outs };
    }

    // For regular objects: [incoming] and [outgoing] are the same.
    // For junctions only: [incoming] and [outgoing] point to different nodes.
    interface SignalNodePair {
      readonly inNode : SignalNode;
      readonly outNode : SignalNode;
    }

    // Creates two nodes for a 'junction' type object: one pure-sink (inputs only) and one
    // pure-source (outputs only). Placing them on opposite ends of the graph avoids the
    // loop-back that would occur if a single node had both inputs and outputs.
    function createJunctionNodes(obj: LocoObject): {
      inNode: SignalNode;
      outNode: SignalNode;
    } {
      const baseName = obj.name;
      const { ins, outs } = collectSockets(obj);
      const displayProps = getDisplayedProperties(obj);
      const inNode: SignalNode = {
        name: `${baseName} [in]`,
        objectType: "junction",
        inputSockets: ins,
        outputSockets: [],
        innerGraph: null,
        owner: obj,
        displayedProperties: displayProps,
        layoutX: 0,
        layoutY: 0,
        w: 0,
        h: 0,
      };
      const outNode: SignalNode = {
        name: `${baseName} [out]`,
        objectType: "junction",
        inputSockets: [],
        outputSockets: outs,
        innerGraph: null,
        owner: obj,
        displayedProperties: displayProps,
        layoutX: 0,
        layoutY: 0,
        w: 0,
        h: 0,
      };
      return { inNode, outNode };
    }

    function createNodes(obj: LocoObject): SignalNodePair {
      if (obj.objectType === "junction") return createJunctionNodes(obj);

      const { ins, outs } = collectSockets(obj);

      let innerGraph: SignalGraph | null = null;
      for (const prop of obj.properties) {
        if (prop.typeId === PropTypeId.SubRoot) {
          const innerSr = prop.value as SubRoot;
          innerGraph = buildForRoot(innerSr, obj.name);
          break;
        }
      }

      const node: SignalNode = {
        name: obj.name,
        objectType: obj.objectType,
        inputSockets: ins,
        outputSockets: outs,
        innerGraph,
        owner: obj,
        displayedProperties: getDisplayedProperties(obj),
        layoutX: 0,
        layoutY: 0,
        w: 0,
        h: 0,
      };

      return { inNode: node, outNode: node };
    }

    const nodeMap = new Map<LocoObject, SignalNodePair>();
    function createNodesForObject(obj: LocoObject): void {
      if (nodeMap.has(obj))
        return;

      const result = createNodes(obj);
      nodeMap.set(obj, result);  
      graph.nodes.push(result.inNode);
      if (result.inNode !== result.outNode)
        graph.nodes.push(result.outNode);

      for (const c of obj.children) createNodesForObject(c.object);
    }

    function createNodesForRoot(root: RootObject) {
      const components = root.collision?.components;
      if (components) {
        components.forEach((polygonComponent, i) => {
          if (polygonComponent.onCollisionSignals) {
            graph.nodes.push({
              name: "root",
              objectType: "root",
              inputSockets: [],
              outputSockets: [{
                  propName: componentCollisionPropertyName(i),
                  signalIdentifiers: polygonComponent.onCollisionSignals,
                  y: 0,
                }],
              innerGraph: null,
              owner: root,
              displayedProperties: [],
              layoutX: 0,
              layoutY: 0,
              w: 0,
              h: 0,
            });
          }
        });
      }
    }

    function connectEdges() {
      interface DestSocket {
        node: SignalNode;
        sockIdx: number
      };

      const signalIdToInputSocket = new Map<SignalIdentifier, DestSocket[]>();
      for (const inNode of graph.nodes) {
        inNode.inputSockets.forEach((socket, sockIdx) => {
          const x = {node: inNode, sockIdx};
          const l = signalIdToInputSocket.get(socket.signalIdentifier);
          if (l) l.push(x);
          else signalIdToInputSocket.set(socket.signalIdentifier, [x]);
        });
      }

      for (const outNode of graph.nodes) {
        outNode.outputSockets.forEach((socket, sockIdx) => {
          for (const outSignalIdentifiers of socket.signalIdentifiers) {
            for (const destSocket of signalIdToInputSocket.get(outSignalIdentifiers) ?? []) {
              graph.edges.push({
                fromNode: outNode,
                fromSockIdx: sockIdx,
                toNode: destSocket.node,
                toSockIdx: destSocket.sockIdx,
              });
            }
          }
        });
      }
    }

    if (root instanceof RootObject)
      createNodesForRoot(root);
    if (sr.object)
      createNodesForObject(sr.object);
    connectEdges();

    // Strip nodes that have no edges and no inner graph — they're irrelevant to visualization.
    const connNodes = new Set<SignalNode>();
    for (const e of graph.edges) {
      connNodes.add(e.fromNode);
      connNodes.add(e.toNode);
    }
    
    let j = 0;
    for (let n of graph.nodes)
        if (connNodes.has(n) || (n.innerGraph !== null && n.innerGraph.nodes.length > 0))
          graph.nodes[j++] = n;
    graph.nodes.splice(j);

    return graph;
  }

  return buildForRoot(blvFile.root, 'Root');
}
