import { mat3, vec3 } from "gl-matrix";
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
 * A registered level in Descent (2) (.RL2).
 */
export class Descent2Level extends DescentLevel {
    public readonly gameVersion: 2 = 2;

    private mineDataBase: number;
    private gameDataBase: number;
    private gameInfo: DescentLevelGameInfo;
    private secretLevelReturnSegment: number;
    private secretLevelReturnOrientation: mat3;

    public vertices: vec3[] = [];
    public segments: DescentSegment[] = [];
    public walls: DescentWall[] = [];
    public objects: DescentObject[] = [];
    public paletteName: string;
    public flickeringLights: DescentFlickeringLight[] = [];

    constructor(private buffer: ArrayBufferSlice) {
        super();

        const reader = new DescentDataReader(buffer);
        assert(reader.readString(4) === "LVLP");
        const levelVersion = reader.readInt32();
        assert(levelVersion >= 2 && levelVersion <= 8);
        this.mineDataBase = reader.readInt32();
        this.gameDataBase = reader.readInt32();
        if (levelVersion >= 8) reader.offset += 7;
        if (levelVersion < 5) reader.offset += 4;

        this.paletteName = reader.readLevelString(13).replace(/.256$/, "");
        if (levelVersion >= 3) reader.offset += 4;
        if (levelVersion >= 4) reader.offset += 4;

        if (levelVersion >= 7) {
            const flickeringLightsCount = reader.readInt32();
            for (let i = 0; i < flickeringLightsCount; ++i) {
                const segmentNum = reader.readInt16();
                const sideNum = reader.readInt16();
                const mask = reader.readUint32();
                const timer = reader.readFix();
                const delay = reader.readFix();
                this.flickeringLights.push(
                    new DescentFlickeringLight(
                        segmentNum,
                        sideNum,
                        mask,
                        timer,
                        delay,
                    ),
                );
            }
        }

        if (levelVersion >= 6) {
            this.secretLevelReturnSegment = reader.readInt32();
            const temp = mat3.create();
            mat3.transpose(temp, reader.readFixMatrix());
            this.secretLevelReturnOrientation = temp;
        }

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
            if (levelVersion === 5) {
                readSegmentSpecial(reader, levelVersion, segment, mask);
                readSegmentVertices(
                    reader,
                    levelVersion,
                    segment,
                    this.vertices,
                );
                readSegmentConnections(
                    reader,
                    levelVersion,
                    segment,
                    this.segments,
                    mask,
                );
            } else {
                readSegmentConnections(
                    reader,
                    levelVersion,
                    segment,
                    this.segments,
                    mask,
                );
                readSegmentVertices(
                    reader,
                    levelVersion,
                    segment,
                    this.vertices,
                );
            }
            if (levelVersion <= 5) segment.light = reader.readUint16() / 4096.0;
            readSegmentWalls(reader, levelVersion, segment);
            readSegmentTextures(reader, levelVersion, segment);
            ++segmentIndex;
        }

        if (levelVersion > 5) {
            for (const segment of this.segments) {
                readSegmentSpecial(reader, levelVersion, segment);
            }
        }

        // Game data
        reader.offset = this.gameDataBase;

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

    public destroy(): void {}
}
