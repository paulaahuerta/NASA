import Phaser from 'phaser';

const colorValue = (hex) => Number.parseInt(hex.slice(1), 16);

const scaledPoints = (points, scaleX, scaleY) =>
  points.map(([x, y]) => new Phaser.Geom.Point(x * scaleX, y * scaleY));

export default class Spacecraft {
  constructor(scene, data, gameConfig) {
    this.scene = scene;
    this.movement = data.movement;
    this.width = data.appearance.width;
    this.height = data.appearance.height;
    this.halfWidth = this.width / 2;
    this.halfHeight = this.height / 2;
    this.velocity = new Phaser.Math.Vector2();
    this.flameScale = this.movement.flameMinScale;
    this.flameAlpha = 0.16;
    this.palette = gameConfig.palette;

    this.container = scene.add.container(data.spawnPosition.x, data.spawnPosition.y);
    this.flame = this.createFlame(data.appearance.colors);
    this.hull = this.createHull(data.appearance.colors);
    this.container.add([this.flame, this.hull]);
    this.container.setDepth(10);
  }

  createFlame(colors) {
    const scaleX = this.width / 76;
    const scaleY = this.height / 100;
    const flame = this.scene.add.graphics();
    flame.fillStyle(colorValue(this.palette[colors.engine]), 0.92);
    flame.fillPoints(scaledPoints([
      [-10, 31], [-5, 45], [0, 58], [5, 45], [10, 31],
    ], scaleX, scaleY), true);
    flame.fillStyle(colorValue(this.palette[colors.engineHot]), 0.9);
    flame.fillPoints(scaledPoints([
      [-4, 33], [-2, 43], [0, 49], [2, 43], [4, 33],
    ], scaleX, scaleY), true);
    flame.setAlpha(this.flameAlpha);
    return flame;
  }

  createHull(colors) {
    const scaleX = this.width / 76;
    const scaleY = this.height / 100;
    const hull = this.scene.add.graphics();
    const drawPolygon = (points, fill) => {
      const scaled = scaledPoints(points, scaleX, scaleY);
      hull.fillStyle(colorValue(this.palette[fill]));
      hull.fillPoints(scaled, true);
      hull.lineStyle(1.2, colorValue(this.palette[colors.outline]), 0.75);
      hull.strokePoints(scaled, true);
    };

    drawPolygon([[-10, -22], [-37, 8], [-31, 24], [-12, 17]], colors.metal);
    drawPolygon([[10, -22], [37, 8], [31, 24], [12, 17]], colors.metal);
    drawPolygon([[-10, -31], [-15, -8], [-12, 31], [-7, 39], [7, 39], [12, 31], [15, -8], [10, -31], [0, -48]], colors.hull);

    hull.fillStyle(colorValue(this.palette[colors.cabin]), 0.92);
    hull.fillEllipse(0, -17 * scaleY, 9 * scaleX, 16 * scaleY);
    hull.lineStyle(1.2, colorValue(this.palette[colors.outline]), 0.95);
    hull.strokeEllipse(0, -17 * scaleY, 9 * scaleX, 16 * scaleY);

    hull.lineStyle(2, colorValue(this.palette[colors.outline]), 0.9);
    hull.beginPath();
    hull.moveTo(-5 * scaleX, 22 * scaleY);
    hull.lineTo(-5 * scaleX, 31 * scaleY);
    hull.moveTo(5 * scaleX, 22 * scaleY);
    hull.lineTo(5 * scaleX, 31 * scaleY);
    hull.strokePath();

    hull.fillStyle(colorValue(this.palette[colors.outline]), 0.9);
    hull.fillCircle(0, -36 * scaleY, 2.2 * scaleX);
    return hull;
  }

  update(keys, delta, bounds) {
    const frameDelta = Math.min(delta, 100);
    const seconds = frameDelta / 1000;
    const previousVelocityX = this.velocity.x;
    const previousVelocityY = this.velocity.y;
    let directionX = Number(keys.right.isDown) - Number(keys.left.isDown) + (keys.touchX ?? 0);
    let directionY = Number(keys.down.isDown) - Number(keys.up.isDown) + (keys.touchY ?? 0);
    const directionLength = Math.hypot(directionX, directionY);

    if (directionLength > 1) {
      directionX /= directionLength;
      directionY /= directionLength;
    }
    if (directionLength > 0) {
      this.velocity.x += directionX * this.movement.acceleration * seconds;
      this.velocity.y += directionY * this.movement.acceleration * seconds;
    } else {
      this.velocity.scale(this.movement.drag ** (frameDelta / (1000 / 60)));
    }

    let currentSpeed = this.velocity.length();
    if (currentSpeed > this.movement.maxSpeed) {
      this.velocity.scale(this.movement.maxSpeed / currentSpeed);
      currentSpeed = this.movement.maxSpeed;
    }

    this.container.x = Phaser.Math.Clamp(
      this.container.x + (previousVelocityX + this.velocity.x) * 0.5 * seconds,
      bounds.x + this.halfWidth,
      bounds.x + bounds.width - this.halfWidth,
    );
    this.container.y = Phaser.Math.Clamp(
      this.container.y + (previousVelocityY + this.velocity.y) * 0.5 * seconds,
      bounds.y + this.halfHeight,
      bounds.y + bounds.height - this.halfHeight,
    );

    if (currentSpeed > 1) {
      const targetAngle = Math.atan2(this.velocity.y, this.velocity.x) + Math.PI / 2;
      this.container.rotation = Phaser.Math.Angle.RotateTo(
        this.container.rotation,
        targetAngle,
        this.movement.rotationSpeed * seconds,
      );
    }

    const throttle = Phaser.Math.Clamp(currentSpeed / this.movement.maxSpeed, 0, 1);
    const targetFlameScale = Phaser.Math.Linear(
      this.movement.flameMinScale,
      this.movement.flameMaxScale,
      throttle,
    );
    const targetFlameAlpha = Phaser.Math.Linear(0.16, 0.9, throttle);
    const smoothing = 1 - Math.exp(-seconds * 12);
    this.flameScale = Phaser.Math.Linear(this.flameScale, targetFlameScale, smoothing);
    this.flameAlpha = Phaser.Math.Linear(this.flameAlpha, targetFlameAlpha, smoothing);
    this.flame.setScale(1, this.flameScale).setAlpha(this.flameAlpha);
  }

  get x() {
    return this.container.x;
  }

  get y() {
    return this.container.y;
  }
}