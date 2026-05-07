/*
 * Detects canvas click events (as distinct from camera drags) and exposes
 * them as a single pending pixel coordinate that the renderer consumes
 * once per frame.
 *
 * A click is registered when the left mouse button goes down and then up
 * within 200ms and less than 5 pixels of travel. Anything larger is treated
 * as a drag and ignored.
 *
 * petton-svn, 2026.
 */

export class ClickListener {
  private lastClickTime = 0;
  private lastMouseX = -1;
  private lastMouseY = -1;
  private pendingClick = false;
  private pendingClickScreenX = 0;
  private pendingClickScreenY = 0;
  private hasPendingClick = false;

  constructor() {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;

    canvas.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.lastClickTime = performance.now();
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.pendingClick = true;
    });

    canvas.addEventListener("mouseup", (e: MouseEvent) => {
      if (e.button !== 0 || !this.pendingClick) return;
      const elapsed = performance.now() - this.lastClickTime;
      const dx = Math.abs(e.clientX - this.lastMouseX);
      const dy = Math.abs(e.clientY - this.lastMouseY);
      if (elapsed < 200 && dx < 5 && dy < 5) {
        this.pendingClickScreenX = e.clientX;
        this.pendingClickScreenY = e.clientY;
        this.hasPendingClick = true;
      }
      this.pendingClick = false;
    });

    canvas.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.pendingClick) return;
      const dx = Math.abs(e.clientX - this.lastMouseX);
      const dy = Math.abs(e.clientY - this.lastMouseY);
      if (dx >= 5 || dy >= 5) {
        this.pendingClick = false;
      }
    });
  }

  /**
   * If a click was registered since the last call, returns its screen
   * coordinates and clears the pending flag. Otherwise returns null.
   */
  public takePendingClick(): { x: number; y: number } | null {
    if (!this.hasPendingClick) return null;
    this.hasPendingClick = false;
    return { x: this.pendingClickScreenX, y: this.pendingClickScreenY };
  }
}
