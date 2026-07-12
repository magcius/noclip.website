import { SHDR } from "../../chunk/shoc/shdr";
import { readFourCC } from "../../helpers/fourCC";
import { parseChunks } from "../chunk";
import { parseObf, Obf } from "./obf";

export interface Gmd {
  rawData: Uint8Array;
}

export interface O3D {
  kind: "O3D";
  rawData: Uint8Array;
  resourceName: string;
  shocHeader: SHDR;
  isAnimated: boolean;
  gmds: Gmd[];
  obfs: Obf[];
}

export function parseO3D(
  isAnimated: boolean,
  buf: Uint8Array,
  header: SHDR,
  resName: string,
): O3D {
  const o3d: O3D = {
    kind: "O3D",
    rawData: buf,
    resourceName: resName,
    shocHeader: header,
    isAnimated,
    gmds: [],
    obfs: [],
  };

  const chunks = parseChunks(buf);

  for (const chunk of chunks) {
    const magic = readFourCC(chunk.magic, 0);
    switch (magic) {
      case "Gmd ":
        o3d.gmds.push({ rawData: chunk.payload });
        break;
      case "Obf ":
        o3d.obfs.push(parseObf(chunk.payload));
        break;
      case "Part":
      case "o3da":
      case "ExpF":
        break;
      default:
        console.warn("UNRECOGNIZED CHUNK MAGIC: " + magic + " " + resName);
        throw new Error("Unhandled o3d Chunk Magic: " + magic);
    }
  }

  return o3d;
}
