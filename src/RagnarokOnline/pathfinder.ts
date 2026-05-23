
// A* cell pathfinder over the GAT walkability grid. Port of the 2008 client's
// CPathFinder::FindPath: same neighbour expansion order, the engine's costs
// (10 orthogonal, 14 diagonal, Manhattan*10 heuristic), the same node state
// machine (UNEXPLORED -> OPEN -> CLOSED with re-opening on a cheaper path),
// and the same MAX_PATHNODE budget. Direction codes 0..7 are the engine's,
// and the wander controller maps them to actor facings.

import { GatMap, isWalkable } from "./gat.js";

const COST_ORTHO = 10;
const COST_DIAG = 14;
const MAX_PATHNODE = 150;

const UNEXPLORED = 0;
const OPEN = 1;
const CLOSED = 2;

// One step of a found path: the GAT cell and the engine direction code (0..7)
// of the step that arrives at it.
export interface PathStep {
    x: number;
    y: number;
    dir: number;
}

interface PathNode {
    x: number;
    y: number;
    cost: number;   // g: accumulated cost from start
    total: number;  // f: cost + heuristic
    dir: number;
    type: number;
    parent: PathNode | null;
}

// Direction codes: 0=+Y, 1=-X+Y, 2=-X, 3=-X-Y, 4=-Y, 5=+X-Y, 6=+X, 7=+X+Y.
const NEIGHBORS: { dx: number, dy: number, cost: number, dir: number }[] = [
    { dx: +1, dy: -1, cost: COST_DIAG, dir: 5 },
    { dx: +1, dy: 0, cost: COST_ORTHO, dir: 6 },
    { dx: +1, dy: +1, cost: COST_DIAG, dir: 7 },
    { dx: 0, dy: +1, cost: COST_ORTHO, dir: 0 },
    { dx: -1, dy: +1, cost: COST_DIAG, dir: 1 },
    { dx: -1, dy: 0, cost: COST_ORTHO, dir: 2 },
    { dx: -1, dy: -1, cost: COST_DIAG, dir: 3 },
    { dx: 0, dy: -1, cost: COST_ORTHO, dir: 4 },
];

// Returns the cell path from (sx, sy) to (dx, dy) inclusive, or null if start
// equals goal, the goal is unwalkable, or no path exists within the node budget.
export function findPath(gat: GatMap, sx: number, sy: number, dx: number, dy: number): PathStep[] | null {
    if (sx === dx && sy === dy)
        return null;
    if (!isWalkable(gat, dx, dy))
        return null;

    const heuristic = (x: number, y: number): number => (Math.abs(x - dx) + Math.abs(y - dy)) * 10;

    const master = new Map<number, PathNode>();
    const key = (x: number, y: number): number => x + y * gat.width;
    let poolCount = 0;

    const getNode = (x: number, y: number): PathNode | null => {
        const k = key(x, y);
        const existing = master.get(k);
        if (existing !== undefined)
            return existing;
        if (poolCount >= MAX_PATHNODE - 1)
            return null;
        poolCount++;
        const node: PathNode = { x, y, cost: 0, total: 0, dir: 0, type: UNEXPLORED, parent: null };
        master.set(k, node);
        return node;
    };

    // Min-heap by node.total. Stale entries (a popped node already CLOSED) are
    // skipped at pop time.
    const heap: PathNode[] = [];
    const heapPush = (node: PathNode): void => {
        heap.push(node);
        let i = heap.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heap[parent].total <= heap[i].total)
                break;
            [heap[parent], heap[i]] = [heap[i], heap[parent]];
            i = parent;
        }
    };
    const heapPop = (): PathNode => {
        const top = heap[0];
        const last = heap.pop()!;
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = 2 * i + 2;
                let smallest = i;
                if (l < heap.length && heap[l].total < heap[smallest].total) smallest = l;
                if (r < heap.length && heap[r].total < heap[smallest].total) smallest = r;
                if (smallest === i)
                    break;
                [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
                i = smallest;
            }
        }
        return top;
    };

    const start = getNode(sx, sy)!;
    start.type = OPEN;
    start.parent = null;
    start.cost = 0;
    start.total = heuristic(sx, sy);
    heapPush(start);

    const processNode = (parent: PathNode, traverseCost: number, x: number, y: number, dir: number): boolean => {
        const newCost = parent.cost + traverseCost;
        const node = getNode(x, y);
        if (node === null)
            return false; // node pool exhausted
        if (node.type !== UNEXPLORED) {
            if (node.cost <= newCost)
                return true;
            node.parent = parent;
            node.cost = newCost;
            node.total = newCost + heuristic(x, y);
            node.dir = dir;
            if (node.type === OPEN)
                heapPush(node); // re-insert; stale dup tolerated at pop
            else if (node.type === CLOSED) {
                node.type = OPEN;
                heapPush(node);
            }
        } else {
            node.type = OPEN;
            node.parent = parent;
            node.cost = newCost;
            node.total = newCost + heuristic(x, y);
            node.dir = dir;
            heapPush(node);
        }
        return true;
    };

    while (heap.length > 0) {
        const best = heapPop();
        if (best.type === CLOSED)
            continue;
        if (best.x === dx && best.y === dy)
            return buildResultPath(best);

        for (const n of NEIGHBORS) {
            const nx = best.x + n.dx, ny = best.y + n.dy;
            if (!isWalkable(gat, nx, ny))
                continue;
            if (!processNode(best, n.cost, nx, ny, n.dir))
                return null;
        }
        best.type = CLOSED;
    }

    return null;
}

function buildResultPath(goal: PathNode): PathStep[] {
    const reversed: PathStep[] = [];
    let node: PathNode | null = goal;
    while (node !== null) {
        reversed.push({ x: node.x, y: node.y, dir: node.dir });
        node = node.parent;
    }
    reversed.reverse();
    return reversed;
}
