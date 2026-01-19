import { Actor } from "./Actor";
import type { NametagGroup } from "./NametagGroup";

export enum NametagColorCode {
  Normal,
  NoChat,
  NonPlayer,
  Suit,
  ToonBuilding,
  SuitBuilding,
  HouseBuilding,
  SpeedChat,
  FreeChat,
}

export class Avatar extends Actor {
  protected _playerType = NametagColorCode.Normal;
  protected _nametag: NametagGroup;

  // constructor() {
  //   super();
  // }
}
