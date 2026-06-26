
// Parser for Incoming (1998, Rage Software) ".wdl" world-definition files.

/**
 * A single placed object instance from a `.wdl` file. The orientation is given by a forward and up
 * vector; the right vector is derived as `up × forward` when building the model matrix.
 */
export interface IncomingPlacement {
    /** The object type name to instance (matches an `IncomingObjectType.name`). */
    readonly typeName: string;
    /** The instance's `label "x"`, used by `.mdl` placements that position relative to it;
     *  undefined if unlabeled. */
    readonly label?: string;
    /** World X coordinate. */
    readonly x: number;
    /** World Y coordinate. Only meaningful when {@link onGround} is false. */
    readonly y: number;
    /** World Z coordinate. */
    readonly z: number;
    /** If true, Y must be sampled from the terrain heightfield at (x, z). */
    readonly onGround: boolean;
    /** Forward orientation vector. */
    readonly forward: [number, number, number];
    /** Up orientation vector. */
    readonly up: [number, number, number];
}

/**
 * Strips a `;` or `#` line comment (outside of quotes) from a single line.
 * @param line The raw line.
 * @returns The line with any trailing comment removed.
 */
export function stripComment(line: string): string {
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuote = !inQuote;
        } else if (!inQuote && (c === ";" || c === "#")) {
            return line.substring(0, i);
        }
    }
    return line;
}

/**
 * Tokenizes a line, keeping double-quoted spans as single tokens.
 * @param line The (comment-stripped) line.
 * @returns The list of tokens.
 */
export function tokenize(line: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < line.length) {
        const c = line[i];
        if (c === " " || c === "\t" || c === "\r") {
            i++;
        } else if (c === '"') {
            let j = i + 1;
            while (j < line.length && line[j] !== '"') {
                j++;
            }
            tokens.push(line.substring(i + 1, j));
            i = j + 1;
        } else {
            let j = i;
            while (j < line.length && line[j] !== " " && line[j] !== "\t" && line[j] !== "\r") {
                j++;
            }
            tokens.push(line.substring(i, j));
            i = j;
        }
    }
    return tokens;
}

/**
 * Parses a float, returning a fallback for invalid input.
 * @param t The token (may be undefined).
 * @param fallback The value to return for missing/invalid input.
 * @returns The parsed float, or the fallback.
 */
export function num(t: string | undefined, fallback = 0): number {
    const n = t !== undefined ? parseFloat(t) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Parses an Incoming `.wdl` file into a flat list of object placements.
 * @param text The full text of the `.wdl` file.
 * @returns Every `create` placement, in file order.
 */
export function parseWDL(text: string): IncomingPlacement[] {
    const placements: IncomingPlacement[] = [];
    const lines = text.split("\n");
    let typeName: string | undefined;
    let label: string | undefined;
    let x = 0, y = 0, z = 0, onGround = false;
    let forward: [number, number, number] = [0, 0, 1];
    let up: [number, number, number] = [0, 1, 0];
    const flush = () => {
        if (typeName !== undefined) {
            placements.push({ typeName, ...(label !== undefined ? { label } : {}), x, y, z, onGround, forward, up });
        }
    };

    for (const rawLine of lines) {
        const tokens = tokenize(stripComment(rawLine));
        if (tokens.length === 0) {
            continue;
        }
        const kw = tokens[0].toLowerCase();

        if (kw === "create") {
            flush();
            typeName = tokens.length >= 2 ? tokens[1] : "";
            label = undefined;
            x = 0; y = 0; z = 0; onGround = false;
            forward = [0, 0, 1];
            up = [0, 1, 0];
        } else if (kw === "label") {
            if (tokens.length >= 2) {
                label = tokens[1];
            }
        } else if (kw === "position") {
            // Handle "position X on ground Z" OR "position X Y Z".
            const groundIdx = tokens.findIndex((t) => t.toLowerCase() === "ground");
            if (groundIdx >= 0) {
                onGround = true;
                x = num(tokens[1]);
                z = num(tokens[groundIdx + 1]);
                y = 0;
            } else {
                onGround = false;
                x = num(tokens[1]);
                y = num(tokens[2]);
                z = num(tokens[3]);
            }
        } else if (kw === "forward") {
            // Handle "forward fx fy fz up ux uy uz".
            forward = [num(tokens[1]), num(tokens[2]), num(tokens[3])];
            const upIdx = tokens.findIndex((t) => t.toLowerCase() === "up");
            if (upIdx >= 0) {
                up = [num(tokens[upIdx + 1]), num(tokens[upIdx + 2]), num(tokens[upIdx + 3])];
            }
        }
    }
    flush();

    return placements;
}
