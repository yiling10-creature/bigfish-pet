import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChatHistory, historyKey, messagesFromMemory } from '../src/client/chat-history.js';
import type { ProviderId } from '../src/client/deepseek.js';
function storage() { const values = new Map<string, string>(); return { get length() { return values.size; }, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); }, clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null } satisfies Storage; }
test('legacy chat imports into DeepSeek only; provider histories remain independent', () => {
 const s = storage(); s.setItem('bigfish.chat.history.v1', JSON.stringify([{id:'u1',role:'user',content:'旧对话'},{id:'a1',role:'assistant',content:'旧回答'}]));
 assert.equal(readChatHistory(s,'deepseek').length,2);
 for(const id of ['zhipu','qwen','kimi'] as ProviderId[]) assert.equal(readChatHistory(s,id).length,0);
 s.setItem(historyKey('deepseek'),'[]'); assert.equal(readChatHistory(s,'deepseek').length,0);
});
test('restoring archived turns retains interrupted, truncated and failed states',()=>{
 const messages=messagesFromMemory([{id:'p',user:'等待',assistant:'半段',status:'pending'},{id:'t',user:'继续',assistant:'截断',status:'truncated'},{id:'f',user:'重试',assistant:'',status:'failed'}]);
 assert.equal(messages[1]?.stopped,true); assert.equal(messages[3]?.truncated,true); assert.equal(messages[5]?.failed,true);
});

test('persona history never imports the legacy default or another persona', () => {
 const s = storage();
 const messages = JSON.stringify([{ id: 'u', role: 'user', content: 'private' }, { id: 'a', role: 'assistant', content: 'answer' }]);
 s.setItem('bigfish.chat.history.v1', messages);
 assert.equal(readChatHistory(s, 'deepseek', 'alice').length, 0);
 s.setItem(historyKey('deepseek', 'alice'), messages);
 assert.equal(readChatHistory(s, 'deepseek', 'alice').length, 2);
 assert.equal(readChatHistory(s, 'deepseek', 'bob').length, 0);
 assert.equal(readChatHistory(s, 'qwen', 'alice').length, 0);
 assert.notEqual(historyKey('deepseek', 'alice'), historyKey('deepseek'));
});
