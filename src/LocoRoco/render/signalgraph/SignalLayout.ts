/*
 * Entirely AI written layout algorithm for the SignalGraph. It works OK.
 * 
 * petton-svn, 2026.
 */
 
import { SignalGraph, SignalNode, SignalEdge } from "./SignalGraph.js";

// DFS vertex color states for back-edge detection.
const enum DfsColor {
  White, // Unvisited
  Gray, // In current DFS path (visiting descendants)
  Black, // Fully explored
}

// Finds back-edges in a directed graph via DFS coloring.
// Back-edges point from a node to an ancestor in the DFS tree, indicating a cycle.
function findBackEdges(
  nodes: SignalNode[],
  edges: SignalEdge[],
): Set<SignalEdge> {
  const backEdges = new Set<SignalEdge>();
  const adjIdx = new Map<SignalNode, SignalEdge[]>(nodes.map((n) => [n, []]));
  for (const e of edges) adjIdx.get(e.fromNode)?.push(e);
  const color = new Map<SignalNode, DfsColor>(
    nodes.map((n) => [n, DfsColor.White]),
  );
  const dfs = (node: SignalNode) => {
    color.set(node, DfsColor.Gray);
    for (const e of adjIdx.get(node) ?? []) {
      if (color.get(e.toNode) === DfsColor.Gray) backEdges.add(e);
      else if (color.get(e.toNode) === DfsColor.White) dfs(e.toNode);
    }
    color.set(node, DfsColor.Black);
  };
  for (const n of nodes) if (color.get(n) === DfsColor.White) dfs(n);
  return backEdges;
}

// Horizontal spacing between rank columns in pixels.
const COL_W = 420;
// Vertical spacing between nodes seeded into the same rank column.
const ROW_H = 200;
// Minimum gap (px) kept between node bounding boxes during overlap correction.
export const OVERLAP_PAD = 12;
// Padding (px) between connected components when shelf-packing.
const COMP_PAD = 200;
// Inset (px) from the top-left origin for the entire layout.
const LAYOUT_MARGIN = 80;

