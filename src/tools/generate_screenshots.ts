
import * as Puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const HOST = `http://localhost:8080/`;
const OUT_PATH = `Screenshots/`;

// Change to customize width/height.
const WIDTH = 450, HEIGHT = 220;

const DefaultSaveStates: { [k: string]: string } = require('../../DefaultSaveStates.json');

// XXX(jstpierre): Don't ask.
declare var main: any;

interface SceneDescMeta {
    SceneGroupCategory: string;
    SceneGroupId: string;
    SceneGroupName: string;
    SceneDescCategory: string;
    SceneDescId: string;
    SceneDescName: string;
}

function getSceneDescId(sceneDescMeta: SceneDescMeta): string {
    return `${sceneDescMeta.SceneGroupId}/${sceneDescMeta.SceneDescId}`;
}

function findSaveStatesForSceneDescMeta(sceneDescMeta: SceneDescMeta): string[] {
    const saveStates: string[] = [];
    const sceneDescId = getSceneDescId(sceneDescMeta);

    for (let i = 0; i <= 9; i++) {
        const key = `SaveState_${sceneDescId}/${i}`;
        if (key in DefaultSaveStates)
        saveStates[i] = DefaultSaveStates[key];
    }

    return saveStates;
}

// https://github.com/GoogleChrome/puppeteer/issues/1353#issuecomment-356561654
function waitForNetworkIdle(page: Puppeteer.Page, timeout: number, maxInflightRequests = 0) {
    page.on('request', onRequestStarted);
    page.on('requestfinished', onRequestFinished);
    page.on('requestfailed', onRequestFinished);

    let inflight = 0;
    let fulfill: () => void;
    let promise = new Promise(x => fulfill = x);
    let timeoutId = setTimeout(onTimeoutDone, timeout);
    return promise;

    function onTimeoutDone() {
        page.removeListener('request', onRequestStarted);
        page.removeListener('requestfinished', onRequestFinished);
        page.removeListener('requestfailed', onRequestFinished);
        fulfill();
    }

    function onRequestStarted() {
        ++inflight;
        if (inflight > maxInflightRequests)
            clearTimeout(timeoutId);
    }

    function onRequestFinished() {
        if (inflight === 0)
            return;
        --inflight;
        if (inflight === maxInflightRequests)
            timeoutId = setTimeout(onTimeoutDone, timeout);
    }
}

async function takeScreenshotsForSceneDescMeta(page: Puppeteer.Page, sceneDescMeta: SceneDescMeta) {
    // Load the scene desc.
    const sceneDescId = getSceneDescId(sceneDescMeta);

    const outPathPrefix = `${OUT_PATH}/${sceneDescId.replace('/', '_')}`;

    // Start the load.
    await Promise.all([
        waitForNetworkIdle(page, 200),
        page.evaluate((sceneDescId) => { main._loadSceneDescById(sceneDescId); return true; }, sceneDescId),
    ])

    // Collect savestates.
    const saveStates = findSaveStatesForSceneDescMeta(sceneDescMeta);
    if (saveStates.length === 0) {
        // If there aren't any, then we can just take a screenshot and be on our way.
        await page.screenshot({ path: `${outPathPrefix}_1.png` });
    } else {
        // Otherwise, iterate over all savestates and take them.
        for (let i = 0; i < saveStates.length; i++) {
            const saveState = saveStates[i];
            if (saveState === undefined)
                continue;

            await page.evaluate((saveState) => main._loadSceneSaveState(saveState), saveState);
            await page.screenshot({ path: `${outPathPrefix}_${i}.png` });
        }
    }
}

async function takeScreenshots(filter?: string) {
    const browser = await Puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    try {
        mkdirSync(OUT_PATH, { recursive: true });
    } catch(e) {}

    await page.goto(HOST);
    await page.evaluate('main._toggleUI()');
    await page.setViewport({ width: WIDTH, height: HEIGHT });

    // We need to generate screenshots for:
    //  * All savestates.
    //  * All maps without savestates taken.
    // Generate up-front the list of everything we need.

    let sceneDescMetas: SceneDescMeta[] = await page.evaluate(() => {
        const sceneDescMetas = [];
        let sceneGroupCategory = null;
        for (let i = 0; i < main.groups.length; i++) {
            const g = main.groups[i];
            if (typeof g === 'string') {
                sceneGroupCategory = g;
                continue;
            }
            let sceneDescCategory = null;
            for (let j = 0; j < g.sceneDescs.length; j++) {
                const d = g.sceneDescs[j];
                if (typeof d === 'string') {
                    sceneDescCategory = d;
                    continue;
                }

                sceneDescMetas.push({
                    SceneGroupCategory: sceneGroupCategory,
                    SceneGroupId: g.id,
                    SceneGroupName: g.name,
                    SceneDescCategory: sceneDescCategory,
                    SceneDescId: d.id,
                    SceneDescName: d.name,
                });
            }
        }
        return sceneDescMetas;
    });

    // Optionally filter.
    if (filter !== undefined) {
        sceneDescMetas = sceneDescMetas.filter((sceneDescMeta) => {
            const sceneDescId = getSceneDescId(sceneDescMeta);
            return sceneDescId.includes(filter);
        });
    }

    for (let i = 0; i < sceneDescMetas.length; i++) {
        await takeScreenshotsForSceneDescMeta(page, sceneDescMetas[i]);
    }

    await browser.close();
}

takeScreenshots(process.argv[2]);
