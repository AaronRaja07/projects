/* DOM-boundary tests for export previews; no browser or downloads required. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../assets/ui.js'), 'utf8');

function harness({clipboardFails = false, clickFails = false} = {}) {
  const clicks = [], urls = [], revoked = [], timers = [], copied = [];
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.parentNode = null; this.textContent = ''; }
    set innerHTML(_) { throw new Error('Export contents must never be interpolated as HTML'); }
    get innerHTML() { return ''; }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
    remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; } }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key]; }
    click() {
      clicks.push({element: this, attached: this.isConnected, href: this.href, filename: this.download});
      if (clickFails) throw new Error('Download blocked by browser');
    }
    get isConnected() { let node = this; while (node) { if (node === body) return true; node = node.parentNode; } return false; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
  }
  const body = new Element('body');
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const document = {body, createElement: tag => new Element(tag), getElementById: id => descendants(body).find(node => node.id === id) || null};
  const sandbox = {
    document, Blob,
    URL: {createObjectURL(blob) { const url = 'blob:synthetic-' + urls.length; urls.push({url, blob}); return url; }, revokeObjectURL(url) { revoked.push(url); }},
    navigator: {clipboard: {async writeText(text) { if (clipboardFails) throw new Error('Clipboard unavailable'); copied.push(text); }}},
    setTimeout(callback, delay) { timers.push({callback, delay}); return timers.length; }, clearTimeout() {},
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return {UI: sandbox.UI, body, document, clicks, urls, revoked, timers, copied, descendants,
    preview: () => document.getElementById('export-preview'),
    buttons: () => descendants(document.getElementById('export-preview')).filter(node => node.tagName === 'BUTTON'),
    textarea: () => descendants(document.getElementById('export-preview')).find(node => node.tagName === 'TEXTAREA')};
}

test('exact literal content is preserved in both Blob and accessible readonly preview', async () => {
  const h = harness(), text = '</textarea><script>alert("demo")</script>\nα,β\r\n"quoted"\t=1+1';
  h.UI.download('synthetic-<example>.csv', text, 'text/csv');
  assert.equal(await h.urls[0].blob.text(), text);
  assert.equal(h.textarea().value, text);
  assert.equal(h.textarea().readOnly, true);
  assert.equal(h.textarea().getAttribute('aria-label'), 'Prepared export contents');
  assert.equal(h.preview().getAttribute('aria-labelledby'), 'export-preview-title');
  assert.equal(h.document.getElementById('export-preview-title').textContent, 'Export ready');
  assert.equal(h.preview().open, true);
});

test('save attaches the filename-bearing anchor before clicking and removes it afterward', () => {
  const h = harness(); h.UI.download('readout.md', '# Synthetic readout', 'text/markdown');
  assert.equal(h.clicks.length, 1);
  assert.equal(h.clicks[0].attached, true);
  assert.equal(h.clicks[0].filename, 'readout.md');
  assert.equal(h.clicks[0].element.isConnected, false);
  assert.equal(h.urls[0].blob.type, 'text/markdown');
});

test('default MIME and String conversion are explicit', async () => {
  const h = harness(); h.UI.download(123, 456);
  assert.equal(h.clicks[0].filename, '123');
  assert.equal(h.urls[0].blob.type, 'text/plain');
  assert.equal(await h.urls[0].blob.text(), '456');
});

test('save retry creates a fresh object URL with the same exact output', async () => {
  const h = harness(); h.UI.download('audit.json', '{"synthetic":true}', 'application/json');
  h.buttons().find(button => button.textContent === 'Save file').onclick();
  assert.equal(h.clicks.length, 2);
  assert.notEqual(h.clicks[0].href, h.clicks[1].href);
  assert.equal(await h.urls[1].blob.text(), await h.urls[0].blob.text());
  assert.ok(h.clicks.every(click => click.attached && click.filename === 'audit.json'));
});

test('object URLs remain alive during save and cleanup runs after the grace period', () => {
  const h = harness(); h.UI.download('readout.txt', 'Synthetic');
  assert.deepEqual(h.revoked, []);
  assert.equal(h.timers.length, 1);
  assert.ok(h.timers[0].delay >= 30000);
  h.timers[0].callback();
  assert.deepEqual(h.revoked, [h.urls[0].url]);
});

test('a second export replaces its prior preview and close dismisses the dialog', () => {
  const h = harness(); h.UI.download('first.txt', 'First'); const first = h.preview();
  h.UI.download('second.txt', 'Second');
  assert.equal(first.isConnected, false);
  assert.notEqual(h.preview(), first);
  assert.equal(h.descendants(h.body).filter(node => node.id === 'export-preview').length, 1);
  assert.equal(h.textarea().value, 'Second');
  h.buttons().find(button => button.textContent === 'Close').onclick();
  assert.equal(h.preview().open, false);
});

test('clipboard writing occurs only after explicit Copy contents activation', async () => {
  const h = harness(), text = '# Exact synthetic readout\n';
  h.UI.download('readout.md', text);
  assert.deepEqual(h.copied, []);
  await h.buttons().find(button => button.textContent === 'Copy contents').onclick();
  assert.deepEqual(h.copied, [text]);
  assert.equal(h.document.getElementById('toast').textContent, 'Export contents copied');
});

test('unavailable clipboard selects the literal preview for manual copying', async () => {
  const h = harness({clipboardFails: true}); h.UI.download('readout.txt', 'Safe literal contents');
  await h.buttons().find(button => button.textContent === 'Copy contents').onclick();
  assert.deepEqual(h.copied, []);
  assert.equal(h.textarea().focused, true); assert.equal(h.textarea().selected, true);
  assert.match(h.document.getElementById('toast').textContent, /Contents selected/);
});

test('blocked native clicks still remove the anchor, schedule cleanup, and leave a preview', () => {
  const h = harness({clickFails: true});
  assert.throws(() => h.UI.download('readout.txt', 'Reviewable even if download fails'), /Download blocked/);
  assert.equal(h.clicks[0].element.isConnected, false);
  assert.equal(h.timers[0].delay, 30000);
  assert.equal(h.preview().open, true);
  assert.equal(h.textarea().value, 'Reviewable even if download fails');
});
