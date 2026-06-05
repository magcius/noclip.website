do
    local p = io.popen("iconv -l 2>/dev/null")
    local out = p and p:read("*a") or ""
    if p ~= nil then p:close() end
    if out == "" then
        io.stderr:write("dump-emitters.lua: iconv not found on PATH (needed for CP949 -> UTF-8)\n")
        os.exit(2)
    end
end

local function cp949ToUtf8(s)
    for i = 1, #s do
        if s:byte(i) >= 0x80 then
            local tmp = os.tmpname()
            local f = io.open(tmp, "wb"); f:write(s); f:close()
            local pipe = io.popen("iconv -f CP949 -t UTF-8 < '" .. tmp .. "'")
            local out = pipe:read("*a"); pipe:close()
            os.remove(tmp)
            if out == "" then
                io.stderr:write("dump-emitters.lua: iconv produced empty output for non-empty input\n")
                os.exit(2)
            end
            return out
        end
    end
    return s
end

local function jsonEscape(s)
    s = cp949ToUtf8(s)
    s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
    s = s:gsub("[%z\1-\8\11\12\14-\31]", function(c) return string.format("\\u%04x", c:byte()) end)
    return '"' .. s .. '"'
end

local function encode(v)
    local t = type(v)
    if t == "nil" then return "null" end
    if t == "boolean" then return v and "true" or "false" end
    if t == "number" then
        if v ~= v then return "null" end
        if v == math.huge or v == -math.huge then return "null" end
        return string.format("%.6g", v)
    end
    if t == "string" then return jsonEscape(v) end
    if t == "table" then

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

local path = arg[1]
if not path then io.stderr:write("usage: dump-emitters.lua <path>\n"); os.exit(1) end

local env = setmetatable({
    math = math, string = string, table = table,
    pairs = pairs, ipairs = ipairs, type = type, tostring = tostring, tonumber = tonumber,
    select = select, unpack = unpack,
    print = function() end,
}, nil)

local chunk, err = loadfile(path)
if not chunk then io.stderr:write("loadfile failed: " .. tostring(err) .. "\n"); io.write("null\n"); os.exit(0) end
setfenv(chunk, env)
local ok, runErr = pcall(chunk)
if not ok then io.stderr:write("run failed: " .. tostring(runErr) .. "\n"); io.write("null\n"); os.exit(0) end

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

local indices = {}
for k in pairs(emitters) do if type(k) == "number" then indices[#indices+1] = k end end
table.sort(indices)
local arr = {}
for _, k in ipairs(indices) do arr[#arr+1] = emitters[k] end

local out = { version = version, emitters = arr }
io.write(encode(out) .. "\n")
