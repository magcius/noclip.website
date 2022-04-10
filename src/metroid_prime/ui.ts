import { COOL_BLUE_COLOR, Layer, LAYER_ICON, LayerPanel, Panel, RadioButtons } from '../ui';

export interface GroupLayer extends Layer {
    layerGroup?: string;
}

export class GroupLayerPanel extends Panel {
    public layerPanel: LayerPanel = new LayerPanel();
    private groupRadios: RadioButtons;
    private groupLayers: Layer[][] = [];

    private _constructGroupRadios(optionNames: string[]) {
        this.groupRadios = new RadioButtons('', optionNames);
        this.groupRadios.elem.style.gridGap = '4px';
        for (const option of this.groupRadios.options) {
            option.style.lineHeight = '32px';
        }
    }

    constructor(layers: GroupLayer[] | null = null) {
        super();
        this.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        this.setTitle(LAYER_ICON, 'Layers');
        this._constructGroupRadios([]);
        this.contents.appendChild(this.groupRadios.elem);
        this.contents.appendChild(this.layerPanel.multiSelect.elem);
        if (layers !== null)
            this.setLayers(layers);
    }

    private _classifyLayerGroups(layers: GroupLayer[]): Map<string|null, Layer[]> {
        const defaultGroup: Layer[] = [];
        const groups = new Map<string|null, Layer[]>();
        groups.set(null, defaultGroup);
        for (const layer of layers) {
            if (layer.layerGroup === undefined) {
                defaultGroup.push(layer);
            } else {
                let group = groups.get(layer.layerGroup);
                if (group === undefined) {
                    group = [];
                    groups.set(layer.layerGroup, group);
                }
                group.push(layer);
            }
        }
        return groups;
    }

    public setLayers(layers: GroupLayer[]): void {
        const groups = this._classifyLayerGroups(layers);
        const optionNames: string[] = [];
        this.groupLayers = [];
        for (const [groupName, layers] of groups) {
            if (layers.length) {
                optionNames.push(groupName !== null ? groupName : 'Default');
                this.groupLayers.push(layers);
            }
        }
        const oldGroupRadios = this.groupRadios;
        this._constructGroupRadios(optionNames);
        this.contents.replaceChild(this.groupRadios.elem, oldGroupRadios.elem);
        this.groupRadios.onselectedchange = () => {
            const layers = this.groupLayers[this.groupRadios!.selectedIndex];
            this.layerPanel.setLayers(layers);
        };
        this.groupRadios.setVisible(optionNames.length > 1);
        if (optionNames.length > 0) {
            this.groupRadios.setSelectedIndex(0);
            this.layerPanel.setLayers(this.groupLayers[0]);
            this.setVisible(true);
        } else {
            this.setVisible(false);
        }
    }
}
