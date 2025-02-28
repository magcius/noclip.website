import {decode as tifDecode} from 'tiff'
import {decode as jpgDecode} from 'jpeg-js'
import { FakeTextureHolder } from '../TextureHolder.js';
import { DataFetcher } from '../DataFetcher.js';
import { Texture } from './types.js';
import { range } from '../MathHelpers.js';

const decodeImage = (path: string, imageBytes: ArrayBufferLike) : {rgba8: Uint8Array, width: number, height: number} | null => {
  const extension = path.toLowerCase().split(".").pop();
  switch (extension) {
    case "tif": 
    case "tiff": {
      const result = tifDecode(imageBytes)[0];
      const { width, height, components } = result;
      return {
        width,
        height,
        rgba8: new Uint8Array(
          components === 3
            ? range(0, result.size).flatMap(i => [...result.data.slice(i * 3, (i + 1) * 3), 0xFF])
            : result.data
        )
      }
    }
    case "jpg":
    case "jpeg": {
      const {width, height, data: rgba8} = jpgDecode(imageBytes as ArrayBuffer, {useTArray: true});
      return {width, height, rgba8};
    }
  }
  return null;
};

const flipImage = (image : {rgba8: Uint8Array, width: number, height: number}) : {rgba8: Uint8Array, width: number, height: number} => {
  const data: number[] = Array(image.height).fill(null).map(
    (_, i) => ([...image.rgba8.subarray(
      i * image.width * 4,
      (i + 1) * image.width * 4
    )])
  ).reverse().flat();
  return {
    ...image,
    rgba8: new Uint8Array(data)
  };
}

export const fetchTextures = (dataFetcher: DataFetcher, basePath: string, texturePaths: string[]) : Promise<Texture[]> => 
  Promise.all(
    texturePaths.map(path => dataFetcher.fetchData(`${basePath}/${path}`).then(({arrayBuffer}) => ({
      ...flipImage(decodeImage(path, arrayBuffer)!),
      path
    })))
  );

export const makeTextureHolder = (textures: Texture[]) => new FakeTextureHolder(
  textures.map((texture) => {
    const {path: name, rgba8, width, height} = texture;
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [width, height];
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba8);
    ctx.putImageData(imageData, 0, 0);
    return { name, surfaces: [canvas] }
  })
);
