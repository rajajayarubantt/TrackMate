// The note editor: a Notion-style block editor on a single editable surface.
//
// Each direct child of the editable area is one block (paragraph, heading, to-do, …). The browser
// handles typing, selection and the caret; this file handles what the browser would get wrong:
// splitting and joining blocks, Markdown shortcuts, the "/" menu, and turning the page into data.
// Everything is saved automatically a moment after you stop typing.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IconType } from 'react-icons';
import { useQuery } from '../db/hooks';
import { deleteNote, getNote, insertNote, setItemTags, updateNote } from '../db/repo';
import type { Block, BlockType, Note } from '../db/types';
import { fmt, relDay } from '../lib/dates';
import { uid } from '../lib/id';
import { navigate } from '../lib/router';
import { escapeHtml, sanitizeHtml } from '../lib/sanitize';
import { useSettings } from '../lib/session';
import { Icon } from '../ui/icons';
import { Menu, Popover, toast, useAnchor } from '../ui/overlay';
import type { MenuEntry } from '../ui/overlay';
import { TagsField } from '../ui/pickers';

interface BlockDef {
  type: BlockType;
  label: string;
  hint: string;
  icon: IconType;
  keywords: string;
}

const BLOCKS: BlockDef[] = [
  { type: 'p', label: 'Text', hint: 'Plain paragraph', icon: Icon.textOutline, keywords: 'text paragraph body' },
  { type: 'h1', label: 'Heading 1', hint: 'Large section heading', icon: Icon.text, keywords: 'heading title h1' },
  { type: 'h2', label: 'Heading 2', hint: 'Medium section heading', icon: Icon.text, keywords: 'heading subtitle h2' },
  { type: 'h3', label: 'Heading 3', hint: 'Small section heading', icon: Icon.text, keywords: 'heading h3' },
  { type: 'todo', label: 'To-do', hint: 'A box you can tick', icon: Icon.checkboxOutline, keywords: 'todo task checkbox checklist' },
  { type: 'bullet', label: 'Bulleted list', hint: 'A simple list', icon: Icon.bullets, keywords: 'bullet list unordered' },
  { type: 'number', label: 'Numbered list', hint: 'A list with numbers', icon: Icon.list, keywords: 'number list ordered' },
  { type: 'quote', label: 'Quote', hint: 'Set a line apart', icon: Icon.quote, keywords: 'quote blockquote' },
  { type: 'callout', label: 'Callout', hint: 'Make a point stand out', icon: Icon.callout, keywords: 'callout note tip highlight' },
  { type: 'code', label: 'Code', hint: 'Monospaced block', icon: Icon.code, keywords: 'code snippet pre' },
  { type: 'divider', label: 'Divider', hint: 'A line between sections', icon: Icon.divider, keywords: 'divider line rule separator' },
];

/** Typed at the start of a line, these turn it into another kind of block. */
const SHORTCUTS: [string, BlockType][] = [
  ['# ', 'h1'], ['## ', 'h2'], ['### ', 'h3'], ['- ', 'bullet'], ['* ', 'bullet'], ['1. ', 'number'],
  ['[] ', 'todo'], ['[ ] ', 'todo'], ['> ', 'quote'], ['``` ', 'code'],
];
const CONTINUES: BlockType[] = ['bullet', 'number', 'todo'];

// ── Blocks <-> DOM ─────────────────────────────────────────────────────────────────────────────

function blockHtml(block: Block): string {
  const attrs = `class="blk" data-type="${block.type}" data-id="${block.id}"${block.checked ? ' data-checked="true"' : ''}`;
  if (block.type === 'divider') return `<div ${attrs} contenteditable="false"><hr></div>`;
  return `<div ${attrs}>${sanitizeHtml(block.html) || '<br>'}</div>`;
}

function makeBlock(type: BlockType): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'blk';
  el.dataset.type = type;
  el.dataset.id = uid(8);
  if (type === 'divider') {
    el.contentEditable = 'false';
    el.appendChild(document.createElement('hr'));
  } else {
    el.appendChild(document.createElement('br'));
  }
  return el;
}

