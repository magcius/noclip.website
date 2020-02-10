
import { LocationBase } from "./SceneBase2";

export class LightweightOverlay {
    public elem: HTMLElement;

    private grid: HTMLElement;
    private border: HTMLElement;
    private gameTitle: HTMLElement;
    private locationTitle: HTMLElement;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.position = 'absolute';
        this.elem.style.right = '0';
        this.elem.style.top = '0';
        this.elem.style.transition = '.1s ease-out';

        this.grid = document.createElement('div');
        this.grid.style.padding = '16px';
        this.grid.style.pointerEvents = 'none';
        this.grid.style.userSelect = 'none';
        this.grid.style.display = 'grid';
        this.grid.style.gridGap = '8px';
        this.elem.appendChild(this.grid);

        this.border = document.createElement('div');
        this.border.style.width = '8px';
        this.border.style.backgroundColor = 'white';
        this.border.style.boxShadow = '0 4px 8px black, 0 4px 8px black';
        this.border.style.gridArea = '1 / 2 / 3 / 2';
        this.border.style.marginLeft = '16px';
        this.grid.appendChild(this.border);

        this.gameTitle = document.createElement('div');
        this.gameTitle.style.textShadow = '0 4px 8px black, 0 4px 8px black';
        this.gameTitle.style.font = '36px "Comic Sans MS"';
        this.gameTitle.style.color = 'white';
        this.gameTitle.style.gridArea = '1 / 1 / 1 / 1';
        this.gameTitle.style.textAlign = 'right';
        this.grid.appendChild(this.gameTitle);

        this.locationTitle = document.createElement('div');
        this.locationTitle.style.textShadow = '0 4px 8px black, 0 4px 8px black';
        this.locationTitle.style.font = '24px "Comic Sans MS"';
        this.locationTitle.style.color = 'white';
        this.locationTitle.style.gridArea = '2 / 1 / 2 / 1';
        this.locationTitle.style.textAlign = 'right';
        this.grid.appendChild(this.locationTitle);

        this.setLocation(null);
    }

    public setLocation(location: LocationBase | null): void {
        if (location !== null) {
            this.elem.style.display = 'block';
            this.gameTitle.textContent = location.groupName;
            this.locationTitle.textContent = location.title;
        } else {
            this.elem.style.display = 'none';
        }
    }

    public setVisible(active: boolean): void {
        this.elem.style.opacity = active ? '1' : '0';
    }
}
