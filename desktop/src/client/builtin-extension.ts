// 运行时素材版本：扩展动作包（playful .dshpet）不再内联进 pet.html，
// 由主进程从已安装插件中读出并通过 preload 注入。
import metadata from '../../examples/bigfish-playful/animations.json' with { type: 'json' };
import { decodePet, type PetBundle } from '../pet/contract.js';
import { loadImages, type LoadedPet } from '../pet/library.js';

export const newBuiltinMotions = metadata.filter(a => Boolean(a.family));
let data: PetBundle | undefined;
let pending: Promise<PetBundle> | undefined;
let images: Promise<LoadedPet> | undefined;
let owners = 0;
export const builtinExtensionData = () => data;

function playfulBytes(): Uint8Array {
  const value = (globalThis as unknown as { __BIGFISH_ASSETS__?: Record<string, string> })
    .__BIGFISH_ASSETS__?.playful;
  if (!value) throw new Error('缺少扩展动作包 playful，请确认已安装 dsh-bigfish 插件');
  const base64 = value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** All visible built-in canvases share decoded sheets; each releases only its own lease. */
export async function loadBuiltinExtension(): Promise<LoadedPet> {
  pending ??= decodePet(playfulBytes()).then(pet => (data = pet));
  const loading = images ??= pending.then(pet => loadImages('bigfish-builtin-extension', pet));
  owners++;
  try {
    const loaded = await loading;
    let released = false;
    return { ...loaded, release() {
      if (released) return;
      released = true;
      if (--owners === 0) { loaded.release(); if (images === loading) images = undefined; }
    } };
  } catch (error) {
    if (--owners === 0 && images === loading) images = undefined;
    throw error;
  }
}