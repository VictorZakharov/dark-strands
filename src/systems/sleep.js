import { getHoursUntilDawn, getDayTime } from './daynight.js';
import { getRenderer } from '../core/scene.js';
import { setTimeStopped } from './controls.js';

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

    // Unlock pointer to use UI
    document.exitPointerLock();

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

    // Re-lock pointer
    const renderer = getRenderer();
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => { });
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
        closeSleepMenu();
        if (onSleepConfirm) onSleepConfirm(hs);
    });

    document.getElementById('sleep-btn-cancel').addEventListener('click', closeSleepMenu);
}
