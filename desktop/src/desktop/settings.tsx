import React, { useState, useSyncExternalStore, useEffect } from 'react';
import type { Companion } from '../client/controller.js';
import { preferenceDefaults, type Preferences } from '../contract/preferences.js';
import { DeepSeekSettings } from '../client/deepseek-settings.js';
import { RoleSettings } from '../pet/settings.js';
import { BackupSettings } from '../client/backup-settings.js';
import { petLibrary } from '../pet/library.js';

const tabs = [['home', '陪伴'], ['chat', '问答'], ['roles', '角色'], ['data', '数据']] as const;
export function DesktopSettings({ controller }: { controller: Companion }) {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>('home');
  const store = useSyncExternalStore(controller.preferences.subscribe, controller.preferences.getSnapshot);
  const p = store.value;
  useSyncExternalStore(petLibrary.subscribe, petLibrary.getSnapshot);
  const [notice, setNotice] = useState('');
  const [desktop, setDesktop] = useState<{ alwaysOnTop: boolean; displayId: number | null;
    displays: Array<{ id: number; label: string }> } | null>(null);
  useEffect(() => { void window.desktopPet?.desktop?.status().then(setDesktop).catch(() => setNotice('暂时无法读取窗口设置。')); }, []);
  const update = (patch: Partial<Preferences>) => {
    setNotice(''); void controller.preferences.update(patch).catch(() => setNotice('设置未能保存，请重试。'));
  };
  const windowUpdate = (patch: { alwaysOnTop?: boolean; displayId?: number | null }) => {
    void window.desktopPet?.desktop?.update(patch).then(setDesktop).catch(() => setNotice('窗口设置未能保存，请重试。'));
  };
  const select = (label: string, value: string | number, choices: readonly (readonly [string | number, string])[], change: (v: string) => void) => (
    <label className="bf-field"><span>{label}</span><select aria-label={label} value={value} onChange={e => change(e.target.value)}>
      {choices.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select></label>);
  const slider = (key: 'size' | 'opacity' | 'idleHoldSeconds' | 'idleMinSeconds' | 'idleMaxSeconds' | 'completionSeconds', label: string, min: number, max: number, step = 1) => (
    <label className="bf-field bf-range"><span>{label}<output>{key === 'size' ? `${Math.round(p.size / 180 * 100)}%` : key === 'opacity' ? `${Math.round(p.opacity * 100)}%` : `${p[key]} 秒`}</output></span>
      <input aria-label={label} type="range" value={p[key]} min={min} max={max} step={step} onChange={e => update({ [key]: +e.target.value })} /></label>);
  return (
    <div className="bf-desktop-settings">
      <header className="bf-home-header"><div className="bf-home-mark" aria-hidden="true">🐋</div>
        <div><p className="bf-eyebrow">桌面上的小小陪伴</p><h1>肥肥鱼的小窝</h1><p>一只陪着你的小鲸鱼。</p></div>
        <span className="bf-saved" role="status">{store.error || notice ? '保存遇到问题' : store.saving ? '正在保存' : '偏好自动保存'}</span>
      </header>
      <nav className="bf-settings-tabs" role="tablist" aria-label="设置分类">{tabs.map(([id, label], i) => (
        <button id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1} key={id} onClick={() => setTab(id)}
          onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const at = e.key === 'Home' ? 0 : e.key === 'End' ? 3 : (i + (e.key === 'ArrowRight' ? 1 : 3)) % 4; setTab(tabs[at]![0]); document.getElementById(`tab-${tabs[at]![0]}`)?.focus(); } }}>
          <span className="bf-tab-number" aria-hidden="true">0{i + 1}</span>{label}</button>))}</nav>
      {(notice || store.error) && <p className="bf-error" role="alert">{notice || '偏好未能保存，请重试。'}</p>}
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="bf-settings-content">
        {tab === 'home' && <>
          <section className="bf-setting-card"><div className="bf-section-title"><span>01</span><div><h2>陪伴的节奏</h2><p>闲下来做点小动作，聊天时认真回应你。</p></div></div>
            {select('空闲互动', p.idleMode, [['quiet', '安静陪着'], ['occasional', '偶尔活动'], ['natural', '自然陪伴'], ['frequent', '活泼陪伴'], ['continuous', '持续活动'], ['custom', '自定义间隔']], v => update({ idleMode: v as Preferences['idleMode'] }))}
            {p.idleMode === 'custom' && <>{slider('idleMinSeconds', '最短休息时间', 1, 600)}{slider('idleMaxSeconds', '最长休息时间', 1, 600)}</>}
            {select('动作幅度', p.richness, [[0, '轻柔'], [1, '自然'], [2, '活泼']], v => update({ richness: +v }))}
            {p.idleMode !== 'quiet' && slider('idleHoldSeconds', '每次空闲动作时长', 5, 30)}
            {select('举牌偏好', p.idleSignPreference, [['prefer', '多举牌'], ['balanced', '均衡轮换'], ['none', '不举牌']], v => update({ idleSignPreference: v as Preferences['idleSignPreference'] }))}
            {select('回答结束后', p.completionMode === 'celebrate' ? 'celebrate' : 'quiet', [['celebrate', '开心庆祝一下'], ['quiet', '安静休息']], v => update({ completionMode: v as Preferences['completionMode'] }))}
            {p.completionMode === 'celebrate' && slider('completionSeconds', '庆祝时长', 1, 15)}
          </section>
          <section className="bf-setting-card"><div className="bf-section-title"><span>02</span><div><h2>外观与窗口</h2><p>留一点空间，也保留一点存在感。</p></div></div>
            {slider('size', '角色大小', 120, 300, 10)}{slider('opacity', '角色透明度', 0.3, 1, 0.05)}
            {select('动画播放', p.motionPolicy, [['system', '跟随系统'], ['normal', '正常播放'], ['reduced', '减弱动态']], v => update({ motionPolicy: v as Preferences['motionPolicy'], reducedMotion: false }))}
            {!petLibrary.active && select('布景', p.scene, [['auto', '跟随动作'], ['desk', '书桌'], ['library', '书房'], ['workshop', '工作间'], ['rest', '休息区'], ['delivery', '收工']], v => update({ scene: v }))}
            {desktop && <><label className="bf-field"><span>始终显示在其他窗口上方</span><input aria-label="窗口置顶" type="checkbox" checked={desktop.alwaysOnTop} onChange={e => windowUpdate({ alwaysOnTop: e.target.checked })} /></label>
              {select('所在显示器', desktop.displayId ?? 'primary', [['primary', '主显示器'], ...desktop.displays.map(d => [d.id, d.label] as const)], v => windowUpdate({ displayId: v === 'primary' ? null : +v }))}</>}
            <div className="bf-button-row"><button onClick={() => window.desktopPet?.resetPosition()}>让肥肥鱼回到右下角</button></div>
          </section>
        </>}
        {tab === 'chat' && <section className="bf-setting-card"><div className="bf-section-title"><span>01</span><div><h2>和肥肥鱼聊聊</h2><p>选一个接口，和同一只肥肥鱼继续聊。</p></div></div><DeepSeekSettings /></section>}
        {tab === 'roles' && <section className="bf-setting-card"><div className="bf-section-title"><span>01</span><div><h2>选择你的伙伴</h2><p>预览动作，或带来一位新朋友。</p></div></div><RoleSettings /></section>}
        {tab === 'data' && <>
          <p className="bf-help">各接口分别保存近期聊天，源文件夹中的记忆 Markdown 保留长期摘要和完整对话。下方角色备份不包含聊天、记忆和 API Key。</p>
          <section className="bf-setting-card"><div className="bf-section-title"><span>01</span><div><h2>备份与恢复</h2><p>把角色和陪伴习惯一起保存。</p></div></div><BackupSettings controller={controller} /></section>
          <section className="bf-setting-card"><h2>重新整理小窝</h2><p className="bf-help">恢复陪伴和外观默认值，保留已安装角色、聊天记录和 API Key。</p><div className="bf-button-row"><button onClick={() => { if (confirm('恢复陪伴和外观的默认设置？')) update({ ...preferenceDefaults, whipEnabled: false, dialogueJson: p.dialogueJson, toolRulesJson: p.toolRulesJson }); }}>恢复默认偏好</button></div></section>
        </>}
      </div>
      <footer className="bf-settings-foot"><span>肥肥鱼桌宠</span><span>愿每一次等待，都有陪伴。</span></footer>
    </div>
  );
}
