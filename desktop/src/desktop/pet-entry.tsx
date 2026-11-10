import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopCompanion } from './controller.js';
import { DesktopSettings } from './settings.js';
import { Widget } from '../client/ui.js';
import { DeepSeekChat } from '../client/deepseek-chat.js';
import { zh, type Translate } from '../client/locales.js';
import { petLibrary } from '../pet/library.js';
import type { WorkState } from '../contract/types.js';
import type { DeepSeekBridge, ProviderId } from '../client/deepseek.js';
import css from '../client/styles.css';
import desktopCss from './styles.css';

type Command =
  | { type: 'state'; state: WorkState }
  | { type: 'auto'; enabled: boolean }
  | { type: 'refresh' }
  | { type: 'ai-config-changed' }
  | { type: 'chat-keyboard-ended' }
  | { type: 'ai-memory-cleared'; provider: ProviderId; scope?: string }
  | { type: 'cursor-near'; near: boolean }
  | { type: 'reset-position' };

type Hotspot = { x: number; y: number; w: number; h: number };

declare global {
  interface Window {
    desktopPet?: {
      setHotspots(list: Array<{ x: number; y: number; w: number; h: number }>): void;
      setInteractiveLock(locked: boolean): void;
      onCommand(callback: (command: Command) => void): void;
      openSettings(): void;
      setKeyboardFocus(enabled: boolean): Promise<boolean>;
      chatInput: {
        open(payload: { value: string; rect: { x: number; y: number; width: number; height: number } }): Promise<{ value: string; submit: boolean; error?: string }>;
        read(): Promise<{ value: string }>;
        update(value: string): void;
        ready(): void;
        finish(result: { value: string; submit: boolean }): void;
        cancel(): void;
      };
      openExternal(url: string): Promise<{ ok: boolean; message?: string }>;
      settingsChanged(): void;
      contextMenu(): void;
      deepseek?: DeepSeekBridge;
      resetPosition(): void;
      chatStarted(): void;
      saveFile(filename: string, bytes: Uint8Array): Promise<{ ok: boolean; canceled?: boolean; message?: string }>;
      desktop?: {
        status(): Promise<{ alwaysOnTop: boolean; displayId: number | null; displays: Array<{ id: number; label: string }> }>;
        update(patch: { alwaysOnTop?: boolean; displayId?: number | null }): Promise<{ alwaysOnTop: boolean; displayId: number | null; displays: Array<{ id: number; label: string }> }>;
      };
    };
  }
}

const settingsMode = location.hash === '#settings';
if (settingsMode) document.title = '肥肥鱼桌宠 · 设置';

const style = document.createElement('style');
style.textContent = `${css}\n${desktopCss}
html, body { margin: 0; width: 100%; height: ${settingsMode ? 'auto' : '100%'} !important; min-height: 100%; background: ${settingsMode ? '#f4f7fb' : 'transparent'} !important; overflow: ${settingsMode ? 'auto' : 'hidden'} !important; }
#root { width: 100%; height: ${settingsMode ? 'auto' : '100%'} !important; min-height: 100%; background: ${settingsMode ? '#fafcff' : 'transparent'} !important; overflow: ${settingsMode ? 'visible' : 'hidden'} !important; }
body { -webkit-user-select: ${settingsMode ? 'text' : 'none'}; }
`;
document.head.append(style);

let storage: Storage | null = null;
try {
  storage = localStorage;
  if (!storage.getItem('bigfish.position.v1'))
    storage.setItem('bigfish.position.v1', JSON.stringify({ right: 24, bottom: 24 }));
} catch {
  /* Preferences then stay session-only. */
}

void petLibrary.init(false);
const controller = new DesktopCompanion(storage);
const t: Translate = key => zh[key];

const stages: Array<{ state: WorkState; ms: number }> = [
  { state: 'idle', ms: 24000 },
  { state: 'reasoning', ms: 14000 },
  { state: 'generating', ms: 22000 },
  { state: 'tool-running', ms: 9000 },
  { state: 'waiting-user', ms: 9000 },
  { state: 'completed', ms: 8000 },
];
let stage = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function stopAuto() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

