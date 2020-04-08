
// Common utilities for the N64 Reality Signal Processor (RDP).

export interface RSPVertex {
    x: number;
    y: number;
    z: number;
    // Texture coordinates.
    tx: number;
    ty: number;
    // Color or normals.
    c0: number;
    c1: number;
    c2: number;
    // Alpha.
    a: number;
}

export function loadVertexFromView(dst: RSPVertex, view: DataView, offs: number): void {
    dst.x = view.getInt16(offs + 0x00);
    dst.y = view.getInt16(offs + 0x02);
    dst.z = view.getInt16(offs + 0x04);
    // flag (unused)
    // TODO(jstpierre): I don't think this + 0.5 is correct.
    dst.tx = (view.getInt16(offs + 0x08) / 0x20) + 0.5; // Convert from S10.5 fixed-point
    dst.ty = (view.getInt16(offs + 0x0A) / 0x20) + 0.5;
    dst.c0 = view.getUint8(offs + 0x0C) / 0xFF;
    dst.c1 = view.getUint8(offs + 0x0D) / 0xFF;
    dst.c2 = view.getUint8(offs + 0x0E) / 0xFF;
    dst.a = view.getUint8(offs + 0x0F) / 0xFF;
}
