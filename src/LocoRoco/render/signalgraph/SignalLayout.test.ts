/**
 * Entirely AI written layout algorithm test suite for the SignalGraph. Useful for 
 * maintaining constraints on the algorithm itself as the AI iterates on it.
 * 
 * Tests for the signal graph layout algorithm.
 * Run with: npx tsx src/LocoRoco/render/signalgraph/SignalLayout.test.ts
 *
 * Each test asserts left-to-right flow ordering and that no two nodes overlap.
 *
 * petton-svn, 2026.
 */

import { runLayout, OVERLAP_PAD } from "./SignalLayout.js";
import { SignalNode, SignalEdge, SignalGraph } from "./SignalGraph.js";

let passed = 0;
let failed = 0;

const NODE_W = 200, NODE_H = 80;

function node(name: string): SignalNode {
  return {
    name,
    objectType: "",
    inputSockets: [],
    outputSockets: [],
    innerGraph: null,
    owner: null as any,
    displayedProperties: [],
    layoutX: 0,
    layoutY: 0,
    w: NODE_W,
    h: NODE_H,
  };
}

function edge(from: SignalNode, to: SignalNode): SignalEdge {
  return {
    fromNode: from,
    toNode: to,
    fromSockIdx: 0,
    toSockIdx: 0,
  };
}

function graph(nodes: SignalNode[], edges: SignalEdge[]): SignalGraph {
  return { name: 'test', nodes, edges };
}

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passed++;
  } else {
    console.error(`  FAIL  ${message}`);
    failed++;
  }
}

function run(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

/** Asserts that no two nodes in the list have overlapping bounding boxes (including padding). */
function assertNoOverlap(nodes: SignalNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j];
      const ox =
        (a.w + b.w) / 2 +
        OVERLAP_PAD -
        Math.abs(a.layoutX + a.w / 2 - (b.layoutX + b.w / 2));
      const oy =
        (a.h + b.h) / 2 +
        OVERLAP_PAD -
        Math.abs(a.layoutY + a.h / 2 - (b.layoutY + b.h / 2));
      assert(
        !(ox > 0 && oy > 0),
        `${a.name} and ${b.name} don't overlap  ` +
          `(${a.name}: x=${a.layoutX.toFixed(0)},y=${a.layoutY.toFixed(0)}  ` +
          `${b.name}: x=${b.layoutX.toFixed(0)},y=${b.layoutY.toFixed(0)}  ` +
          `ox=${ox.toFixed(1)}, oy=${oy.toFixed(1)})`,
      );
    }
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

run("Linear chain A→B→C", () => {
  const [a, b, c] = [node("A"), node("B"), node("C")];
  runLayout(graph([a, b, c], [edge(a, b), edge(b, c)]));
  assert(
    a.layoutX < b.layoutX,
    `source A is left of middle B  (A.x=${a.layoutX.toFixed(0)}, B.x=${b.layoutX.toFixed(0)})`,
  );
  assert(
    b.layoutX < c.layoutX,
    `middle B is left of sink C    (B.x=${b.layoutX.toFixed(0)}, C.x=${c.layoutX.toFixed(0)})`,
  );
  assertNoOverlap([a, b, c]);
});

run("Fan-out: A→B, A→C", () => {
  const [a, b, c] = [node("A"), node("B"), node("C")];
  runLayout(graph([a, b, c], [edge(a, b), edge(a, c)]));
  assert(
    a.layoutX < b.layoutX,
    `source A is left of B  (A.x=${a.layoutX.toFixed(0)}, B.x=${b.layoutX.toFixed(0)})`,
  );
  assert(
    a.layoutX < c.layoutX,
    `source A is left of C  (A.x=${a.layoutX.toFixed(0)}, C.x=${c.layoutX.toFixed(0)})`,
  );
  assertNoOverlap([a, b, c]);
});

run("Fan-in: A→C, B→C", () => {
  const [a, b, c] = [node("A"), node("B"), node("C")];
  runLayout(graph([a, b, c], [edge(a, c), edge(b, c)]));
  assert(
    a.layoutX < c.layoutX,
    `source A is left of sink C  (A.x=${a.layoutX.toFixed(0)}, C.x=${c.layoutX.toFixed(0)})`,
  );
  assert(
    b.layoutX < c.layoutX,
    `source B is left of sink C  (B.x=${b.layoutX.toFixed(0)}, C.x=${c.layoutX.toFixed(0)})`,
  );
  assertNoOverlap([a, b, c]);
});

