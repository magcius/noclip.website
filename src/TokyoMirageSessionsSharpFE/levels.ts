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
            return ["d003_06", "obj02", "sky"];

        case "d003_07":
            return ["d003_07", "sky"];

        case "d003_08":
            return ["d003_08", "obj02", "sky"];

        default:
            console.error(`level id ${level_id} not found`);
            throw("");
    }
}
