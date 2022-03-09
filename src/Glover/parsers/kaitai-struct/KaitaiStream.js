// -*- mode: js; js-indent-level: 2; -*-
'use strict';
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KaitaiStream = factory();
  }
}(this, function () {

/**
  KaitaiStream is an implementation of Kaitai Struct API for JavaScript.
  Based on DataStream - https://github.com/kig/DataStream.js

  @param {ArrayBuffer} arrayBuffer ArrayBuffer to read from.
  @param {?Number} byteOffset Offset from arrayBuffer beginning for the KaitaiStream.
  */
var KaitaiStream = function(arrayBuffer, byteOffset) {
  this._byteOffset = byteOffset || 0;
  if (arrayBuffer instanceof ArrayBuffer) {
    this.buffer = arrayBuffer;
  } else if (typeof arrayBuffer == "object") {
    this.dataView = arrayBuffer;
    if (byteOffset) {
      this._byteOffset += byteOffset;
    }
  } else {
    this.buffer = new ArrayBuffer(arrayBuffer || 1);
  }
  this.pos = 0;
  this.alignToByte();
};


KaitaiStream.prototype = {};

/**
  Dependency configuration data. Holds urls for (optional) dynamic loading
  of code dependencies from a remote server. For use by (static) processing functions.

  Caller should the supported keys to the asset urls as needed.
  NOTE: `depUrls` is a static property of KaitaiStream (the factory),like the various
        processing functions. It is NOT part of the prototype of instances.
  @type {Object}
  */
KaitaiStream.depUrls = {
  // processZlib uses this and expected a link to a copy of pako.
  // specifically the pako_inflate.min.js script at:
  // https://raw.githubusercontent.com/nodeca/pako/master/dist/pako_inflate.min.js
  zlib: undefined
};

/**
  Virtual byte length of the KaitaiStream backing buffer.
  Updated to be max of original buffer size and last written size.
  If dynamicSize is false is set to buffer size.
  @type {number}
  */
KaitaiStream.prototype._byteLength = 0;

/**
  Set/get the backing ArrayBuffer of the KaitaiStream object.
  The setter updates the DataView to point to the new buffer.
  @type {Object}
  */
Object.defineProperty(KaitaiStream.prototype, 'buffer',
  { get: function() {
      this._trimAlloc();
      return this._buffer;
    },
    set: function(v) {
      this._buffer = v;
      this._dataView = new DataView(this._buffer, this._byteOffset);
      this._byteLength = this._buffer.byteLength;
    } });

/**
  Set/get the byteOffset of the KaitaiStream object.
  The setter updates the DataView to point to the new byteOffset.
  @type {number}
  */
Object.defineProperty(KaitaiStream.prototype, 'byteOffset',
  { get: function() {
      return this._byteOffset;
    },
    set: function(v) {
      this._byteOffset = v;
      this._dataView = new DataView(this._buffer, this._byteOffset);
      this._byteLength = this._buffer.byteLength;
    } });

/**
  Set/get the backing DataView of the KaitaiStream object.
  The setter updates the buffer and byteOffset to point to the DataView values.
  @type {Object}
  */
Object.defineProperty(KaitaiStream.prototype, 'dataView',
  { get: function() {
      return this._dataView;
    },
    set: function(v) {
      this._byteOffset = v.byteOffset;
      this._buffer = v.buffer;
      this._dataView = new DataView(this._buffer, this._byteOffset);
      this._byteLength = this._byteOffset + v.byteLength;
    } });

/**
  Internal function to trim the KaitaiStream buffer when required.
  Used for stripping out the extra bytes from the backing buffer when
  the virtual byteLength is smaller than the buffer byteLength (happens after
  growing the buffer with writes and not filling the extra space completely).

  @return {null}
  */
KaitaiStream.prototype._trimAlloc = function() {
  if (this._byteLength === this._buffer.byteLength) {
    return;
  }
  var buf = new ArrayBuffer(this._byteLength);
  var dst = new Uint8Array(buf);
  var src = new Uint8Array(this._buffer, 0, dst.length);
  dst.set(src);
  this.buffer = buf;
};

// ========================================================================
// Stream positioning
// ========================================================================

/**
  Returns true if the KaitaiStream seek pointer is at the end of buffer and
  there's no more data to read.

  @return {boolean} True if the seek pointer is at the end of the buffer.
  */
KaitaiStream.prototype.isEof = function() {
  return this.pos >= this.size && this.bitsLeft === 0;
};

/**
  Sets the KaitaiStream read/write position to given position.
  Clamps between 0 and KaitaiStream length.

  @param {number} pos Position to seek to.
  @return {null}
  */
KaitaiStream.prototype.seek = function(pos) {
  var npos = Math.max(0, Math.min(this.size, pos));
  this.pos = (isNaN(npos) || !isFinite(npos)) ? 0 : npos;
};

/**
  Returns the byte length of the KaitaiStream object.
  @type {number}
  */
Object.defineProperty(KaitaiStream.prototype, 'size',
  { get: function() {
    return this._byteLength - this._byteOffset;
  }});

// ========================================================================
// Integer numbers
// ========================================================================

// ------------------------------------------------------------------------
// Signed
// ------------------------------------------------------------------------

/**
  Reads an 8-bit signed int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readS1 = function() {
  this.ensureBytesLeft(1);
  var v = this._dataView.getInt8(this.pos);
  this.pos += 1;
  return v;
};

// ........................................................................
// Big-endian
// ........................................................................

/**
  Reads a 16-bit big-endian signed int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readS2be = function() {
  this.ensureBytesLeft(2);
  var v = this._dataView.getInt16(this.pos);
  this.pos += 2;
  return v;
};

/**
  Reads a 32-bit big-endian signed int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readS4be = function() {
  this.ensureBytesLeft(4);
  var v = this._dataView.getInt32(this.pos);
  this.pos += 4;
  return v;
};

/**
  Reads a 64-bit big-endian unsigned int from the stream. Note that
  JavaScript does not support 64-bit integers natively, so it will
  automatically upgrade internal representation to use IEEE 754
  double precision float.
  @return {number} The read number.
 */
KaitaiStream.prototype.readS8be = function() {
  this.ensureBytesLeft(8);
  var v1 = this.readU4be();
  var v2 = this.readU4be();

  if ((v1 & 0x80000000) !== 0) {
    // negative number
    return -(0x100000000 * (v1 ^ 0xffffffff) + (v2 ^ 0xffffffff)) - 1;
  } else {
    return 0x100000000 * v1 + v2;
  }
};

// ........................................................................
// Little-endian
// ........................................................................

/**
  Reads a 16-bit little-endian signed int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readS2le = function() {
  this.ensureBytesLeft(2);
  var v = this._dataView.getInt16(this.pos, true);
  this.pos += 2;
  return v;
};

/**
  Reads a 32-bit little-endian signed int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readS4le = function() {
  this.ensureBytesLeft(4);
  var v = this._dataView.getInt32(this.pos, true);
  this.pos += 4;
  return v;
};

/**
  Reads a 64-bit little-endian unsigned int from the stream. Note that
  JavaScript does not support 64-bit integers natively, so it will
  automatically upgrade internal representation to use IEEE 754
  double precision float.
  @return {number} The read number.
 */
KaitaiStream.prototype.readS8le = function() {
  this.ensureBytesLeft(8);
  var v1 = this.readU4le();
  var v2 = this.readU4le();

  if ((v2 & 0x80000000) !== 0) {
    // negative number
    return -(0x100000000 * (v2 ^ 0xffffffff) + (v1 ^ 0xffffffff)) - 1;
  } else {
    return 0x100000000 * v2 + v1;
  }
};

// ------------------------------------------------------------------------
// Unsigned
// ------------------------------------------------------------------------

/**
  Reads an 8-bit unsigned int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readU1 = function() {
  this.ensureBytesLeft(1);
  var v = this._dataView.getUint8(this.pos);
  this.pos += 1;
  return v;
};

// ........................................................................
// Big-endian
// ........................................................................

/**
  Reads a 16-bit big-endian unsigned int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readU2be = function() {
  this.ensureBytesLeft(2);
  var v = this._dataView.getUint16(this.pos);
  this.pos += 2;
  return v;
};

/**
  Reads a 32-bit big-endian unsigned int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readU4be = function() {
  this.ensureBytesLeft(4);
  var v = this._dataView.getUint32(this.pos);
  this.pos += 4;
  return v;
};

/**
  Reads a 64-bit big-endian unsigned int from the stream. Note that
  JavaScript does not support 64-bit integers natively, so it will
  automatically upgrade internal representation to use IEEE 754
  double precision float.
  @return {number} The read number.
 */
KaitaiStream.prototype.readU8be = function() {
  this.ensureBytesLeft(8);
  var v1 = this.readU4be();
  var v2 = this.readU4be();
  return 0x100000000 * v1 + v2;
};

// ........................................................................
// Little-endian
// ........................................................................

/**
  Reads a 16-bit little-endian unsigned int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readU2le = function() {
  this.ensureBytesLeft(2);
  var v = this._dataView.getUint16(this.pos, true);
  this.pos += 2;
  return v;
};

/**
  Reads a 32-bit little-endian unsigned int from the stream.
  @return {number} The read number.
 */
KaitaiStream.prototype.readU4le = function() {
  this.ensureBytesLeft(4);
  var v = this._dataView.getUint32(this.pos, true);
  this.pos += 4;
  return v;
};

/**
  Reads a 64-bit little-endian unsigned int from the stream. Note that
  JavaScript does not support 64-bit integers natively, so it will
  automatically upgrade internal representation to use IEEE 754
  double precision float.
  @return {number} The read number.
 */
KaitaiStream.prototype.readU8le = function() {
  this.ensureBytesLeft(8);
  var v1 = this.readU4le();
  var v2 = this.readU4le();
  return 0x100000000 * v2 + v1;
};

// ========================================================================
// Floating point numbers
// ========================================================================

// ------------------------------------------------------------------------
// Big endian
// ------------------------------------------------------------------------

KaitaiStream.prototype.readF4be = function() {
  this.ensureBytesLeft(4);
  var v = this._dataView.getFloat32(this.pos);
  this.pos += 4;
  return v;
};

KaitaiStream.prototype.readF8be = function() {
  this.ensureBytesLeft(8);
  var v = this._dataView.getFloat64(this.pos);
  this.pos += 8;
  return v;
};

// ------------------------------------------------------------------------
// Little endian
// ------------------------------------------------------------------------

KaitaiStream.prototype.readF4le = function() {
  this.ensureBytesLeft(4);
  var v = this._dataView.getFloat32(this.pos, true);
  this.pos += 4;
  return v;
};

KaitaiStream.prototype.readF8le = function() {
  this.ensureBytesLeft(8);
  var v = this._dataView.getFloat64(this.pos, true);
  this.pos += 8;
  return v;
};

// ------------------------------------------------------------------------
// Unaligned bit values
// ------------------------------------------------------------------------

KaitaiStream.prototype.alignToByte = function() {
  this.bits = 0;
  this.bitsLeft = 0;
};

KaitaiStream.prototype.readBitsIntBe = function(n) {
  // JS only supports bit operations on 32 bits
  if (n > 32) {
    throw new Error(`readBitsIntBe: the maximum supported bit length is 32 (tried to read ${n} bits)`);
  }
  var bitsNeeded = n - this.bitsLeft;
  if (bitsNeeded > 0) {
    // 1 bit  => 1 byte
    // 8 bits => 1 byte
    // 9 bits => 2 bytes
    var bytesNeeded = Math.ceil(bitsNeeded / 8);
    var buf = this.readBytes(bytesNeeded);
    for (var i = 0; i < bytesNeeded; i++) {
      this.bits <<= 8;
      this.bits |= buf[i];
      this.bitsLeft += 8;
    }
  }

  // raw mask with required number of 1s, starting from lowest bit
  var mask = n === 32 ? 0xffffffff : (1 << n) - 1;
  // shift this.bits to align the highest bits with the mask & derive reading result
  var shiftBits = this.bitsLeft - n;
  var res = (this.bits >>> shiftBits) & mask;
  // clear top bits that we've just read => AND with 1s
  this.bitsLeft -= n;
  mask = (1 << this.bitsLeft) - 1;
  this.bits &= mask;

  return res;
};

/**
 * Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions
 *
 * @deprecated use {@link readBitsIntBe} instead
 */
KaitaiStream.prototype.readBitsInt = KaitaiStream.prototype.readBitsIntBe;

KaitaiStream.prototype.readBitsIntLe = function(n) {
  // JS only supports bit operations on 32 bits
  if (n > 32) {
    throw new Error(`readBitsIntLe: the maximum supported bit length is 32 (tried to read ${n} bits)`);
  }
  var bitsNeeded = n - this.bitsLeft;
  if (bitsNeeded > 0) {
      // 1 bit  => 1 byte
      // 8 bits => 1 byte
      // 9 bits => 2 bytes
      var bytesNeeded = Math.ceil(bitsNeeded / 8);
      var buf = this.readBytes(bytesNeeded);
      for (var i = 0; i < bytesNeeded; i++) {
          this.bits |= (buf[i] << this.bitsLeft);
          this.bitsLeft += 8;
      }
  }

  // raw mask with required number of 1s, starting from lowest bit
  var mask = n === 32 ? 0xffffffff : (1 << n) - 1;
  // derive reading result
  var res = this.bits & mask;
  // remove bottom bits that we've just read by shifting
  this.bits >>= n;
  this.bitsLeft -= n;

  return res;
};

/**
  Native endianness. Either KaitaiStream.BIG_ENDIAN or KaitaiStream.LITTLE_ENDIAN
  depending on the platform endianness.

  @type {boolean}
 */
KaitaiStream.endianness = new Int8Array(new Int16Array([1]).buffer)[0] > 0;

// ========================================================================
// Byte arrays
// ========================================================================

KaitaiStream.prototype.readBytes = function(len) {
  return this.mapUint8Array(len);
};

KaitaiStream.prototype.readBytesFull = function() {
  return this.mapUint8Array(this.size - this.pos);
};

KaitaiStream.prototype.readBytesTerm = function(terminator, include, consume, eosError) {
  var blen = this.size - this.pos;
  var u8 = new Uint8Array(this._buffer, this._byteOffset + this.pos);
  for (var i = 0; i < blen && u8[i] !== terminator; i++); // find first zero byte
  if (i === blen) {
    // we've read all the buffer and haven't found the terminator
    if (eosError) {
      throw "End of stream reached, but no terminator " + terminator + " found";
    } else {
      return this.mapUint8Array(i);
    }
  } else {
    var arr;
    if (include) {
      arr = this.mapUint8Array(i + 1);
    } else {
      arr = this.mapUint8Array(i);
    }
    if (consume) {
      this.pos += 1;
    }
    return arr;
  }
};

// Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions
KaitaiStream.prototype.ensureFixedContents = function(expected) {
  var actual = this.readBytes(expected.length);
  if (actual.length !== expected.length) {
    throw new UnexpectedDataError(expected, actual);
  }
  var actLen = actual.length;
  for (var i = 0; i < actLen; i++) {
    if (actual[i] !== expected[i]) {
      throw new UnexpectedDataError(expected, actual);
    }
  }
  return actual;
};

KaitaiStream.bytesStripRight = function(data, padByte) {
  var newLen = data.length;
  while (data[newLen - 1] === padByte)
    newLen--;
  return data.slice(0, newLen);
};

KaitaiStream.bytesTerminate = function(data, term, include) {
  var newLen = 0;
  var maxLen = data.length;
  while (newLen < maxLen && data[newLen] !== term)
    newLen++;
  if (include && newLen < maxLen)
    newLen++;
  return data.slice(0, newLen);
};

KaitaiStream.bytesToStr = function(arr, encoding) {
  if (encoding == null || encoding.toLowerCase() === "ascii") {
    return KaitaiStream.createStringFromArray(arr);
  } else {
    if (typeof TextDecoder === 'function') {
      // we're in the browser that supports TextDecoder
      return (new TextDecoder(encoding)).decode(arr);
    } else {
      // probably we're in node.js

      // check if it's supported natively by node.js Buffer
      // see https://github.com/nodejs/node/blob/master/lib/buffer.js#L187 for details
      switch (encoding.toLowerCase()) {
        case 'utf8':
        case 'utf-8':
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return new Buffer(arr).toString(encoding);
          break;
        default:
          // unsupported encoding, we'll have to resort to iconv-lite
          if (typeof KaitaiStream.iconvlite === 'undefined')
            KaitaiStream.iconvlite = require('iconv-lite');

          return KaitaiStream.iconvlite.decode(arr, encoding);
      }
    }
  }
};

// ========================================================================
// Byte array processing
// ========================================================================

KaitaiStream.processXorOne = function(data, key) {
  var r = new Uint8Array(data.length);
  var dl = data.length;
  for (var i = 0; i < dl; i++)
    r[i] = data[i] ^ key;
  return r;
};

KaitaiStream.processXorMany = function(data, key) {
  var dl = data.length;
  var r = new Uint8Array(dl);
  var kl = key.length;
  var ki = 0;
  for (var i = 0; i < dl; i++) {
    r[i] = data[i] ^ key[ki];
    ki++;
    if (ki >= kl)
      ki = 0;
  }
  return r;
};

KaitaiStream.processRotateLeft = function(data, amount, groupSize) {
  if (groupSize !== 1)
    throw("unable to rotate group of " + groupSize + " bytes yet");

  var mask = groupSize * 8 - 1;
  var antiAmount = -amount & mask;

  var r = new Uint8Array(data.length);
  for (var i = 0; i < data.length; i++)
    r[i] = (data[i] << amount) & 0xff | (data[i] >> antiAmount);

  return r;
};

KaitaiStream.processZlib = function(buf) {
  if (typeof require !== 'undefined')  {
    // require is available - we're running under node
    if (typeof KaitaiStream.zlib === 'undefined')
      KaitaiStream.zlib = require('zlib');
    // use node's zlib module API
    var r = KaitaiStream.zlib.inflateSync(
      Buffer.from(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    );
    return r;
  } else {
    // no require() - assume we're running as a web worker in browser.
    // user should have configured KaitaiStream.depUrls.zlib, if not
    // we'll throw.
    if (typeof KaitaiStream.zlib === 'undefined'
      && typeof KaitaiStream.depUrls.zlib !== 'undefined') {
      importScripts(KaitaiStream.depUrls.zlib);
      KaitaiStream.zlib = pako;
    }
    // use pako API
    r = KaitaiStream.zlib.inflate(buf);
    return r;
  }
};

// ========================================================================
// Misc runtime operations
// ========================================================================

KaitaiStream.mod = function(a, b) {
  if (b <= 0)
    throw "mod divisor <= 0";
  var r = a % b;
  if (r < 0)
    r += b;
  return r;
};

KaitaiStream.arrayMin = function(arr) {
  var min = arr[0];
  var x;
  for (var i = 1, n = arr.length; i < n; ++i) {
    x = arr[i];
    if (x < min) min = x;
  }
  return min;
};

KaitaiStream.arrayMax = function(arr) {
  var max = arr[0];
  var x;
  for (var i = 1, n = arr.length; i < n; ++i) {
    x = arr[i];
    if (x > max) max = x;
  }
  return max;
};

KaitaiStream.byteArrayCompare = function(a, b) {
  if (a === b)
    return 0;
  var al = a.length;
  var bl = b.length;
  var minLen = al < bl ? al : bl;
  for (var i = 0; i < minLen; i++) {
    var cmp = a[i] - b[i];
    if (cmp !== 0)
      return cmp;
  }

  // Reached the end of at least one of the arrays
  if (al === bl) {
    return 0;
  } else {
    return al - bl;
  }
};

// ========================================================================
// Internal implementation details
// ========================================================================

var EOFError = KaitaiStream.EOFError = function(bytesReq, bytesAvail) {
  this.name = "EOFError";
  this.message = "requested " + bytesReq + " bytes, but only " + bytesAvail + " bytes available";
  this.bytesReq = bytesReq;
  this.bytesAvail = bytesAvail;
  this.stack = (new Error()).stack;
};

EOFError.prototype = Object.create(Error.prototype);
EOFError.prototype.constructor = EOFError;

// Unused since Kaitai Struct Compiler v0.9+ - compatibility with older versions
var UnexpectedDataError = KaitaiStream.UnexpectedDataError = function(expected, actual) {
  this.name = "UnexpectedDataError";
  this.message = "expected [" + expected + "], but got [" + actual + "]";
  this.expected = expected;
  this.actual = actual;
  this.stack = (new Error()).stack;
};

UnexpectedDataError.prototype = Object.create(Error.prototype);
UnexpectedDataError.prototype.constructor = UnexpectedDataError;

var UndecidedEndiannessError = KaitaiStream.UndecidedEndiannessError = function() {
  this.name = "UndecidedEndiannessError";
  this.stack = (new Error()).stack;
};

UndecidedEndiannessError.prototype = Object.create(Error.prototype);
UndecidedEndiannessError.prototype.constructor = UndecidedEndiannessError;

var ValidationNotEqualError = KaitaiStream.ValidationNotEqualError = function(expected, actual) {
  this.name = "ValidationNotEqualError";
  this.message = "not equal, expected [" + expected + "], but got [" + actual + "]";
  this.expected = expected;
  this.actual = actual;
  this.stack = (new Error()).stack;
};

ValidationNotEqualError.prototype = Object.create(Error.prototype);
ValidationNotEqualError.prototype.constructor = ValidationNotEqualError;

var ValidationLessThanError = KaitaiStream.ValidationLessThanError = function(min, actual) {
  this.name = "ValidationLessThanError";
  this.message = "not in range, min [" + min + "], but got [" + actual + "]";
  this.min = min;
  this.actual = actual;
  this.stack = (new Error()).stack;
};

ValidationLessThanError.prototype = Object.create(Error.prototype);
ValidationLessThanError.prototype.constructor = ValidationLessThanError;

var ValidationGreaterThanError = KaitaiStream.ValidationGreaterThanError = function(max, actual) {
  this.name = "ValidationGreaterThanError";
  this.message = "not in range, max [" + max + "], but got [" + actual + "]";
  this.max = max;
  this.actual = actual;
  this.stack = (new Error()).stack;
};

ValidationGreaterThanError.prototype = Object.create(Error.prototype);
ValidationGreaterThanError.prototype.constructor = ValidationGreaterThanError;

var ValidationNotAnyOfError = KaitaiStream.ValidationNotAnyOfError = function(actual, io, srcPath) {
  this.name = "ValidationNotAnyOfError";
  this.message = "not any of the list, got [" + actual + "]";
  this.actual = actual;
  this.stack = (new Error()).stack;
};

ValidationNotAnyOfError.prototype = Object.create(Error.prototype);
ValidationNotAnyOfError.prototype.constructor = ValidationNotAnyOfError;

var ValidationExprError = KaitaiStream.ValidationExprError = function(actual, io, srcPath) {
  this.name = "ValidationExprError";
  this.message = "not matching the expression, got [" + actual + "]";
  this.actual = actual;
  this.stack = (new Error()).stack;
};

ValidationExprError.prototype = Object.create(Error.prototype);
ValidationExprError.prototype.constructor = ValidationExprError;

/**
  Ensures that we have an least `length` bytes left in the stream.
  If that's not true, throws an EOFError.

  @param {number} length Number of bytes to require
  */
KaitaiStream.prototype.ensureBytesLeft = function(length) {
  if (this.pos + length > this.size) {
    throw new EOFError(length, this.size - this.pos);
  }
};

/**
  Maps a Uint8Array into the KaitaiStream buffer.

  Nice for quickly reading in data.

  @param {number} length Number of elements to map.
  @return {Object} Uint8Array to the KaitaiStream backing buffer.
  */
KaitaiStream.prototype.mapUint8Array = function(length) {
  length |= 0;

  this.ensureBytesLeft(length);

  var arr = new Uint8Array(this._buffer, this.byteOffset + this.pos, length);
  this.pos += length;
  return arr;
};

/**
  Creates an array from an array of character codes.
  Uses String.fromCharCode in chunks for memory efficiency and then concatenates
  the resulting string chunks.

  @param {array|Uint8Array} array Array of character codes.
  @return {string} String created from the character codes.
**/
KaitaiStream.createStringFromArray = function(array) {
  var chunk_size = 0x8000;
  var chunks = [];
  var useSubarray = typeof array.subarray === 'function';
  for (var i=0; i < array.length; i += chunk_size) {
    chunks.push(String.fromCharCode.apply(null, useSubarray ? array.subarray(i, i + chunk_size) : array.slice(i, i + chunk_size)));
  }
  return chunks.join("");
};

return KaitaiStream;

}));
