// One editor for every surface material: floors, walls, ceilings, cabinets, countertops, furniture.
// Pick a group (wood / tile / stone…), a named material (it brings its own colors and size), then
// fine-tune the pattern, the colors (swatches start from the current color), accents, size and angle.
import { finishFromPreset, finishLabel, GROUPS, patternGroup, PATTERNS, presetsFor, shadesOf, withColor, withPattern, type FinishGroup, type Surface } from '../materials';
import { FINISH_TYPES, type Finish, type FloorType, type Project } from '../model';
import { store } from '../state';
import { finishPreview } from '../three/textures';
import { button, checkbox, colorInput, field, fieldGroup, h, lengthInput, slider } from './dom';
import { importPatternImage } from './importers';

export interface FinishEditorOptions {
  /** stable id of what is being edited, e.g. "floor:room_1", so the open group survives re-renders */
  id: string;
  surface: Surface;
  /** read / write the material inside a project (mutating) */
  get: (p: Project) => Finish | undefined;
  put: (p: Project, f: Finish | undefined) => void;
  /** offer a plain color instead of a material (walls: "Paint", items: "Color"); the plain editor is passed in */
  plain?: { label: string; editor: () => HTMLElement };
  /** allow importing an image as a pattern */
  allowImport?: boolean;
}

const openGroup = new Map<string, FinishGroup | 'plain'>();

function commit(o: FinishEditorOptions, f: Finish | undefined) {
  store.update((p) => o.put(p, f));
}
function live(o: FinishEditorOptions, fn: (f: Finish) => Finish) {
  const cur = o.get(store.project);
  if (cur) o.put(store.project, fn(cur));
}

export function finishEditor(o: FinishEditorOptions): HTMLElement {
  const f = o.get(store.project);
  const group: FinishGroup | 'plain' = openGroup.get(o.id) ?? (f ? patternGroup(f.type) : o.plain ? 'plain' : 'wood');
  const root = h('div', { class: 'finish-editor', 'data-finish': o.id });

  // group chips
  const chips: [FinishGroup | 'plain', string][] = [...(o.plain ? ([['plain', o.plain.label]] as [FinishGroup | 'plain', string][]) : []), ...GROUPS];
  const chipRow = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Material type' });
  for (const [g, label] of chips) {
    const b = button(label, () => {
      openGroup.set(o.id, g);
      if (g === 'plain') {
        if (f) commit(o, undefined);
        else store.setUI({}); // re-render to show the plain editor
        return;
      }
      // re-render so the group's materials show; the surface keeps its look until one is picked
      if (!f && !o.plain) commit(o, finishFromPreset(presetsFor(o.surface, g)[0]));
      else store.setUI({});
    }, `chip ${g === group ? 'active' : ''}`);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(g === group));
    chipRow.append(b);
  }
  root.append(chipRow);

  if (group === 'plain') {
    root.append(o.plain!.editor());
    return root;
  }

  // named materials of the group
  const presets = presetsFor(o.surface, group);
  root.append(
    h(
      'div',
      { class: 'floor-grid material-grid', role: 'radiogroup', 'aria-label': 'Materials' },
      ...presets.map((p) => {
        const on = f?.preset === p.id;
        const b = h(
          'button',
          {
            type: 'button',
            class: `floor-tile ${on ? 'active' : ''}`,
            title: p.name,
            role: 'radio',
            'aria-checked': String(on),
            'data-preset': p.id,
            onclick: () => commit(o, { ...finishFromPreset(p), ...(f?.imageAsset ? { imageAsset: f.imageAsset } : {}) }),
          },
          h('img', { src: finishPreview(finishFromPreset(p)), alt: '' }),
          h('span', {}, p.name),
        );
        return b;
      }),
    ),
  );

  if (!f) {
    root.append(h('p', { class: 'hint' }, 'Pick a material to use it here.'));
    return root;
  }

  // the current material, fine-tuned
  const info = PATTERNS[f.type];
  const patternSel = h('select', { 'aria-label': 'Pattern' });
  for (const [g, gl] of GROUPS) {
    const og = h('optgroup', { label: gl });
    for (const t of FINISH_TYPES) {
      if (PATTERNS[t].group !== g || (t === 'custom' && !f.imageAsset)) continue;
      og.append(h('option', { value: t, selected: t === f.type }, PATTERNS[t].label));
    }
    patternSel.append(og);
  }
  patternSel.addEventListener('change', () => {
    const t = patternSel.value as FloorType;
    openGroup.set(o.id, patternGroup(t));
    commit(o, withPattern(f, t));
  });

  const accentsOn = f.accents !== false;
  root.append(
    h('div', { class: 'finish-current' },
      h('img', { src: finishPreview(f, 96), alt: '', class: 'finish-swatch' }),
      h('div', { class: 'finish-current-text' }, h('b', {}, finishLabel(f)), h('span', { class: 'hint' }, f.preset ? 'Its own colors – change them below' : 'Custom mix')),
    ),
    field('Pattern', patternSel),
    h('div', { class: 'grid2' },
      field('Color', colorInput(f.color, (c) => live(o, (x) => withColor(x, 'color', c)), shadesOf(f.color, f.accent))),
      accentsOn ? field(info.accentLabel, colorInput(f.accent, (c) => live(o, (x) => withColor(x, 'accent', c)), shadesOf(f.accent, f.color))) : h('span'),
    ),
    checkbox(accentsOn, `Show ${info.accentLabel.toLowerCase()}`, (v) => commit(o, v ? (({ accents, ...rest }) => (void accents, rest))(f) : { ...f, accents: false })),
    h('div', { class: 'grid2' },
      field(info.sizeLabel, lengthInput(f.scale, (v) => commit(o, { ...f, scale: v }), { min: 0.005, max: 10 })),
      field('Rotation', slider(Math.round((f.rotation * 180) / Math.PI), 0, 180, 15, (v) => live(o, (x) => ({ ...x, rotation: (v * Math.PI) / 180 })), (v) => `${v}°`)),
    ),
  );
  if (o.allowImport)
    root.append(
      button('🖼️ Import pattern / photo', async () => {
        const id = await importPatternImage();
        if (id) commit(o, { ...f, type: 'custom', imageAsset: id, scale: f.type === 'custom' ? f.scale : 1, preset: undefined });
      }),
    );
  return root;
}

/** Compact group label for a material, e.g. in lists. */
export function finishSummary(f: Finish | undefined, plain: string): string {
  return f ? finishLabel(f) : plain;
}

export { fieldGroup };
