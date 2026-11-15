import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShareURL } from '../src/ShareURL.js';

test('share URLs encode Markdown-sensitive hash characters without changing the save state', () => {
    const saveState = 'mkwii/beginner_course;ShareData=Azo7)=mE$bVb}u7Wg&K$g,';
    const shareURL = buildShareURL(saveState, 'https://noclip.website/');
    const encodedHash = new URL(shareURL).hash.slice(1);

    assert.equal(shareURL, 'https://noclip.website/#mkwii/beginner_course;ShareData=Azo7%29=mE$bVb%7du7Wg&K$g,');
    assert.equal(decodeURIComponent(encodedHash), saveState);
    assert.equal(encodedHash.includes(')'), false);

    assert.equal(buildShareURL(saveState, '/?webgpu'), '/?webgpu#mkwii/beginner_course;ShareData=Azo7%29=mE$bVb%7du7Wg&K$g,');
});
