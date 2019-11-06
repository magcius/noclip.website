
import { readFileSync, writeFileSync } from 'fs';
import { deflate } from 'pako';

for (const release of ['3', 'ViceCity', 'SanAndreas']) {
    const pathBase = `../../../data/GrandTheftAuto${release}/models/gta3`;
    console.log('Compressing', `${pathBase}.img`);
    const img = readFileSync(`${pathBase}.img`);
    const imgz = deflate(img, { level: 9 });
    console.log('Writing', `${pathBase}.imgz`);
    writeFileSync(`${pathBase}.imgz`, imgz);
}
