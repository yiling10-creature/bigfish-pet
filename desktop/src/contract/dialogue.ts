export const categories = ['idle','start','thinking','writing','read','search','edit','command','test','web','parallel','tool','waiting','error','complete','stopped','image','export','background','agent'] as const;
export type Category = typeof categories[number];
export const categoryLabels: Record<Category,string> = {idle:'空闲等候',start:'收到任务',thinking:'思考',writing:'输出内容',read:'读取文件',search:'搜索内容',edit:'修改文件',command:'执行命令',test:'运行测试',web:'浏览网页',parallel:'并行处理',tool:'其他工具',waiting:'等待确认',error:'遇到问题',complete:'任务完成',stopped:'已经停止',image:'生成图片',export:'导出文件',background:'后台任务',agent:'子代理协作'};
/** Built-in dialogue; user overrides and character-specific lines take precedence. */
export const defaultLines: Record<Category,string[]> = {
  "idle": [
    "我在等哦～",
    "有任务就叫我呀！",
    "准备好啦，随时开工～",
    "尾巴摇一摇，等你来找我～",
    "小鱼在这里，慢慢来呀～",
    "今天想一起做点什么？",
    "我先伸个懒腰，随叫随到～",
    "工具箱收好啦，等你发话～"
  ],
  "start": [
    "收到，马上开工！",
    "让我看看这次做什么～",
    "小鱼收到，准备进入工作状态！",
    "围裙系好啦，开始忙起来～",
    "先看看你的要求，再一步步来～",
    "这次一起把事情做好呀～",
    "开始处理「{task}」啦～",
    "尾巴就位，工具箱就位！"
  ],
  "thinking": [
    "让我认真想一想……",
    "思路正在整理中～",
    "先把这几个线索串起来～",
    "小鱼脑袋正在转呀转……",
    "这里需要再琢磨一下～",
    "让我找个更清楚的思路～",
    "先理顺步骤，再继续往下走～",
    "我在想怎样把「{task}」做好～"
  ],
  "writing": [
    "在写了在写了……",
    "正在把想法变成文字～",
    "键盘哒哒哒，内容正在赶来～",
    "让我把这段写得清楚一点～",
    "小鱼正在认真组织语言～",
    "继续写，思路不要跑呀～",
    "再整理一下这段的表达～",
    "正在一点点补全这份回答～"
  ],
  "read": [
    "正在认真读 {file}～",
    "我去 {file} 里翻翻线索～",
    "看看 {file} 能帮上什么忙～",
    "把 {file} 打开，仔细瞧瞧～",
    "小鱼的目光锁定 {file}！",
    "让我把 {file} 的上下文读明白～",
    "正在从 {file} 里找有用的信息～",
    "{file} 阅读中，尾巴先安静一会儿～"
  ],
  "search": [
    "让我找找看……",
    "目标锁定，开始搜寻！",
    "小鱼雷达打开，寻找线索～",
    "再往相关的地方翻一翻～",
    "正在把可能有用的结果找出来～",
    "线索可能就在下一个角落里～",
    "跟着关键词继续找呀找～",
    "让 {tool} 帮我们缩小范围～"
  ],
  "edit": [
    "正在修改 {file}～",
    "这里修一下：{file}～",
    "小鱼拿起笔，调整 {file}～",
    "把这处改动写进 {file} 里～",
    "正在给 {file} 做细节调整～",
    "{file} 修改中，稍等一下呀～",
    "一处一处来，先处理 {file}～",
    "让 {file} 更接近这次的要求～"
  ],
  "command": [
    "{tool} 跑起来啦！",
    "我盯着 {tool} 的执行结果呢～",
    "{tool} 正在忙，小鱼陪你一起等～",
    "工具箱打开，轮到 {tool} 上场！",
    "{tool} 执行中，尾巴先收好～",
    "让 {tool} 把这一小步跑完～",
    "小鱼守着终端，等 {tool} 回消息～",
    "{tool} 这边还在处理，先看它的反馈～"
  ],
  "test": [
    "检查一下有没有小问题！",
    "正在逐项检查～",
    "小鱼拿起检查表，一项项过～",
    "让测试来看看这次的改动～",
    "正在等测试结果回来～",
    "边界情况也要照顾到呀～",
    "先跑一轮检查，再看结果说话～",
    "{tool} 正在检查，结果还没揭晓～"
  ],
  "web": [
    "我去网上看看～",
    "正在翻阅网页～",
    "小鱼打开浏览器，找找资料～",
    "看看页面里有没有相关说明～",
    "正在读取网页上的信息～",
    "让我沿着相关链接看一看～",
    "这一页也许有我们需要的线索～",
    "网上资料查阅中，稍等一下呀～"
  ],
  "parallel": [
    "分头忙起来啦！",
    "正在并行处理 {activeCount} 项～",
    "这边那边都在忙，小鱼来回看～",
    "{activeCount} 项任务一起推进中～",
    "等各路结果慢慢汇合～",
    "多条线一起走，先跟着当前进度～",
    "小鱼的工具箱分成好几份啦～",
    "还有 {activeCount} 项正在处理呀～"
  ],
  "tool": [
    "工具箱拿来啦！",
    "正在使用 {tool}～",
    "让 {tool} 来帮这一手～",
    "小鱼把 {tool} 请出来啦～",
    "{tool} 处理中，等它给个反馈～",
    "这一步交给 {tool} 试试看～",
    "工具准备好，继续往前做～",
    "{tool} 正在忙，我在这里陪着～"
  ],
  "waiting": [
    "这一步要你点头哦～",
    "我在这里等你确认～",
    "先停在这里，等你决定呀～",
    "准备好了，你确认后再继续～",
    "这一步由你来拿主意～",
    "不用着急，我把位置留在这里～",
    "小鱼举手：这里需要你的确认～",
    "等你看过这一项，我们再往下走～"
  ],
  "error": [
    "这一步出了点问题……",
    "让我看看哪里卡住了～",
    "小鱼先停一下，看看错误提示～",
    "这里没有顺利完成，得检查一下～",
    "遇到个小绊脚石，先弄清原因～",
    "这次结果不太对，看看反馈吧～",
    "这一步需要再检查，别急着往下走～",
    "出状况啦，我陪你一起看提示～"
  ],
  "complete": [
    "做好啦，来看看！",
    "完成！给我放个小假吧～",
    "这轮收工啦，结果等你过目～",
    "工具放好，等你看看成果～",
    "小鱼交卷，欢迎检查！",
    "忙完这一轮，尾巴可以摇起来啦～",
    "这一轮结束啦，你来验收呀～",
    "结果送到，请查收小鱼的作业～"
  ],
  "stopped": [
    "已经停下啦～",
    "这轮先停在这里～",
    "收到，工具先收起来～",
    "小鱼暂停营业一小会儿～",
    "已经停止，等你下一步安排～",
    "先不往下做了，你来决定后续～",
    "停好啦，需要时再叫我～",
    "这次先到这里，陪你歇一歇～"
  ],
  "image": [
    "正在画画，稍等一下～",
    "小鱼的画笔准备好啦～",
    "图像正在制作中，等它慢慢成形～",
    "调一调颜色，等画面出现～",
    "正在把想法变成画面～",
    "画布那边还在忙呀～",
    "{tool} 正在处理图像～",
    "小鱼守着画板，等待这张图～"
  ],
  "export": [
    "正在整理交付文件～",
    "把要交付的内容收拢一下～",
    "小鱼正在准备导出的文件～",
    "结果打包中，稍等一下呀～",
    "把这份成果装进小包裹～",
    "文件正在导出，马上再看反馈～",
    "正在整理可以带走的成果～",
    "交付文件准备中，小鱼来帮忙～"
  ],
  "background": [
    "后台任务还在忙哦～",
    "这项任务正在后台继续处理～",
    "后台那边还没结束，我陪你等～",
    "后台工作进行中，留意它的反馈～",
    "小鱼给后台任务留着一盏灯～",
    "后台还有事情在跑呀～",
    "等后台结果回来，再接着看～",
    "后台处理中，进度有更新就能看到～"
  ],
  "agent": [
    "小伙伴们一起开工啦！",
    "正在等协作伙伴的反馈～",
    "这一步请小伙伴来帮忙～",
    "小鱼和伙伴一起处理任务～",
    "协作正在进行，等结果汇合～",
    "小伙伴在忙，我也在这里～",
    "分工安排中，一起往前推进～",
    "子代理正在处理它负责的部分～"
  ]
};
export const categoryMotions: Record<Category,string> = {idle:'wait-sign',start:'wave',thinking:'read',writing:'type',read:'read',search:'peek',edit:'type',command:'repair',test:'read',web:'read',parallel:'shuffle',tool:'repair',waiting:'wait-sign',error:'wipe',complete:'celebrate',stopped:'sigh',image:'type',export:'stamp',background:'breathe',agent:'wave'};
export interface ToolRule { pattern: string; category: Category; label: string }
export function parseLines(raw: string): Partial<Record<Category,string[]>> {
 if(raw.length>64000)throw Error('台词库过大');const v:unknown=JSON.parse(raw);
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('台词库无效');
 for(const [key,lines] of Object.entries(v))if(!categories.includes(key as Category)||!Array.isArray(lines)||lines.length>30||lines.some(x=>typeof x!=='string'||x.length>160||!x.trim()||/\{(?!task\}|tool\}|file\}|elapsed\}|activeCount\}|completedCount\})[^}]*\}/.test(x)))throw Error('台词或占位符无效');
 return v as Partial<Record<Category,string[]>>;
}
export function parseRules(raw: string): ToolRule[] {
 if(raw.length>32000)throw Error('工具规则过大');const v:unknown=JSON.parse(raw);
 if(!Array.isArray(v)||v.length>100||v.some(r=>!r||typeof r.pattern!=='string'||!r.pattern.trim()||r.pattern.length>100||!/^[-\w./:@]+\*?$/.test(r.pattern)||!categories.includes(r.category)||typeof r.label!=='string'||r.label.length>60))throw Error('工具规则无效');
 return v as ToolRule[];
}
export function classifyTool(name: string, rules: ToolRule[]): {category:Category;label:string} {
 const exact=rules.find(r=>r.pattern===name),prefix=rules.filter(r=>r.pattern.endsWith('*')&&name.startsWith(r.pattern.slice(0,-1))).sort((a,b)=>b.pattern.length-a.pattern.length)[0];
 const match=exact??prefix;if(match)return {category:match.category,label:match.label||name};
 const n=name.toLowerCase();let category:Category='tool';
 if(/test|pytest|vitest/.test(n))category='test';else if(/read|open_file|cat_file/.test(n))category='read';else if(/search|grep|find|glob/.test(n))category='search';else if(/edit|write_file|patch|replace/.test(n))category='edit';else if(/browser|browse|web|fetch|navigate/.test(n))category='web';else if(/spawn|delegate|subagent/.test(n))category='agent';else if(/exec|bash|shell|terminal|run_code|command/.test(n))category='command';
 return {category,label:category==='tool'?name:categoryLabels[category]};
}
export function formatLine(line:string, values:Record<string,string|number>):string {
 return line.replace(/\{(task|tool|file|elapsed|activeCount|completedCount)\}/g,(_,key)=>String(values[key]??({task:'这次任务',file:'这个文件',tool:'工具',elapsed:'片刻',activeCount:1,completedCount:0} as Record<string,string|number>)[key])).slice(0,240);
}
