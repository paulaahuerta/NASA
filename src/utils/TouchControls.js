import { translate } from './localization.js';

export default class TouchControls {
  constructor(scene) {
    this.scene = scene;
    this.x = 0;
    this.y = 0;
    this.pointerId = null;
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.setAttribute('aria-label', translate(scene.language, 'exploration.touch.controls'));

    this.pad = document.createElement('div');
    this.pad.className = 'touch-joystick';
    this.pad.setAttribute('role', 'group');
    this.pad.setAttribute('aria-label', translate(scene.language, 'exploration.touch.move'));
    this.knob = document.createElement('div');
    this.knob.className = 'touch-joystick-knob';
    this.pad.append(this.knob);
    this.root.append(this.pad);

    const actions = document.createElement('div');
    actions.className = 'touch-actions';
    this.buttons = {};
    ['e', 'f', 'q'].forEach((key) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'touch-action';
      button.dataset.action = key;
      const letter = document.createElement('span');
      letter.className = 'touch-action-key';
      letter.textContent = key.toUpperCase();
      const label = document.createElement('span');
      label.className = 'touch-action-label';
      button.append(letter, label);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        scene.handleInteractionKey({ key, repeat: false });
      });
      this.buttons[key] = { button, label };
      actions.append(button);
    });
    this.root.append(actions);
    scene.game.canvas.parentElement.append(this.root);

    this.pad.addEventListener('pointerdown', (event) => {
      if (this.pointerId !== null) return;
      event.preventDefault();
      event.stopPropagation();
      this.pointerId = event.pointerId;
      this.pad.setPointerCapture(event.pointerId);
      this.move(event);
    });
    this.pad.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.pointerId) this.move(event);
    });
    const release = (event) => {
      if (event.pointerId === this.pointerId) this.reset();
    };
    this.pad.addEventListener('pointerup', release);
    this.pad.addEventListener('pointercancel', release);
    this.pad.addEventListener('lostpointercapture', release);
    this.resetOnChange = () => this.reset();
    window.addEventListener('blur', this.resetOnChange);
    window.addEventListener('orientationchange', this.resetOnChange);
    document.addEventListener('visibilitychange', this.resetOnChange);
    this.updateState();
  }

  move(event) {
    event.preventDefault();
    const bounds = this.pad.getBoundingClientRect();
    const radius = bounds.width * 0.34;
    let x = (event.clientX - bounds.left - bounds.width / 2) / radius;
    let y = (event.clientY - bounds.top - bounds.height / 2) / radius;
    const distance = Math.hypot(x, y);
    if (distance > 1) {
      x /= distance;
      y /= distance;
    }
    this.x = distance < 0.08 ? 0 : x;
    this.y = distance < 0.08 ? 0 : y;
    this.knob.style.transform = `translate(${this.x * radius}px, ${this.y * radius}px)`;
  }

  reset() {
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  updateState() {
    const surface = Boolean(this.scene.surfaceModeBodyId);
    const flashlight = Boolean(this.scene.flashlightEnabled);
    const state = `${surface}:${flashlight}`;
    if (this.state === state) return;
    this.state = state;
    const labels = {
      e: 'exploration.touch.info',
      f: 'exploration.touch.light',
      q: surface ? 'exploration.touch.return' : 'exploration.touch.surface',
    };
    Object.entries(labels).forEach(([key, path]) => {
      const text = translate(this.scene.language, path);
      this.buttons[key].label.textContent = text;
      this.buttons[key].button.setAttribute('aria-label', text);
    });
    this.buttons.f.button.setAttribute('aria-pressed', String(flashlight));
  }

  setVisible(visible) {
    this.root.hidden = !visible;
    if (!visible) this.reset();
  }

  destroy() {
    this.reset();
    window.removeEventListener('blur', this.resetOnChange);
    window.removeEventListener('orientationchange', this.resetOnChange);
    document.removeEventListener('visibilitychange', this.resetOnChange);
    this.root.remove();
  }
}