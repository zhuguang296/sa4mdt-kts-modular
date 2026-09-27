// 入口。顺序很重要：崩溃拦截必须先装上再构造 App —— 否则 App 构造过程中抛出
// 的错误没人接，窗口会变成一片空白。
import { installCrashGuard, primeCrashLog, reportError } from './crashguard.js';
import { log, logStartup } from './log.js';
import { App } from './ui.js';
import { VERSION } from './version.js';

installCrashGuard();

// Tauri 的全局 API 可能比脚本晚一点就绪，等一小会儿
function boot() {
  // 先把日志路径问回来（Tauri API 这时已就绪），这样**第一次**报错时框里就能
  // 直接显示路径；顺便记一条启动信息。日志起不来绝不能挡住启动，整段吞异常。
  logStartup({ version: VERSION, userAgent: navigator.userAgent })
    .then(() => primeCrashLog())
    .catch(() => { /* 日志不可用不影响使用 */ });

  try {
    const app = new App();
    window.__app = app;
    app.start();
    log.action('启动完成');
  } catch (e) {
    // 启动就失败是最糟的情况：明确告诉用户「不是你的错」，并给出出路。
    reportError('启动', e);
    const el = document.getElementById('fatal');
    if (el) {
      el.hidden = false;
      if (!el.textContent) el.textContent = '启动失败：' + (e && (e.stack || e.message) || e);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
