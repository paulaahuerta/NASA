import Phaser from 'phaser';
import gameConfig from './data/game-config.json';
import ExplorationScene from './scenes/ExplorationScene.js';
import SpaceScene from './scenes/SpaceScene.js';
import ConclusionScene from './scenes/ConclusionScene.js';
import { getSavedLanguage } from './utils/localization.js';
import './style.css';

document.documentElement.style.setProperty('--space-background', gameConfig.palette.background);

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: gameConfig.palette.background,
  input: { activePointers: window.matchMedia('(pointer: coarse)').matches ? 3 : 1 },
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: gameConfig.resolution.width,
    height: gameConfig.resolution.height,
  },
  scene: [SpaceScene, ExplorationScene, ConclusionScene],
};

const game = new Phaser.Game(config);
const touchScreen = window.matchMedia('(pointer: coarse)');
const portrait = window.matchMedia('(orientation: portrait)');
const notice = document.getElementById('orientation-notice');
let pausedForOrientation = false;

function resizeTouchGame() {
  if (!touchScreen.matches || !game.isBooted || !game.canvas) return;
  const bounds = document.getElementById('game').getBoundingClientRect();
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (width > 0 && height > 0 && (game.scale.gameSize.width !== width || game.scale.gameSize.height !== height)) {
    game.scale.resize(width, height);
  }
}

const resizeObserver = new ResizeObserver(resizeTouchGame);
resizeObserver.observe(document.getElementById('game'));
game.events.once(Phaser.Core.Events.READY, resizeTouchGame);
game.events.once(Phaser.Core.Events.DESTROY, () => resizeObserver.disconnect());

function updateOrientation() {
  const blocked = touchScreen.matches && portrait.matches;
  const english = getSavedLanguage() === 'en';
  document.getElementById('orientation-title').textContent = english
    ? 'Rotate your device to explore the universe' : 'Gira tu dispositivo para explorar el universo';
  document.getElementById('orientation-description').textContent = english
    ? 'This game is designed to be played in landscape orientation'
    : 'Este juego está diseñado para utilizarse en posición horizontal';
  notice.hidden = !blocked;
  if (blocked && !game.isPaused) {
    game.pause();
    pausedForOrientation = true;
  } else if (!blocked && pausedForOrientation) {
    pausedForOrientation = false;
    game.resume();
  }
  resizeTouchGame();
}

touchScreen.addEventListener('change', updateOrientation);
portrait.addEventListener('change', updateOrientation);
updateOrientation();