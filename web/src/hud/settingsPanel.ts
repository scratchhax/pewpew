import { Settings, MeshMode, saveSettings, resetSettings } from '../settings';

type Key = keyof Settings;

const SCENE: Array<[Key, string]> = [
  ['starfield', 'Starfield'], ['nebula', 'Nebula clouds'], ['dust', 'Space dust'],
  ['ambientShips', 'Ambient ships'], ['planets', 'DHCP planets'], ['eventStars', 'Event stars'],
  ['asteroids', 'Block asteroids'], ['crystals', 'Allow crystals'],
  ['constellations', 'IP constellations'], ['ringObjects', 'Ring objects'],
  ['apCores', 'AP cores'], ['screenShake', 'Screen shake'],
];
const HUD: Array<[Key, string]> = [
  ['uplink', 'Uplink'], ['threatBar', 'Ship status bars'], ['telemetry', 'Telemetry'],
  ['mostWanted', 'Most wanted'], ['terminal', 'Comms log'], ['oscilloscope', 'Sensor flux'],
  ['spectrum', 'Subspace spectrum'], ['radar', 'Scan (radar)'], ['scanlines', 'Scanlines'],
];
const EVENT_VOL: Array<[Key, string]> = [
  ['gBlock', 'Block'], ['gAllow', 'Allow'], ['gDns', 'DNS'], ['gWifi', 'WiFi'], ['gDhcp', 'DHCP'],
];
const MESH_MODES: Array<[MeshMode, string]> = [
  ['spectrum', 'Spectrum (rainbow web)'], ['law', 'Event-law (all allow-green)'],
  ['mono', 'Mono (cyan)'], ['warm', 'Warm'], ['cool', 'Cool'],
];

/**
 * F1 settings overlay — tabbed (Scene / HUD / Audio / Colour / System).
 * Mutates the shared settings object in place, persists to localStorage,
 * and calls `onChange` so the app can re-apply.
 */
export class SettingsPanel {
  private root: HTMLElement;
  private visible = false;

  constructor(private settings: Settings, private onChange: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'settings';
    this.root.style.display = 'none';
    this.render('scene');
    document.body.appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest('.set-tab');
      if (tab) this.render(tab.getAttribute('data-tab') || 'scene');
      if ((e.target as HTMLElement).closest('[data-action="reset"]')) {
        resetSettings(this.settings);
        saveSettings(this.settings);
        this.onChange();
        this.render(this.activeTab || 'scene');
      }
    });

    this.root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      const key = el.dataset.key as Key | undefined;
      if (!key) return;
      const bag = this.settings as unknown as Record<string, boolean | number | string>;
      if (el.type === 'checkbox') {
        bag[key] = el.checked;
      } else if (el.tagName === 'SELECT') {
        bag[key] = el.value;
      } else {
        bag[key] = parseFloat(el.value);
        const span = el.parentElement?.querySelector('.val');
        if (span) span.textContent = el.value;
      }
      saveSettings(this.settings);
      this.onChange();
    });
  }

  private activeTab = 'scene';

  private chk(key: Key, label: string): string {
    return `<label class="row"><input type="checkbox" data-key="${key}"
      ${this.settings[key] ? 'checked' : ''}/><span>${label}</span></label>`;
  }
  private rng(key: Key, label: string, min: number, max: number, step: number): string {
    return `<label class="row sld"><span class="lbl">${label}</span>
      <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}"
      value="${this.settings[key] as number}"/><span class="val">${this.settings[key]}</span></label>`;
  }

  private render(tab: string): void {
    this.activeTab = tab;
    const tabs = [['scene', 'SCENE'], ['hud', 'HUD'], ['audio', 'AUDIO'],
      ['color', 'COLOUR'], ['system', 'SYSTEM']] as const;
    let html = `<div class="set-top"><h2>ORBITAL COMMAND</h2>
      <div class="set-tabs">${tabs.map(([k, l]) =>
        `<button class="set-tab${k === tab ? ' active' : ''}" data-tab="${k}">${l}</button>`
      ).join('')}</div></div><div class="set-body">`;

    if (tab === 'scene') {
      html += `<div class="cols">${this.twoCol(SCENE)}</div>`;
    } else if (tab === 'hud') {
      html += `<div class="cols">${this.twoCol(HUD)}</div>`;
    } else if (tab === 'audio') {
      html += `<div class="cols"><div class="col">
        <p class="grp">Master</p>
        ${this.chk('audio', 'Audio on')}${this.rng('volume', 'Volume', 0, 1, 0.05)}
        <p class="grp">Texture — additive layers</p>
        ${this.chk('melody', 'Melody')}
        ${this.chk('deviceVoices', 'Devices (gated)')}
        ${this.chk('noiseMode', 'Chaos (ungated)')}
        ${this.rng('deviceMix', 'Device mix', 0, 1, 0.05)}
        </div><div class="col">
        <p class="grp">Event volumes</p>
        ${EVENT_VOL.map(([k, l]) => this.rng(k, l, 0, 1, 0.05)).join('')}
        <p class="grp">Space & balance</p>
        ${this.rng('reverb', 'Reverb', 0, 1, 0.05)}
        ${this.rng('echo', 'Echo', 0, 1, 0.05)}
        ${this.rng('melodyBal', 'Music bed', 0, 1, 0.05)}
        </div></div>`;
    } else if (tab === 'color') {
      html += `<div class="cols"><div class="col">
        <p class="grp">Host-mesh palette</p>
        <label class="row sld"><span class="lbl">Scheme</span>
        <select data-key="meshMode">${MESH_MODES.map(([v, l]) =>
          `<option value="${v}"${this.settings.meshMode === v ? ' selected' : ''}>${l}</option>`
        ).join('')}</select></label>
        <p class="grp">Global tint</p>
        ${this.rng('hueShift', 'Hue shift', 0, 360, 5)}
        ${this.rng('colorSat', 'Intensity', 0, 1, 0.05)}
        </div><div class="col"><p class="grp">Notes</p>
        <p class="hint">Hue shift & intensity sweep the mesh, nebula and HUD
        accent. Event colours (block/allow/dns/dhcp/wifi) and the terminal
        legend stay fixed so the colour law holds — pick the
        <b>Event-law</b> scheme to force the web green.</p></div></div>`;
    } else {
      html += `<div class="cols"><div class="col">
        <p class="grp">Performance</p>
        ${this.rng('maxParticles', 'Particles', 200, 4000, 100)}
        ${this.rng('speed', 'Sim speed', 0.25, 2, 0.05)}
        <p class="grp">Danger zone</p>
        <button class="set-reset" data-action="reset">Reset to defaults</button>
        </div><div class="col"><p class="grp">Demo</p>
        <p class="hint">Add <b>?demo=1</b> to the URL (or <b>&showreel=1</b>)
        and reload for synthetic traffic. Debug overlay: <b>?debug=1</b>.</p></div></div>`;
    }

    html += `</div><div class="set-foot">F1 to close</div>`;
    this.root.innerHTML = html;
  }

  private twoCol(items: Array<[Key, string]>): string {
    const mid = Math.ceil(items.length / 2);
    return [items.slice(0, mid), items.slice(mid)].map((col) =>
      `<div class="col">${col.map(([k, l]) => this.chk(k, l)).join('')}</div>`
    ).join('');
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }
}
