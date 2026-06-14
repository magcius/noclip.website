import { SHDR } from "../chunk/shoc/shdr";

export interface TextEntry {
  index: number;
  value: string;
}

export interface TxtR {
  kind: "TxtR";
  header: SHDR;
  textEntries: TextEntry[];
  raw: Uint8Array;
}

export function parseTxtR(buf: Uint8Array, header: SHDR): TxtR {
  const textEntries: TextEntry[] = [];
  let i = 0;
  const decoder = new TextDecoder();

  while (i < buf.length) {
    const start = i;
    while (i < buf.length && buf[i] !== 0) i++;

    if (i === start) {
      i++;
      continue;
    }

    const s = decoder.decode(buf.slice(start, i));

    let num = -1;
    let textPart = "";
    const spaceIdx = s.indexOf(" ");
    if (spaceIdx !== -1) {
      const parsed = parseInt(s.slice(0, spaceIdx), 10);
      num = isNaN(parsed) ? -1 : parsed;
      textPart = s.slice(spaceIdx + 1);
    }

    textEntries.push({ index: num, value: textPart });
    i++;
  }

  return { kind: "TxtR", header, textEntries, raw: buf };
}
