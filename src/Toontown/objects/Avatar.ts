import { Actor } from "./Actor";
import { Nametag3D, NametagColorCode } from "./Nametag3D";

export class Avatar extends Actor {
  protected _playerType = NametagColorCode.Normal;
  protected _nametag3d = new Nametag3D();
  protected _height = 0;

  async init(): Promise<void> {
    await this._nametag3d.init(this.name, this._playerType);
    this.addChild(this._nametag3d);
  }

  setHeight(height: number) {
    this._height = height;
    this._nametag3d.height = height + 0.5;
  }
}