function scheduleAuto() {
  if (timer) clearTimeout(timer);
  const next = stages[stage++ % stages.length]!;
  controller.setState(next.state);
  timer = setTimeout(scheduleAuto, next.ms);
}

function startAuto() {
  stage = 0;
  scheduleAuto();
}

function opaqueHotspots(): Hotspot[] {
  const canvas = document.querySelector<HTMLCanvasElement>('.bf-widget canvas');
  if (!canvas) return [];
  const bounds = canvas.getBoundingClientRect();
  if (!canvas.width || !canvas.height || bounds.width < 1 || bounds.height < 1) return [];
  let pixels: Uint8ClampedArray;
  try {
    const context = canvas.getContext('2d');
    if (!context) return [{ x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height }];
    pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return [{ x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height }];
  }
  const cell = 6;
  const columns = Math.ceil(bounds.width / cell);
  const rows = Math.ceil(bounds.height / cell);
  const filled = new Uint8Array(columns * rows);
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  const stepX = Math.max(1, Math.floor(scaleX * 2));
  const stepY = Math.max(1, Math.floor(scaleY * 2));
  for (let y = 0; y < canvas.height; y += stepY) {
    const row = Math.min(rows - 1, Math.floor(y / scaleY / cell));
    for (let x = 0; x < canvas.width; x += stepX) {
      if ((pixels[(y * canvas.width + x) * 4 + 3] ?? 0) < 12) continue;
      const column = Math.min(columns - 1, Math.floor(x / scaleX / cell));
      filled[row * columns + column] = 1;
    }
  }
  const bands: Hotspot[] = [];
  for (let row = 0; row < rows; row++) {
    let start = -1;
    for (let column = 0; column <= columns; column++) {
      const on = column < columns && filled[row * columns + column] === 1;
      if (on) {
        if (start < 0) start = column;
        continue;
      }
      if (start < 0) continue;
      const x = bounds.left + start * cell;
      const y = bounds.top + row * cell;
      const w = Math.min((column - start) * cell, bounds.right - x);
      const h = Math.min(cell, bounds.bottom - y);
      if (w > 0 && h > 0) bands.push({ x, y, w, h });
      start = -1;
    }
  }
  const merged: Hotspot[] = [];
  const open = new Map<string, Hotspot>();
  for (const band of bands) {
    const key = `${Math.round(band.x)}:${Math.round(band.w)}`;
    const previous = open.get(key);
    if (previous && Math.abs(previous.y + previous.h - band.y) < 0.5) previous.h += band.h;
    else {
      const copy = { ...band };
      open.set(key, copy);
      merged.push(copy);
    }
  }
  return merged.slice(0, 220);
}

