import { CoreSettings, PowerPref, Quality, saveSettings, resetSettings, isLocked } from '../settings';
import type { Control, Theme } from '../theme';
import type { HudLabels } from './hud';

type Key = keyof CoreSettings;

/** Live perf readout for the System tab, supplied by the app. */
export interface PerfStatus {
  tier: string | null;      // tier in effect (null = custom)
  why: string;              // what auto based its boot guess on
  reloadNeeded: boolean;    // antialias / power preference changed since boot
}

const QUALITIES: Array<[Quality, string]> = [
  ['auto', 'Auto'], ['low', 'Low (Pi / weak GPU)'],
  ['medium', 'Medium'], ['high', 'High (classic)'], ['ultra', 'Ultra'], ['custom', 'Custom'],
];
const FPS_CAPS: Array<[string, string]> = [['0', 'Uncapped'], ['60', '60 fps'], ['30', '30 fps']];
const POWER: Array<[PowerPref, string]> = [
  ['low-power', 'Low power'], ['default', 'Browser default'], ['high-performance', 'High performance'],
];

/** HUD tab order; the names come from the theme's HUD labels. */
const HUD: Array<HudToggle> = ['uplink', 'threatBar', 'telemetry', 'mostWanted', 'terminal',
  'oscilloscope', 'spectrum', 'radar', 'scanlines'];
type HudToggle = keyof HudLabels['panel'];
const EVENT_VOL: Array<[Key, string]> = [
  ['gBlock', 'Block'], ['gAllow', 'Allow'], ['gDns', 'DNS'], ['gWifi', 'WiFi'], ['gDhcp', 'DHCP'],
  ['gThreat', 'Threat'],
];
const GATES: Array<[Key, string]> = [
  ['gateBlock', 'Block'], ['gateAllow', 'Allow'], ['gateDns', 'DNS'],
  ['gateWifi', 'WiFi'], ['gateDhcp', 'DHCP'], ['gateThreat', 'Threat'],
];

/**
 * F1 settings overlay — tabbed (Scene / HUD / Audio / Colour / System).
 * HUD, audio and system controls are core; the Scene tab, scene budgets and
 * colour scheme come from the active theme's declared controls. Mutates the
 * shared settings object in place, persists to localStorage, and calls
 * `onChange` so the app can re-apply.
 */
export class SettingsPanel {
  private root: HTMLElement;
  private visible = false;

