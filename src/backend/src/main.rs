// KTS 插件工坊 —— Tauri v2 Rust 后端
//
// 本文件实现前端可调用的 8 个 IPC 命令，并用 windows-sys 直接调用 Win32/COM
// 实现原生文件对话框（本机 cargo 缓存中没有 tauri-plugin-dialog，因此不能依赖插件）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::c_void;
use std::path::{Component, PathBuf};

use windows_sys::core::{GUID, HRESULT, PCWSTR, PWSTR};
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_APARTMENTTHREADED, COINIT_MULTITHREADED,
};
use windows_sys::Win32::UI::Shell::{
    FileOpenDialog, FileSaveDialog, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST,
    FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};
use windows_sys::Win32::UI::WindowsAndMessaging::IsWindow;

// ===========================================================================
// 原生文件对话框（COM IFileOpenDialog / IFileSaveDialog）
// ===========================================================================
//
// windows-sys 0.59 只为这些接口生成了 CLSID / IID 常量，并没有生成接口结构体
// （那是 windows crate 才有的）。因此这里手写最小 vtable。字段顺序与 slot 下标
// 逐一对照 windows-0.61.3 的权威绑定，并且已经用真实 COM 运行期验证过：
// GetDisplayName / SetOptions / GetOptions / SetTitle / SetFileName /
// SetFolder / Show / GetResult 均按预期工作。
//
// 注意：传给 COM 的必须是 CoCreateInstance / GetResult 返回的真实对象指针，
// 不能是本地包装结构体的地址 —— 被调方会自己从 this 推导对象并读取 vtable 之后
// 的字段，传错会直接 0xC0000005 崩溃。

const S_OK: HRESULT = 0;
const RPC_E_CHANGED_MODE: HRESULT = -2147417850; // 0x80010106

const IID_IFILE_OPEN_DIALOG: GUID = GUID::from_u128(0xd57c7288_d4ad_4768_be02_9d969532d960);
const IID_IFILE_SAVE_DIALOG: GUID = GUID::from_u128(0x84bccd23_5fde_4cdb_aea4_af64b83d78ab);

#[repr(C)]
struct IFileDialogVtbl {
    query_interface: usize, // 0
    add_ref: usize,         // 1
    release: unsafe extern "system" fn(*mut c_void) -> u32, // 2
    show: unsafe extern "system" fn(*mut c_void, HWND) -> HRESULT, // 3 (IModalWindow)
    set_file_types: usize,      // 4
    set_file_type_index: usize, // 5
    get_file_type_index: usize, // 6
    advise: usize,              // 7
    unadvise: usize,            // 8
    set_options: unsafe extern "system" fn(*mut c_void, u32) -> HRESULT, // 9
    get_options: usize,         // 10
    set_default_folder: usize,  // 11
    set_folder: usize,          // 12
    get_folder: usize,          // 13
    get_current_selection: usize, // 14
    set_file_name: unsafe extern "system" fn(*mut c_void, PCWSTR) -> HRESULT, // 15
    get_file_name: usize,       // 16
    set_title: unsafe extern "system" fn(*mut c_void, PCWSTR) -> HRESULT, // 17
    set_ok_button_label: usize, // 18
    set_file_name_label: usize, // 19
    get_result: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT, // 20
    add_place: usize,           // 21
    set_default_extension: usize, // 22
    close: usize,               // 23
    set_client_guid: usize,     // 24
    clear_client_data: usize,   // 25
    set_filter: usize,          // 26
}

struct IFileDialog {
    raw: *mut c_void,
}

impl IFileDialog {
    #[inline]
    unsafe fn vtbl(&self) -> &IFileDialogVtbl {
        &**(self.raw as *const *const IFileDialogVtbl)
    }

    unsafe fn set_options(&self, fos: u32) {
        ((*self.vtbl()).set_options)(self.raw, fos);
    }

    unsafe fn set_title(&self, title: PCWSTR) {
        ((*self.vtbl()).set_title)(self.raw, title);
    }

    unsafe fn set_file_name(&self, name: PCWSTR) {
        ((*self.vtbl()).set_file_name)(self.raw, name);
    }

    /// 返回 Some(raw IShellItem*) 表示用户确认；None 表示取消。
    unsafe fn get_result(&self) -> Option<*mut c_void> {
        let mut item: *mut c_void = std::ptr::null_mut();
        if ((*self.vtbl()).get_result)(self.raw, &mut item) >= 0 && !item.is_null() {
            Some(item)
        } else {
            None
        }
    }

