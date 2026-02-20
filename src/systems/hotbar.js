let selectedSlot = 0;
let placementMode = false;

// Slot-to-item mapping — starts empty, items assigned on pickup
const slotItems = [null, null, null, null, null];

// Item metadata for rendering and inventory mapping
export const ITEM_META = {
  flower: { invKey: 'flowers', icon: '\uD83C\uDF38' },
  stone:  { invKey: 'stones',  icon: 'svg:rock' },
  torch:  { invKey: 'torches', icon: '\uD83D\uDD25' },
};

export function getSelectedSlot() { return selectedSlot; }
export function getSlotItem(idx) { return slotItems[idx]; }

export function isPlacementMode() { return placementMode; }
export function setPlacementMode(v) { placementMode = v; }

export function selectSlot(idx) {
  if (idx < 0 || idx > 4) return;
  if (idx === selectedSlot && placementMode) {
    placementMode = false;
  } else if (idx === selectedSlot && (slotItems[idx] === 'flower' || slotItems[idx] === 'torch' || slotItems[idx] === 'stone')) {
    placementMode = true;
  } else {
    selectedSlot = idx;
    placementMode = false;
  }
  updateSlotHighlight();
}

export function addItemToSlot(itemType) {
  if (slotItems.includes(itemType)) return true;
  if (!slotItems[selectedSlot]) {
    slotItems[selectedSlot] = itemType;
    return true;
  }
  for (let i = 1; i <= 5; i++) {
    const idx = (selectedSlot + i) % 5;
    if (!slotItems[idx]) {
      slotItems[idx] = itemType;
      return true;
    }
  }
  return false;
}

export function clearItemSlot(itemType) {
  const idx = slotItems.indexOf(itemType);
  if (idx >= 0) slotItems[idx] = null;
}

// SVG icons for drag placeholder (larger, semi-transparent)
const DRAG_SVG = {
  rock: '<svg viewBox="0 0 24 24" width="36" height="36"><polygon points="5,18 2,12 4,7 9,4 15,3 20,6 22,12 19,18 14,20 8,20" fill="#8a7a60" stroke="#5c4e3a" stroke-width="1" opacity="0.85"/><polygon points="7,16 5,11 8,7 13,6 17,8 18,13 15,17 10,17" fill="#a08c6e" opacity="0.85"/><line x1="9" y1="7" x2="14" y2="16" stroke="#6e5e46" stroke-width="0.5"/><line x1="5" y1="12" x2="17" y2="9" stroke="#6e5e46" stroke-width="0.5"/></svg>',
};

// --- ALT mode: virtual cursor (pointer lock stays active) ---
let altMode = false;
let cursorX = 0, cursorY = 0;
let cursorEl = null;
let dragSource = -1;
let dragPlaceholder = null;
let lastHoverSlot = -1;

export function isAltMode() { return altMode; }

export function enterAltMode() {
  altMode = true;
  cursorX = window.innerWidth / 2;
  cursorY = window.innerHeight / 2;
  if (!cursorEl) {
    cursorEl = document.createElement('div');
    cursorEl.id = 'alt-cursor';
    document.body.appendChild(cursorEl);
  }
  cursorEl.style.left = cursorX + 'px';
  cursorEl.style.top = cursorY + 'px';
  cursorEl.style.display = 'block';
  const hotbar = document.getElementById('hotbar');
  if (hotbar) hotbar.classList.add('alt-active');
}

export function exitAltMode() {
  altMode = false;
  cancelDrag();
  if (cursorEl) cursorEl.style.display = 'none';
  const hotbar = document.getElementById('hotbar');
  if (hotbar) hotbar.classList.remove('alt-active');
  // Clear hover state
  if (lastHoverSlot >= 0) {
    const slots = document.querySelectorAll('.hotbar-slot');
    if (slots[lastHoverSlot]) slots[lastHoverSlot].classList.remove('drag-target');
    lastHoverSlot = -1;
  }
}

