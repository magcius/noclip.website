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
            return ["d003_06", "obj02", "sky"]; // obj01 isn't normally there? not sure whats up with it

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

        case "d005_01":
            return ["d005_01", "obj01", "sky"];

        case "d005_02":
            return ["d005_02", "obj01", "sky"];

        case "d005_03":
            return ["d005_03", "sky"];

        case "d005_04":
            return ["d005_04", "sky"];

        case "d005_05":
            return ["d005_05", "obj01", "sky"];

        case "d005_06":
            return ["d005_06", "obj01", "sky"];

        case "d005_07":
            return ["d005_07", "obj01", "sky"];

        case "d006_01":
            return ["d006_01", "obj01", "sky"];

        case "d006_02":
            return ["d006_02", "obj01", "sky"];

        case "d006_03":
            return ["d006_03", "obj01", "obj02", "obj03", "sky"];

        case "d006_04":
            return ["d006_04", "obj01", "sky"];

        case "d006_05":
            return ["d006_05", "sky"];

        case "d006_06":
            return ["d006_06", "obj01", "sky"];

        case "d006_07":
            return ["d006_07", "obj01", "sky"];

        case "d006_08":
            return ["d006_08", "obj01", "sky"];

        case "d006_09":
            return ["d006_09", "obj01", "sky"];

        case "d006_10":
            return ["d006_10", "obj01", "sky"];

        case "d007_01":
            return ["d007_01", "obj01", "obj02", "obj03", "sky"];

        case "d007_02":
            return ["d007_02", "obj01", "obj02", "obj03", "sky"];

        case "d007_03":
            return ["d007_03", "obj01", "obj02", "sky"];

        case "d007_04":
            return ["d007_04", "obj01", "obj02", "obj03", "sky"];

        case "d007_05":
            return ["d007_05", "obj01", "obj02", "sky"];

        case "d007_06":
            return ["d007_06", "obj01", "obj02", "sky"];

        case "d007_07":
            return ["d007_07", "obj01", "obj02", "sky"];

        case "d007_08":
            return ["d007_08", "obj01", "obj02", "sky"];

        case "d007_09":
            return ["d007_09", "obj01", "obj02", "obj03", "sky"];

        case "d007_10":
            return ["d007_10", "sky"];

        case "d008_01":
            return ["d008_01", "obj01", "obj02", "obj03", "sky"];

        case "d010_01":
            return ["d010_01", "obj01", "obj02", "sky"];

        case "d010_02":
            return ["d010_02", "sky"];

        case "d010_03":
            return ["d010_03", "sky"];

        case "d010_04":
            return ["d010_04", "sky"];

        case "d015_01":
            return ["d015_01", "obj01", "obj02", "obj03", "sky"];

        case "d015_02":
            return ["d015_02", "sky"];

        case "d018_01":
            return ["d018_01", "obj01", "obj02", "sky"];

        case "d018_02":
            return ["d018_02", "obj01", "obj02", "sky"];

        case "d018_03":
            return ["d018_03", "obj01", "obj02", "sky"];

        case "d018_04":
            return ["d018_04", "obj01", "obj02", "sky"];

        case "b002_01":
            return ["b002_01", "obj01", "obj02", "obj03", "sky"];

        case "b003_01":
            return ["b003_01", "obj01", "obj02", "obj03", "sky"];

        case "b004_01":
            return ["b004_01", "obj01", "obj02", "obj03", "sky"];

        case "b005_01":
            return ["b005_01", "obj01", "obj02", "obj03", "sky"];

        case "b006_01":
            return ["b006_01", "obj01", "obj02", "obj03", "sky"];

        case "b007_01":
            return ["b007_01", "obj01", "obj02", "obj03", "sky"];

        case "b008_01":
            return ["b008_01", "obj01", "obj02", "obj03", "sky"];

        case "b009_01":
            return ["b009_01", "obj01", "obj02", "obj03", "sky"];

        case "b010_01":
            return ["b010_01", "obj01", "obj02", "obj03", "sky"];

        case "b011_01":
            return ["b011_01", "obj01", "obj02", "obj03", "obj04", "sky"];

        case "b012_01":
            return ["b012_01", "obj01", "obj02", "obj03", "sky"];

        case "b013_01":
            return ["b013_01", "obj01", "obj02", "obj03", "sky"];

        case "b014_01":
            return ["b014_01", "obj01", "obj02", "obj03", "sky"];

        case "b015_01":
            return ["b015_01", "obj01", "obj02", "obj03", "sky"];

        case "b016_01":
            return ["b016_01", "obj01", "obj02", "obj03", "sky"];

        case "f001_01":
            return ["f001_01", "obj01", "obj02", "obj10", "sky"];

        case "f001_02":
            return ["f001_02", "obj01", "obj02", "obj04", "obj10", "sky"];

        case "f001_03":
            return ["f001_03", "obj01", "obj02", "obj04", "obj10", "sky"];

        case "f001_04":
            return ["f001_04", "obj01", "obj02", "obj10", "obj11", "obj12", "sky"];

        case "f001_05":
            return ["f001_05", "obj01", "obj02", "obj10", "sky"];

        case "f001_06":
            return ["f001_06", "obj01", "obj02", "obj04", "obj10", "sky"];

        case "f001_07":
            return ["f001_07", "obj01", "obj02", "obj10", "sky"];

        case "f002_01":
            return ["f002_01", "obj01", "obj02", "obj03", "sky"];

        case "f002_02":
            return ["f002_02", "obj01", "obj02", "obj03", "sky"];

        case "f002_03":
            return ["f002_03", "obj01", "obj02", "sky"];

        case "f003_01":
            return ["f003_01", "sky"];

        case "f003_02":
            return ["f003_02", "obj10", "obj11", "obj12", "obj13", "obj14", "sky"];

        case "f003_03":
            return ["f003_03", "obj01", "sky"];

        case "f003_04":
            return ["f003_04", "obj01", "sky"];

        case "f003_05":
            return ["f003_05", "sky"];

        case "f003_06":
            return ["f003_06", "sky"];

        case "f003_07":
            return ["f003_07", "sky"];

        case "f003_08":
            return ["f003_08", "sky"];

        case "f003_09":
            return ["f003_09", "sky"];

        case "f003_10":
            return ["f003_10", "sky"];

        case "f004_01":
            return ["f004_01", "sky"];

        case "f004_02":
            return ["f004_02", "obj01", "sky"];

        case "f005_01":
            return ["f005_01", "sky"];

        case "f005_02":
            return ["f005_02", "obj01", "sky"];

        case "f006_01":
            return ["f006_01", "obj01", "obj02", "obj03", "sky"];

        case "f006_02":
            return ["f006_02", "sky"];

        case "f007_01":
            return ["f007_01", "sky"];

        case "f007_02":
            return ["f007_02", "sky"];

        case "f010_01":
            return ["f010_01", "sky"];

        case "f010_02":
            return ["f010_02", "sky"];

        case "f010_03":
            return ["f010_03", "sky"];

        case "f010_05":
            return ["f010_05", "sky"];

        case "f010_06":
            return ["f010_06", "sky"];

        case "f010_07":
            return ["f010_07", "f010_07_obj01", "f010_07_obj02", "sky"];

        default:
            console.error(`level id ${level_id} not found`);
            throw("whoops");
    }
}
