import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { PDB1_VERSION } from "./data.js";
import { PDT1_VERSION } from "./texture.js";

export const PERFECT_DARK_DATASET_VERSION = 27;
export const PERFECT_DARK_MANIFEST_VERSION = 1;

export interface PerfectDarkManifestStage {
    id: string;
    backgroundFileId: number;
    hasObjectArchive: boolean;
}

export interface PerfectDarkManifest {
    manifestVersion: number;
    datasetVersion: number;
    formats: {
        level: number;
        texture: number;
    };
    rom: {
        name: string;
        md5: string;
    };
    backgroundArchiveCount: number;
    objectArchiveCount: number;
    stageCount: number;
    textureCount: number;
    stages: PerfectDarkManifestStage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0;
}

export function parsePerfectDarkManifest(buffer: ArrayBufferSlice): PerfectDarkManifest {
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder().decode(buffer.createTypedArray(Uint8Array)));
    } catch (error) {
        throw new Error(`Invalid Perfect Dark data manifest: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(value) || value.manifestVersion !== PERFECT_DARK_MANIFEST_VERSION)
        throw new Error("Unsupported Perfect Dark data manifest version");
    if (value.datasetVersion !== PERFECT_DARK_DATASET_VERSION)
        throw new Error(`Perfect Dark data manifest has dataset version ${String(value.datasetVersion)}; expected ${PERFECT_DARK_DATASET_VERSION}`);
    if (!isRecord(value.formats) || value.formats.level !== PDB1_VERSION || value.formats.texture !== PDT1_VERSION)
        throw new Error("Perfect Dark data manifest contains unsupported archive formats");
    if (!isRecord(value.rom) || typeof value.rom.name !== "string" || value.rom.name.length === 0
            || typeof value.rom.md5 !== "string" || !/^[0-9a-f]{32}$/.test(value.rom.md5))
        throw new Error("Perfect Dark data manifest contains an invalid ROM identity");
    if (!isNonNegativeInteger(value.backgroundArchiveCount) || value.backgroundArchiveCount === 0
            || !isNonNegativeInteger(value.objectArchiveCount)
            || !isNonNegativeInteger(value.stageCount)
            || !isNonNegativeInteger(value.textureCount) || value.textureCount === 0
            || !Array.isArray(value.stages))
        throw new Error("Perfect Dark data manifest contains invalid archive counts");

    const stages: PerfectDarkManifestStage[] = [];
    const stageIds = new Set<string>();
    for (const stage of value.stages) {
        if (!isRecord(stage) || typeof stage.id !== "string" || stage.id.length === 0 || stageIds.has(stage.id)
                || !isNonNegativeInteger(stage.backgroundFileId) || stage.backgroundFileId === 0
                || typeof stage.hasObjectArchive !== "boolean")
            throw new Error("Perfect Dark data manifest contains an invalid stage entry");
        stageIds.add(stage.id);
        stages.push({ id: stage.id, backgroundFileId: stage.backgroundFileId, hasObjectArchive: stage.hasObjectArchive });
    }
    if (value.stageCount !== stages.length)
        throw new Error(`Perfect Dark data manifest declares ${value.stageCount} stages but contains ${stages.length}`);
    const objectArchiveCount = stages.filter((stage) => stage.hasObjectArchive).length;
    if (value.objectArchiveCount !== objectArchiveCount)
        throw new Error(`Perfect Dark data manifest declares ${value.objectArchiveCount} object archives but contains ${objectArchiveCount}`);

    return {
        manifestVersion: value.manifestVersion,
        datasetVersion: value.datasetVersion,
        formats: { level: PDB1_VERSION, texture: PDT1_VERSION },
        rom: { name: value.rom.name, md5: value.rom.md5 },
        backgroundArchiveCount: value.backgroundArchiveCount,
        objectArchiveCount: value.objectArchiveCount,
        stageCount: value.stageCount,
        textureCount: value.textureCount,
        stages,
    };
}
