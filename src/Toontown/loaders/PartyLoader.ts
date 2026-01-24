import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { BaseLoader } from "./BaseLoader";

/**
 * Party loader.
 * Mirrors ttsrc/toontown/src/parties/PartyLoader.py
 */
export class PartyLoader extends BaseLoader {
  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader);
    this.storageDNAFiles.push("phase_13/dna/storage_party_sz");
    this.dnaFile = "phase_13/dna/party_sz";
    this.skyFile = "phase_3.5/models/props/TT_sky";
    this.musicFile = "phase_13/audio/bgm/party_original_theme.mid";
  }
}
