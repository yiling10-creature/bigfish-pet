// 运行时素材版本：替换上游 src/client/sprite-assets.ts
// 目的：构建时不再把 6 张图集内联进 pet.html，改由主进程在运行时读入并通过
//       preload 注入 window.__BIGFISH_ASSETS__，从而让本仓库与安装包都不携带素材。
import { isBuiltinAsset } from "../contract/builtin-assets.js";
import { parsePack } from "../contract/scenes.js";
import manifest from "../../packs/classic/manifest.json" with { type: "json" };
import layouts from "../../assets/sprites/atlas-layout.json" with { type: "json" };

type AssetMap = Record<string, string>;

const injected = (): AssetMap => {
  const value = (globalThis as unknown as { __BIGFISH_ASSETS__?: AssetMap }).__BIGFISH_ASSETS__;
  return value && typeof value === "object" ? value : {};
};

const url = (name: string): string => {
  const value = injected()[name];
  if (!value) throw new Error(`缺少宠物素材：${name}。请先安装 dsh-bigfish 插件，或设置 BIGFISH_PET_ASSETS。`);
  return value;
};

// 用 getter 延迟取值：素材缺失时抛错发生在渲染阶段，而不是模块加载阶段，
// 主进程可以先弹提示再决定是否继续。
export const spriteUrls = {
  get classic() {
    return url("bigfish-atlas.png");
  },
  get motions() {
    return url("bigfish-motions.png");
  },
  get signs() {
    return url("bigfish-signs.png");
  },
  get work() {
    return url("bigfish-work.png");
  },
  get quiet() {
    return url("bigfish-quiet.png");
  },
  get daily() {
    return url("bigfish-daily.png");
  },
};

export { layouts };
export const classicPack = parsePack(manifest, isBuiltinAsset);