if (!settingsMode && window.desktopPet) {
  window.desktopPet.onCommand(command => {
    if (command.type === 'chat-keyboard-ended') dispatchEvent(new Event('bigfish:keyboard-ended'));
    if (command.type === 'ai-config-changed') dispatchEvent(new Event('bigfish:ai-config'));
    if (command.type === 'ai-memory-cleared') dispatchEvent(new CustomEvent('bigfish:memory-cleared', { detail: { provider: command.provider, scope: command.scope } }));
    if (command.type === 'state') {
      stopAuto();
      controller.setState(command.state);
    } else if (command.type === 'auto') {
      if (command.enabled) startAuto();
      else stopAuto();
    } else if (command.type === 'refresh') {
      controller.preferences.reloadLocal();
      dispatchEvent(new Event('bigfish:pack'));
      void petLibrary.refresh().catch(() => {});
    } else if (command.type === 'reset-position') {
      dispatchEvent(new Event('bigfish:reset-position'));
    }
  });

  addEventListener('contextmenu', event => {
    if (event.target instanceof Element && event.target.closest('.bf-chat, .bf-chat-toggle')) return;
    event.preventDefault();
    window.desktopPet?.contextMenu();
  });

  addEventListener('dblclick', event => {
    if (event.target instanceof Element && event.target.closest('.bf-chat, .bf-chat-toggle')) return;
    if (event.target instanceof Element && event.target.closest('.bf-widget'))
      window.desktopPet?.openSettings();
  });

  let lastHotspots = '';
  let lastOpaque: Hotspot[] = [];
  let lastOpaqueAt = 0;
  let lastGeometry = '';
  const sendHotspots = () => {
    if (document.hidden) return;
    const bounds = document.querySelector('.bf-widget canvas')?.getBoundingClientRect();
    const geometry = bounds ? [bounds.x, bounds.y, bounds.width, bounds.height].join(':') : '';
    if (geometry !== lastGeometry) { lastGeometry = geometry; lastOpaqueAt = 0; }
    const cursorNear = document.documentElement.dataset.cursorNear === 'true';
    // Read pixels only near the pet; distant cursors need a coarse activation region.
    if (cursorNear && performance.now() - lastOpaqueAt > 350) {
      lastOpaque = opaqueHotspots(); lastOpaqueAt = performance.now();
    }
    const list = [
      ...lastOpaque.filter(() => cursorNear),
      ...(bounds ? [{ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height, coarse: true }] : []),
      ...Array.from(
        document.querySelectorAll<HTMLElement>(
          '.bf-restore, .bf-popover, .bf-modal-backdrop, .bf-error, .bf-compatibility, .bf-chat, .bf-chat-toggle',
        ),
      )
        .map(element => element.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => ({ x: rect.left, y: rect.top, w: rect.width, h: rect.height })),
    ];
    const next = JSON.stringify(list);
    if (next === lastHotspots) return;
    lastHotspots = next;
    window.desktopPet?.setHotspots(list);
  };

  window.desktopPet.onCommand(command => {
    if (command.type === 'cursor-near') {
      document.documentElement.dataset.cursorNear = String(command.near);
      lastOpaqueAt = 0; sendHotspots();
    }
  });

  const isPetTarget = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest('.bf-widget, .bf-restore, .bf-popover, .bf-modal-backdrop, .bf-chat'));

  addEventListener('pointerdown', event => {
    if (!(event.target instanceof Element) || !event.target.closest('.bf-chat')) void window.desktopPet?.setKeyboardFocus(false);
    if (isPetTarget(event.target)) window.desktopPet?.setInteractiveLock(true);
  }, true);
  addEventListener('pointerup', () => {
    sendHotspots();
    window.desktopPet?.setInteractiveLock(false);
  }, true);
  addEventListener('pointercancel', () => {
    window.desktopPet?.setInteractiveLock(false);
  }, true);

  setTimeout(sendHotspots, 50);
  const hotspotTimer = setInterval(sendHotspots, 350);
  addEventListener('pagehide', () => clearInterval(hotspotTimer));
}

function SettingsApp() {
  const revision = useSyncExternalStore(petLibrary.subscribe, petLibrary.getSnapshot);
  const store = useSyncExternalStore(
    controller.preferences.subscribe,
    controller.preferences.getSnapshot,
  );
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    window.desktopPet?.settingsChanged();
  }, [store.value, revision]);
  useEffect(() => {
    const changed = () => window.desktopPet?.settingsChanged();
    addEventListener('bigfish:pack', changed);
    return () => removeEventListener('bigfish:pack', changed);
  }, []);
  return (
    <main className="bf-surface bf-settings-window">
      <DesktopSettings controller={controller} />
    </main>
  );
}

function App() {
  useSyncExternalStore(petLibrary.subscribe, petLibrary.getSnapshot);
  return (
    <div className="bf-surface bf-desktop">
      <Widget controller={controller} t={t} minimal chat={<DeepSeekChat onStart={(id, search) => { stopAuto(); window.desktopPet?.chatStarted(); controller.begin(id, search); }} onEvent={event => controller.receive(event)} />} />
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(settingsMode ? <SettingsApp /> : <App />);
addEventListener('pagehide', () => {
  if (timer) clearTimeout(timer);
  controller.dispose();
});
