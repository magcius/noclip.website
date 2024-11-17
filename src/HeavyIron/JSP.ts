import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert } from "../util.js";
import { HICamera } from "./HICamera.js";
import { HIScene } from "./HIScene.js";
import { RpAtomic, RpAtomicFlag, RpClump, RpGeometry, RpGeometryFlag } from "./rw/rpworld.js";
import { RwChunkHeader, RwCullMode, RwEngine, RwPluginID, RwStream } from "./rw/rwcore.js";

enum JSPNodeFlags {
    VISIBLE = 0x1,
    DISABLEZWRITE = 0x2,
    DISABLECULL = 0x4
}

interface JSPNode {
    atomic: RpAtomic;
    nodeFlags: number;
}

export class JSP {
    public nodeList: JSPNode[] = [];
    public showAllNodesHack = false;

    public render(scene: HIScene, rw: RwEngine) {
        for (const node of this.nodeList) {
            if ((this.showAllNodesHack || (node.atomic.flags & RpAtomicFlag.RENDER)) &&
                !scene.camera.cullModel(node.atomic, node.atomic.frame.matrix, rw)) {
                
                const oldflag = node.atomic.geometry.flags;
                if (!scene.renderHacks.vertexColors) {
                    node.atomic.geometry.flags &= ~(RpGeometryFlag.PRELIT | RpGeometryFlag.LIGHT);
                }

                rw.renderState.cullMode = (node.nodeFlags & JSPNodeFlags.DISABLECULL) ? RwCullMode.NONE : RwCullMode.BACK;
                rw.renderState.zWriteEnable = (node.nodeFlags & JSPNodeFlags.DISABLEZWRITE) === 0;

                node.atomic.render(rw);

                node.atomic.geometry.flags = oldflag;
            }
        }
    }

    public load(data: ArrayBufferSlice, rw: RwEngine) {
        const stream = new RwStream(data);
        const header = stream.readChunkHeader();
        
        if (header.type === 0xBEEF01) {
            this.loadJSPInfo(stream, header, rw);
        } else if (header.type === RwPluginID.CLUMP) {
            this.loadClump(stream, rw);
        }
    }

    private loadClump(stream: RwStream, rw: RwEngine) {
        const clump = RpClump.streamRead(stream, rw);
        if (clump) {
            for (let i = clump.atomics.length - 1; i >= 0; i--) {
                this.nodeList.push({ atomic: clump.atomics[i], nodeFlags: 0 });
            }
        }
    }

    private loadJSPInfo(stream: RwStream, header: RwChunkHeader, rw: RwEngine) {
        // BSP Tree - skip for now
        stream.pos = header.end;

        while (stream.pos < stream.buffer.byteLength) {
            const header = stream.readChunkHeader();
            if (header.type === 0xBEEF02) {
                const idtag = stream.readUint32();
                const version = stream.readUint32();
                const jspNodeCount = stream.readUint32();
                stream.pos += 12;

                // This should be true as long as the BSP layers are before the JSPINFO layer in the .HOP file
                assert(jspNodeCount === this.nodeList.length);

                for (let i = 0; i < jspNodeCount; i++) {
                    const originalMatIndex = stream.readInt32();
                    const nodeFlags = stream.readInt32();

                    this.nodeList[i].nodeFlags = nodeFlags;
                }
            }
            stream.pos = header.end;
        }
    }

    public destroy(rw: RwEngine) {
        for (const node of this.nodeList) {
            node.atomic.destroy(rw);
        }
    }
}