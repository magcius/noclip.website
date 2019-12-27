import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, align } from "../util";
import { InputStream } from "./stream";

export const enum CompressionMethod {
    NONE,
    SMB, // Super Monkey Ball
    SMB2, // Super Monkey Ball 2 and F-ZERO AX
    GFZ // F-ZERO GX
}