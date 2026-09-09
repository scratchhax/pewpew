import { Settings, saveSettings } from '../settings';

const TOGGLES: Array<[keyof Settings, string]> = [
  ['starfield', 'Starfield'],
  ['nebula', 'Nebula clouds'],
  ['dust', 'Space dust'],
  ['constellations', 'IP constellations'],
  ['crystals', 'Allow crystals'],
  ['asteroids', 'Block asteroids'],
  ['ringObjects', 'Ring objects'],
  ['apCores', 'AP cores'],
  ['screenShake', 'Screen shake'],
  ['scanlines', 'HUD: scanlines'],
  ['ambientShips', 'Ambient ships'],
  ['audio', 'Audio: ambience + cues'],
  ['deviceVoices', 'Audio: device voices'],
  ['noiseMode', 'Audio: NOISE MODE (chaos)'],
  ['melodyWithNoise', 'Audio: melody during chaos'],
  ['terminal', 'HUD: comms log'],
  ['oscilloscope', 'HUD: sensor flux'],
  ['spectrum', 'HUD: subspace spectrum'],
  ['radar', 'HUD: scan (radar)'],
  ['telemetry', 'HUD: telemetry'],
  ['mostWanted', 'HUD: most wanted'],
  ['uplink', 'HUD: uplink'],
  ['threatBar', 'HUD: ship status bars'],
  ['eventStars', 'Event stars'],
  ['planets', 'DHCP planets'],
];

/**
 * F1 settings overlay. Mutates the shared settings object in place and
 * persists to localStorage; `onChange` lets the app react (rebuild layers…).
 */
export class SettingsPanel {
  private root: HTMLElement;
  private visible = false;

  constructor(private settings: Settings, private onChange: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'settings';
    this.root.style.display = 'none';

    let html = '<h2>ORBITAL COMMAND — SETTINGS</h2>';
    for (const [key, label] of TOGGLES) {
      html += `<label class="row"><input type="checkbox" data-key="${key}"
        ${this.settings[key] ? 'checked' : ''}/> ${label}</label>`;
    }
    html += '<p class="note">Per-sound volume</p>';
    for (const [key, label] of [['gBlock', 'Block'], ['gAllow', 'Allow'],
                                ['gDns', 'DNS'], ['gWifi', 'WiFi'], ['gDhcp', 'DHCP']] as const) {
      html += `<label class="row">${label} <input type="range" data-key="${key}"
        min="0" max="1" step="0.05" value="${this.settings[key]}"/>
        <span class="val">${this.settings[key]}</span></label>`;
    }
    html += `<label class="row">Device mix <input type="range" data-key="deviceMix"
      min="0" max="1" step="0.05" value="${this.settings.deviceMix}"/>
      <span class="val">${this.settings.deviceMix}</span></label>`;
    html += `<label class="row">Volume <input type="range" data-key="volume"
      min="0" max="1" step="0.05" value="${this.settings.volume}"/>
      <span class="val">${this.settings.volume}</span></label>`;
    html += `<label class="row">Particles <input type="range" data-key="maxParticles"
      min="200" max="4000" step="100" value="${this.settings.maxParticles}"/>
      <span class="val">${this.settings.maxParticles}</span></label>`;
    html += `<label class="row">Speed <input type="range" data-key="speed"
      min="0.25" max="2" step="0.05" value="${this.settings.speed}"/>
      <span class="val">${this.settings.speed}</span></label>`;
    html += '<p class="note">Demo mode: add ?demo=1 to the URL and reload.</p>';
    html += '<p class="note">Close: F1</p>';
    this.root.innerHTML = html;
    document.body.appendChild(this.root);

    this.root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      const key = el.dataset.key as keyof Settings | undefined;
      if (!key) return;
      const bag = this.settings as unknown as Record<string, boolean | number>;
      if (el.type === 'checkbox') {
        bag[key] = el.checked;
      } else {
        bag[key] = parseFloat(el.value);
        const span = el.parentElement?.querySelector('.val');
        if (span) span.textContent = el.value;
      }
      saveSettings(this.settings);
      this.onChange();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }
}