    unsafe fn show(&self, owner: HWND) -> HRESULT {
        ((*self.vtbl()).show)(self.raw, owner)
    }

    unsafe fn release(&self) {
        ((*self.vtbl()).release)(self.raw);
    }
}

#[repr(C)]
struct IShellItemVtbl {
    query_interface: usize, // 0
    add_ref: usize,         // 1
    release: unsafe extern "system" fn(*mut c_void) -> u32, // 2
    bind_to_handler: usize, // 3
    get_parent: usize,      // 4
    get_display_name: unsafe extern "system" fn(*mut c_void, i32, *mut PWSTR) -> HRESULT, // 5
    get_attributes: usize,  // 6
    compare: usize,         // 7
}

struct IShellItem {
    raw: *mut c_void,
}

impl IShellItem {
    #[inline]
    unsafe fn vtbl(&self) -> &IShellItemVtbl {
        &**(self.raw as *const *const IShellItemVtbl)
    }

    /// 取文件系统路径；拿到的 PWSTR 由 CoTaskMemFree 释放。
    unsafe fn get_display_name(&self, sigdn: i32) -> Option<String> {
        let mut raw: PWSTR = std::ptr::null_mut();
        let hr = ((*self.vtbl()).get_display_name)(self.raw, sigdn, &mut raw);
        if hr < 0 || raw.is_null() {
            return None;
        }
        let mut len = 0usize;
        while *raw.add(len) != 0 {
            len += 1;
        }
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(raw, len));
        CoTaskMemFree(raw as *const c_void);
        Some(s)
    }

    unsafe fn release(&self) {
        ((*self.vtbl()).release)(self.raw);
    }
}

/// COM 套间守卫。返回时若由我们完成初始化，Drop 时配对 CoUninitialize。
struct ComGuard {
    owns_init: bool,
}

