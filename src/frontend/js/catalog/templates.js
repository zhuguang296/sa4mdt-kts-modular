// 四个内置模板：套用后直接可用的完整画布
// 坐标经过安排，保证「同级按上→下、左→右」的执行顺序符合直觉

import { newCanvas, newNode } from '../model.js';

let t = 0;
const id = (p) => `${p}${++t}`;

/** 简单助手：串一条 父 -> 子 的结构线 */
function chain(edges, from, fromPort, to) {
  edges.push({ id: id('e'), from: { node: from, port: fromPort }, to: { node: to, port: 'in' }, kind: 'flow' });
}

export const TEMPLATES = [
  {
    key: 'welcome',
    title: '进服欢迎',
    file: 'welcome',
    desc: '有人进服务器时，私聊欢迎他，并全服播报一句',
    learn: '学会：事件 → 动作，以及「玩家」这个变量怎么用',
    build() {
      const c = newCanvas('进服欢迎', 'welcome');
      const ev = newNode('event.PlayerJoin', 80, 140);
      const a1 = newNode('action.broadcast', 460, 80, {
        target: 'player',
        text: '[green]欢迎 {player.name} 来到本服务器！',
        msgType: 'MsgType.Message',
        quite: false,
      });
      const a2 = newNode('action.broadcast', 460, 260, {
        target: 'all',
        text: '[cyan][+] {player.name} 加入了服务器',
        msgType: 'MsgType.InfoMessage',
        quite: false,
      });
      c.nodes = [ev, a1, a2];
      chain(c.edges, ev.id, 'out', a1.id);
      chain(c.edges, ev.id, 'out', a2.id);
      return { canvas: c, tip: '把「欢迎 {player.name} 来到本服务器！」改成你想说的话就能用了' };
    },
  },

  {
    key: 'alert',
    title: '定时公告',
    file: 'alert',
    desc: '每隔一段时间，自动全服播报一句话',
    learn: '学会：定时控件（每隔 X 秒）',
    build() {
      const c = newCanvas('定时公告', 'alert');
      const tm = newNode('timer.every', 80, 140, { ms: 60000, firstDelay: true });
      const a1 = newNode('action.broadcast', 460, 140, {
        target: 'all',
        text: '[yellow]欢迎来到本服务器，输入 [white]/help[yellow] 查看所有指令',
        msgType: 'MsgType.InfoMessage',
        quite: false,
      });
      c.nodes = [tm, a1];
      chain(c.edges, tm.id, 'out', a1.id);
      return { canvas: c, tip: '默认每分钟播报一次；想改频率就选中「每隔 X 秒」改毫秒数（60000 = 1 分钟）' };
    },
  },

  {
    key: 'command',
    title: '自定义指令',
    file: 'helloCmd',
    desc: '做一个玩家可以输入的服务器指令',
    learn: '学会：注册指令、权限、以及指令里怎么拿到玩家',
    build() {
      const c = newCanvas('自定义指令', 'helloCmd');
      const cmd = newNode('action.registerCommand', 80, 160, {
        name: 'hello',
        desc: '打个招呼',
        aliases: '你好',
        playerOnly: true,
        permission: '',
      });
      const perm = newNode('action.permission', 80, 420, {
        node: 'myPlugin.hello', group: '@default',
      });
      const a1 = newNode('action.broadcast', 520, 160, {
        target: 'player',
        text: '[green]你好，{player.name}！',
        msgType: 'MsgType.Message',
        quite: false,
      });
      c.nodes = [cmd, perm, a1];
      chain(c.edges, cmd.id, 'out', a1.id);
      return { canvas: c, tip: '玩家在游戏里输入 /hello 就能看到这条消息。想加权限就把最下面的权限名字填进指令的「需要的权限」' };
    },
  },

  {
    key: 'keyword',
    title: '聊天关键词触发',
    file: 'checkin',
    desc: '玩家在聊天栏说「签到」时，回应并全服播报',
    learn: '学会：条件判断（如果……就……否则）',
    build() {
      const c = newCanvas('聊天关键词触发', 'checkin');
      const ev = newNode('event.PlayerChatEvent', 80, 220);
      const cond = newNode('condition.if', 460, 220, {
        joiner: 'and',
        rules: [{
          var: 'message', type: 'String', field: 'contains',
          op: '==', valueSource: 'literal', value: '签到', arg: '签到',
        }],
      });
      const then1 = newNode('action.broadcast', 880, 100, {
        target: 'all',
        text: '[green]{player.name} 完成了签到！',
        msgType: 'MsgType.Message',
        quite: false,
      });
      const else1 = newNode('action.broadcast', 880, 340, {
        target: 'player',
        text: '[yellow]输入「签到」可以签到',
        msgType: 'MsgType.Message',
        quite: false,
      });
      c.nodes = [ev, cond, then1, else1];
      chain(c.edges, ev.id, 'out', cond.id);
      chain(c.edges, cond.id, 'then', then1.id);
      chain(c.edges, cond.id, 'else', else1.id);
      return { canvas: c, tip: '把条件里的「签到」换成别的词，就能做各种关键词触发' };
    },
  },
];

export function templateByKey(k) {
  return TEMPLATES.find(x => x.key === k) || null;
}
