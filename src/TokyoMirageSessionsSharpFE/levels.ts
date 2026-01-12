// levels.ts
// level loading isn't straight forward and requires unique code per level
// some objects are spawned in lua scripts, so that behavior has to be replicated as well

export function get_level_bfres_names(level_id: string): string[]
{
    let output: string[] = [];

    switch(level_id)
    {
        case "d002_01":
            return ["d002_01", "obj01", "obj02", "obj03", "sky"];

        case "d002_02":
            return ["d002_02", "sky"];
        
        case "d002_03":
            return ["d002_03", "sky"];
        
        case "d003_01":
            return ["d003_01", "obj01", "obj02", "sky"];
        
        case "d003_02":
            return ["d003_02", "obj01", "sky"];
        
        case "d003_03":
            return ["d003_03", "obj01", "sky"];

        case "d003_04":
            return ["d003_04", "sky"];

        case "d003_06":
            return ["d003_06", "obj02", "sky"];// obj01 isn't normally there? not sure whats up with it

        case "d003_07":
            return ["d003_07", "sky"];

        case "d003_08":
            return ["d003_08", "obj02", "sky"]; //same as d003_06

        case "d004_01":
            return ["d004_01", "obj01", "sky"];

        case "d004_02":
            return ["d004_02", "obj01", "sky"];

        case "d004_03":
            return ["d004_03", "obj01", "sky"];

        case "d004_04":
            return ["d004_04", "obj01", "sky"];

        case "d004_05":
            return ["d004_05", "obj01", "obj02", "sky"];

        case "d004_06":
            return ["d004_06"];

        default:
            console.error(`level id ${level_id} not found`);
            throw("");
    }
}
