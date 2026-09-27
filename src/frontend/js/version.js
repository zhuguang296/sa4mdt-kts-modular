// 版本号（构建时由 tests/sync-version.mjs 从仓库根 VERSION 写入）。
// 桌面版实际用的是 Rust 的 app_version（编译期常量，和 exe 属性一致）；
// 这个常量只是浏览器里打开 ui/ 调试时的兜底显示值。
export const VERSION = '1.1.0';
