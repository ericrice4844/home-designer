// "Trace a floor plan": upload a plan image, set its scale from a known dimension, check a second one,
// then draw rooms over it (drawing snaps to the plan's wall lines).
import { uid, type Underlay, type Vec2 } from '../model';
import { store } from '../state';
import { storage } from '../storage';
import { calibrate, checkDimension, createUnderlay, fixStretch, rotateUnderlay } from '../underlay';
import { formatLength, parseLength } from '../units';
import { hideBanner, showBanner } from './banner';
import { button, checkbox, h, modal, pickFile, section, slider, toast } from './dom';
import { describeError } from './errors';

const MAX_SIDE = 3000;

function updUnderlay(fn: (u: Underlay) => void) {
  store.update((p) => p.underlay && fn(p.underlay));
}

/** Upload a plan image and start calibration. */
export async function uploadPlan(center: Vec2, capture = false) {
  const file = await pickFile('image/*', capture);
  if (!file) return;
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    toast('That file could not be read as an image. Use a photo, PNG or JPG (save PDF pages as images first).', 5000);
    return;
  }
  // keep a reasonably sized copy (big phone photos are 4000+ px)
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k);
  const hgt = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // transparent PNGs → white paper
  ctx.fillRect(0, 0, w, hgt);
  ctx.drawImage(img, 0, 0, w, hgt);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92));
  const id = uid('plan');
  try {
    await storage.putAsset(id, blob);
  } catch (e) {
    showBanner('asset', `Could not save the floor plan image: ${describeError(e)}.`, [{ label: 'Dismiss', run: () => hideBanner('asset') }]);
    return;
  }
  const u = createUnderlay(id, w, hgt, center);
  store.update((p) => (p.underlay = u));
  store.setUI({ view: store.ui.view === '3d' ? 'split' : store.ui.view, tool: 'calibrate', placing: null });
  toast('Now set the scale: drag along a dimension you know (e.g. an outside wall) from one end to the other.', 5000);
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Ask for a real-world length. Resolves null if cancelled. */
function askLength(title: string, text: string): Promise<number | null> {
  return new Promise((resolve) => {
    const units = store.project.settings.units;
    const input = h('input', { type: 'text', class: 'len big', placeholder: units === 'imperial' ? `e.g. 30' 6"` : 'e.g. 9.3 m', 'aria-label': 'Real length', inputmode: 'text' });
    const err = h('p', { class: 'field-hint' }, units === 'imperial' ? `Feet and inches like 30' 6" or 30ft 6in (a plain number is inches)` : 'Meters like 9.3 m or 930 cm');
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const ok = () => {
      const v = parseLength(input.value, units);
      if (v === null || !(v > 0)) {
        err.textContent = 'Please enter a length, e.g. ' + (units === 'imperial' ? `30' 6"` : '9.3 m');
        err.classList.add('error');
        return;
      }
      finish(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok();
      e.stopPropagation();
    });
    const m = modal(title, h('div', {}, h('p', {}, text), input, err), [button('Cancel', () => finish(null), 'ghost'), button('OK', ok, 'primary')]);
    // closing the dialog any other way counts as cancel
    new MutationObserver((_, obs) => {
      if (!m.el.isConnected) {
        obs.disconnect();
        finish(null);
      }
    }).observe(document.body, { childList: true });
    setTimeout(() => input.focus(), 50);
  });
}

