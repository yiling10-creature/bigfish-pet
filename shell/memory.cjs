const fs = require('node:fs');
const path = require('node:path');
const { providerFor } = require('./providers.cjs');

const MANUAL_START = '<!-- manual:start -->', MANUAL_END = '<!-- manual:end -->';
const AUTO_START = '<!-- auto:start -->', AUTO_END = '<!-- auto:end -->';
function between(text, start, end) {
  const at = text.indexOf(start), stop = text.indexOf(end, at + start.length);
  return at >= 0 && stop > at ? text.slice(at + start.length, stop).trim() : '';
}
function createMemory({ directory, characterName = '肥肥鱼', log = () => {} }) {
  fs.mkdirSync(directory, { recursive: true });
  const cache = new Map(), jobs = new Map(), generations = new Map();
  const files = id => { providerFor(id); return { data: path.join(directory, `${id}.json`), markdown: path.join(directory, `${id}.md`), archive: path.join(directory, `${id}-对话归档.md`) }; };
  function load(id) {
    if (cache.has(id)) return cache.get(id);
    const f = files(id); let data;
    try {
      const raw = JSON.parse(fs.readFileSync(f.data, 'utf8'));
      if (raw.version !== 1 || !Array.isArray(raw.turns)) throw new Error('Invalid memory format');
      data = { ...raw, turns: raw.turns.filter(t => t && typeof t.id === 'string' && typeof t.user === 'string' && typeof t.assistant === 'string') };
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`${providerFor(id).label}记忆文件无法读取；已保留原文件，请先检查记忆目录。`);
      data = { version: 1, summary: '', archived: 0, turns: [] };
    }
    cache.set(id, data);
    if (!fs.existsSync(f.markdown)) persist(id);
    return data;
  }
  function manual(id) {
    try { return between(fs.readFileSync(files(id).markdown, 'utf8'), MANUAL_START, MANUAL_END).slice(0, 12000); }
    catch { return ''; }
  }
  function persist(id) {
    const data = cache.get(id), f = files(id), note = manual(id);
    fs.writeFileSync(`${f.data}.tmp`, JSON.stringify(data), 'utf8'); fs.renameSync(`${f.data}.tmp`, f.data);
    const text = `# ${characterName} · ${providerFor(id).label} 长期记忆\n\n本接口的对话独立保存。完整聊天见同目录的对话归档；可在下方手动记忆区域补充信息。\n\n## 手动记忆\n${MANUAL_START}\n${note}\n${MANUAL_END}\n\n## 自动整理的长期记忆\n${AUTO_START}\n${data.summary || ''}\n${AUTO_END}\n\n已归档 ${data.archived} 轮对话，另保留 ${data.turns.length} 轮近期对话。\n`;
    fs.writeFileSync(`${f.markdown}.tmp`, text, 'utf8'); fs.renameSync(`${f.markdown}.tmp`, f.markdown);
  }
  function archive(id, text) {
    const f = files(id);
    if (!fs.existsSync(f.archive)) fs.writeFileSync(f.archive, `# ${characterName} · ${providerFor(id).label} 完整对话归档\n\n`, 'utf8');
    fs.appendFileSync(f.archive, text, 'utf8');
  }
  function seed(id, messages) {
    const d = load(id); if (d.turns.length || d.archived) return;
    for (let i = 0; i + 1 < messages.length; i++) {
      const u = messages[i], a = messages[i + 1];
      if (u?.role === 'user' && a?.role === 'assistant' && u.content && a.content) {
        const turn = { id: `import-${i}`, user: String(u.content), assistant: String(a.content), reasoning: String(a.reasoning_content || ''), status: 'done' };
        d.turns.push(turn); archive(id, `## 从旧版本导入 · ${turn.id}\n\n### 用户\n${turn.user}\n\n### ${characterName}\n${turn.assistant}\n\n`); i++;
      }
    }
    persist(id);
  }
  function context(id, rounds, beforeId) {
    const d = load(id), messages = [];
    const before = beforeId ? d.turns.findIndex(t => t.id === beforeId) : -1;
    const turns = before >= 0 ? d.turns.slice(0, before) : d.turns;
    for (const turn of turns.slice(-rounds)) {
      if (!turn.assistant || turn.status === 'failed') continue;
      messages.push({ role: 'user', content: turn.user }, { role: 'assistant', content: turn.assistant, ...(turn.reasoning ? { reasoning_content: turn.reasoning } : {}) });
    }
    let length = messages.reduce((n, m) => n + m.content.length + (m.reasoning_content?.length || 0), 0);
    while (length > 80000 && messages.length > 2) { const removed = messages.splice(0, 2); length -= removed.reduce((n, m) => n + m.content.length + (m.reasoning_content?.length || 0), 0); }
    return messages;
  }
  function prompt(id) {
    const d = load(id), f = files(id);
    // Read Markdown on each request so edits made in an editor take effect immediately.
    let summary = d.summary;
    try { summary = between(fs.readFileSync(f.markdown, 'utf8'), AUTO_START, AUTO_END); } catch { /* JSON remains authoritative if Markdown is unavailable. */ }
    return [manual(id), summary].filter(Boolean).join('\n\n').slice(0, 24000);
  }
  function start(id, turnId, user) {
    const d = load(id);
    if (d.turns.some(t => t.id === turnId)) throw new Error('本轮请求编号已存在，请重新发送。');
    d.turns.push({ id: turnId, user, assistant: '', reasoning: '', status: 'pending' });
    archive(id, `## ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · ${turnId}\n\n### 用户\n${user}\n\n`); persist(id);
  }
  function finish(id, turnId, assistant, reasoning, status) {
    const d = load(id), turn = d.turns.find(t => t.id === turnId); if (!turn || turn.status !== 'pending') return;
    Object.assign(turn, { assistant, reasoning, status });
    archive(id, `### ${characterName} · ${turnId}\n${assistant || '（本轮未生成回答）'}\n\n状态：${status}\n\n`); persist(id);
  }
  function status(id) { const d = load(id); return { directory, file: files(id).markdown, archived: d.archived, recent: d.turns.length, hasSummary: Boolean(prompt(id)), summarizing: jobs.has(id) }; }
  function history(id) { return load(id).turns.slice(-100).map(t => ({ ...t })); }
  async function compact(id, rounds, summarize, force = false) {
    if (jobs.has(id)) { await jobs.get(id); return status(id); }
    const generation = generations.get(id) || 0;
    const d = load(id), keep = force ? Math.min(10, rounds) : rounds;
    const older = d.turns.slice(0, -keep).filter(t => t.status !== 'pending');
    if (older.length < (force ? 1 : 8)) return status(id);
    const job = (async () => {
      const selected = older.slice(0, 30), ids = new Set(selected.map(t => t.id));
      const text = await summarize(prompt(id), selected);
      if ((generations.get(id) || 0) !== generation) return status(id);
      if (!text?.trim()) throw new Error('本次未生成记忆摘要，完整对话仍已保留。');
      d.summary = text.trim().slice(0, 16000); d.archived += selected.length;
      d.turns = d.turns.filter(t => !ids.has(t.id)); persist(id); return status(id);
    })();
    jobs.set(id, job);
    try { await job; } catch (error) { log('MEMORY_SUMMARY_FAILED', id, error.message); throw error; }
    finally { if (jobs.get(id) === job) jobs.delete(id); }
    return status(id);
  }
  function clear(id) {
    const f = files(id);
    generations.set(id, (generations.get(id) || 0) + 1); jobs.delete(id);
    cache.set(id, { version: 1, summary: '', archived: 0, turns: [] });
    // Clear each known file only; retain the provider directory and configuration.
    fs.writeFileSync(f.markdown, '', 'utf8'); persist(id);
    fs.writeFileSync(f.archive, `# ${characterName} · ${providerFor(id).label} 完整对话归档\n\n`, 'utf8');
    return status(id);
  }
  return { seed, context, prompt, start, finish, status, history, compact, clear };
}
module.exports = { createMemory };