impl ComGuard {
    fn new() -> Self {
        unsafe {
            let hr = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
            if hr == S_OK {
                ComGuard { owns_init: true }
            } else {
                if hr == RPC_E_CHANGED_MODE {
                    // 该线程已在 MTA 中：可用，但不能再改套间、也不能 CoUninitialize。
                    CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED as u32);
                }
                // S_FALSE = 本线程已初始化过，同样不需要我们反初始化。
                ComGuard { owns_init: false }
            }
        }
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.owns_init {
            unsafe { CoUninitialize() };
        }
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn create_dialog(clsid: &GUID, iid: &GUID) -> Option<IFileDialog> {
    unsafe {
        let mut ptr: *mut c_void = std::ptr::null_mut();
        let hr = CoCreateInstance(clsid, std::ptr::null_mut(), CLSCTX_ALL, iid, &mut ptr);
        if hr < 0 || ptr.is_null() {
            None
        } else {
            Some(IFileDialog { raw: ptr })
        }
    }
}

fn dialog_result_path(dlg: &IFileDialog) -> Option<String> {
    unsafe {
        let item = dlg.get_result()?;
        let shell = IShellItem { raw: item };
        let path = shell.get_display_name(SIGDN_FILESYSPATH);
        shell.release();
        path
    }
}

/// 在**当前线程**上跑对话框逻辑。
///
/// 名字保留 `run_dialog` 是因为它包着 ComGuard 的生命周期语义，
/// 但注意：它不再自己 spawn 线程了。调用方（三个 async 命令）已经用
/// `spawn_blocking` 把它放到阻塞线程池上执行，那里没有消息循环要照顾。
///
/// 之前这里写的是 `std::thread::spawn(f).join()` —— 在同步命令里就意味着
/// 主线程死等，正是卡死的来源。多一层 spawn 只是白搭一个线程。
fn run_dialog(f: impl FnOnce() -> Option<String>) -> Option<String> {
    f()
}

/// 决定对话框归属哪个窗口。
///
/// 这是「点保存/打开/导出就卡住」的根因之一，实测确认过：
/// 原来用 `GetForegroundWindow()` 取 owner，而它返回的是**全系统**的前台窗口，
/// 不保证是本应用。测试时抓到的 owner 是另一个进程的窗口（DeepSeek Harness
/// 主窗口）—— 后果是文件对话框挂到别的程序底下，用户根本看不到它，
/// 只看到本应用不动了，于是报告「一点就卡住」。
///
/// 现在优先用 Tauri 给的本应用主窗口句柄；拿不到时用 0（空 owner），
/// IFileDialog 会把它弹成一个独立的顶层窗口 —— 至少用户看得见。
fn resolve_owner(hwnd_from_frontend: Option<i64>) -> i64 {
    match hwnd_from_frontend {
        Some(v) if v != 0 && unsafe { IsWindow(v as HWND) } != 0 => v,
        _ => 0,
    }
}

fn dialog_pick_folder(title: String, owner: HWND) -> Option<String> {
    run_dialog(move || {
        let _com = ComGuard::new();
        let dlg = create_dialog(&FileOpenDialog, &IID_IFILE_OPEN_DIALOG)?;
        unsafe {
            let t = to_wide(&title);
            dlg.set_options(FOS_PICKFOLDERS | FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM);
            dlg.set_title(t.as_ptr());
            if dlg.show(owner) < 0 {
                dlg.release();
                return None;
            }
            let r = dialog_result_path(&dlg);
            dlg.release();
            r
        }
    })
}

fn dialog_pick_open_file(title: String, owner: HWND) -> Option<String> {
    run_dialog(move || {
        let _com = ComGuard::new();
        let dlg = create_dialog(&FileOpenDialog, &IID_IFILE_OPEN_DIALOG)?;
        unsafe {
            let t = to_wide(&title);
            dlg.set_options(FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM);
            dlg.set_title(t.as_ptr());
            if dlg.show(owner) < 0 {
                dlg.release();
                return None;
            }
            let r = dialog_result_path(&dlg);
            dlg.release();
            r
        }
    })
}

fn dialog_pick_save_file(title: String, default_name: String, owner: HWND) -> Option<String> {
    run_dialog(move || {
        let _com = ComGuard::new();
        let dlg = create_dialog(&FileSaveDialog, &IID_IFILE_SAVE_DIALOG)?;
        unsafe {
            let t = to_wide(&title);
            dlg.set_options(FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM);
            dlg.set_title(t.as_ptr());
            if !default_name.is_empty() {
                let n = to_wide(&default_name);
                dlg.set_file_name(n.as_ptr());
            }
            if dlg.show(owner) < 0 {
                dlg.release();
                return None;
            }
            let r = dialog_result_path(&dlg);
            dlg.release();
            r
        }
    })
}

// ===========================================================================
// IPC 命令
// ===========================================================================

#[derive(serde::Deserialize)]
struct PluginFile {
    path: String,
    content: String,
}

/// 校验并规范化 `files[].path` 为相对路径，拒绝一切越权写法。
fn sanitize_relative(rel: &str) -> Result<PathBuf, String> {
    let bad = |why: &str| Err(format!("非法路径: {rel} ({why})"));

    if rel.trim().is_empty() {
        return bad("路径为空");
    }
    if rel.contains('\0') {
        return bad("含 NUL 字符");
    }

    // 统一分隔符后逐段检查，'/' 与 '\' 都当分隔符。
    let unified = rel.replace('\\', "/");

    // 绝对路径的几种写法：以分隔符开头（含 UNC \\server\share）、盘符、扩展长度前缀。
    if unified.starts_with('/') {
        return bad("不允许绝对路径");
    }
    let bytes: Vec<char> = unified.chars().collect();
    if bytes.len() >= 2 && bytes[1] == ':' {
        return bad("不允许盘符");
    }

    let mut out = PathBuf::new();
    for seg in unified.split('/') {
        // 跳过空段与 "."，它们不产生实际目录层级。
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return bad("不允许 .. 逃逸");
        }
        // 冒号可构成 NTFS 数据流（如 a.txt:evil）或再次引入盘符。
        if seg.contains(':') {
            return bad("段内不允许冒号");
        }
        // Windows 文件名非法字符，顺带挡住设备名以外的怪异输入。
        if seg.chars().any(|c| matches!(c, '<' | '>' | '"' | '|' | '?' | '*') || (c as u32) < 0x20)
        {
            return bad("含非法字符");
        }
        if seg.ends_with('.') || seg.ends_with(' ') {
            return bad("段不能以点或空格结尾");
        }
        out.push(seg);
    }

    if out.as_os_str().is_empty() {
        return bad("路径为空");
    }

    // 双保险：确认拼出来的东西确实全是普通相对段。
    for c in out.components() {
        if !matches!(c, Component::Normal(_)) {
            return bad("非普通路径段");
        }
    }

    Ok(out)
}

