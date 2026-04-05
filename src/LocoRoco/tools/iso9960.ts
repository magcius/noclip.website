/*
 * iso9960 handling taken from KatamariDamacy code, which was ported from "unpack.py" by Murugo. Minor changes to handle subdirectories.
 */

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { openSync, readSync, closeSync } from "fs";
import { readString } from "../../util.js";

function fetchDataFragmentSync(
  path: string,
  byteOffset: number,
  byteLength: number,
): ArrayBufferSlice {
  const fd = openSync(path, "r");
  const b = Buffer.alloc(byteLength);
  readSync(fd, b, 0, byteLength, byteOffset);
  closeSync(fd);
  return new ArrayBufferSlice(b.buffer, b.byteOffset, b.byteLength);
}

const logicalBlockSize = 0x800;
function iso9660GetDataLBA(
  isoFilename: string,
  lba: number,
  byteLength: number,
): ArrayBufferSlice {
  return fetchDataFragmentSync(isoFilename, lba * logicalBlockSize, byteLength);
}

function iso9660FindInDirectory(
  isoFilename: string,
  directoryLBA: number,
  pathParts: string[],
): ArrayBufferSlice | null {
  if (pathParts.length === 0) return null;

  const directory = iso9660GetDataLBA(
    isoFilename,
    directoryLBA,
    logicalBlockSize,
  );
  const directoryView = directory.createDataView();

  let offs = 0x00;
  while (true) {
    const recordLen = directoryView.getUint8(offs + 0x00);
    if (recordLen === 0) break;

    const lba = directoryView.getUint32(offs + 0x02, true);
    const byteLength = directoryView.getUint32(offs + 0x0a, true);
    const fileFlags = directoryView.getUint8(offs + 0x19);
    const isDirectory = (fileFlags & 0x02) !== 0;
    const dirFilenameLength = directoryView.getUint8(offs + 0x20);
    const dirFilename = readString(directory, offs + 0x21, dirFilenameLength);

    // Skip "." and ".." entries
    if (dirFilename !== "\x00" && dirFilename !== "\x01") {
      if (dirFilename === pathParts[0]) {
        if (pathParts.length === 1) {
          // This is the file we're looking for
          return iso9660GetDataLBA(isoFilename, lba, byteLength);
        } else if (isDirectory) {
          // This is a directory we need to traverse
          return iso9660FindInDirectory(isoFilename, lba, pathParts.slice(1));
        }
      }
    }

    offs += recordLen;
  }

  return null;
}

export function iso9660GetDataFilename(
  isoFilename: string,
  filename: string,
): ArrayBufferSlice | null {
  const primaryVolume = iso9660GetDataLBA(
    isoFilename,
    0x10,
    logicalBlockSize * 2,
  );

  const primaryVolumeMagic = readString(primaryVolume, 0x00, 0x06);
  if (primaryVolumeMagic !== "\x01CD001")
    throw new Error("Expected primary volume descriptor at offset 0x8000");

  const primaryVolumeView = primaryVolume.createDataView();

  const rootDirectoryLBA = primaryVolumeView.getUint32(0x009e, true);

  // Split the path into parts
  const pathParts = filename.split("/").filter((part) => part.length > 0);
  if (pathParts.length === 0) return null;

  return iso9660FindInDirectory(isoFilename, rootDirectoryLBA, pathParts);
}