/** The plan editor reports a calibration / check line. */
export async function handleTwoPoints(tool: 'calibrate' | 'check-dim', a: Vec2, b: Vec2) {
  const u = store.project.underlay;
  if (!u) return;
  const units = store.project.settings.units;
  if (tool === 'calibrate') {
    const L = await askLength('Set the scale', 'How long is the line you just drew in real life? (Use the dimension written on the plan.)');
    if (L === null) return;
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    try {
      store.update((p) => p.underlay && calibrate(p.underlay, a, b, L));
    } catch (e) {
      toast((e as Error).message);
      return;
    }
    const m = modal(
      'Scale set',
      h('p', {}, `The plan is now to scale (${formatLength(L, units)}). Checking one more dimension – ideally in the other direction – catches typos and photos taken at an angle.`),
      [
        button('Start tracing', () => (m.close(), store.setUI({ tool: 'room-rect' })), 'ghost'),
        button('Check another dimension', () => (m.close(), store.setUI({ tool: 'check-dim' })), 'primary'),
      ],
    );
    return;
  }
  const L = await askLength('Check a dimension', 'How long is this line according to the plan?');
  if (L === null) return;
  const res = checkDimension(u, a, b, L);
  const pct = Math.abs(res.error * 100);
  if (pct <= 1.5) {
    const m = modal('Plan checks out ✓', h('p', {}, `The plan measures ${formatLength(res.measured, units)} – within ${pct.toFixed(1)}% of ${formatLength(L, units)}. You're ready to trace.`), [
      button('Start tracing', () => (m.close(), store.setUI({ tool: 'room-rect' })), 'primary'),
    ]);
    return;
  }
  const body = h(
    'div',
    {},
    h('p', {}, `The plan measures ${formatLength(res.measured, units)} here, but you entered ${formatLength(L, units)} (${res.error > 0 ? 'long' : 'short'} by ${pct.toFixed(1)}%).`),
    h('p', { class: 'hint' }, res.canFixStretch ? 'This usually means the photo was taken at a slight angle. Stretching the plan can make both dimensions exact.' : 'If you mistyped either dimension, set the scale again. Otherwise rescale using this one.'),
  );
  const m = modal('Dimensions don’t agree', body, [
    button('Keep as is', () => m.close(), 'ghost'),
    button('Rescale from this one', () => {
      m.close();
      store.update((p) => p.underlay && calibrate(p.underlay, a, b, L));
      toast('Scale updated');
    }),
    res.canFixStretch
      ? button('Fix stretch (both exact)', () => {
          m.close();
          store.update((p) => p.underlay && fixStretch(p.underlay, a, b, L));
          toast('Plan stretched so both dimensions match');
        }, 'primary')
      : null,
  ].filter(Boolean) as HTMLElement[]);
}

/** The “Trace a floor plan” section of the Build panel. */
export function traceSection(center: () => Vec2): HTMLElement {
  const u = store.project.underlay;
  const tool = store.ui.tool;
  if (!u) {
    return section(
      'Trace a floor plan',
      h('p', { class: 'hint' }, 'Upload a photo or image of a plan with dimensions, set its scale, then draw the rooms over it.'),
      h('div', { class: 'import-buttons' },
        button('📐 Upload floor plan', () => uploadPlan(center())),
        button('📷 Photograph a plan', () => uploadPlan(center(), true)),
      ),
    );
  }
  const toolBtn = (t: typeof tool, label: string, title: string) => button(label, () => store.setUI({ tool: tool === t ? 'select' : t, placing: null }), `small ${tool === t ? 'primary' : ''}`, title);
  const hint =
    tool === 'calibrate'
      ? 'Drag along a dimension you know, end to end (it snaps to the plan’s walls).'
      : tool === 'check-dim'
        ? 'Drag along a second dimension, ideally in the other direction.'
        : tool === 'move-plan'
          ? 'Drag the plan to line it up with rooms you already drew.'
          : u.calibrated
            ? 'Use Draw room / Draw shape over the plan – corners snap to its walls. Add doors from each wall.'
            : 'Set the scale first.';
  return section(
    'Floor plan',
    h('div', { class: 'stats' }, h('span', {}, u.calibrated ? '✓ to scale' : '⚠ not to scale yet'), u.calibration ? h('span', {}, `from ${formatLength(u.calibration.length, store.project.settings.units)}`) : null, Math.abs(u.scaleX / u.scaleZ - 1) > 0.001 ? h('span', {}, 'stretch corrected') : null),
    h('div', { class: 'row wrap' },
      toolBtn('calibrate', '📏 Set scale', 'Drag along a known dimension'),
      u.calibrated ? toolBtn('check-dim', '✓ Check 2nd dimension', 'Verify the scale with another dimension') : null,
      toolBtn('move-plan', '✥ Move plan', 'Drag the plan'),
      button('⟲', () => updUnderlay((q) => rotateUnderlay(q, -1)), 'small', 'Rotate plan 90° left'),
      button('⟳', () => updUnderlay((q) => rotateUnderlay(q, 1)), 'small', 'Rotate plan 90° right'),
    ),
    h('p', { class: 'hint' }, hint),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Plan visibility'), slider(Math.round(u.opacity * 100), 10, 100, 5, (v) => store.project.underlay && (store.project.underlay.opacity = v / 100), (v) => `${v}%`)),
    checkbox(u.visible, 'Show plan', (v) => updUnderlay((q) => (q.visible = v))),
    checkbox(u.snap, 'Snap drawing to the plan’s walls', (v) => updUnderlay((q) => (q.snap = v))),
    checkbox(u.locked, 'Lock plan position', (v) => updUnderlay((q) => (q.locked = v))),
    h('div', { class: 'row wrap' },
      button('Replace image', () => uploadPlan(center())),
      button('Remove plan', () => {
        if (confirm('Remove the floor plan image? Rooms you traced stay.')) store.update((p) => delete p.underlay);
      }, 'danger'),
    ),
  );
}
