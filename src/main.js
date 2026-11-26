import './styles.css';
import './interactions.css';
import './home-theme.css';
import { initBrandMotion } from './brand-motion.js';
import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  MAX_FILE_SIZE, MAX_BASE64_LENGTH, textToBytes, bytesToText,
  bytesToBase64, parseBase64Input, hexToBytes, bytesToHex,
  formatBytes, safeFilename, decodedFilename,
} from './codec.js';

const $ = (id) => document.getElementById(id);
const state = { mode: 'text', file: null, result: null, preview: null, busy: false, revision: 0, copyTimer: null, countAnimation: null, splitRatio: .5 };
const desktop = isTauri();
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
initBrandMotion();
const privacyTitle = $('local-title');
const privacyTitleGroup = privacyTitle.closest('.identity-title');
for (const type of ['pointerenter', 'pointerleave', 'focus', 'blur']) {
  privacyTitle.addEventListener(type, () => privacyTitleGroup.classList.remove('tooltip-dismissed'));
}
privacyTitle.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') privacyTitleGroup.classList.add('tooltip-dismissed');
});
const paths = {
  arrow: '<path d="M4 9h10m-4-4 4 4-4 4"/>',
  encode: '<path d="M3 5h7M3 9h5M3 13h7m1-8 4 4-4 4m-4-4h8"/>',
  decode: '<path d="M15 5H8m7 4h-5m5 4H8M7 5 3 9l4 4m-4-4h8"/>',
  swap: '<path d="M3 5h12m-3-3 3 3-3 3M15 13H3m3-3-3 3 3 3"/>',
  file: '<path d="M5 2h5l4 4v10H4V2h1m5 0v5h4M6 10h5m-5 3h5"/>',
  upload: '<path d="M3 12v3h12v-3M9 12V2m-4 4 4-4 4 4"/>',
  check: '<circle cx="9" cy="9" r="7"/><path d="m6 9 2 2 4-4"/>',
  info: '<circle cx="9" cy="9" r="7"/><path d="M9 8v4m0-7v.1"/>',
  error: '<circle cx="9" cy="9" r="7"/><path d="M9 5v5m0 3v.1"/>',
  help: '<circle cx="9" cy="9" r="7"/><path d="M7 6.5a2 2 0 1 1 3 1.7C9 8.7 9 9 9 10m0 3v.1"/>',
  close: '<path d="m4 4 10 10M14 4 4 14"/>',
  moveLeft: '<path d="M15 9H3m5-5L3 9l5 5"/>',
  resize: '<path d="M2 9h14M5 6 2 9l3 3m8-6 3 3-3 3"/>',
};
function icon(name) { return `<svg viewBox="0 0 18 18" aria-hidden="true">${paths[name]}</svg>`; }
const toolbarIcons = { import: '📁', example: '📝', clear: '🗑️', copy: '📋', save: '💾' };
function toolbarContent(name, label) {
  return `<span class="toolbar-emoji" aria-hidden="true">${toolbarIcons[name]}</span><span>${label}</span>`;
}
for (const [id, name] of Object.entries({
  'help-button': 'help', 'close-help': 'close', 'drop-icon': 'upload', 'binary-icon': 'file',
  'encode-icon': 'encode', 'decode-icon': 'decode', 'swap-icon': 'moveLeft', 'empty-arrow': 'arrow', 'status-icon': 'info',
  'resizer-icon': 'resize', 'page-drop-icon': 'upload',
})) $(id).innerHTML = icon(name);
for (const [id, name, label] of [
  ['import-button', 'import', '导入'], ['example-button', 'example', '示例'],
  ['clear-button', 'clear', '清空'], ['copy-button', 'copy', '复制'], ['save-button', 'save', '保存'],
]) $(id).innerHTML = toolbarContent(name, label);
$('modifier-key').textContent = mac ? '⌘' : 'Ctrl';
for (const key of document.querySelectorAll('[data-modifier]')) key.textContent = mac ? '⌘' : 'Ctrl';
$('encode-button').title = `${mac ? '⌘' : 'Ctrl'} + Enter`;
$('decode-button').title = `${mac ? '⌘' : 'Ctrl'} + Shift + Enter`;

