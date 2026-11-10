import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve('../shell/resources');
await mkdir(out, { recursive: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/desktop/pet-entry.tsx'],
  outfile: 'dist/desktop-pet.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  loader: { '.png': 'dataurl', '.css': 'text', '.dshpet': 'binary' },
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = (await readFile('dist/desktop-pet.js', 'utf8')).replaceAll('</script', '<\\/script');
await writeFile(
  resolve(out, 'pet.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'none'"><title>肥肥鱼</title><style>html,body,#root{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
);
console.log('Built shell/resources/pet.html');

await build({
  entryPoints: ['src/desktop/chat-input-entry.tsx'], outfile: 'dist/chat-input.js', bundle: true,
  platform: 'browser', format: 'iife', target: 'es2022', loader: { '.css': 'text' }, minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const inputJs = (await readFile('dist/chat-input.js', 'utf8')).replaceAll('</script', '<\/script');
await writeFile(resolve(out, 'chat-input.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'none\'"><title>聊天输入</title></head><body><div id="root"></div><script>' + inputJs + '</script></body></html>');
console.log('Built shell/resources/chat-input.html');