function readBlocks(root: HTMLElement): { blocks: Block[]; plain: string } {
  const blocks: Block[] = [];
  const lines: string[] = [];
  root.querySelectorAll<HTMLElement>(':scope > .blk').forEach((el) => {
    const type = (el.dataset.type ?? 'p') as BlockType;
    if (type === 'divider') {
      blocks.push({ id: el.dataset.id ?? uid(8), type, html: '' });
      return;
    }
    const html = sanitizeHtml(el.innerHTML).replace(/(<br>)+$/, '');
    const block: Block = { id: el.dataset.id ?? uid(8), type, html };
    if (type === 'todo') block.checked = el.dataset.checked === 'true';
    blocks.push(block);
    const text = (el.textContent ?? '').replace(/ /g, ' ').trim();
    if (text) lines.push(text);
  });
  return { blocks, plain: lines.join('\n') };
}

/** Repair anything the browser left behind: stray nodes, nested blocks, duplicate ids, empty page. */
function normalize(root: HTMLElement): void {
  const seen = new Set<string>();
  [...root.childNodes].forEach((node) => {
    if (node instanceof HTMLElement && node.classList.contains('blk')) {
      node.querySelectorAll('.blk').forEach((inner) => inner.replaceWith(...inner.childNodes));
      if (!node.dataset.id || seen.has(node.dataset.id)) node.dataset.id = uid(8);
      seen.add(node.dataset.id);
      if (!node.dataset.type) node.dataset.type = 'p';
      if (node.dataset.type !== 'divider' && !node.firstChild) node.appendChild(document.createElement('br'));
      return;
    }
    if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()) {
      node.remove();
      return;
    }
    const block = makeBlock('p');
    block.textContent = node.textContent ?? '';
    if (!block.firstChild) block.appendChild(document.createElement('br'));
    node.replaceWith(block);
  });
  const last = root.lastElementChild as HTMLElement | null;
  if (!last || last.dataset.type === 'code' || last.dataset.type === 'divider') root.appendChild(makeBlock('p'));
}

// ── Caret helpers ──────────────────────────────────────────────────────────────────────────────

function blockAt(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.parentNode !== root) el = el.parentNode;
  return el instanceof HTMLElement && el.classList.contains('blk') ? el : null;
}

function textBeforeCaret(block: HTMLElement): string | null {
  const selection = getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!block.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().replace(/ /g, ' ');
}

