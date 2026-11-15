import Phaser from 'phaser';

const colorValue = (hex) => Number.parseInt(hex.slice(1), 16);

export default function createActionButton(scene, options) {
  const { width, height, text, palette, visual, onPress } = options;
  const container = scene.add.container(0, 0);
  const background = scene.add
    .rectangle(0, 0, width, height, colorValue(palette.buttonFill), 0.88)
    .setStrokeStyle(1, colorValue(palette.electric), 0.8);
  const label = scene.add
    .text(0, 0, text, {
      fontFamily: visual.monoFontFamily,
      fontSize: `${visual.buttonFontSize}px`,
      fontStyle: 'bold',
      color: palette.text,
      align: 'center',
      letterSpacing: 2,
    })
    .setOrigin(0.5);

  container.add([background, label]);
  container.setSize(width, height);

  const createHitArea = (buttonWidth, buttonHeight) =>
    new Phaser.Geom.Rectangle(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight);
  
  container.setInteractive(createHitArea(width, height), Phaser.Geom.Rectangle.Contains);
  let enabled = true;
  const pressedPointers = new Set();

  container.on('pointerover', () => {
    if (!enabled) return;
    scene.tweens.killTweensOf(container);
    scene.tweens.add({
      targets: container,
      scale: visual.hoverScale,
      duration: visual.hoverMs,
      ease: 'Sine.Out',
    });
    background.setFillStyle(colorValue(palette.buttonHover), 1);
  });
  container.on('pointerout', () => {
    if (!enabled) return;
    scene.tweens.killTweensOf(container);
    scene.tweens.add({
      targets: container,
      scale: 1,
      duration: visual.hoverMs,
      ease: 'Sine.Out',
    });
    background.setFillStyle(colorValue(palette.buttonFill), 0.88);
  });
  container.on('pointerdown', (pointer) => {
    if (enabled) pressedPointers.add(pointer.id);
  });
  container.on('pointerup', (pointer) => {
    if (enabled && pressedPointers.delete(pointer.id)) onPress();
  });
  container.on('pointerupoutside', (pointer) => {
    pressedPointers.delete(pointer.id);
  });

  return {
    container,
    label,
    setSize(nextWidth, nextHeight) {
      background.setSize(nextWidth, nextHeight);
      container.setSize(nextWidth, nextHeight);
      container.setInteractive(createHitArea(nextWidth, nextHeight), Phaser.Geom.Rectangle.Contains);
    },
    setEnabled(value) {
      enabled = value;
      if (enabled) {
        container.setInteractive(createHitArea(container.width, container.height), Phaser.Geom.Rectangle.Contains);
        container.setAlpha(1);
      } else {
        pressedPointers.clear();
        container.disableInteractive();
        container.setAlpha(0.58);
      }
    },
  };
}