// Lays out a single connected component in-place, normalizing to origin (minX=0, minY=0).
// X positions are fixed by topological rank; only Y is force-simulated.
// Chain-straightening aligns sockets (using their pre-computed y offsets) rather than node top-edges.
function layoutSingle(nodes: SignalNode[], edges: SignalEdge[]): void {
  if (nodes.length === 0) return;

  // Identify back-edges via DFS so the rank computation can skip them.
  // Without this, cycles cause the Bellman-Ford loop to diverge, producing
  // astronomically large initial ranks and a layout the simulation can't recover.
  const backEdgeSet = findBackEdges(nodes, edges);

  // Compute topological rank for initialization only — not enforced during simulation.
  // Back-edges are skipped so cycles don't inflate ranks.
  const rank = new Map<SignalNode, number>(nodes.map((n) => [n, 0]));
  for (let pass = 0; pass < nodes.length; pass++)
    for (const e of edges) {
      if (backEdgeSet.has(e)) continue;
      const r = (rank.get(e.fromNode) ?? 0) + 1;
      if (r > (rank.get(e.toNode) ?? 0)) rank.set(e.toNode, r);
    }

  // Late-start normalization: push each node as far right as possible toward its
  // successors while preserving DAG order.  rank[v] = min(rank[successor]) - 1.
  // This compresses the empty column gaps caused by long-range edges (e.g. a rank-2
  // node whose only successor is at rank 6 moves to rank 5, directly adjacent).
  // Processing in descending rank order ensures successors are finalized first.
  // Proof that lateRank[v] ≥ rank[v]: min(rank[s]) ≥ rank[v]+1 (DAG) → lateRank ≥ rank[v]. ✓
  {
    const fwdSucc = new Map<SignalNode, SignalNode[]>(nodes.map((n) => [n, []]));
    const fwdInDeg = new Map<SignalNode, number>(nodes.map((n) => [n, 0]));
    for (const e of edges) {
      if (backEdgeSet.has(e)) continue;
      fwdSucc.get(e.fromNode)!.push(e.toNode);
      fwdInDeg.set(e.toNode, (fwdInDeg.get(e.toNode) ?? 0) + 1);
    }
    // Only push nodes that are pure pipe/source: exactly 1 forward successor AND
    // at most 1 forward predecessor.  Multi-predecessor nodes are excluded because
    // their other incoming edges would become longer if the node were pushed right.
    for (const n of [...nodes].sort(
      (a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0),
    )) {
      const succs = fwdSucc.get(n)!;
      if (succs.length !== 1 || (fwdInDeg.get(n) ?? 0) > 1) continue;
      rank.set(n, (rank.get(succs[0]) ?? 0) - 1);
    }
  }

  // Seed positions: x from rank, y spread within each rank bucket.
  const byRank = new Map<number, SignalNode[]>();
  for (const gn of nodes) {
    const r = rank.get(gn) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(gn);
  }
  for (const [r, nodes] of byRank)
    nodes.forEach((gn, i) => {
      gn.layoutX = r * COL_W;
      gn.layoutY = i * ROW_H;
    });

  // X is frozen at rank * COL_W for the entire simulation — only Y is optimised.
  // This prevents the "radial chains" artefact produced when omnidirectional repulsion
  // is free to rotate straight-line chains away from the horizontal flow direction.
  const k = Math.sqrt(COL_W * ROW_H);

  // vel[node] is vy only; vx is never computed.
  const vel = new Map<SignalNode, number>(nodes.map((n) => [n, 0]));

  for (let iter = 0; iter < 200; iter++) {
    const temp = k * 2 * (1 - iter / 200) + 2;
    for (const id of vel.keys()) vel.set(id, 0);

    // Y repulsion: same-rank (column) nodes only.
    // Cross-column y-repulsion is omitted because nodes in unrelated subgraphs that happen
    // to share a rank column would otherwise push chain nodes away from their spring targets.
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        if ((rank.get(a) ?? 0) !== (rank.get(b) ?? 0)) continue;
        const dy = b.layoutY - a.layoutY;
        const d = Math.max(Math.abs(dy), 1),
          f = (k * k) / d;
        vel.set(a, vel.get(a)! - (dy / d) * f);
        vel.set(b, vel.get(b)! + (dy / d) * f);
      }

    // Y-only FR attraction: pull connected nodes to the same height.
    for (const e of edges) {
      const a = e.fromNode,
        b = e.toNode;
      const dx = b.layoutX - a.layoutX,
        dy = b.layoutY - a.layoutY;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      vel.set(a, vel.get(a)! + (dy / d) * ((d * d) / k));
      vel.set(b, vel.get(b)! - (dy / d) * ((d * d) / k));
    }

    // Y centering gravity keeps the component from drifting vertically.
    const cy = nodes.reduce((s, n) => s + n.layoutY, 0) / nodes.length;
    for (const gn of nodes)
      vel.set(gn, vel.get(gn)! + (cy - gn.layoutY) * 0.02);

    // Apply velocity to Y only, capped by temperature.
    for (const gn of nodes) {
      const vy = vel.get(gn)!;
      const mag = Math.abs(vy);
      if (mag > 0) gn.layoutY += (vy / mag) * Math.min(mag, temp);
    }

    // Overlap correction in Y only (X stays fixed at rank position).
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        const dx = b.layoutX + b.w / 2 - (a.layoutX + a.w / 2);
        const dy = b.layoutY + b.h / 2 - (a.layoutY + a.h / 2);
        const ox = (a.w + b.w) / 2 + OVERLAP_PAD - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + OVERLAP_PAD - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          const sy = dy === 0 ? 1 : Math.sign(dy);
          a.layoutY -= (sy * oy) / 2;
          b.layoutY += (sy * oy) / 2;
        }
      }
  }

  // Chain-straightening: two passes.
  // 1. Descending rank (right-to-left): pipe nodes (1 out, ≤1 in) align their output
  //    socket to their successor's input socket.  This anchors chains at the downstream
  //    hub they feed into, eliminating the Y gap between the chain tail and a multi-input
  //    target node.
  // 2. Ascending rank (left-to-right): sink nodes (0 out, 1 in) align to predecessor.
  {
    const dagInEdges = new Map<SignalNode, SignalEdge[]>(
      nodes.map((n) => [n, []]),
    );
    const dagOutEdges = new Map<SignalNode, SignalEdge[]>(
      nodes.map((n) => [n, []]),
    );
    for (const e of edges) {
      if (backEdgeSet.has(e)) continue;
      dagInEdges.get(e.toNode)!.push(e);
      dagOutEdges.get(e.fromNode)!.push(e);
    }

    // Pass 1: pipe nodes → align to successor (descending rank so successors are stable).
    for (const [, colNodes] of [...byRank.entries()].sort(
      ([a], [b]) => b - a,
    )) {
      for (const gn of colNodes) {
        const outs = dagOutEdges.get(gn)!;
        const ins = dagInEdges.get(gn)!;
        if (outs.length !== 1 || ins.length > 1) continue;
        const e = outs[0];
        const toSockY = e.toNode.inputSockets[e.toSockIdx]?.y ?? 0;
        const fromSockY = gn.outputSockets[e.fromSockIdx]?.y ?? 0;
        gn.layoutY = e.toNode.layoutY + toSockY - fromSockY;
      }
    }

    // Pass 2: sinks (0 out, 1 in) → align to predecessor (ascending rank).
    for (const [, colNodes] of [...byRank.entries()].sort(
      ([a], [b]) => a - b,
    )) {
      for (const gn of colNodes) {
        const outs = dagOutEdges.get(gn)!;
        const ins = dagInEdges.get(gn)!;
        if (outs.length !== 0 || ins.length !== 1) continue;
        const e = ins[0];
        const fromSockY = e.fromNode.outputSockets[e.fromSockIdx]?.y ?? 0;
        const toSockY = gn.inputSockets[e.toSockIdx]?.y ?? 0;
        gn.layoutY = e.fromNode.layoutY + fromSockY - toSockY;
      }
    }
  }

  // Post-simulation guaranteed overlap removal in Y only.
  for (let pass = 0; pass < 100; pass++) {
    let anyOverlap = false;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        const dx = b.layoutX + b.w / 2 - (a.layoutX + a.w / 2);
        const dy = b.layoutY + b.h / 2 - (a.layoutY + a.h / 2);
        const ox = (a.w + b.w) / 2 + OVERLAP_PAD - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + OVERLAP_PAD - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          anyOverlap = true;
          const sy = dy === 0 ? 1 : Math.sign(dy);
          a.layoutY -= (sy * oy) / 2;
          b.layoutY += (sy * oy) / 2;
        }
      }
    if (!anyOverlap) break;
  }

  // Crossing reduction via adjacent swaps within each column.
  // For each pair of Y-adjacent nodes in a column, count how many edge crossings
  // would be eliminated vs introduced by swapping them.  Accept the swap if it
  // yields a net reduction.  Iterate until stable.
  {
    // Index edges by node for fast lookup.
    const edgesFrom = new Map<SignalNode, { to: SignalNode }[]>(
      nodes.map((n) => [n, []]),
    );
    const edgesTo = new Map<SignalNode, { from: SignalNode }[]>(
      nodes.map((n) => [n, []]),
    );
    for (const e of edges) {
      edgesFrom.get(e.fromNode)!.push({ to: e.toNode });
      edgesTo.get(e.toNode)!.push({ from: e.fromNode });
    }

    for (let sweep = 0; sweep < 8; sweep++) {
      let anySwap = false;
      for (const [, col] of byRank) {
        if (col.length < 2) continue;
        col.sort((a, b) => a.layoutY - b.layoutY);

        for (let i = 0; i < col.length - 1; i++) {
          const a = col[i],
            b = col[i + 1]; // a above b

          // Collect Y positions of targets of edges going RIGHT from a and b.
          const aRightYs: number[] = [],
            bRightYs: number[] = [];
          for (const { to } of edgesFrom.get(a)!) {
            if (to.layoutX > a.layoutX) aRightYs.push(to.layoutY);
          }
          for (const { to } of edgesFrom.get(b)!) {
            if (to.layoutX > b.layoutX) bRightYs.push(to.layoutY);
          }
          // Collect Y positions of sources of edges coming from the LEFT to a and b.
          const aLeftYs: number[] = [],
            bLeftYs: number[] = [];
          for (const { from } of edgesTo.get(a)!) {
            if (from.layoutX < a.layoutX) aLeftYs.push(from.layoutY);
          }
          for (const { from } of edgesTo.get(b)!) {
            if (from.layoutX < b.layoutX) bLeftYs.push(from.layoutY);
          }

          // Current: a above b.  Two edges cross when a's endpoint is below b's.
          let crossCur = 0,
            crossSwap = 0;
          for (const ay of aRightYs)
            for (const by of bRightYs) {
              if (ay > by) crossCur++;
              else if (ay < by) crossSwap++;
            }
          for (const ay of aLeftYs)
            for (const by of bLeftYs) {
              if (ay > by) crossCur++;
              else if (ay < by) crossSwap++;
            }

          if (crossSwap < crossCur) {
            const tmpY = a.layoutY;
            a.layoutY = b.layoutY;
            b.layoutY = tmpY;
            col[i] = b;
            col[i + 1] = a;
            anySwap = true;
          }
        }
      }
      if (!anySwap) break;

      // Re-run overlap removal after swaps.
      for (let pass = 0; pass < 100; pass++) {
        let anyOverlap = false;
        for (let i = 0; i < nodes.length; i++)
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i],
              b = nodes[j];
            const dx = b.layoutX + b.w / 2 - (a.layoutX + a.w / 2);
            const dy = b.layoutY + b.h / 2 - (a.layoutY + a.h / 2);
            const ox = (a.w + b.w) / 2 + OVERLAP_PAD - Math.abs(dx);
            const oy = (a.h + b.h) / 2 + OVERLAP_PAD - Math.abs(dy);
            if (ox > 0 && oy > 0) {
              anyOverlap = true;
              const sy = dy === 0 ? 1 : Math.sign(dy);
              a.layoutY -= (sy * oy) / 2;
              b.layoutY += (sy * oy) / 2;
            }
          }
        if (!anyOverlap) break;
      }
    }
  }

  // Normalize to origin.
  const minX = Math.min(...nodes.map((n) => n.layoutX)),
    minY = Math.min(...nodes.map((n) => n.layoutY));
  for (const gn of nodes) {
    gn.layoutX -= minX;
    gn.layoutY -= minY;
  }
}