function status(message, type = '') {
  $('status').className = `status ${type}`;
  $('status-message').textContent = message;
  $('status-icon').innerHTML = icon(type === 'error' ? 'error' : type === 'success' ? 'check' : 'info');
}
function inputCount() {
  const length = $('input').value.length;
  const [value, unit] = state.file ? formatBytes(state.file.size).split(' ') : [length.toLocaleString(), '字符'];
  const changed = $('count-value').textContent !== value;
  $('count-value').textContent = value;
  $('count-unit').textContent = unit;
  $('input-count').setAttribute('aria-label', `${value} ${unit}`);
  state.countAnimation?.cancel();
  if (changed && !reducedMotion.matches) {
    state.countAnimation = $('count-value').animate(
      [{ transform: 'translateY(7px)', opacity: .25 }, { transform: 'translateY(0)', opacity: 1 }],
      { duration: 180, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
  }
}
function resultPhase(phase, label) {
  $('output-state-light').className = `result-state ${phase}`;
  $('output-state-light').title = label;
  $('output-subtitle').textContent = label;
}
function resetCopyFeedback() {
  clearTimeout(state.copyTimer);
  state.copyTimer = null;
  $('copy-button').classList.remove('is-copied');
  $('copy-button').innerHTML = toolbarContent('copy', '复制');
}
function releasePreview() {
  if (state.preview) URL.revokeObjectURL(state.preview);
  state.preview = null;
  $('image-preview').removeAttribute('src');
  $('image-preview').hidden = true;
}
function clearResult() {
  state.result = null;
  resetCopyFeedback();
  releasePreview();
  $('output').value = '';
  $('output').hidden = true;
  $('binary-result').hidden = true;
  $('output-empty').hidden = false;
  resultPhase('idle', '等待转换');
  $('output-count').textContent = '尚无结果';
  for (const id of ['copy-button', 'save-button', 'swap-button']) $(id).disabled = true;
  $('swap-button').classList.remove('swap-ready');
}
function invalidate() {
  state.revision++;
  clearResult();
  inputCount();
  status('输入或设置已更改，可以重新转换。');
}
function setMode(mode) {
  if (state.busy || mode === state.mode) return;
  state.mode = mode;
  state.file = null;
  $('input').value = '';
  clearResult();
  for (const tab of document.querySelectorAll('.mode-tab')) {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const file = mode === 'file';
  $('workspace').setAttribute('aria-labelledby', file ? 'tab-file' : 'tab-text');
  $('drop-zone').hidden = !file;
  $('charset-setting').hidden = file;
  $('hex-setting').hidden = file;
  $('example-button').hidden = file;
  $('empty-example-button').hidden = file;
  $('empty-import-button').textContent = file ? '选择文件' : '导入文本';
  $('empty-hint').textContent = file
    ? '选择本地文件编码，或在左侧粘贴 Base64 解码'
    : '填入示例，或在左侧输入需要转换的内容';
  $('data-uri-setting').hidden = !file;
  $('padding-setting').hidden = file;
  document.querySelector('.input-pane').classList.toggle('file-mode', file);
  $('input-subtitle').textContent = file ? '文件或 Base64' : '原文或 Base64';
  $('input').placeholder = file
    ? '要还原文件，请在这里粘贴 Base64 或 data:…;base64,…'
    : '粘贴要编码的文本，或要解码的 Base64 内容…';
  resetFile();
  if (file && $('data-uri').checked) {
    $('variant').value = 'standard';
    $('padding').checked = true;
  }
  inputCount();
  status(file ? '选择文件后编码；粘贴 Base64 后解码。单次最多处理 50 MB 文件。' : '已切换到文本转换，内容不会上传或自动保存。');
}
function resetFile() {
  state.file = null;
  $('file-picker').value = '';
  $('drop-zone').classList.remove('has-file');
  $('file-title').textContent = '拖入文件，或点击选择';
  $('file-detail').textContent = '图片、文档和其他文件，最大 50 MB';
  $('remove-file').hidden = true;
  $('input').disabled = false;
}
function chooseFile() {
  if (state.busy) return;
  $('file-picker').accept = state.mode === 'text' ? '.txt,.b64,.base64,.json,.csv,.log,*/*' : '*/*';
  $('file-picker').click();
}
async function acceptFile(file, forceText = false) {
  if (!file || state.busy) return;
  if (file.size > (forceText || state.mode === 'text' ? MAX_BASE64_LENGTH + 1024 : MAX_FILE_SIZE)) {
    status('文件过大，请使用不超过 50 MB 的原文件或对应的 Base64 文本文件。', 'error');
    return;
  }
  const expectedMode = state.mode;
  const expectedRevision = state.revision;
  const charset = $('charset').value;
  try {
    if (state.mode === 'text' || forceText || /\.(?:base64|b64)$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (state.mode !== expectedMode || state.revision !== expectedRevision) return;
      const text = bytesToText(bytes, expectedMode === 'text' ? charset : 'utf-8');
      resetFile();
      $('input').value = text;
      invalidate();
      status(`已导入 ${file.name}，${formatBytes(file.size)}。`, 'success');
    } else {
      state.file = file;
      $('input').value = '';
      $('input').disabled = true;
      $('drop-zone').classList.add('has-file');
      $('file-title').textContent = file.name;
      $('file-detail').textContent = `${formatBytes(file.size)} / ${file.type || '二进制文件'}`;
      $('remove-file').hidden = false;
      invalidate();
      status(`已选择 ${file.name}，点击“编码为 Base64”开始转换。`);
    }
  } catch (error) { status(error.message || '无法读取文件，请重新选择。', 'error'); }
}
function setBusy(busy) {
  state.busy = busy;
  for (const id of ['encode-button', 'decode-button', 'clear-button', 'import-button', 'example-button', 'empty-example-button', 'empty-import-button', 'charset', 'variant', 'hex-mode', 'padding', 'data-uri']) $(id).disabled = busy;
  for (const tab of document.querySelectorAll('.mode-tab')) tab.disabled = busy;
  $('input').readOnly = busy;
}
function showResult(result) {
  state.result = result;
  $('output-empty').hidden = true;
  resultPhase('success', result.direction === 'encode' ? '编码完成' : '解码完成');
  $('save-button').disabled = false;
  $('copy-button').disabled = result.text === null;
  $('swap-button').disabled = result.text === null;
  $('swap-button').classList.toggle('swap-ready', result.text !== null);
  if (result.text !== null) {
    $('output').hidden = false;
    $('binary-result').hidden = true;
    $('output').value = result.text;
    $('output-count').textContent = `${result.text.length.toLocaleString()} 字符 / ${formatBytes(result.bytes.length)} 原始数据`;
  } else {
    $('output').hidden = true;
    $('binary-result').hidden = false;
    $('binary-name').textContent = result.filename;
    $('binary-detail').textContent = `${formatBytes(result.bytes.length)} / ${result.mime || '二进制文件'}`;
    $('output-count').textContent = `${formatBytes(result.bytes.length)} / 可保存为文件`;
    const image = /^image\/(?:png|jpeg|gif|webp|bmp)$/.test(result.mime);
    $('binary-icon').hidden = image;
    if (image) {
      state.preview = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
      $('image-preview').src = state.preview;
      $('image-preview').hidden = false;
      $('image-preview').onerror = () => {
        $('image-preview').hidden = true;
        $('binary-icon').hidden = false;
      };
    }
  }
}
async function convert(direction) {
  if (state.busy) return;
  const source = $('input').value;
  if (direction === 'encode' && state.mode === 'file' && !state.file) {
    status('请先拖入或选择要编码的文件。', 'error'); return;
  }
  const empty = direction === 'decode' ? !source.trim() : source.length === 0;
  if ((!state.file || direction === 'decode') && empty) {
    status(state.file ? '当前选择的是文件，请点击“编码为 Base64”。要还原文件，请先移除文件并粘贴 Base64。' : '请先输入要转换的内容。', 'error'); return;
  }
  clearResult();
  const revision = state.revision;
  setBusy(true);
  resultPhase('processing', '正在转换');
  status('正在本机转换…');
  // Allow the pending status and button state to paint before large conversions.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const started = performance.now();
  try {
    let bytes, text = null, mime = '', filename;
    if (direction === 'encode') {
      const includeDataUri = state.mode === 'file' && $('data-uri').checked;
      bytes = state.mode === 'file'
        ? new Uint8Array(await state.file.arrayBuffer())
        : $('hex-mode').checked ? hexToBytes(source) : textToBytes(source, $('charset').value);
      text = bytesToBase64(bytes, {
        variant: includeDataUri ? 'standard' : $('variant').value,
        padding: includeDataUri || $('padding').checked,
      });
      if (includeDataUri) {
        mime = state.file.type || 'application/octet-stream';
        text = `data:${mime};base64,${text}`;
      }
      filename = safeFilename(state.file ? `${state.file.name}.base64` : 'encoded.base64');
    } else {
      ({ bytes, mime } = parseBase64Input(source));
      if (state.mode === 'text') {
        text = $('hex-mode').checked ? bytesToHex(bytes) : bytesToText(bytes, $('charset').value);
        filename = 'decoded.txt';
      } else filename = decodedFilename(mime);
    }
    if (revision !== state.revision) return;
    showResult({ bytes, text, mime, filename, direction });
    status(`${direction === 'encode' ? '编码' : '解码'}完成，处理了 ${formatBytes(bytes.length)}，用时 ${Math.max(1, Math.round(performance.now() - started))} ms。`, 'success');
  } catch (error) {
    resultPhase('error', '转换失败');
    status(error.message || '转换失败，请检查输入内容。', 'error');
  }
  finally { setBusy(false); }
}
async function copyResult() {
  if (!state.result || state.result.text === null) return;
  const copiedResult = state.result;
  try {
    if (desktop) await writeText(copiedResult.text);
    else await navigator.clipboard.writeText(copiedResult.text);
    if (state.result !== copiedResult) return;
    resetCopyFeedback();
    $('copy-button').innerHTML = `${icon('check')}<span>已复制</span>`;
    $('copy-button').classList.add('is-copied');
    state.copyTimer = setTimeout(resetCopyFeedback, 1500);
    status('已复制结果到剪贴板。', 'success');
  } catch { status('无法访问剪贴板，可以选中右侧结果手动复制。', 'error'); }
}
async function saveResult() {
  const result = state.result;
  if (!result) return;
  try {
    // Text is saved in the selected character set; Base64/hex output is ASCII/UTF-8.
    const isDecodedText = result.text !== null && result.direction === 'decode' && !$('hex-mode').checked;
    const bytes = result.text === null ? result.bytes : textToBytes(result.text, isDecodedText ? $('charset').value : 'utf-8');
    let savedName = result.filename;
    if (desktop) {
      const path = await save({ defaultPath: result.filename, title: '保存转换结果' });
      if (!path) { status('已取消保存。'); return; }
      await writeFile(path, bytes);
      savedName = path.split(/[\\/]/).pop();
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: result.text === null ? result.mime || 'application/octet-stream' : 'text/plain' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = result.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    status(`已保存 ${savedName}。`, 'success');
  } catch (error) { status(`保存失败：${String(error.message || error)}`, 'error'); }
}
function setSplitRatio(value) {
  if (window.matchMedia('(max-width: 650px)').matches) return;
  const available = $('workspace').getBoundingClientRect().width - $('pane-resizer').offsetWidth;
  if (available <= 0) return;
  const minimum = Math.max(.28, Math.min(300, available / 2) / available);
  const maximum = 1 - minimum;
  state.splitRatio = Math.max(minimum, Math.min(maximum, value));
  $('workspace').style.setProperty('--pane-left', `${state.splitRatio}fr`);
  $('workspace').style.setProperty('--pane-right', `${1 - state.splitRatio}fr`);
  const percent = Math.round(state.splitRatio * 100);
  $('pane-resizer').setAttribute('aria-valuemin', String(Math.ceil(minimum * 100)));
  $('pane-resizer').setAttribute('aria-valuemax', String(Math.floor(maximum * 100)));
  $('pane-resizer').setAttribute('aria-valuenow', String(percent));
  $('pane-resizer').setAttribute('aria-valuetext', `输入 ${percent}%，结果 ${100 - percent}%`);
}
let resizePointer = null;
$('pane-resizer').addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  resizePointer = event.pointerId;
  $('pane-resizer').setPointerCapture(event.pointerId);
  $('pane-resizer').focus();
  $('app').classList.add('is-resizing');
});
$('pane-resizer').addEventListener('pointermove', (event) => {
  if (resizePointer !== event.pointerId) return;
  const bounds = $('workspace').getBoundingClientRect();
  const gripWidth = $('pane-resizer').offsetWidth;
  setSplitRatio((event.clientX - bounds.left - gripWidth / 2) / (bounds.width - gripWidth));
});
function finishResize(event) {
  if (resizePointer !== event.pointerId) return;
  resizePointer = null;
  $('app').classList.remove('is-resizing');
  if ($('pane-resizer').hasPointerCapture(event.pointerId)) $('pane-resizer').releasePointerCapture(event.pointerId);
}
$('pane-resizer').addEventListener('pointerup', finishResize);
$('pane-resizer').addEventListener('pointercancel', finishResize);
$('pane-resizer').addEventListener('lostpointercapture', (event) => {
  if (resizePointer === event.pointerId) {
    resizePointer = null;
    $('app').classList.remove('is-resizing');
  }
});
$('pane-resizer').addEventListener('dblclick', () => {
  setSplitRatio(.5);
  status('已恢复为等宽分栏。');
});
$('pane-resizer').addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const next = {
    ArrowLeft: state.splitRatio - .02,
    ArrowRight: state.splitRatio + .02,
    Home: 0, End: 1, Enter: .5,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  setSplitRatio(next);
});
window.addEventListener('resize', () => setSplitRatio(state.splitRatio));
setSplitRatio(.5);

let fileDragDepth = 0;
function containsFiles(event) {
  return Array.from(event.dataTransfer?.types || []).some((type) => type.toLowerCase() === 'files');
}
function fileDropActive(active) {
  $('app').classList.toggle('file-drag-active', active);
  $('page-drop-notice').hidden = !active;
  $('drop-zone').classList.toggle('dragging', active && state.mode === 'file');
}
function clearFileDrag() {
  fileDragDepth = 0;
  fileDropActive(false);
}
window.addEventListener('dragenter', (event) => {
  if (!containsFiles(event) || state.busy) return;
  event.preventDefault();
  fileDragDepth++;
  fileDropActive(true);
});
window.addEventListener('dragover', (event) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  if (!state.busy) {
    event.dataTransfer.dropEffect = 'copy';
    fileDropActive(true);
  }
});
window.addEventListener('dragleave', (event) => {
  if (!$('app').classList.contains('file-drag-active')) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth || event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight) clearFileDrag();
});
window.addEventListener('dragend', clearFileDrag);
window.addEventListener('blur', clearFileDrag);
window.addEventListener('drop', (event) => {
  const files = Array.from(event.dataTransfer?.files || []);
  clearFileDrag();
  if (!files.length) {
    if (event.target !== $('input') || $('input').readOnly || $('input').disabled) event.preventDefault();
    return;
  }
  event.preventDefault();
  if (state.busy) return;
  if (files.length > 1) { status('请每次选择一个文件。', 'error'); return; }
  const file = files[0];
  const text = file.type.startsWith('text/') || /\.(?:txt|b64|base64|json|csv|log|md|xml|html|css|js|ya?ml|ini)$/i.test(file.name);
  if (state.mode === 'text' && !text) setMode('file');
  acceptFile(file);
});
for (const tab of document.querySelectorAll('.mode-tab')) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'text' : event.key === 'End' ? 'file' : state.mode === 'text' ? 'file' : 'text';
    setMode(next); $(next === 'text' ? 'tab-text' : 'tab-file').focus();
  });
}
$('input').addEventListener('input', invalidate);
for (const id of ['charset', 'hex-mode', 'padding']) $(id).addEventListener('change', invalidate);
$('variant').addEventListener('change', () => {
  if (state.mode === 'file' && $('variant').value === 'url') $('data-uri').checked = false;
  invalidate();
});
$('data-uri').addEventListener('change', () => {
  if ($('data-uri').checked) {
    $('variant').value = 'standard';
    $('padding').checked = true;
  }
  invalidate();
});
$('wrap-output').addEventListener('change', () => {
  $('output').classList.toggle('no-wrap', !$('wrap-output').checked);
  $('output').wrap = $('wrap-output').checked ? 'soft' : 'off';
});
$('encode-button').addEventListener('click', () => convert('encode'));
$('decode-button').addEventListener('click', () => convert('decode'));
$('copy-button').addEventListener('click', copyResult);
$('save-button').addEventListener('click', saveResult);
$('save-binary-button').addEventListener('click', saveResult);
$('import-button').addEventListener('click', chooseFile);
$('empty-import-button').addEventListener('click', chooseFile);
$('empty-example-button').addEventListener('click', () => $('example-button').click());
$('file-picker').addEventListener('change', (event) => acceptFile(event.target.files[0]));
$('drop-zone').addEventListener('click', (event) => { if (!event.target.closest('#remove-file')) chooseFile(); });
$('drop-zone').addEventListener('keydown', (event) => {
  if (event.target === $('drop-zone') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); chooseFile(); }
});
$('remove-file').addEventListener('click', (event) => { event.stopPropagation(); if (!state.busy) { resetFile(); invalidate(); } });
$('clear-button').addEventListener('click', () => {
  if (state.busy) return;
  resetFile(); $('input').value = ''; invalidate();
  status('已清空输入和结果。'); $('input').focus();
});
$('example-button').addEventListener('click', () => {
  $('input').value = $('hex-mode').checked ? 'E4 BD A0 E5 A5 BD' : '你好，世界！\nHello, Base64.';
  invalidate(); $('input').focus();
});
$('swap-button').addEventListener('click', () => {
  if (!state.result || state.result.text === null || state.busy) return;
  const text = state.result.text;
  resetFile(); $('input').value = text; invalidate(); $('input').focus();
  status('结果已移到输入区，可以继续转换。');
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !$('help-dialog').open) {
    event.preventDefault(); convert(event.shiftKey ? 'decode' : 'encode');
  }
});
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('help-done').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', (event) => {
  if (event.target === $('help-dialog')) {
    const rect = $('help-dialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('help-dialog').close();
  }
});
window.addEventListener('beforeunload', () => {
  releasePreview();
  clearTimeout(state.copyTimer);
  state.countAnimation?.cancel();
});
