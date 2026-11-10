const PROVIDERS = Object.freeze({
  deepseek: { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'] },
  zhipu: { id: 'zhipu', label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7', models: ['glm-4.7'] },
  qwen: { id: 'qwen', label: '千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen-flash'] },
  kimi: { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6', models: ['kimi-k2.6', 'kimi-k3.1-pro'] },
});
function providerFor(id = 'deepseek') {
  if (typeof id !== 'string' || !Object.hasOwn(PROVIDERS, id)) throw new Error('请选择有效的模型服务商。');
  return PROVIDERS[id];
}
function baseUrlFor(id, value) {
  const provider = providerFor(id);
  let url;
  try { url = new URL(String(value || provider.baseUrl).trim().replace(/\/chat\/completions\/?$/, '')); }
  catch { throw new Error('接口地址格式不正确。'); }
  const host = url.hostname.toLowerCase();
  const allowed = id === 'deepseek' ? host === 'api.deepseek.com'
    : id === 'zhipu' ? host === 'open.bigmodel.cn'
      : id === 'kimi' ? ['api.moonshot.cn', 'api.moonshot.ai'].includes(host)
        : ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com'].includes(host) || host.endsWith('.maas.aliyuncs.com');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !allowed) {
    throw new Error(`请使用${provider.label}的官方 HTTPS 接口地址。`);
  }
  return url.toString().replace(/\/+$/, '');
}
function requestParameters(id, config, { stream = true, test = false } = {}) {
  const thinking = test ? false : config.thinking;
  const result = { model: config.model, stream, max_tokens: test ? 64 : thinking ? 8192 : 4096 };
  if (stream && id !== 'zhipu') result.stream_options = { include_usage: true };
  if (id === 'qwen') result.enable_thinking = thinking;
  else if (id === 'kimi' && /^kimi-k3/.test(config.model)) {
    result.reasoning_effort = 'low'; result.max_tokens = test ? 1024 : 8192;
  } else result.thinking = { type: thinking ? 'enabled' : 'disabled' };
  return result;
}
module.exports = { PROVIDERS, providerFor, baseUrlFor, requestParameters };
