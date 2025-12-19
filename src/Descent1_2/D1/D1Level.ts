import { vec3 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { DescentDataReader } from "../Common/DataReader";
import { DescentFlickeringLight, DescentLevel } from "../Common/Level";
import { DescentObject, readObject } from "../Common/LevelObject";
import {
    readLevelGameInfo,
    readSegmentConnections,
    readSegmentSpecial,
    readSegmentTextures,
    readSegmentVertices,
    readSegmentWalls,
    readWall,
} from "../Common/LevelReaders";
import {
    DescentLevelGameInfo,
    DescentSegment,
    DescentWall,
} from "../Common/LevelTypes";

/**
 * A registered level in Descent (1) (.RDL).
 */
export class Descent1Level extends DescentLevel {
    public readonly gameVersion: 1 = 1;

    private mineDataBase: number;
    private gameDataBase: number;
    private gameInfo: DescentLevelGameInfo;

    public vertices: vec3[] = [];
    public segments: DescentSegment[] = [];
    public walls: DescentWall[] = [];
    public objects: DescentObject[] = [];
    public readonly paletteName = "palette";
    public readonly flickeringLights: DescentFlickeringLight[] = [];

    constructor(private buffer: ArrayBufferSlice) {
        super();

        const reader = new DescentDataReader(buffer);
        assert(reader.readString(4) === "LVLP");
        const levelVersion = reader.readInt32();
        assert(levelVersion === 1);
        this.mineDataBase = reader.readInt32();
        this.gameDataBase = reader.readInt32();
        reader.offset += 4;

        // Mine data
        reader.offset = this.mineDataBase + 1;
        const vertexCount = reader.readInt16();
        const segmentCount = reader.readInt16();
        for (let i = 0; i < vertexCount; ++i) {
            this.vertices.push(reader.readFixVector());
        }
        for (let i = 0; i < segmentCount; ++i) {
            this.segments.push(new DescentSegment());
        }
        let segmentIndex = 0;
        for (const segment of this.segments) {
            const mask = reader.readUint8();
            readSegmentConnections(
                reader,
                levelVersion,
                segment,
                this.segments,
                mask,
            );
            readSegmentVertices(reader, levelVersion, segment, this.vertices);
            readSegmentSpecial(reader, levelVersion, segment, mask);
            segment.light = reader.readUint16() / 4096.0;
            readSegmentWalls(reader, levelVersion, segment);
            readSegmentTextures(reader, levelVersion, segment);
            ++segmentIndex;
        }

        // Game info
        reader.offset = this.gameDataBase;
        const gameInfo = readLevelGameInfo(reader, levelVersion);
        this.gameInfo = gameInfo;
        if (gameInfo.objectsOffset !== -1) {
            reader.offset = gameInfo.objectsOffset;
            for (let i = 0; i < gameInfo.objectsCount; ++i) {
                this.objects.push(readObject(reader, gameInfo.version));
            }
        }
        if (gameInfo.wallsOffset !== -1) {
            reader.offset = gameInfo.wallsOffset;
            for (let i = 0; i < gameInfo.wallsCount; ++i) {
                this.walls.push(readWall(reader, gameInfo.version));
            }
        }
    }

    public override destroy(): void {}
}
