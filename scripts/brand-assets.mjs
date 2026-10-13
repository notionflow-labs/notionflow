import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../public/',import.meta.url);
for (const [source,target,width] of [['social.svg','social.png',1200],['brand.svg','apple-touch-icon.png',180],['brand.svg','icon-192.png',192]]) {
  const svg = await readFile(new URL(source,root),'utf8');
  const image = new Resvg(svg,{ fitTo:{ mode:'width',value:width } }).render().asPng();
  await writeFile(new URL(target,root),image);
}
console.log('Brand PNG assets rendered from the original SVG files.');