function placeCaret(block: HTMLElement, atEnd = false): void {
  const selection = getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (block.dataset.type === 'divider') {
    range.setStartAfter(block);
  } else {
    range.selectNodeContents(block);
    if (atEnd && block.lastChild?.nodeName === 'BR') range.setEndBefore(block.lastChild);
    range.collapse(!atEnd);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function setType(block: HTMLElement, type: BlockType): HTMLElement {
  if (type === 'divider') {
    const divider = makeBlock('divider');
    block.replaceWith(divider);
    return divider;
  }
  block.dataset.type = type;
  if (type !== 'todo') delete block.dataset.checked;
  return block;
}

const isEmpty = (block: HTMLElement): boolean => !(block.textContent ?? '').replace(/ |\n/g, '').trim();

// ── Component ──────────────────────────────────────────────────────────────────────────────────

interface SlashState {
  query: string;
  point: { x: number; y: number };
  index: number;
}

export function NoteEditor({ id }: { id: string }) {
  const settings = useSettings();
  const initial = useMemo(() => getNote(id), [id]);
  const live = useQuery(() => getNote(id), [id]);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [status, setStatus] = useState<'saved' | 'saving'>('saved');
  const [words, setWords] = useState(() => (initial?.plain.match(/\S+/g) ?? []).length);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [marks, setMarks] = useState({ bold: false, italic: false, underline: false, strike: false, link: false });
  const [currentType, setCurrentType] = useState<BlockType>('p');
  const typeMenu = useAnchor();
  const moreMenu = useAnchor();
  const linkPop = useAnchor();
  const [linkUrl, setLinkUrl] = useState('');
  const state = useRef({ title, timer: 0, dirty: false, blockId: '', slashDismissed: '', range: null as Range | null });
  state.current.title = title;
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const initialHtml = useMemo(() => (initial?.content.length ? initial.content : [{ id: uid(8), type: 'p' as BlockType, html: '' }]).map(blockHtml).join(''), [initial]);

  const slashItems = useMemo(() => {
    if (!slash) return [];
    const q = slash.query.toLowerCase();
    return BLOCKS.filter((block) => !q || block.label.toLowerCase().includes(q) || block.keywords.includes(q));
  }, [slash]);

  const actions = useRef<{ chooseSlash: (def: BlockDef) => void }>({ chooseSlash: () => undefined });
  const slashItemsRef = useRef(slashItems);
  slashItemsRef.current = slashItems;

  // ── Saving ──
  const saveNow = (root: HTMLElement | null = rootRef.current) => {
    const s = state.current;
    clearTimeout(s.timer);
    if (!root || !s.dirty) return;
    s.dirty = false;
    const { blocks, plain } = readBlocks(root);
    updateNote(id, { title: s.title.trim(), content: blocks, plain });
    setWords((plain.match(/\S+/g) ?? []).length);
    setStatus('saved');
  };
  const queueSave = () => {
    const s = state.current;
    s.dirty = true;
    setStatus('saving');
    clearTimeout(s.timer);
    s.timer = window.setTimeout(() => saveNow(), 600);
  };

  // Save when leaving the note, hiding the tab, or closing the page. Empty notes are thrown away.
  useEffect(() => {
    const root = rootRef.current; // kept for the final save: the ref is already cleared by then
    const onHide = () => saveNow();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      saveNow(root);
      const note = getNote(id);
      if (note && !note.title.trim() && !note.plain.trim()) deleteNote(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // The editable area is filled once, by hand. React must never re-render its contents, or it
  // would wipe what was just typed.
  useLayoutEffect(() => {
    if (rootRef.current) rootRef.current.innerHTML = initialHtml;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // A brand-new note starts with the cursor in its title.
  useEffect(() => {
    if (initial && !initial.title && !initial.plain) titleRef.current?.focus();
  }, [initial]);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // ── Tracking the caret ──
  const refreshSlash = (block: HTMLElement | null) => {
    const text = block ? (block.textContent ?? '').replace(/ /g, ' ') : '';
    const match = /^\/([a-z0-9 ]{0,16})$/i.exec(text);
    if (!block || !match || state.current.slashDismissed === block.dataset.id) {
      if (slashRef.current) setSlash(null);
      if (!match) state.current.slashDismissed = '';
      return;
    }
    const rect = getSelection()?.getRangeAt(0).getBoundingClientRect();
    const box = rect && (rect.width || rect.height) ? rect : block.getBoundingClientRect();
    const prev = slashRef.current;
    setSlash({
      query: match[1],
      point: prev && prev.point.x === Math.round(box.left) && prev.point.y === Math.round(box.bottom) ? prev.point : { x: Math.round(box.left), y: Math.round(box.bottom) },
      index: prev && prev.query === match[1] ? prev.index : 0,
    });
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onSelection = () => {
      const selection = getSelection();
      if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return;
      const block = blockAt(selection.anchorNode, root);
      root.querySelectorAll('.blk[data-current]').forEach((el) => el !== block && el.removeAttribute('data-current'));
      if (block) {
        block.setAttribute('data-current', 'true');
        state.current.blockId = block.dataset.id ?? '';
        setCurrentType((block.dataset.type ?? 'p') as BlockType);
      }
      state.current.range = selection.getRangeAt(0).cloneRange();
      const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
      setMarks({
        bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'), strike: document.queryCommandState('strikeThrough'),
        link: !!anchor?.closest('a'),
      });
      if (slashRef.current) refreshSlash(block);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  // ── Editing behaviour (native events: React's synthetic beforeinput lacks inputType) ──
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const current = (): HTMLElement | null => blockAt(getSelection()?.anchorNode ?? null, root);

    const enter = () => {
      const selection = getSelection();
      const block = current();
      if (!selection?.rangeCount || !block) return;
      const type = (block.dataset.type ?? 'p') as BlockType;
      if (type === 'code') {
        document.execCommand('insertLineBreak'); // a new line inside the code block
        return;
      }
      // Enter on an empty list item or heading turns it back into plain text.
      if (isEmpty(block) && type !== 'p') {
        setType(block, 'p');
        placeCaret(block);
        return;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      // Enter at the very start of a line pushes that line down.
      if (textBeforeCaret(block) === '' && !isEmpty(block)) {
        block.before(makeBlock(CONTINUES.includes(type) ? type : 'p'));
        return;
      }
      const tail = document.createRange();
      tail.selectNodeContents(block);
      tail.setStart(range.endContainer, range.endOffset);
      const fragment = tail.extractContents();
      const next = makeBlock(CONTINUES.includes(type) ? type : 'p');
      if ((fragment.textContent ?? '').length || fragment.querySelector('a, b, i, u, s, code')) {
        next.replaceChildren(fragment);
        if (!next.textContent) next.replaceChildren(document.createElement('br'));
      }
      if (!block.textContent) block.replaceChildren(document.createElement('br'));
      block.after(next);
      placeCaret(next);
      next.scrollIntoView({ block: 'nearest' });
    };

    const backspaceAtStart = (block: HTMLElement): boolean => {
      const type = block.dataset.type ?? 'p';
      if (type !== 'p') {
        setType(block, 'p');
        placeCaret(block);
        return true;
      }
      const prev = block.previousElementSibling;
      if (!(prev instanceof HTMLElement)) return false;
      if (prev.dataset.type === 'divider') {
        prev.remove();
        return true;
      }
      if (prev.lastChild?.nodeName === 'BR') prev.lastChild.remove();
      const marker = document.createTextNode('');
      prev.appendChild(marker);
      while (block.firstChild) {
        if (block.firstChild.nodeName === 'BR' && !block.firstChild.nextSibling) block.firstChild.remove();
        else prev.appendChild(block.firstChild);
      }
      block.remove();
      if (!prev.textContent) prev.replaceChildren(document.createElement('br'));
      const selection = getSelection();
      const range = document.createRange();
      if (marker.isConnected) range.setStart(marker, 0);
      else range.selectNodeContents(prev);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    };

    const chooseSlash = (def: BlockDef) => {
      const block = current() ?? root.querySelector<HTMLElement>(`.blk[data-id="${state.current.blockId}"]`);
      if (!block) return;
      block.replaceChildren(document.createElement('br'));
      const result = setType(block, def.type);
      if (def.type === 'divider') {
        const next = makeBlock('p');
        result.after(next);
        placeCaret(next);
      } else placeCaret(result);
      setSlash(null);
      setCurrentType(def.type === 'divider' ? 'p' : def.type);
      queueSave();
    };
    actions.current.chooseSlash = chooseSlash;

    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertParagraph') {
        event.preventDefault();
        enter();
        normalize(root);
        queueSave();
      } else if (event.inputType === 'deleteContentBackward') {
        const block = current();
        if (block && textBeforeCaret(block) === '' && backspaceAtStart(block)) {
          event.preventDefault();
          normalize(root);
          queueSave();
        }
      }
    };

    const onInput = (event: Event) => {
      normalize(root);
      const block = current();
      const input = event as InputEvent;
      if (block && (block.dataset.type ?? 'p') === 'p' && input.inputType === 'insertText') {
        const before = textBeforeCaret(block);
        const whole = (block.textContent ?? '').replace(/ /g, ' ');
        const hit = before !== null && SHORTCUTS.find(([marker]) => before === marker);
        if (hit) {
          const selection = getSelection();
          const range = document.createRange();
          range.selectNodeContents(block);
          if (selection?.rangeCount) range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
          range.deleteContents();
          if (!block.textContent) block.replaceChildren(document.createElement('br'));
          setType(block, hit[1]);
          placeCaret(block);
          setCurrentType(hit[1]);
        } else if (whole === '---') {
          const divider = setType(block, 'divider');
          const next = makeBlock('p');
          divider.after(next);
          placeCaret(next);
        }
      }
      refreshSlash(current());
      queueSave();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const menu = slashRef.current;
      if (menu) {
        const items = slashItemsRef.current;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const count = Math.max(1, items.length);
          setSlash({ ...menu, index: (menu.index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count });
          return;
        }
        if (event.key === 'Enter' && items[menu.index]) {
          event.preventDefault();
          chooseSlash(items[menu.index]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          state.current.slashDismissed = current()?.dataset.id ?? '';
          setSlash(null);
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        // Tick or untick a to-do from the keyboard.
        const block = current();
        if (block?.dataset.type === 'todo') {
          event.preventDefault();
          if (block.dataset.checked === 'true') delete block.dataset.checked;
          else block.dataset.checked = 'true';
          queueSave();
        }
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
      if (!text) return;
      const lines = text.split('\n');
      const block = current();
      if (lines.length === 1 || !block || block.dataset.type === 'code') {
        document.execCommand('insertText', false, text);
        return;
      }
      // Several lines become several blocks; Markdown markers at the start of a line are honoured.
      let after: HTMLElement = block;
      let first = true;
      for (const raw of lines) {
        const line = raw.replace(/\t/g, '  ');
        if (first) {
          first = false;
          if (line) document.execCommand('insertText', false, line);
          continue;
        }
        if (!line.trim()) continue;
        const shortcut = SHORTCUTS.find(([marker]) => line.startsWith(marker));
        const todo = /^- \[( |x)\] /i.exec(line);
        const next = makeBlock(todo ? 'todo' : shortcut ? shortcut[1] : /^\d+\. /.test(line) ? 'number' : 'p');
        if (todo && todo[1].toLowerCase() === 'x') next.dataset.checked = 'true';
        next.textContent = todo ? line.slice(todo[0].length) : shortcut ? line.slice(shortcut[0].length) : line.replace(/^\d+\. /, '');
        after.after(next);
        after = next;
      }
      placeCaret(after, true);
      normalize(root);
      queueSave();
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Tapping the box at the left of a to-do ticks it.
      if (target.classList.contains('blk') && target.dataset.type === 'todo') {
        const rect = target.getBoundingClientRect();
        if (event.clientX - rect.left < 30) {
          event.preventDefault();
          if (target.dataset.checked === 'true') delete target.dataset.checked;
          else target.dataset.checked = 'true';
          queueSave();
        }
      }
      const link = target.closest('a');
      if (link && (event.metaKey || event.ctrlKey)) window.open(link.href, '_blank', 'noopener,noreferrer');
    };

    root.addEventListener('beforeinput', onBeforeInput);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('paste', onPaste);
    root.addEventListener('click', onClick);
    const onBlur = () => saveNow();
    root.addEventListener('blur', onBlur);
    return () => {
      root.removeEventListener('beforeinput', onBeforeInput);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('paste', onPaste);
      root.removeEventListener('click', onClick);
      root.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Toolbar actions ──
  const focusEditor = () => {
    const root = rootRef.current;
    if (!root) return null;
    const block = root.querySelector<HTMLElement>(`.blk[data-id="${state.current.blockId}"]`) ?? root.querySelector<HTMLElement>('.blk:last-child');
    return block;
  };
  const restoreSelection = () => {
    const range = state.current.range;
    const root = rootRef.current;
    if (!root) return;
    root.focus({ preventScroll: true });
    if (range && root.contains(range.startContainer)) {
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      const block = focusEditor();
      if (block) placeCaret(block, true);
    }
  };
  const format = (command: string, value?: string) => {
    restoreSelection();
    // execCommand is old but it is still the one cross-browser way to format editable text.
    document.execCommand(command, false, value);
    queueSave();
  };
  const changeType = (type: BlockType) => {
    const root = rootRef.current;
    const block = focusEditor();
    if (!root || !block) return;
    root.focus({ preventScroll: true });
    const result = setType(block, type);
    if (type === 'divider') {
      const next = makeBlock('p');
      result.after(next);
      placeCaret(next);
    } else placeCaret(result, true);
    setCurrentType(type === 'divider' ? 'p' : type);
    queueSave();
  };
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  const openLink = (target: HTMLElement) => {
    const range = state.current.range;
    const node = range?.startContainer;
    const anchor = (node instanceof Element ? node : node?.parentElement)?.closest('a');
    setLinkUrl(anchor?.getAttribute('href') ?? '');
    linkPop.show(target);
  };
  const applyLink = () => {
    const url = linkUrl.trim();
    linkPop.hide();
    if (!url) return;
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    restoreSelection();
    if (getSelection()?.isCollapsed) document.execCommand('insertHTML', false, `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`);
    else document.execCommand('createLink', false, href);
    queueSave();
  };

  if (!initial) return null;

  const remove = () => {
    saveNow();
    const snapshot: Note | undefined = getNote(id);
    if (!snapshot) return;
    navigate('notes');
    deleteNote(id);
    toast({ message: 'Note deleted', actionLabel: 'Undo', onAction: () => insertNote(snapshot) });
  };
  const copyText = () => {
    const root = rootRef.current;
    const text = `${title}\n\n${root ? readBlocks(root).plain : ''}`.trim();
    void navigator.clipboard?.writeText(text).then(() => toast('Note copied'), () => toast({ message: 'Copying is not allowed here', tone: 'warning' }));
  };
  const more: MenuEntry[] = [
    { label: live?.pinned ? 'Unpin' : 'Pin to top', icon: live?.pinned ? <Icon.pinOutline /> : <Icon.pin />, onSelect: () => updateNote(id, { pinned: live?.pinned ? 0 : 1 }) },
    { label: 'Copy as text', icon: <Icon.copy />, onSelect: copyText },
    { separator: true },
    { label: 'Delete note', icon: <Icon.trash />, destructive: true, onSelect: remove },
  ];
  const typeDef = BLOCKS.find((block) => block.type === currentType) ?? BLOCKS[0];
  const edited = live ? `${relDay(live.updated_at)}, ${fmt.time(live.updated_at, settings.time24)}` : '';

  return (
    <div className="editor">
      <header className="editor-bar">
        <button type="button" className="back-btn glass editor-back" onClick={() => navigate('notes')}>
          <Icon.chevronBack />
          Notes
        </button>
        <span className="save-state" data-state={status} role="status">
          {status === 'saving' ? <span className="spinner small" /> : <Icon.saved />}
          {status === 'saving' ? 'Saving…' : 'Saved'}
        </span>
        <button type="button" className="icon-btn glass" aria-label={live?.pinned ? 'Unpin note' : 'Pin note'} aria-pressed={!!live?.pinned}
          onClick={() => updateNote(id, { pinned: live?.pinned ? 0 : 1 })}>
          {live?.pinned ? <Icon.pin /> : <Icon.pinOutline />}
        </button>
        <button type="button" className="icon-btn glass" aria-label="Note options" onClick={(event) => moreMenu.show(event.currentTarget)}>
          <Icon.more />
        </button>
        <Menu open={moreMenu.open} anchor={moreMenu.anchor} onClose={moreMenu.hide} items={more} />
      </header>

      <div className="editor-scroll">
        <div className="editor-page">
          <textarea
            ref={titleRef} className="note-title" aria-label="Note title" placeholder="Title" rows={1} value={title}
            onChange={(event) => {
              setTitle(event.currentTarget.value.replace(/\n/g, ' '));
              state.current.title = event.currentTarget.value.replace(/\n/g, ' ');
              queueSave();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault();
                const first = rootRef.current?.querySelector<HTMLElement>('.blk');
                rootRef.current?.focus();
                if (first) placeCaret(first);
              }
            }}
            onBlur={() => saveNow()}
          />
          <div className="note-meta">Edited {edited} · {words} {words === 1 ? 'word' : 'words'}</div>
          <div className="note-tags"><TagsField value={live?.tagIds ?? []} onChange={(tagIds) => setItemTags('note', id, tagIds)} /></div>
          <div
            ref={rootRef} className="doc" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
            aria-label="Note" spellCheck
          />
        </div>
      </div>

      <div className="fmt-bar glass" role="toolbar" aria-label="Formatting" onPointerDown={keepFocus} onMouseDown={keepFocus}>
        <button type="button" className="fmt-type" aria-label="Block type" onClick={(event) => typeMenu.show(event.currentTarget)}>
          <typeDef.icon />
          <span>{typeDef.label}</span>
          <Icon.chevronExpand />
        </button>
        <i className="fmt-sep" />
        <button type="button" aria-label="To-do" aria-pressed={currentType === 'todo'} onClick={() => changeType(currentType === 'todo' ? 'p' : 'todo')}><Icon.checkboxOutline /></button>
        <button type="button" aria-label="Bulleted list" aria-pressed={currentType === 'bullet'} onClick={() => changeType(currentType === 'bullet' ? 'p' : 'bullet')}><Icon.bullets /></button>
        <i className="fmt-sep" />
        <button type="button" aria-label="Bold" aria-pressed={marks.bold} onClick={() => format('bold')}><b>B</b></button>
        <button type="button" aria-label="Italic" aria-pressed={marks.italic} onClick={() => format('italic')}><i>I</i></button>
        <button type="button" aria-label="Underline" aria-pressed={marks.underline} onClick={() => format('underline')}><u>U</u></button>
        <button type="button" aria-label="Strikethrough" aria-pressed={marks.strike} onClick={() => format('strikeThrough')}><s>S</s></button>
        <button type="button" aria-label="Link" aria-pressed={marks.link} onClick={(event) => openLink(event.currentTarget)}><Icon.link /></button>
      </div>

      <Menu
        open={typeMenu.open} anchor={typeMenu.anchor} onClose={typeMenu.hide} align="start"
        items={BLOCKS.map((block) => ({ label: block.label, icon: <block.icon />, checked: block.type === currentType, onSelect: () => changeType(block.type) }))}
      />

      <Popover open={linkPop.open} anchor={linkPop.anchor} onClose={linkPop.hide} align="center" className="link-pop" label="Link">
        <label className="input input-search">
          <span className="input-icon"><Icon.link /></span>
          <input
            aria-label="Link address" placeholder="Paste or type a link" value={linkUrl} data-autofocus inputMode="url" autoCapitalize="none"
            onChange={(event) => setLinkUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyLink();
            }}
          />
        </label>
        <div className="quick-row">
          <button type="button" className="quick" disabled={!linkUrl.trim()} onClick={applyLink}>Apply</button>
          {marks.link && (
            <>
              <button type="button" className="quick" onClick={() => window.open(linkUrl, '_blank', 'noopener,noreferrer')}>Open</button>
              <button type="button" className="quick quick-clear" onClick={() => { linkPop.hide(); format('unlink'); }}>Remove link</button>
            </>
          )}
        </div>
      </Popover>

      <Popover open={!!slash && slashItems.length > 0} anchor={slash?.point ?? null} onClose={() => setSlash(null)} passive className="slash-pop" label="Insert block">
        <div className="menu" role="listbox">
          {slashItems.map((block, index) => (
            <button
              key={block.type} type="button" role="option" aria-selected={index === slash?.index} className="menu-item slash-item"
              data-active={index === slash?.index || undefined}
              onPointerDown={keepFocus} onMouseDown={keepFocus}
              onClick={() => actions.current.chooseSlash(block)}
            >
              <span className="slash-icon"><block.icon /></span>
              <span className="menu-label">
                {block.label}
                <small>{block.hint}</small>
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
