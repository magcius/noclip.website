import os

def gen_configs(dir_path):
    if not os.path.exists(dir_path):
        return

    for root, dirs, files in os.walk(dir_path):
        if root == dir_path:
            continue

        filenames = [f.split(".")[0] for f in files]
        level_id = root.split("\\")[1]

        has_mobj = str(filenames.count("dispos_Mobj") > 0).lower()
        has_sobj = str(filenames.count("dispos_Sobj") > 0).lower()
        has_aobj = str(filenames.count("dispos_Aobj") > 0).lower()
        has_item = str(filenames.count("dispos_Item") > 0).lower()
        has_npc = str(filenames.count("dispos_Npc") > 0).lower()

        alt_mobj = []
        for f in filenames:
            if "dispos_Mobj" in f and len(f) >= 11:
                alt_mobj.append(f"\"{f[7:]}\"")
        alt_mobj_str = ("[" + ", ".join(alt_mobj) + "]") if len(alt_mobj) > 1 else ""

        print(f"[\"{level_id}\", {'{'} mobj: {has_mobj}, sobj: {has_sobj}, aobj: {has_aobj}, item: {has_item}, npc: {has_npc}{(", altMobj: " + alt_mobj_str) if len(alt_mobj_str) > 0 else ''} {'}'}],")

dir_path = "../../../data/PMTOK/data/map"
gen_configs(dir_path)