run("Diamond: A→B, A→C, B→D, C→D", () => {
  const [a, b, c, d] = [node("A"), node("B"), node("C"), node("D")];
  runLayout(
    graph(
      [a, b, c, d],
      [edge(a, b), edge(a, c), edge(b, d), edge(c, d)],
    ),
  );
  assert(
    a.layoutX < b.layoutX,
    `A is left of B  (A.x=${a.layoutX.toFixed(0)}, B.x=${b.layoutX.toFixed(0)})`,
  );
  assert(
    a.layoutX < c.layoutX,
    `A is left of C  (A.x=${a.layoutX.toFixed(0)}, C.x=${c.layoutX.toFixed(0)})`,
  );
  assert(
    b.layoutX < d.layoutX,
    `B is left of D  (B.x=${b.layoutX.toFixed(0)}, D.x=${d.layoutX.toFixed(0)})`,
  );
  assert(
    c.layoutX < d.layoutX,
    `C is left of D  (C.x=${c.layoutX.toFixed(0)}, D.x=${d.layoutX.toFixed(0)})`,
  );
  assertNoOverlap([a, b, c, d]);
});

run("Two independent chains: A→B and C→D", () => {
  const [a, b, c, d] = [node("A"), node("B"), node("C"), node("D")];
  runLayout(graph([a, b, c, d], [edge(a, b), edge(c, d)]));
  assert(
    a.layoutX < b.layoutX,
    `chain1: A is left of B  (A.x=${a.layoutX.toFixed(0)}, B.x=${b.layoutX.toFixed(0)})`,
  );
  assert(
    c.layoutX < d.layoutX,
    `chain2: C is left of D  (C.x=${c.layoutX.toFixed(0)}, D.x=${d.layoutX.toFixed(0)})`,
  );
  assertNoOverlap([a, b, c, d]);
});

run("Long chain A→B→C→D→E", () => {
  const [a, b, c, d, e] = [
    node("A"),
    node("B"),
    node("C"),
    node("D"),
    node("E"),
  ];
  runLayout(
    graph(
      [a, b, c, d, e],
      [edge(a, b), edge(b, c), edge(c, d), edge(d, e)],
    ),
  );
  assert(
    a.layoutX < c.layoutX,
    `A is left of midpoint C  (A.x=${a.layoutX.toFixed(0)}, C.x=${c.layoutX.toFixed(0)})`,
  );
  assert(
    c.layoutX < e.layoutX,
    `midpoint C is left of sink E  (C.x=${c.layoutX.toFixed(0)}, E.x=${e.layoutX.toFixed(0)})`,
  );
  assert(
    a.layoutX < e.layoutX,
    `source A is left of sink E  (A.x=${a.layoutX.toFixed(0)}, E.x=${e.layoutX.toFixed(0)})`,
  );
  assertNoOverlap([a, b, c, d, e]);
});

run("Pure source has smallest x in its component", () => {
  const [a, b, c, d] = [node("A"), node("B"), node("C"), node("D")];
  runLayout(
    graph(
      [a, b, c, d],
      [edge(a, b), edge(a, c), edge(b, d), edge(c, d)],
    ),
  );
  const minX = Math.min(a.layoutX, b.layoutX, c.layoutX, d.layoutX);
  const maxX = Math.max(a.layoutX, b.layoutX, c.layoutX, d.layoutX);
  assert(
    a.layoutX === minX,
    `pure source A has leftmost x  (A.x=${a.layoutX.toFixed(0)}, min=${minX.toFixed(0)})`,
  );
  assert(
    d.layoutX === maxX,
    `pure sink D has rightmost x   (D.x=${d.layoutX.toFixed(0)}, max=${maxX.toFixed(0)})`,
  );
  assertNoOverlap([a, b, c, d]);
});

run("Loop: A→B and B→A (1-in-1-out each, mutually connected)", () => {
  const [a, b] = [node("A"), node("B")];
  runLayout(graph([a, b], [edge(a, b), edge(b, a)]));
  assert(
    isFinite(a.layoutX) && isFinite(a.layoutY),
    `A has finite position (x=${a.layoutX.toFixed(0)}, y=${a.layoutY.toFixed(0)})`,
  );
  assert(
    isFinite(b.layoutX) && isFinite(b.layoutY),
    `B has finite position (x=${b.layoutX.toFixed(0)}, y=${b.layoutY.toFixed(0)})`,
  );
  assertNoOverlap([a, b]);
});

run("Single node: does not crash", () => {
  const [a] = [node("A")];
  runLayout(graph([a], []));
  assert(
    isFinite(a.layoutX) && isFinite(a.layoutY),
    `single node has finite position (x=${a.layoutX}, y=${a.layoutY})`,
  );
});

run("No nodes: does not crash", () => {
  runLayout(graph([], []));
  assert(true, "completed without throwing");
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).process?.exit(1);
