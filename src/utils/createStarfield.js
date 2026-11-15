import Phaser from 'phaser';

const colorValue = (hex) => Number.parseInt(hex.slice(1), 16);

export default function createStarfield(scene, config, options = {}) {
  const layers = config.world.starfield.layers;
  const { width, height } = options.worldSize ?? scene.scale.gameSize;
  const densityScale = options.densityScale ?? 1;
  const expandedWidth = options.worldSize ? width * 2 : width;
  const expandedHeight = options.worldSize ? height * 2 : height;
  const originX = options.worldSize ? -width / 2 : 0;
  const originY = options.worldSize ? -height / 2 : 0;
  const objects = [];

  layers.forEach((layer, layerIndex) => {
    if (!options.worldSize) {
      const graphics = scene.add.graphics();
      const starCount = Math.round(layer.count * densityScale);
      for (let index = 0; index < starCount; index += 1) {
        const radius = Phaser.Math.FloatBetween(layer.minRadius, layer.maxRadius);
        const alpha = Phaser.Math.FloatBetween(layer.minAlpha, layer.maxAlpha);
        graphics.fillStyle(colorValue(config.palette.star), alpha);
        graphics.fillCircle(
          Phaser.Math.Between(0, expandedWidth),
          Phaser.Math.Between(0, expandedHeight),
          radius,
        );
      }
      graphics
        .setPosition(originX, originY)
        .setDepth(-100 + layerIndex)
        .setScrollFactor(layer.scrollFactor);
      objects.push(graphics);
      return;
    }
    const chunks = new Map();
    const chunkSize = 512;
    const starCount = Math.round(layer.count * densityScale);
    for (let index = 0; index < starCount; index += 1) {
      const radius = Phaser.Math.FloatBetween(layer.minRadius, layer.maxRadius);
      const alpha = Phaser.Math.FloatBetween(layer.minAlpha, layer.maxAlpha);
      const x = Phaser.Math.Between(0, expandedWidth);
      const y = Phaser.Math.Between(0, expandedHeight);
      const chunkX = Math.floor(x / chunkSize);
      const chunkY = Math.floor(y / chunkSize);
      const key = `${chunkX},${chunkY}`;
      let graphics = chunks.get(key);
      if (!graphics) {
        const left = originX + chunkX * chunkSize;
        const top = originY + chunkY * chunkSize;
        graphics = scene.add.graphics()
          .setPosition(left, top)
          .setDepth(-100 + layerIndex)
          .setScrollFactor(layer.scrollFactor);
        const willRender = graphics.willRender;
        graphics.willRender = function (camera) {
          if (!willRender.call(this, camera)) return false;
          const viewLeft = camera.worldView.x - camera.scrollX * (1 - layer.scrollFactor);
          const viewTop = camera.worldView.y - camera.scrollY * (1 - layer.scrollFactor);
          return left + chunkSize + 2 >= viewLeft
            && left - 2 <= viewLeft + camera.worldView.width
            && top + chunkSize + 2 >= viewTop
            && top - 2 <= viewTop + camera.worldView.height;
        };
        chunks.set(key, graphics);
        objects.push(graphics);
      }
      graphics.fillStyle(colorValue(config.palette.star), alpha);
      graphics.fillCircle(x - chunkX * chunkSize, y - chunkY * chunkSize, radius);
    }
  });

  const twinkleCount = Math.round(config.world.starfield.twinkleCount * densityScale);
  for (let index = 0; index < twinkleCount; index += 1) {
    const star = scene.add
      .circle(
        Phaser.Math.Between(0, width),
        Phaser.Math.Between(0, height),
        Phaser.Math.FloatBetween(0.7, 1.6),
        colorValue(config.palette.star),
      )
      .setAlpha(Phaser.Math.FloatBetween(
        config.world.starfield.twinkleMinAlpha,
        config.world.starfield.twinkleMaxAlpha,
      ))
      .setDepth(-96)
      .setScrollFactor(1);

    scene.tweens.add({
      targets: star,
      alpha: config.world.starfield.twinkleMinAlpha,
      duration: Phaser.Math.Between(config.animation.starTwinkleMs, config.animation.starTwinkleMs * 2),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
      delay: Phaser.Math.Between(0, config.animation.starTwinkleMs),
    });
    objects.push(star);
  }

  return objects;
}