  constructor(private settings: CoreSettings,
              private theme: Pick<Theme, 'title' | 'controls'> & { hudToggles: HudLabels['panel'] },
              private defaults: CoreSettings, private perfKeys: string[],
              private onChange: (key?: string) => void,
              private perfStatus: () => PerfStatus) {
    this.root = document.createElement('div');
    this.root.id = 'settings';
    this.root.style.display = 'none';
    this.render('scene');
    document.body.appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest('.set-tab');
      if (tab) this.render(tab.getAttribute('data-tab') || 'scene');
      if ((e.target as HTMLElement).closest('[data-action="reset"]')) {
        resetSettings(this.settings, this.defaults);
        saveSettings(this.settings);
        this.onChange();
        this.render(this.activeTab || 'scene');
      }
      if ((e.target as HTMLElement).closest('[data-action="reload"]')) {
        saveSettings(this.settings);
        location.reload();
      }
    });

    this.root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      const key = el.dataset.key;
      if (!key) return;
      const bag = this.settings as unknown as Record<string, boolean | number | string>;
      if (el.type === 'checkbox') {
        bag[key] = el.checked;
      } else if (el.tagName === 'SELECT') {
        bag[key] = el.dataset.num ? parseFloat(el.value) : el.value;
      } else {
        bag[key] = parseFloat(el.value);
        const span = el.parentElement?.querySelector('.val');
        if (span) span.textContent = el.value;
      }
      // hand-tuning any perf value leaves the preset behind
      const perfTweak = this.perfKeys.includes(key) && this.settings.quality !== 'custom';
      if (perfTweak) this.settings.quality = 'custom';
      saveSettings(this.settings);
      this.onChange(key);
      if (perfTweak || key === 'quality' || key === 'antialias' || key === 'powerPref') {
        this.refresh();
      }
    });
  }

  /** Re-render the open tab (e.g. auto just stepped down a tier). */
  refresh(): void {
    if (this.visible) this.render(this.activeTab);
  }

  private activeTab = 'scene';

  private get bag(): Record<string, boolean | number | string> {
    return this.settings as unknown as Record<string, boolean | number | string>;
  }

  private chk(key: string, label: string): string {
    return `<label class="row"><input type="checkbox" data-key="${key}"
      ${this.bag[key] ? 'checked' : ''}/><span>${label}</span></label>`;
  }
  private rng(key: string, label: string, min: number, max: number, step: number): string {
    return `<label class="row sld"><span class="lbl">${label}${this.pin(key)}</span>
      <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}"
      value="${this.bag[key] as number}"/><span class="val">${this.bag[key]}</span></label>`;
  }
  private sel(key: string, label: string, options: Array<[string, string]>, numeric = false): string {
    const cur = String(this.bag[key]);
    return `<label class="row sld"><span class="lbl">${label}${this.pin(key)}</span>
      <select data-key="${key}"${numeric ? ' data-num="1"' : ''}>${options.map(([v, l]) =>
        `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select></label>`;
  }
  private control(c: Control): string {
    return c.kind === 'toggle' ? this.chk(c.key, c.label)
      : c.kind === 'range' ? this.rng(c.key, c.label, c.min, c.max, c.step)
      : this.sel(c.key, c.label, c.options, c.numeric);
  }
  /** Marks a value pinned by a URL param (applies this load, not saved). */
  private pin(key: string): string {
    return isLocked(key) ? ' <b class="pin" title="Set by URL parameter; not saved">URL</b>' : '';
  }

  private render(tab: string): void {
    this.activeTab = tab;
    const c = this.theme.controls;
    const tabs = [['scene', 'SCENE'], ['hud', 'HUD'], ['audio', 'AUDIO'],
      ['color', 'COLOUR'], ['system', 'SYSTEM']] as const;
    let html = `<div class="set-top"><h2>${this.theme.title}</h2>
      <div class="set-tabs">${tabs.map(([k, l]) =>
        `<button class="set-tab${k === tab ? ' active' : ''}" data-tab="${k}">${l}</button>`
      ).join('')}</div></div><div class="set-body">`;

    if (tab === 'scene') {
      html += `<div class="cols">${this.twoCol(c.scene)}</div>`;
    } else if (tab === 'hud') {
      html += `<div class="cols">${this.twoCol(HUD.map((key) =>
        ({ kind: 'toggle' as const, key, label: this.theme.hudToggles[key] })))}</div>`;
    } else if (tab === 'audio') {
      html += `<div class="cols"><div class="col">
        <p class="grp">Master</p>
        ${this.chk('audio', 'Audio on')}${this.rng('volume', 'Volume', 0, 1, 0.05)}
        <p class="grp">Texture — additive layers</p>
        ${this.chk('melody', 'Melody')}
        ${this.chk('deviceVoices', 'Devices (gated)')}
        ${this.rng('deviceMix', 'Device mix', 0, 1, 0.05)}
        <p class="grp">Event gates — openness (1 = every hit)</p>
        ${GATES.map(([k, l]) => this.rng(k, l, 0, 1, 0.05)).join('')}
        ${this.rng('noiseGate', 'Noise (chaos)', 0, 1, 0.05)}
        </div><div class="col">
        <p class="grp">Event volumes</p>
        ${EVENT_VOL.map(([k, l]) => this.rng(k, l, 0, 1, 0.05)).join('')}
        <p class="grp">Space & balance</p>
        ${this.rng('reverb', 'Reverb', 0, 1, 0.05)}
        ${this.rng('echo', 'Echo', 0, 1, 0.05)}
        ${this.rng('melodyBal', 'Music bed', 0, 1, 0.05)}
        <p class="hint">Gates set how <b>often</b> each event sounds (density);
        volumes set how <b>loud</b>. Noise gate replaces the old Chaos mode —
        it fires a burst per event at that rate (1 = full chaos, 0 = none).</p>
        </div></div>`;
    } else if (tab === 'color') {
      html += `<div class="cols"><div class="col">
        ${c.color.length ? `<p class="grp">${c.colorGroup ?? 'Scheme'}</p>
        ${c.color.map((ctl) => this.control(ctl)).join('')}` : ''}
        <p class="grp">Global tint</p>
        ${this.rng('hueShift', 'Hue shift', 0, 360, 5)}
        ${this.rng('colorSat', 'Intensity', 0, 1, 0.05)}
        </div><div class="col"><p class="grp">Notes</p>
        <p class="hint">${c.colorHint ?? 'Hue shift & intensity sweep the theme and HUD accent.'}</p></div></div>`;
    } else {
      const st = this.perfStatus();
      const running = this.settings.quality === 'auto'
        ? `Auto is running <b>${(st.tier ?? 'custom').toUpperCase()}</b> (${st.why})`
        : this.settings.quality === 'custom' ? 'Running your <b>custom</b> values'
        : `Running the <b>${this.settings.quality.toUpperCase()}</b> preset`;
      html += `<div class="cols"><div class="col">
        <p class="grp">Quality</p>
        ${this.sel('quality', 'Preset', QUALITIES)}
        <p class="hint">${running}</p>
        <p class="grp">Rendering</p>
        ${this.rng('renderScale', 'Render scale', 0.5, 2, 0.05)}
        ${this.sel('fpsCap', 'FPS cap', FPS_CAPS, true)}
        <p class="grp">Budgets</p>
        ${c.budgets.map((ctl) => this.control(ctl)).join('')}
        </div><div class="col">
        <p class="grp">Renderer (reload)</p>
        ${this.chk('antialias', 'Antialias')}
        ${this.sel('powerPref', 'GPU power', POWER)}
        ${st.reloadNeeded
          ? '<button class="set-reload" data-action="reload">Apply &amp; reload</button>'
          : '<p class="hint">Read once at startup.</p>'}
        <p class="grp">Simulation</p>
        ${this.rng('speed', 'Sim speed', 0.25, 2, 0.05)}
        <p class="grp">Danger zone</p>
        <button class="set-reset" data-action="reset">Reset to defaults</button>
        <p class="grp">Notes</p>
        <p class="hint"><b>Auto</b> guesses a tier from the GPU at load and drops
        one tier at a time if frames stay low; it never steps back up. Moving
        any value here switches to <b>Custom</b>. <b>?debug=1</b> shows the
        FPS you actually get. Pin a kiosk with <b>?quality=low</b>
        (also <b>?scale=0.6</b>, <b>?fps=30</b>).</p>
        <p class="grp">Demo</p>
        <p class="hint">Add <b>?demo=1</b> to the URL (or <b>&showreel=1</b>)
        and reload for synthetic traffic. Debug overlay: <b>?debug=1</b>.</p></div></div>`;
    }

    html += `</div><div class="set-foot">F1 to close</div>`;
    this.root.innerHTML = html;
  }

  private twoCol(items: Control[]): string {
    const mid = Math.ceil(items.length / 2);
    return [items.slice(0, mid), items.slice(mid)].map((col) =>
      `<div class="col">${col.map((ctl) => this.control(ctl)).join('')}</div>`
    ).join('');
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }
}
