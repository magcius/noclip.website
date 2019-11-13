
import { GTA3SceneDesc } from './scenes';
import { SceneGroup } from '../viewer';
import { vec4 } from 'gl-matrix';

class GTAVCSceneDesc extends GTA3SceneDesc {
    constructor(name: string, interior = 0, suffix = '') {
        super(name, interior, `${interior}${suffix}`);
        this.pathBase = 'GrandTheftAutoViceCity';
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
        };
    }
}

export const sceneGroup: SceneGroup = {
    id: 'GrandTheftAutoViceCity',
    name: 'Grand Theft Auto: Vice City',
    sceneDescs: [
        new GTAVCSceneDesc('Vice City'),
        'Interiors',
        new GTAVCSceneDesc('Ocean View Hotel', 1),
        new GTAVCSceneDesc('Vercetti Estate', 2),
        new GTAVCSceneDesc('El Banco Corrupto Grande', 3),
        new GTAVCSceneDesc('North Point Mall', 4),
        new GTAVCSceneDesc('Pole Position Club', 5),
        new GTAVCSceneDesc('Ken Rosenburg\'s office', 6),
        new GTAVCSceneDesc('Cafe Robina', 7),
        new GTAVCSceneDesc('Love Fist concert hall', 8),
        new GTAVCSceneDesc('Love Fist recording studio', 9),
        new GTAVCSceneDesc('Shooting Range', 10),
        new GTAVCSceneDesc('Apartment 3C', 11, 'a'),
        new GTAVCSceneDesc('Greasy Choppers', 11, 'b'),
        new GTAVCSceneDesc('VCPD HQ', 12, 'a'),
        new GTAVCSceneDesc('Auntie Poulet\'s', 12, 'b'),
        new GTAVCSceneDesc('Dirt Ring', 14),
        new GTAVCSceneDesc('Bloodring', 15),
        new GTAVCSceneDesc('Hotring', 16),
        new GTAVCSceneDesc('The Malibu Club', 17),
        new GTAVCSceneDesc('Print Works', 18),
    ]
};
