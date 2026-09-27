// 极简 Kotlin 语法高亮（正则，无依赖）
// 输出 HTML 片段；输入必须已做 HTML 转义

const KEYWORDS = new Set([
  'package', 'import', 'fun', 'val', 'var', 'class', 'object', 'interface', 'data',
  'if', 'else', 'when', 'for', 'while', 'do', 'return', 'break', 'continue',
  'true', 'false', 'null', 'is', 'in', 'as', 'this', 'super', 'try', 'catch',
  'finally', 'throw', 'suspend', 'inline', 'noinline', 'crossinline', 'reified',
  'object', 'typealias', 'enum', 'sealed', 'internal', 'private', 'public',
  'protected', 'override', 'open', 'abstract', 'companion', 'init', 'constructor',
  'lateinit', 'by', 'where', 'out', 'vararg', 'operator', 'infix', 'const',
]);

const KNOWN_TYPES = new Set([
  'String', 'Int', 'Long', 'Float', 'Double', 'Boolean', 'Unit', 'Any', 'List',
  'MutableList', 'Map', 'MutableMap', 'Player', 'Unit', 'Team', 'Tile', 'UnitType',
  'Item', 'Color', 'Vec2',
]);

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 高亮
 * @param {string} code
 */
export function highlight(code) {
  const lines = esc(code).split('\n');
  return lines.map(highlightLine).join('\n');
}

function highlightLine(line) {
  // 锚点注释整行高亮
  if (/^\s*\/\/\s*@sa:/.test(line)) {
    return `<span class="c-anchor">${line}</span>`;
  }
  let out = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const rest = line.slice(i);

    if (rest.startsWith('//')) {
      out += `<span class="c-com">${rest}</span>`;
      break;
    }
    if (line[i] === '"') {
      let j = i + 1;
      while (j < n) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === '"') { j++; break; }
        j++;
      }
      out += `<span class="c-str">${line.slice(i, j)}</span>`;
      i = j;
      continue;
    }
    if (line[i] === '@') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.]/.test(line[j])) j++;
      out += `<span class="c-ann">${line.slice(i, j)}</span>`;
      i = j;
      continue;
    }
    if (/[0-9]/.test(line[i]) && !/[A-Za-z0-9_]/.test(line[i - 1] || '')) {
      let j = i;
      while (j < n && /[0-9._eE]/.test(line[j])) j++;
      if (line[j] === 'L' || line[j] === 'f') j++;
      out += `<span class="c-num">${line.slice(i, j)}</span>`;
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(line[i])) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(line[j])) j++;
      const w = line.slice(i, j);
      if (KEYWORDS.has(w)) out += `<span class="c-kw">${w}</span>`;
      else if (KNOWN_TYPES.has(w)) out += `<span class="c-typ">${w}</span>`;
      else if (line[j] === '(') out += `<span class="c-fn">${w}</span>`;
      else out += w;
      i = j;
      continue;
    }
    if ('{}()[]'.includes(line[i])) {
      out += `<span class="c-br">${line[i]}</span>`;
      i++;
      continue;
    }
    out += line[i];
    i++;
  }
  return out;
}

/** 带行号的 HTML */
export function highlightWithLines(code) {
  const lines = highlight(code).split('\n');
  const width = String(lines.length).length;
  return lines.map((l, idx) => {
    const num = String(idx + 1).padStart(width, ' ');
    return `<div class="code-line"><span class="code-num">${num}</span><span class="code-txt">${l || '\u200b'}</span></div>`;
  }).join('');
}
