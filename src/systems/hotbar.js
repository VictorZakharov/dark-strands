let selectedSlot = 0;
let placementMode = false;

// Slot-to-item mapping — starts empty, items assigned on pickup
const slotItems = [null, null, null, null, null];

// Item metadata for rendering and inventory mapping
export const ITEM_META = {
  flower: { invKey: 'flowers', icon: '\uD83C\uDF38' },
  stone:  { invKey: 'stones',  icon: '\u25C6' },
  torch:  { invKey: 'torches', icon: '\uD83D\uDD25' },
};

export function getSelectedSlot() { return selectedSlot; }
export function getSlotItem(idx) { return slotItems[idx]; }

export function isPlacementMode() { return placementMode; }
export function setPlacementMode(v) { placementMode = v; }

export function selectSlot(idx) {
  if (idx < 0 || idx > 4) return;
  if (idx === selectedSlot && placementMode) {
    // Toggle off if pressing same slot while in placement mode
    placementMode = false;
  } else if (idx === selectedSlot && (slotItems[idx] === 'flower' || slotItems[idx] === 'torch')) {
    // Pressing same flower/torch slot enters placement/equip mode
    placementMode = true;
  } else {
    // Switching slots always clears placement mode
    selectedSlot = idx;
    placementMode = false;
  }
  updateSlotHighlight();
}

/**
 * Assign an item type to a slot on pickup.
 * If item already has a slot, returns true (just add to count).
 * Otherwise places in active slot, or next empty slot wrapping around.
 */
export function addItemToSlot(itemType) {
  // Already in a slot? Done.
  if (slotItems.includes(itemType)) return true;

  // Try active slot first
  if (!slotItems[selectedSlot]) {
    slotItems[selectedSlot] = itemType;
    return true;
  }

  // Find next empty slot wrapping from active
  for (let i = 1; i <= 5; i++) {
    const idx = (selectedSlot + i) % 5;
    if (!slotItems[idx]) {
      slotItems[idx] = itemType;
      return true;
    }
  }

  return false; // all slots full
}

/**
 * Clear a slot when its item count reaches 0.
 */
export function clearItemSlot(itemType) {
  const idx = slotItems.indexOf(itemType);
  if (idx >= 0) slotItems[idx] = null;
}

// ALT mode for drag-and-drop
let altMode = false;
let dragSource = -1;

export function isAltMode() { return altMode; }

export function enterAltMode() {
  altMode = true;
  const hotbar = document.getElementById('hotbar');
  if (hotbar) hotbar.style.pointerEvents = 'auto';
}

export function exitAltMode() {
  altMode = false;
  cancelDrag();
  const hotbar = document.getElementById('hotbar');
  if (hotbar) hotbar.style.pointerEvents = 'none';
}

function cancelDrag() {
  dragSource = -1;
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

  // Drag-and-drop handlers on hotbar slots
  const slots = document.querySelectorAll('.hotbar-slot');
  slots.forEach((el, i) => {
    el.addEventListener('mousedown', (e) => {
      if (!altMode) return;
      if (!slotItems[i]) return; // can't drag empty slot
      dragSource = i;
      el.classList.add('dragging');
      e.preventDefault();
    });

    el.addEventListener('mouseup', () => {
      if (!altMode || dragSource < 0) return;
      if (i !== dragSource) {
        // Swap slot items
        [slotItems[i], slotItems[dragSource]] = [slotItems[dragSource], slotItems[i]];
      }
      cancelDrag();
    });

    el.addEventListener('mouseenter', () => {
      if (altMode && dragSource >= 0 && i !== dragSource) {
        el.classList.add('drag-target');
      }
    });

    el.addEventListener('mouseleave', () => {
      el.classList.remove('drag-target');
    });
  });

  // Cancel drag if mouse released outside any slot
  document.addEventListener('mouseup', () => {
    if (altMode && dragSource >= 0) cancelDrag();
  });
}