export function runLayout(graph: SignalGraph): void {
  const gnodes = graph.nodes;
  if (gnodes.length === 0) return;
  const nodeSet = new Set(gnodes);
  const activeEdges = graph.edges.filter(
    (e) => nodeSet.has(e.fromNode) && nodeSet.has(e.toNode),
  );

  // Find connected components (undirected).
  const adj = new Map<SignalNode, Set<SignalNode>>();
  for (const n of gnodes) adj.set(n, new Set());
  for (const e of activeEdges) {
    adj.get(e.fromNode)!.add(e.toNode);
    adj.get(e.toNode)!.add(e.fromNode);
  }
  const visited = new Set<SignalNode>();
  const components: SignalNode[][] = [];
  for (const gn of gnodes) {
    if (visited.has(gn)) continue;
    const comp: SignalNode[] = [];
    const queue: SignalNode[] = [gn];
    visited.add(gn);
    while (queue.length) {
      const node = queue.shift()!;
      comp.push(node);
      for (const nb of adj.get(node)!) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }

  // Layout each component independently (positions normalized to origin after each).
  for (const comp of components) {
    const compSet = new Set(comp);
    layoutSingle(
      comp,
      activeEdges.filter((e) => compSet.has(e.fromNode) && compSet.has(e.toNode)),
    );
  }

  // Compute AABBs using node dimensions set by the renderer before layout.
  const boxes = components.map((comp) => ({
    comp,
    w: Math.max(...comp.map((n) => n.layoutX + n.w)),
    h: Math.max(...comp.map((n) => n.layoutY + n.h)),
  }));

  // Shelf-pack sorted by height descending. Target width ≈ sqrt(total area) to keep roughly square.
  boxes.sort((a, b) => b.h - a.h);
  const totalArea = boxes.reduce(
    (s, b) => s + (b.w + COMP_PAD) * (b.h + COMP_PAD),
    0,
  );
  const targetW = Math.max(boxes[0]?.w ?? 0, Math.sqrt(totalArea) * 1.5);

  let x = LAYOUT_MARGIN,
    y = LAYOUT_MARGIN,
    rowH = 0;
  for (const box of boxes) {
    if (x > LAYOUT_MARGIN && x + box.w > targetW + LAYOUT_MARGIN) {
      x = LAYOUT_MARGIN;
      y += rowH + COMP_PAD;
      rowH = 0;
    }
    for (const n of box.comp) {
      n.layoutX += x;
      n.layoutY += y;
    }
    x += box.w + COMP_PAD;
    rowH = Math.max(rowH, box.h);
  }
}
