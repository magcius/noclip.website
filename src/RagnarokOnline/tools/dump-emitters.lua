-- Run a single effecttool .lub/.lua under Lua 5.1 (the iRO patched binary
-- under data/RagnarokOnline_raw/bin/lua-5.1-iro) and dump the global _<map>_emitterInfo
-- table to stdout as one JSON object per line. Stdin is the absolute path of
-- the script to load; stdout is the JSON; failures emit `null`.
--
-- The emitter spec on disk (one entry):
--   { dir1={x,y,z}, dir2={x,y,z}, gravity={x,y,z}, pos={x,y,z},
--     radius={x,y,z}, color={r,g,b,a}, rate={min,max}, size={min,max},
--     life={min,max}, texture="...", speed={v}, srcmode={N}, destmode={N},
--     maxcount={N}, zenable={0|1} }
--
-- This script is data-only: it runs the LUB to populate globals, then walks
-- the named table and re-emits each entry as JSON. No Lua bytecode execution
-- beyond what the LUB itself does (which is just table-construction ops).

local function jsonEscape(s)
    s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
    -- Bytes >= 0x80 are part of legacy CP949 (EUC-KR) multi-byte sequences
    -- in the iRO emitter texture names (e.g. "effect\\번개4.bmp"). Emitting
    -- them raw causes JSON.parse on the TS side to mis-decode them as UTF-8
    -- and produce U+FFFD replacement chars. Escape each high byte as
    -- \u00HH, a valid JSON Unicode escape. On the TS side the parsed string
    -- contains chars with codepoint == byte value; the extractor walks each
    -- char, treats codepoints < 256 as raw bytes, and feeds the byte string
    -- through TextDecoder('euc-kr') to recover the proper Korean text.
    -- ASCII control bytes < 0x20 (other than the \n\r\t we already escaped)
    -- get the same treatment for safety.
    s = s:gsub("[\128-\255]", function(c) return string.format("\\u%04x", c:byte()) end)
    s = s:gsub("[%z\1-\8\11\12\14-\31]", function(c) return string.format("\\u%04x", c:byte()) end)
    return '"' .. s .. '"'
end

-- Encode a Lua value as JSON. Numbers are emitted as %.6g (matches typical
-- author-time precision and avoids excess trailing zeros). Tables are encoded
-- as arrays IF their integer keys form a contiguous 1..N sequence, otherwise
-- as objects with string keys (we ignore non-string non-integer keys).
local function encode(v)
    local t = type(v)
    if t == "nil" then return "null" end
    if t == "boolean" then return v and "true" or "false" end
    if t == "number" then
        if v ~= v then return "null" end -- NaN
        if v == math.huge or v == -math.huge then return "null" end
        return string.format("%.6g", v)
    end
    if t == "string" then return jsonEscape(v) end
    if t == "table" then
        -- Detect a contiguous integer-keyed sequence (1..N or 0..N).
        local intKeys = {}
        local stringKeys = {}
        for k in pairs(v) do
            if type(k) == "number" and k == math.floor(k) then
                intKeys[#intKeys + 1] = k
            elseif type(k) == "string" then
                stringKeys[#stringKeys + 1] = k
            end
        end
        table.sort(intKeys)
        local hasInt = #intKeys > 0
        local hasStr = #stringKeys > 0
        if hasInt and not hasStr then
            local parts = {}
            for _, k in ipairs(intKeys) do
                parts[#parts + 1] = encode(v[k])
            end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            table.sort(stringKeys)
            local parts = {}
            for _, k in ipairs(stringKeys) do
                parts[#parts + 1] = jsonEscape(k) .. ":" .. encode(v[k])
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    end
    return "null"
end

-- Main: read script path from arg, load it in a sandbox, then find the
-- _<id>_emitterInfo global (whichever id the script chose) and emit JSON.
local path = arg[1]
if not path then io.stderr:write("usage: dump-emitters.lua <path>\n"); os.exit(1) end

-- Sandbox: an empty env with just math/string/table available, so even if a
-- LUB calls something exotic we don't blow up.
local env = setmetatable({
    math = math, string = string, table = table,
    pairs = pairs, ipairs = ipairs, type = type, tostring = tostring, tonumber = tonumber,
    select = select, unpack = unpack,
    print = function() end, -- silence any debug prints
}, nil)

local chunk, err = loadfile(path)
if not chunk then io.stderr:write("loadfile failed: " .. tostring(err) .. "\n"); io.write("null\n"); os.exit(0) end
setfenv(chunk, env)
local ok, runErr = pcall(chunk)
if not ok then io.stderr:write("run failed: " .. tostring(runErr) .. "\n"); io.write("null\n"); os.exit(0) end

-- Find the *_emitterInfo global the LUB set in its env (one per file).
local emitters = nil
local version = nil
for k, v in pairs(env) do
    if type(k) == "string" then
        if k:match("_emitterInfo$") and type(v) == "table" then
            emitters = v
        elseif k:match("_effect_version$") then
            version = v
        end
    end
end

if not emitters then io.write("null\n"); os.exit(0) end

-- Flatten to a 1..N JSON array, preserving original-index order. Some LUBs
-- key from 0, some from 1, and some have gaps; we just sort and emit.
local indices = {}
for k in pairs(emitters) do if type(k) == "number" then indices[#indices+1] = k end end
table.sort(indices)
local arr = {}
for _, k in ipairs(indices) do arr[#arr+1] = emitters[k] end

local out = { version = version, emitters = arr }
io.write(encode(out) .. "\n")
