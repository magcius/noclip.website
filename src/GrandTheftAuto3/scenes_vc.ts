
import { GTA3SceneDesc } from './scenes';
import { SceneGroup } from '../viewer';
import { ItemInstance, ObjectDefinition, INTERIOR_EVERYWHERE } from './item';
import { vec4 } from 'gl-matrix';

class GTAVCSceneDesc extends GTA3SceneDesc {
    constructor(private interior: number, name: string) {
        super(String(interior), name);
        this.pathBase = 'GrandTheftAutoViceCity';
        this.complete = true;
        this.water = {
            origin: vec4.fromValues(-400, 0, 6, 2048),
            texture: 'waterclear256',
        };
        this.weatherTypes = ['Sunny', 'Cloudy', 'Rainy', 'Foggy', 'Extra Sunny', 'Hurricane'];
        this.paths = {
            zon: 'data/navig.zon',
            dat: {
                timecyc: 'data/timecyc.dat',
                water: 'data/WATERPRO.DAT',
            },
            ide: [
                'generic',
                'airport/airport',
                'airportN/airportN',
                'bank/bank',
                'bridge/bridge',
                'cisland/cisland',
                'club/club',
                'concerth/concerth',
                'docks/docks',
                'downtown/downtown',
                'downtows/downtows',
                'golf/golf',
                'haiti/haiti',
                'haitiN/haitiN',
                'hotel/hotel',
                'islandsf/islandsf',
                'lawyers/lawyers',
                'littleha/littleha',
                'mall/mall',
                'mansion/mansion',
                'nbeachbt/nbeachbt',
                'nbeach/nbeach',
                'nbeachw/nbeachw',
                'oceandn/oceandN',
                'oceandrv/oceandrv',
                'stadint/stadint',
                'starisl/starisl',
                'stripclb/stripclb',
                'washintn/washintn',
                'washints/washints',
                'yacht/yacht',
            ],
            ipl: [
                'airport/airport',
                'airportN/airportN',
                'bank/bank',
                'bridge/bridge',
                'cisland/cisland',
                'club/CLUB',
                'concerth/concerth',
                'docks/docks',
                'downtown/downtown',
                'downtows/downtows',
                'golf/golf',
                'haiti/haiti',
                'haitiN/haitin',
                'hotel/hotel',
                'islandsf/islandsf',
                'lawyers/lawyers',
                'littleha/littleha',
                'mall/mall',
                'mansion/mansion',
                'nbeachbt/nbeachbt',
                'nbeach/nbeach',
                'nbeachw/nbeachw',
                'oceandn/oceandN',
                'oceandrv/oceandrv',
                'stadint/stadint',
                'starisl/starisl',
                'stripclb/stripclb',
                'washintn/washintn',
                'washints/washints',
                'yacht/yacht',
            ],
            ipl_stream: [],
        };
    }

    protected filter(item: ItemInstance, obj: ObjectDefinition, zone: string) {
        return item.interior === this.interior || item.interior === INTERIOR_EVERYWHERE;
    }
}

export const sceneGroup: SceneGroup = {
    id: 'GrandTheftAutoViceCity',
    name: 'Grand Theft Auto: Vice City',
    sceneDescs: [
        new GTAVCSceneDesc(0, 'Vice City'),
        new GTAVCSceneDesc(1, 'Ocean View Hotel'),
        new GTAVCSceneDesc(2, 'Vercetti Estate'),
        new GTAVCSceneDesc(3, 'El Banco Corrupto Grande'),
        new GTAVCSceneDesc(4, 'North Point Mall'),
        new GTAVCSceneDesc(5, 'Pole Position Club'),
        new GTAVCSceneDesc(6, 'Ken Rosenburg\'s office'),
        new GTAVCSceneDesc(7, 'Cafe Robina'),
        new GTAVCSceneDesc(8, 'Love Fist concert hall'),
        new GTAVCSceneDesc(9, 'Love Fist recording studio'),
        new GTAVCSceneDesc(10, 'Shooting Range'),
        new GTAVCSceneDesc(11, 'Apartment 3C, Greasy Choppers'),
        new GTAVCSceneDesc(12, 'VCPD HQ, Auntie Poulet\'s'),
        new GTAVCSceneDesc(14, 'Dirt Ring'),
        new GTAVCSceneDesc(15, 'Bloodring'),
        new GTAVCSceneDesc(16, 'Hotring'),
        new GTAVCSceneDesc(17, 'The Malibu Club'),
        new GTAVCSceneDesc(18, 'Print Works'),
    ]
};
