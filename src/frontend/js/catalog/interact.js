// 「交互」类控件：和玩家点来点去有关的东西（菜单 / 链接）。
//
// 每个 emit 的写法都在工作区脚本与真实 jar 里核实过：
//   * mindustry.gen.Call 签名（tests/_api/mindustry.gen.Call.txt）
//       menu(NetConnection, int, String, String, String[][])
//       followUpMenu(NetConnection, int, String, String, String[][])
//       hideFollowUpMenu(NetConnection, int)
//       openURI(NetConnection, String)
//   * coreMindustry/menu.kts:6          listen<EventType.MenuOptionChooseEvent>
//   * coreMindustry/menu.lib.kt:15-17   MenuChooseEvent(player, menuId, value)
//
// 菜单编号是脚本自己定的，客户端原样回传，所以「弹一个菜单」和
// 「玩家选了菜单项」填同一个号就能对上，不需要共享变量。

/** 取整数参数，非数字则用兜底值 */
export function intOf(v, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : dflt;
}

export const INTERACTS = [
  // ---------------- 弹一个菜单 ----------------
  {
    key: 'interact.openMenu',
    category: 'interact',
    level: 'basic',
    label: '弹一个菜单',
    terms: 'menu 菜单 选项 选择 弹窗 按钮 followUpMenu 对话框 商店',
    codeHint: 'Call.menu(player.con, 编号, 标题, 说明, arrayOf(arrayOf(...)))',
    note: '在玩家屏幕上弹出可点的菜单。要知道他点了哪个，接「玩家选了菜单项」',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'menuId', type: 'number', label: '菜单编号', required: true, default: 1, min: 0,
        hint: '自己定一个数字；「玩家选了菜单项」要填同一个数字' },
      { key: 'title', type: 'text', label: '标题', required: true, default: '请选择' },
      { key: 'msg', type: 'text', label: '说明文字', default: '' },
      { key: 'options', type: 'template', label: '选项（一行一个）', required: true, default: '选项一\n选项二',
        placeholder: '一行一个选项，例如：\n传送到前线\n领取物资' },
      { key: 'followup', type: 'boolean', label: '跟随式（一直占着屏幕）', default: false,
        hint: '跟随式的菜单才能用「关掉菜单」主动收起' },
    ],
    emit(n, ctx) {
      const p = ctx.varOfType('Player');
      if (!p) return { error: '「弹一个菜单」需要一个玩家。挂到「玩家进服」「玩家发言」这类事件下面。' };
      const opts = String(n.props.options == null ? '' : n.props.options)
        .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!opts.length) return { error: '「弹一个菜单」还没有填选项（一行一个）' };
      // 竖排：外层数组是「行」，一行一个按钮 = 每个选项单独成一组。
      // 核过 menu.lib.kt（newRow() 开新行、option() 加进当前行）：
      // arrayOf(arrayOf("A"), arrayOf("B")) 才是两行竖排；
      // arrayOf(arrayOf("A", "B")) 会横排挤在一行里。
      const rows = opts.map(o => `arrayOf(${ctx.lit(o)})`).join(', ');
      const call = n.props.followup ? 'Call.followUpMenu' : 'Call.menu';
      const id = intOf(n.props.menuId, 1);
      return {
        lines: [
          `${call}(${p}.con, ${id}, ${ctx.lit(n.props.title || '')}, ` +
          `${ctx.lit(n.props.msg || '')}, arrayOf(${rows}))`,
        ],
      };
    },
  },

  // ---------------- 玩家选了菜单项（起点） ----------------
  {
    key: 'interact.onMenuChoose',
    category: 'interact',
    level: 'basic',
    label: '玩家选了菜单项',
    terms: 'MenuOptionChooseEvent 菜单 选中 点击 选择了 选项 menuId option',
    codeHint: 'listen<EventType.MenuOptionChooseEvent>',
    note: '玩家点了菜单里某一项时触发。选项编号「第几项」从 0 开始数',
    inPorts: [],
    outPorts: [{ id: 'out', type: 'flow', opensBlock: true }],
    closers: { out: '}' },
    isRoot: true,
    labelName: 'listen',
    contexts: [
      { name: 'player', type: 'Player', expr: 'it.player' },
      { name: 'option', type: 'Number', expr: 'it.option' },
    ],
    props: [
      { key: 'menuId', type: 'number', label: '菜单编号', required: true, default: 1, min: 0,
        hint: '要和「弹一个菜单」里填的编号一样' },
    ],
    emit(n, ctx) {
      // 编号不匹配就直接退出。这样同一张画布能放好几套菜单，各自只听自己的号。
      const id = intOf(n.props.menuId, 1);
      return {
        lines: [
          'listen<EventType.MenuOptionChooseEvent> {',
          `    if (it.menuId != ${id}) return@listen`,
        ],
      };
    },
  },

  // ---------------- 关掉菜单 ----------------
  {
    key: 'interact.closeMenu',
    category: 'interact',
    level: 'advanced',
    label: '关掉菜单',
    terms: 'hideFollowUpMenu 关闭 收起 菜单 取消',
    codeHint: 'Call.hideFollowUpMenu(player.con, 编号)',
    note: '主动收起一个跟随式菜单；普通弹出式菜单会自己消失，不用管',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'menuId', type: 'number', label: '菜单编号', required: true, default: 1, min: 0,
        hint: '要和「弹一个菜单」里填的编号一样' },
    ],
    emit(n, ctx) {
      const p = ctx.varOfType('Player');
      if (!p) return { error: '「关掉菜单」需要一个玩家。挂到「玩家进服」这类事件下面。' };
      return { lines: [`Call.hideFollowUpMenu(${p}.con, ${intOf(n.props.menuId, 1)})`] };
    },
  },

  // ---------------- 打开链接 ----------------
  {
    key: 'interact.openURI',
    category: 'interact',
    level: 'basic',
    label: '让玩家打开一个网址',
    terms: 'openURI 链接 网址 url 打开 网页 群 公告',
    codeHint: 'Call.openURI(player.con, "https://...")',
    note: '用游戏内的确认框问玩家要不要打开这个网址',
    inPorts: [{ id: 'in', type: 'flow' }],
    outPorts: [{ id: 'out', type: 'flow' }],
    props: [
      { key: 'url', type: 'text', label: '网址', required: true, default: 'https://',
        placeholder: 'https://example.com' },
    ],
    emit(n, ctx) {
      const p = ctx.varOfType('Player');
      if (!p) return { error: '「让玩家打开一个网址」需要一个玩家。挂到「玩家进服」这类事件下面。' };
      const url = String(n.props.url || '').trim();
      if (!url) return { error: '「让玩家打开一个网址」还没填网址' };
      return { lines: [`Call.openURI(${p}.con, ${ctx.lit(url)})`] };
    },
  },
];