/** Called from controls.js mousemove — moves virtual cursor */
export function moveCursor(dx, dy) {
  cursorX = Math.max(0, Math.min(window.innerWidth, cursorX + dx));
  cursorY = Math.max(0, Math.min(window.innerHeight, cursorY + dy));
  if (cursorEl) {
    cursorEl.style.left = cursorX + 'px';
    cursorEl.style.top = cursorY + 'px';
  }
  // Update drag placeholder position
  if (dragSource >= 0 && dragPlaceholder) {
    dragPlaceholder.style.left = cursorX + 'px';
    dragPlaceholder.style.top = cursorY + 'px';
  }
  // Update hover highlights
  updateHover();
}

/** Called from controls.js mousedown — virtual click */
export function cursorDown() {
  const slotIdx = getSlotUnderCursor();
  if (slotIdx < 0) return;
  if (!slotItems[slotIdx]) return;
  dragSource = slotIdx;
  const slots = document.querySelectorAll('.hotbar-slot');
  if (slots[slotIdx]) slots[slotIdx].classList.add('dragging');
  showDragPlaceholder(slotItems[slotIdx], cursorX, cursorY);
  if (cursorEl) cursorEl.style.display = 'none';
}

/** Called from controls.js mouseup — virtual release */
export function cursorUp() {
  if (dragSource < 0) return;
  const slotIdx = getSlotUnderCursor();
  if (slotIdx >= 0 && slotIdx !== dragSource) {
    [slotItems[slotIdx], slotItems[dragSource]] = [slotItems[dragSource], slotItems[slotIdx]];
  }
  cancelDrag();
}

function getSlotUnderCursor() {
  const slots = document.querySelectorAll('.hotbar-slot');
  for (let i = 0; i < slots.length; i++) {
    const r = slots[i].getBoundingClientRect();
    if (cursorX >= r.left && cursorX <= r.right && cursorY >= r.top && cursorY <= r.bottom) {
      return i;
    }
  }
  return -1;
}

function updateHover() {
  const slots = document.querySelectorAll('.hotbar-slot');
  const idx = getSlotUnderCursor();
  if (lastHoverSlot >= 0 && lastHoverSlot !== idx && slots[lastHoverSlot]) {
    slots[lastHoverSlot].classList.remove('drag-target');
  }
  if (idx >= 0 && dragSource >= 0 && idx !== dragSource && slots[idx]) {
    slots[idx].classList.add('drag-target');
  }
  lastHoverSlot = idx;
}

function showDragPlaceholder(itemType, x, y) {
  if (!dragPlaceholder) {
    dragPlaceholder = document.createElement('div');
    dragPlaceholder.id = 'drag-placeholder';
    document.body.appendChild(dragPlaceholder);
  }
  const meta = ITEM_META[itemType];
  const icon = meta ? meta.icon : '?';
  if (icon.startsWith('svg:')) {
    dragPlaceholder.innerHTML = DRAG_SVG[icon.slice(4)] || '?';
  } else {
    dragPlaceholder.textContent = icon;
  }
  dragPlaceholder.style.left = x + 'px';
  dragPlaceholder.style.top = y + 'px';
  dragPlaceholder.style.display = 'block';
}

function hideDragPlaceholder() {
  if (dragPlaceholder) dragPlaceholder.style.display = 'none';
}

function cancelDrag() {
  dragSource = -1;
  hideDragPlaceholder();
  if (cursorEl && altMode) cursorEl.style.display = 'block';
  document.querySelectorAll('.hotbar-slot').forEach(s => {
    s.classList.remove('dragging', 'drag-target');
  });
}

function updateSlotHighlight() {
  const slots = document.querySelectorAll('.hotbar-slot');
  slots.forEach((el, i) => {
    el.classList.toggle('selected', i === selectedSlot);
  });
}

export function initHotbar() {
  updateSlotHighlight();
}
