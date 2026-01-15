import { Geom, RenderState } from "../nodes";

export class TextGlyph {
  public readonly state: RenderState;

  constructor(
    public readonly character: number,
    public readonly geom: Geom | null,
    state: RenderState | null,
    public readonly advance: number,
  ) {
    this.state = state ?? new RenderState();
  }

  isWhitespace(): boolean {
    return (
      this.character === 32 ||
      this.character === 9 ||
      this.character === 10 ||
      this.character === 13
    );
  }
}