// ---------------------------------------------------------------------------
// 三个「会弹原生对话框」的命令必须是 async。
// ---------------------------------------------------------------------------
//
// 这是「点保存/打开/导出就卡住」的第二个根因，实测确认过。
//
// Tauri 对**同步**命令（`fn foo()`）的处理是 `ExecutionContext::Blocking`
// → 生成的代码是 `"sync"`（见 tauri-macros 的 command/wrapper.rs:266）
// → 直接在**主线程**上调用。而主线程同时负责窗口消息循环。
//
// 于是原来的写法：主线程进入 pick_folder → 里面 spawn 一个线程去显示
// 模态对话框 → 再 `.join()` **死等**它结束。主线程就此不再派发任何消息，
// Windows 判定窗口失去响应（标题栏出现「(无响应)」），用户看到的就是
// 整个应用卡死。我用 SendMessageTimeout 测过：对话框打开期间主窗口 HUNG，
// 而同一个时刻网页（渲染进程）仍能正常应答 1+1，证明卡的是主线程而非页面。
//
// 改成 `async fn` 后，宏生成 `"async"` 上下文，命令体在异步运行时里被 poll，
// 不占住主线程的消息循环；阻塞部分交给 spawn_blocking 的线程池。

#[tauri::command]
async fn pick_folder(title: String, window: tauri::Window) -> Option<String> {
    let hwnd = resolve_owner(window_hwnd(&window));
    tauri::async_runtime::spawn_blocking(move || {
        dialog_pick_folder(title, hwnd_from_i64(hwnd))
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn pick_save_file(title: String, default_name: String, window: tauri::Window) -> Option<String> {
    let hwnd = resolve_owner(window_hwnd(&window));
    tauri::async_runtime::spawn_blocking(move || {
        dialog_pick_save_file(title, default_name, hwnd_from_i64(hwnd))
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn pick_open_file(title: String, window: tauri::Window) -> Option<String> {
    let hwnd = resolve_owner(window_hwnd(&window));
    tauri::async_runtime::spawn_blocking(move || {
        dialog_pick_open_file(title, hwnd_from_i64(hwnd))
    })
    .await
    .ok()
    .flatten()
}

/// 把 i64 形式的窗口句柄还原成 Windows 句柄。
///
/// 为什么要绕这一圈：`HWND` 在 windows-sys 里是 `*mut c_void`，裸指针不实现
/// `Send`，而 `spawn_blocking` 要求闭包是 `Send`。句柄本身只是个不透明的整数值，
/// 跨线程传递是安全的，所以传 i64、在目标线程里还原回指针。
#[cfg(windows)]
fn hwnd_from_i64(v: i64) -> HWND {
    v as HWND
}

/// 取本应用主窗口的原生句柄（i64 形式，便于跨线程传递）。
///
/// Tauri 的 `Window::hwnd()` 返回的是 `windows` crate 的 HWND（一个带类型的
/// 包装），我们用的是 windows-sys 的 `HWND`（裸指针别名）。两者 ABI 相同但
/// 类型不同，所以取 `.0` 再转成 `i64` —— HWND 在 64 位下就是指针宽度。
#[cfg(windows)]
fn window_hwnd(window: &tauri::Window) -> Option<i64> {
    window.hwnd().ok().map(|h| h.0 as i64)
}

#[cfg(not(windows))]
fn window_hwnd(_window: &tauri::Window) -> Option<i64> {
    None
}

#[tauri::command]
fn export_plugin(out_dir: String, files: Vec<PluginFile>) -> Result<Vec<String>, String> {
    if out_dir.trim().is_empty() {
        return Err("导出目录为空".to_string());
    }
    let root = PathBuf::from(&out_dir);

    // 先整体校验，任一文件非法就整体拒绝，避免写出半套文件。
    let mut planned: Vec<(PathBuf, &str)> = Vec::with_capacity(files.len());
    for f in &files {
        let rel = sanitize_relative(&f.path)?;
        planned.push((rel, f.content.as_str()));
    }

    std::fs::create_dir_all(&root).map_err(|e| format!("创建目录失败 {out_dir}: {e}"))?;
    let root_abs = std::path::absolute(&root).unwrap_or_else(|_| root.clone());

    let mut written = Vec::with_capacity(planned.len());
    for (rel, content) in planned {
        let full = root_abs.join(&rel);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
        }
        std::fs::write(&full, content)
            .map_err(|e| format!("写入失败 {}: {e}", full.display()))?;
        written.push(full.to_string_lossy().into_owned());
    }

    Ok(written)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败 {path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
        }
    }
    std::fs::write(&p, content).map_err(|e| format!("写入失败 {path}: {e}"))
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    // explorer.exe 即使成功也可能返回非 0 退出码，因此只看能否拉起进程。
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开资源管理器失败 {path}: {e}"))
}

#[tauri::command]
fn app_dir() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.to_string_lossy().into_owned();
        }
    }
    std::env::current_dir()
        .map(|d| d.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 版本号来自编译期的 Cargo 包版本（单一来源 = 仓库根目录的 VERSION 文件，
/// 由 build.ps1 在编译前写进 Cargo.toml / tauri.conf.json）。
/// 这样「设置里显示的版本」「资源管理器里 exe 的属性」「Cargo 记录」永远一致。
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 许可证名称与版权人。和仓库根目录的 LICENSE 文件保持一致。
#[tauri::command]
fn app_license() -> String {
    "MIT License".to_string()
}

#[tauri::command]
fn app_author() -> String {
    "烛光".to_string()
}

// ===========================================================================
// 日志
// ===========================================================================
//
// 用户要「增加日志功能，使用 .txt」。设计要点：
//
//   · 位置：exe 旁边的 logs\ 目录。用户找得到（就在他双击的那个文件边上），
//     而且不污染导出目录 —— 日志和插件产物混在一起会很难看。
//   · 命名：按天分文件 kts-builder-YYYY-MM-DD.txt。单个文件不会无限膨胀，
//     想翻哪天就看哪天。
//   · 崩溃也写进同一个文件（不再单独出 crash.log）—— 一个文件看完所有事情，
//     不用在两处对时间。
//   · 日志写失败绝不 panic：一条日志写不进去，不能把工具本身弄崩。

/// logs 目录：exe 同目录下的 logs\。
fn log_dir() -> PathBuf {
    let base = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_default();
    base.join("logs")
}

/// 今天的日志文件完整路径。
fn todays_log_file() -> PathBuf {
    log_dir().join(format!("kts-builder-{}.txt", date_stamp()))
}

/// 日期串 YYYY-MM-DD（本地时间）。
fn date_stamp() -> String {
    let (y, m, d) = local_ymd();
    format!("{y:04}-{m:02}-{d:02}")
}

/// 时间戳串 YYYY-MM-DD HH:MM:SS（本地时间）。
fn time_stamp() -> String {
    let (y, m, d, hh, mm, ss) = local_ymdhms();
    format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}")
}

/// 问系统要本地时间。
///
/// 不走 chrono 依赖：只需要「可读的时间戳」，直接调 Win32 拿本地时间即可，
/// 还能顺带把时区和夏令时交给系统处理。
#[cfg(windows)]
fn local_ymdhms() -> (u16, u16, u16, u16, u16, u16) {
    #[repr(C)]
    struct SystemTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }
    unsafe extern "system" {
        fn GetLocalTime(t: *mut SystemTime);
    }
    unsafe {
        let mut t = SystemTime {
            year: 0, month: 0, day_of_week: 0, day: 0,
            hour: 0, minute: 0, second: 0, milliseconds: 0,
        };
        GetLocalTime(&mut t);
        (t.year, t.month, t.day, t.hour, t.minute, t.second)
    }
}

#[cfg(windows)]
fn local_ymd() -> (u16, u16, u16) {
    let (y, m, d, _, _, _) = local_ymdhms();
    (y, m, d)
}

#[cfg(not(windows))]
fn local_ymdhms() -> (u16, u16, u16, u16, u16, u16) {
    (0, 0, 0, 0, 0, 0)
}

#[cfg(not(windows))]
fn local_ymd() -> (u16, u16, u16) {
    (0, 0, 0)
}

/// 往今天的日志里追加一段文本。返回写成功的路径。
///
/// 每次都重新算路径（而不是启动时算一次就存起来）：应用可能开着跨过午夜，
/// 那样日志要跟着换到新的一天，而不是继续往昨天那个文件里写。
fn append_log_line(text: &str) -> Result<String, String> {
    let dir = log_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建日志目录失败 {}: {e}", dir.display()))?;
    let path = todays_log_file();
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("打不开日志文件 {}: {e}", path.display()))?;
    f.write_all(text.as_bytes())
        .map_err(|e| format!("写日志失败 {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// 日志文件的完整路径（今天的）。前端用来显示/打开。
#[tauri::command]
fn log_path() -> String {
    todays_log_file().to_string_lossy().into_owned()
}

/// logs 目录路径（前端「打开日志文件夹」用）。
#[tauri::command]
fn log_dir_path() -> String {
    log_dir().to_string_lossy().into_owned()
}

/// 追加一条日志。
///
/// `level` 是 INFO / WARN / ERROR 这类短标签。每行都带本地时间戳，
/// 这样把日志发过来时能直接对上「什么时候出的问题」。
#[tauri::command]
fn append_log(level: String, message: String) -> Result<String, String> {
    let lv = if level.trim().is_empty() { "INFO".to_string() } else { level };
    let mut text = String::with_capacity(message.len() + 32);
    for (i, line) in message.lines().enumerate() {
        if i == 0 {
            text.push_str(&format!("{} [{}] {}\n", time_stamp(), lv, line));
        } else {
            // 多行内容（堆栈、生成的代码）后续行缩进，和第一行区分开
            text.push_str(&format!("                       | {}\n", line));
        }
    }
    if message.is_empty() {
        text.push_str(&format!("{} [{}]\n", time_stamp(), lv));
    }
    append_log_line(&text)
}

/// 读回今天的日志内容（设置里的「日志」页要显示）。
///
/// `max_bytes` 限制返回量：日志可能有几兆，全塞进 IPC 会卡住界面。
/// 默认从尾部取，因为用户关心的是刚刚发生了什么。
#[tauri::command]
fn read_log(max_bytes: Option<usize>) -> Result<String, String> {
    let path = todays_log_file();
    let data = match std::fs::read(&path) {
        Ok(d) => d,
        // 今天还没写过日志不是错误，返回空串即可
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(format!("读取日志失败 {}: {e}", path.display())),
    };
    let limit = max_bytes.unwrap_or(256 * 1024);
    if data.len() <= limit {
        return Ok(String::from_utf8_lossy(&data).into_owned());
    }
    // 超过上限就只取末尾，并明确标注前面被截断了
    let start = data.len() - limit;
    // 从换行处切开，避免第一行是半截内容
    let slice = &data[start..];
    let cut = slice.iter().position(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    let body = String::from_utf8_lossy(&slice[cut..]).into_owned();
    Ok(format!(
        "（日志太长，只显示最后 {} KB；完整内容见 {}）\n\n{}",
        limit / 1024,
        path.display(),
        body
    ))
}

/// 清空今天的日志。
///
/// 为什么不是「删除整个 logs 目录」：用户清日志通常是想「从现在开始看」，
/// 顺手删掉历史反而会让之前排查的线索一起消失。只清今天这个文件。
#[tauri::command]
fn clear_log() -> Result<(), String> {
    let path = todays_log_file();
    if path.exists() {
        std::fs::write(&path, b"").map_err(|e| format!("清空日志失败 {}: {e}", path.display()))?;
    }
    Ok(())
}

/// 退出前补一条「应用关闭」记录（前端在关闭时调）。
#[tauri::command]
fn log_shutdown() -> Result<(), String> {
    append_log_line(&format!("{} [INFO] ==== 应用关闭 v{} ====\n", time_stamp(), env!("CARGO_PKG_VERSION")))
        .map(|_| ())
}

// ===========================================================================
// 全屏
// ===========================================================================
//
// 用户要「真全屏」（无边框、盖住任务栏），F11 和工具栏按钮都能切。
//
// 为什么从 Rust 走而不是前端调窗口 API：Tauri 的窗口插件命令要走 ACL 权限
// 系统，而本工程没有 capabilities 清单（gen/schemas/capabilities.json 是空 {}），
// 插件命令会被直接拒绝。自定义命令不受 ACL 限制 —— 关窗那套就是这么做的。

#[tauri::command]
fn set_fullscreen(window: tauri::Window, on: bool) -> Result<(), String> {
    window
        .set_fullscreen(on)
        .map_err(|e| format!("切换全屏失败: {e}"))
}

#[tauri::command]
fn is_fullscreen(window: tauri::Window) -> bool {
    window.is_fullscreen().unwrap_or(false)
}

// ===========================================================================
// 关窗前的二次确认
// ===========================================================================
//
// 用户点右上角 X 时，先让前端问一句「要不要先保存」。
//
// 为什么放在 Rust 而不是用 window.__TAURI__.event.listen('tauri://close-requested')：
//   事件插件（plugin:event|listen）和窗口插件（plugin:window|destroy）都要走
//   Tauri 的 ACL 权限系统，而本工程没有 capabilities 清单（gen/schemas/capabilities.json
//   是空的 {}），插件命令会被直接拒绝。自定义命令不受 ACL 限制 —— 现有那 8 个
//   IPC 命令就是这么工作的 —— 所以从 Rust 这一侧接管最省事也最可靠。
//
// 流程：
//   CloseRequested → prevent_close() → eval 前端 JS 去问用户
//   用户选「保存并继续」或「不保存」→ 前端调 confirm_close → 真的关
//   用户选「取消」→ 前端什么都不做，窗口留着
//
// 兜底（重要）：prevent_close() 之后系统不会再重试关闭，万一前端脚本坏了
// （window.__app 不存在、或 render 时抛异常），eval 过去就是石沉大海，
// 窗口会变得**关不掉**，用户只能去任务管理器强杀。所以这里加一个看门狗：
//   拦住关闭的同时起一个 2 秒的计时，前端必须在 2 秒内用 close_guard_ack()
//   报到（它一进 onCloseRequested 就报到，正常只要几毫秒）。
//   到点还没报到 → 认定前端已死 → 直接放行关闭。
// 用户正常在询问框上思考多久都不会被这个计时影响：报到的动作是在**弹框之前**
// 完成的，计时早就在那时取消了。

use std::sync::atomic::{AtomicBool, Ordering};

static CLOSE_CONFIRMED: AtomicBool = AtomicBool::new(false);
// 前端已经接手这次关闭（准备弹询问框了）
static CLOSE_ACKED: AtomicBool = AtomicBool::new(false);

/// 前端一进关窗处理流程就调这个报到，用来取消看门狗。
#[tauri::command]
fn close_guard_ack() {
    CLOSE_ACKED.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn confirm_close(window: tauri::Window) {
    CLOSE_CONFIRMED.store(true, Ordering::SeqCst);
    let _ = window.close();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            pick_save_file,
            pick_open_file,
            export_plugin,
            read_text_file,
            write_text_file,
            reveal_in_explorer,
            app_dir,
            app_version,
            app_license,
            app_author,
            log_path,
            log_dir_path,
            append_log,
            read_log,
            clear_log,
            log_shutdown,
            set_fullscreen,
            is_fullscreen,
            close_guard_ack,
            confirm_close
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if CLOSE_CONFIRMED.load(Ordering::SeqCst) {
                    return;   // 前端已经问过了，放行
                }

                let webviews = window.webviews();
                if webviews.is_empty() {
                    return;   // 没有前端可问（理论上不会发生），别把窗口卡死
                }

                api.prevent_close();
                CLOSE_ACKED.store(false, Ordering::SeqCst);

                // 让前端弹询问框。前端问完会回调 confirm_close。
                // eval 是异步的，这里不能等它 —— prevent_close 已经把这次关闭
                // 拦住了，窗口会一直留到用户做出选择。
                for wv in &webviews {
                    let _ = wv.eval("window.__app && window.__app.onCloseRequested()");
                }

                // 看门狗：前端没在 2 秒内报到就认为它坏了，放行关闭。
                // （只是防止窗口关不掉，不是催用户 —— 报到发生在弹框之前。）
                let win = window.clone();
                std::thread::spawn(move || {
                    for _ in 0..40 {                       // 40 × 50ms = 2s
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        if CLOSE_ACKED.load(Ordering::SeqCst)
                            || CLOSE_CONFIRMED.load(Ordering::SeqCst) {
                            return;                        // 前端活着，交给它处理
                        }
                    }
                    eprintln!("[close-guard] 前端未响应关窗询问，强制关闭");
                    let _ = win.destroy();
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::sanitize_relative;
    use std::path::PathBuf;

    #[test]
    fn accepts_plain_and_nested_relative_paths() {
        assert_eq!(sanitize_relative("module.kts").unwrap(), PathBuf::from("module.kts"));
        assert_eq!(
            sanitize_relative("demo/module.kts").unwrap(),
            PathBuf::from("demo").join("module.kts")
        );
        assert_eq!(
            sanitize_relative("a/b/c/d.txt").unwrap(),
            PathBuf::from("a").join("b").join("c").join("d.txt")
        );
    }

    #[test]
    fn treats_backslash_as_separator() {
        assert_eq!(
            sanitize_relative("demo\\sub\\f.kts").unwrap(),
            PathBuf::from("demo").join("sub").join("f.kts")
        );
    }

    #[test]
    fn collapses_redundant_segments() {
        assert_eq!(sanitize_relative("./demo//f.kts").unwrap(), PathBuf::from("demo").join("f.kts"));
    }

    #[test]
    fn rejects_dotdot_escape() {
        for p in [
            "../evil.txt",
            "demo/../../evil.txt",
            "a/b/../../../evil.txt",
            "..",
            "demo/..",
            "..\\evil.txt",
        ] {
            assert!(sanitize_relative(p).is_err(), "should reject {p:?}");
        }
    }

    #[test]
    fn rejects_absolute_paths() {
        for p in [
            "/etc/passwd",
            "\\Windows\\system32\\evil.dll",
            "C:/Windows/evil.dll",
            "C:\\Windows\\evil.dll",
            "c:evil.txt",
            "//server/share/evil.txt",
            "\\\\server\\share\\evil.txt",
        ] {
            assert!(sanitize_relative(p).is_err(), "should reject {p:?}");
        }
    }

    #[test]
    fn rejects_alternative_data_streams_and_illegal_chars() {
        for p in ["a.txt:evil", "demo/f.kts:ads", "bad<name>.txt", "q?.txt", "", "   ", "trail./f.txt"] {
            assert!(sanitize_relative(p).is_err(), "should reject {p:?}");
        }
    }

    #[test]
    fn rejects_embedded_nul() {
        assert!(sanitize_relative("demo/\0evil.txt").is_err());
    }

    /// 端到端：确认逃逸路径不会在 out_dir 之外落地。
    #[test]
    fn export_plugin_refuses_escape_without_writing() {
        let base = std::env::temp_dir().join("kts_builder_sanitize_test");
        let _ = std::fs::remove_dir_all(&base);
        let out = base.join("out");
        let canary = base.join("canary.txt");
        std::fs::create_dir_all(&base).unwrap();

        let files = vec![
            super::PluginFile { path: "ok/a.kts".into(), content: "A".into() },
            super::PluginFile { path: "../canary.txt".into(), content: "PWNED".into() },
        ];
        let res = super::export_plugin(out.to_string_lossy().into_owned(), files);
        assert!(res.is_err(), "escaping export must fail");

        // 整体拒绝：连合法的第一个文件也不应写出。
        assert!(!out.join("ok").join("a.kts").exists(), "no partial write allowed");
        assert!(!canary.exists(), "must not write outside out_dir");

        let _ = std::fs::remove_dir_all(&base);
    }

    /// 正常导出：递归建目录、覆盖已存在文件、返回绝对路径。
    #[test]
    fn export_plugin_writes_nested_and_overwrites() {
        let base = std::env::temp_dir().join("kts_builder_export_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();

        let files = vec![
            super::PluginFile { path: "demo/module.kts".into(), content: "v1".into() },
            super::PluginFile { path: "demo/deep/inner.kts".into(), content: "x".into() },
        ];
        let out = base.to_string_lossy().into_owned();
        let written = super::export_plugin(out, files).unwrap();
        assert_eq!(written.len(), 2);
        for w in &written {
            assert!(std::path::Path::new(w).is_absolute(), "must return absolute: {w}");
        }
        assert_eq!(std::fs::read_to_string(base.join("demo/module.kts")).unwrap(), "v1");
        assert_eq!(std::fs::read_to_string(base.join("demo/deep/inner.kts")).unwrap(), "x");

        // 覆盖
        let again = vec![super::PluginFile { path: "demo/module.kts".into(), content: "v2".into() }];
        super::export_plugin(base.to_string_lossy().into_owned(), again).unwrap();
        assert_eq!(std::fs::read_to_string(base.join("demo/module.kts")).unwrap(), "v2");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn write_and_read_text_file_roundtrip_creates_parents() {
        let base = std::env::temp_dir().join("kts_builder_rw_test");
        let _ = std::fs::remove_dir_all(&base);
        let target = base.join("nested").join("dir").join("note.txt");
        let p = target.to_string_lossy().into_owned();

        super::write_text_file(p.clone(), "你好 KTS 🌟".into()).unwrap();
        assert_eq!(super::read_text_file(p).unwrap(), "你好 KTS 🌟");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn read_text_file_reports_missing_file() {
        let missing = std::env::temp_dir().join("kts_definitely_missing_9f3a.txt");
        let _ = std::fs::remove_file(&missing);
        assert!(super::read_text_file(missing.to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn app_dir_is_absolute_and_exists() {
        let d = super::app_dir();
        assert!(!d.is_empty());
        let p = std::path::Path::new(&d);
        assert!(p.is_absolute(), "app_dir must be absolute: {d}");
        assert!(p.exists(), "app_dir must exist: {d}");
    }
}
