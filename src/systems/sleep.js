import { getHoursUntilDawn, getDayTime } from './daynight.js';
import { getRenderer } from '../core/scene.js';
import { setTimeStopped } from './controls.js';
// Runtime-only import cycle (touch.js -> controls.js -> ...), safe per CLAUDE.md
import { releaseTouchDrags } from './touch.js';

let sleepMenuEl = null;
let sliderEl = null;
let active = false;
let onSleepConfirm = null;

export function isSleepMenuActive() {
    return active;
}

export function openSleepMenu(onConfirm) {
    if (!sleepMenuEl) initSleepUI();
    active = true;
    onSleepConfirm = onConfirm;

    setTimeStopped(true); // Freeze world time
    releaseTouchDrags();  // release the long-press finger that opened this menu

    // Unlock pointer to use the UI. Guarded: iOS Safari has no Pointer Lock
    // API, and an unguarded throw HERE freezes world time before the panel is
    // ever shown (display:flex is below) — a soft-lock no touch fix can undo.
    if (document.exitPointerLock) document.exitPointerLock();

    const maxHours = Math.floor(getHoursUntilDawn());
    // Minimum 1 hour, max whatever is left until dawn, cap at 24 just in case
    const maxVal = Math.max(1, Math.min(24, maxHours));

    sliderEl.max = maxVal;
    sliderEl.value = Math.min(8, maxVal); // Default to 8 or max
    updateLabel();

    sleepMenuEl.style.display = 'flex';
}

export function closeSleepMenu() {
    if (!active) return;
    active = false;
    if (sleepMenuEl) sleepMenuEl.style.display = 'none';

    setTimeStopped(false); // Resume world time

    // Re-lock pointer (absent on iOS Safari — see openSleepMenu)
    const el = getRenderer().domElement;
    if (el && el.requestPointerLock) {
        const p = el.requestPointerLock();
        if (p && p.catch) p.catch(() => { });
    }
}

function formatTime(t) {
    let hours = Math.floor(t * 24);
    const mins = Math.floor(((t * 24) - hours) * 60);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${ampm}`;
}

function updateLabel() {
    const lbl = document.getElementById('sleep-amount-lbl');
    const header = document.querySelector('#sleep-panel h3');
    if (lbl && sliderEl && header) {
        const hs = parseInt(sliderEl.value);
        const curr = getDayTime();
        const wake = (curr + (hs / 24)) % 1;

        header.textContent = `Current Time: ${formatTime(curr)}`;
        lbl.textContent = `Sleep for ${hs} hour${hs > 1 ? 's' : ''} (Awake at ${formatTime(wake)})`;
    }
}

function initSleepUI() {
    sleepMenuEl = document.getElementById('sleep-ui');
    sliderEl = document.getElementById('sleep-slider');

    sliderEl.addEventListener('input', updateLabel);

    document.getElementById('sleep-btn-confirm').addEventListener('click', () => {
        const hs = parseInt(sliderEl.value);
        // Capture the callback first and run it in `finally`: closeSleepMenu
        // touches the Pointer Lock API, and a throw there used to swallow the
        // sleep entirely (the menu closed but time never advanced).
        const cb = onSleepConfirm;
        try { closeSleepMenu(); } finally { if (cb) cb(hs); }
    });

    document.getElementById('sleep-btn-cancel').addEventListener('click', closeSleepMenu);
}
