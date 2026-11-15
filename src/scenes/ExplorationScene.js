import Phaser from 'phaser';
import assetsManifest from '../data/assets.json';
import assetsUrl from '../data/assets.json?url&no-inline';
import gameConfig from '../data/game-config.json';
import equipmentUrl from '../data/equipment.json?url&no-inline';
import moonsUrl from '../data/moons.json?url&no-inline';
import planetsUrl from '../data/planets.json?url&no-inline';
import sunUrl from '../data/sun.json?url&no-inline';
import spacecraftUrl from '../data/spacecraft.json?url&no-inline';
import moonsManifest from '../data/moons.json';
import planetsManifest from '../data/planets.json';
import sunManifest from '../data/sun.json';
import CelestialBody from '../objects/CelestialBody.js';
import SpaceEquipment from '../objects/SpaceEquipment.js';
import Spacecraft from '../objects/Spacecraft.js';
import createStarfield from '../utils/createStarfield.js';
import createActionButton from '../utils/createActionButton.js';
import { getAmbientMusic } from '../utils/AmbientMusic.js';
import TouchControls from '../utils/TouchControls.js';
import { getSavedLanguage, localizedAssetCaption, localizedField, translate } from '../utils/localization.js';

const SURFACE_MAP_WIDTH = 4800;
const SURFACE_MAP_HEIGHT = 1600;
const SURFACE_VIEW_ZOOM = 0.64;
const SURFACE_SPACECRAFT_SCALE = 0.55;
const SURFACE_GROUND_PROFILE = [
  [0, 0.76],
  [0.08, 0.72],
  [0.18, 0.75],
  [0.29, 0.7],
  [0.42, 0.74],
  [0.52, 0.69],
  [0.63, 0.74],
  [0.75, 0.71],
  [0.88, 0.75],
  [1, 0.72],
];
const LEGACY_PROGRESS_KEY = 'spaceLegacyRememberedMissions';
const TIMELINE_START_YEAR = 1969;
const TIMELINE_END_YEAR = 2026;

export default class ExplorationScene extends Phaser.Scene {
  constructor() {
    super('ExplorationScene');
  }

  preload() {
    const { width, height } = this.scale.gameSize;
    const loadingText = this.add.text(width / 2, height / 2, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: '18px',
      color: gameConfig.palette.text,
    }).setOrigin(0.5);
    const loadingLabel = getSavedLanguage() === 'en' ? 'Loading' : 'Cargando';
    const updateLoadingText = (progress) => {
      loadingText.setText(`${loadingLabel} ${Math.round(progress * 100)}%`);
    };
    updateLoadingText(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, updateLoadingText);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, updateLoadingText);
      loadingText.destroy();
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file) => {
      console.error(`[ExplorationScene] No se pudo cargar ${file.key}: ${file.src}`);
    });

    this.load.json('explorationAssets', assetsUrl);
    this.load.json('spacecraftData', spacecraftUrl);
    this.load.json('planetsData', planetsUrl);
    this.load.json('moonsData', moonsUrl);
    this.load.json('equipmentData', equipmentUrl);
    this.load.json('sunData', sunUrl);

    const spriteIds = new Set(
      [...planetsManifest.objects, ...moonsManifest.objects, sunManifest]
        .map((body) => body.visual?.imageId)
        .filter(Boolean),
    );
    assetsManifest.images.forEach((image) => {
      if (spriteIds.has(image.id) && !image.mapArtifacts) this.queueImage(image);
    });
  }

  queueImage(image) {
    if (!image?.id || typeof image.path !== 'string' || this.textures.exists(image.id)) return;
    const cleanPath = image.path.startsWith('/') ? image.path.slice(1) : image.path;
    this.load.image(image.id, `${import.meta.env.BASE_URL}${cleanPath}`);
  }

  create() {
    this.cameras.main.setBackgroundColor(gameConfig.palette.background);
    this.assets = this.cache.json.get('explorationAssets');
    this.spacecraftData = this.cache.json.get('spacecraftData');
    this.planetsData = this.cache.json.get('planetsData');
    this.moonsData = this.cache.json.get('moonsData');
    this.equipmentData = this.cache.json.get('equipmentData');
    this.sunData = this.cache.json.get('sunData');
    this.language = getSavedLanguage();

    const requiredData = {
      explorationAssets: this.assets,
      spacecraftData: this.spacecraftData,
      planetsData: this.planetsData,
      moonsData: this.moonsData,
      equipmentData: this.equipmentData,
      sunData: this.sunData,
    };
    const missingData = Object.entries(requiredData)
      .filter(([, value]) => value === undefined || value === null)
      .map(([key]) => key);

    if (missingData.length > 0) {
      throw new Error(`[ExplorationScene] Faltan datos JSON: ${missingData.join(', ')}`);
    }

    this.rememberedMissionIds = this.loadRememberedMissionIds();
    this.selectedTimelineYear = null;
    this.timelineDragging = false;
    this.timelineMilestoneQueue = [];
    this.timelineMilestoneShowing = false;
    this.surfaceModeBodyId = null;
    this.surfaceViewZoom = gameConfig.world.camera.zoom;
    this.surfaceSpacecraftScale = 1;
    this.currentCameraZoom = gameConfig.world.camera.zoom;

    this.worldBounds = {
      x: 0,
      y: 0,
      width: gameConfig.world.width,
      height: gameConfig.world.height,
    };
    this.worldObjects = [];
    this.celestialBodies = new Map();
    this.equipmentMarkers = [];
    this.discoveredIds = new Set();
    this.completionPending = false;
    this.activeTarget = null;
    this.infoPopupTarget = null;
    this.infoPopupOpen = false;

    this.worldObjects.push(...createStarfield(this, gameConfig, {
      worldSize: { width: this.worldBounds.width, height: this.worldBounds.height },
      densityScale: 8,
    }));
    this.createCelestialBodies();
    this.createEquipmentMarkers();
    this.createSurfaceTerrain();
    this.spacecraft = new Spacecraft(this, this.spacecraftData, gameConfig);
    this.worldObjects.push(this.spacecraft.container);
    this.createLighting();

    this.targets = [
      ...this.celestialBodies.values(),
      ...this.equipmentMarkers,
    ];
    this.orderedGuideTargets = this.createGuideOrder();
    this.discoveryTotal = new Set(this.targets.map((target) => target.id)).size;

    console.info('[ExplorationScene] Nave creada', {
      id: this.spacecraftData.id,
      position: { x: this.spacecraft.x, y: this.spacecraft.y },
      planets: this.planetsData.objects.length,
      moons: this.moonsData.objects.length,
      equipment: this.equipmentMarkers.length,
    });

    this.configureControls();
    this.touchControls = window.matchMedia('(pointer: coarse)').matches ? new TouchControls(this) : null;
    this.ambientMusic = getAmbientMusic(this.game);
    this.createHUD();
    this.configureCameras();
    this.layoutHUD(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.on(Phaser.Scenes.Events.PAUSE, this.hideTouchControls, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.showTouchControls, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.input.off('pointermove', this.handleTimelinePointerMove, this);
      this.input.off('pointerup', this.handleTimelinePointerUp, this);
      this.input.off('pointermove', this.handleMusicVolumeMove, this);
      this.input.off('pointerup', this.handleMusicVolumeUp, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.hideTouchControls, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.showTouchControls, this);
      this.touchControls?.destroy();
      this.touchControls = null;
    });

    this.cameras.main.fadeIn(gameConfig.animation.fadeMs, 0, 0, 0);
  }

  createCelestialBodies() {
    const scale = gameConfig.world.coordinateSystem;
    const planetScale = scale.planetDiameter;
    const moonScale = scale.moonDiameter;

    this.createSun();

    this.planetsData.objects.forEach((data) => {
      const worldPosition = {
        ...this.getSolarMapPosition(data.distanceFromSunKm, data.visualAngleDegrees),
      };
      const radius = Phaser.Math.Clamp(
        planetScale.referenceVisualRadius
          * (data.diameterKm / planetScale.referenceDiameterKm) ** planetScale.diameterExponent
          * (data.visual.radiusScale ?? 1),
        planetScale.minimumVisualRadius,
        planetScale.maximumVisualRadius,
      );
      const body = new CelestialBody(this, {
        ...data,
        worldPosition,
        visual: { ...data.visual, radius },
      }, gameConfig, this.assets, this.language);
      this.celestialBodies.set(body.id, body);
      this.worldObjects.push(body.container);
    });

    const orbitScale = scale.moonOrbit;
    this.moonsData.objects.forEach((data) => {
      const parent = this.celestialBodies.get(data.parentId);
      if (!parent) {
        console.error(`[ExplorationScene] Planeta padre no encontrado para ${data.id}: ${data.parentId}`);
        return;
      }

      const radius = Phaser.Math.Clamp(
        moonScale.referenceVisualRadius
          * (data.diameterKm / moonScale.referenceDiameterKm) ** moonScale.diameterExponent
          * (data.visual.radiusScale ?? 1),
        moonScale.minimumVisualRadius,
        moonScale.maximumVisualRadius,
      );
      const orbitRadius = parent.radius + orbitScale.baseGap
        + Math.sqrt(data.distanceFromParentKm / orbitScale.maximumMeanDistanceKm)
          * orbitScale.compressedOrbitSpan;
      const angle = Phaser.Math.DegToRad(data.visualAngleDegrees);
      const worldPosition = {
        x: parent.x + Math.cos(angle) * orbitRadius,
        y: parent.y + Math.sin(angle) * orbitRadius,
      };
      const body = new CelestialBody(this, {
        ...data,
        worldPosition,
        visual: { ...data.visual, radius },
      }, gameConfig, this.assets, this.language);
      this.celestialBodies.set(body.id, body);
      this.worldObjects.push(body.container);
    });
  }

  getSolarMapPosition(distanceFromSunKm, visualAngleDegrees) {
    const distanceScale = gameConfig.world.coordinateSystem.planetDistance;
    const radius = Math.sqrt(distanceFromSunKm / 1000000) * distanceScale.unitsPerSqrtMillionKm;
    const angle = Phaser.Math.DegToRad(visualAngleDegrees);
    return {
      x: distanceScale.sunReferenceX + radius * Math.cos(angle),
      y: distanceScale.sunReferenceY + radius * Math.sin(angle),
    };
  }

  createSun() {
    const visualScale = gameConfig.world.coordinateSystem.sunDiameter;
    const radius = Phaser.Math.Clamp(
      visualScale.referenceVisualRadius
        * (this.sunData.diameterKm / visualScale.earthDiameterKm) ** visualScale.diameterExponent,
      visualScale.minimumVisualRadius,
      visualScale.maximumVisualRadius,
    );
    const distanceScale = gameConfig.world.coordinateSystem.planetDistance;
    const sun = new CelestialBody(this, {
      ...this.sunData,
      worldPosition: {
        x: distanceScale.sunReferenceX,
        y: distanceScale.sunReferenceY,
      },
      visual: { ...this.sunData.visual, radius },
    }, gameConfig, this.assets, this.language);
    this.celestialBodies.set(sun.id, sun);
    this.worldObjects.push(sun.container);
  }

  createEquipmentMarkers() {
    const records = this.equipmentData.records;
    records.forEach((data) => {
      const body = this.celestialBodies.get(data.celestialBodyId);
      if (!body) {
        console.error(`[ExplorationScene] Cuerpo asociado no encontrado para ${data.id}: ${data.celestialBodyId}`);
        return;
      }
      const marker = new SpaceEquipment(this, data, body, gameConfig, this.assets, this.language);
      this.equipmentMarkers.push(marker);
      this.worldObjects.push(marker.container);
    });
  }

  createSurfaceTerrain() {
    this.surfaceTerrain = this.add.graphics().setDepth(-1).setVisible(false);
    this.worldObjects.push(this.surfaceTerrain);
  }

  configureControls() {
    const keyboard = this.input.keyboard;
    const keyCodes = Phaser.Input.Keyboard.KeyCodes;
    keyboard.addCapture([keyCodes.UP, keyCodes.DOWN, keyCodes.LEFT, keyCodes.RIGHT]);
    this.keys = keyboard.addKeys({
      up: 'W',
      down: 'S',
      left: 'A',
      right: 'D',
      arrowUp: keyCodes.UP,
      arrowDown: keyCodes.DOWN,
      arrowLeft: keyCodes.LEFT,
      arrowRight: keyCodes.RIGHT,
    });
    this.movementInput = {
      up: { isDown: false },
      down: { isDown: false },
      left: { isDown: false },
      right: { isDown: false },
    };
    this.handleInteractionKey = (event) => {
      if (event.repeat) return;
      if (event.key === 'Escape') {
        if (this.infoPopupOpen) this.closeInfoPopup();
        return;
      }
      if (event.key.toLowerCase() === 'f' && !this.infoPopupOpen) {
        this.flashlightEnabled = !this.flashlightEnabled;
        this.flashlightGraphics.setVisible(this.flashlightEnabled);
        this.flashlightStatus
          .setText(translate(
            this.language,
            this.flashlightEnabled
              ? 'exploration.flashlightOn'
              : 'exploration.flashlightOff',
          ))
          .setColor(this.flashlightEnabled
            ? gameConfig.palette.sunFlare
            : gameConfig.palette.muted);
        return;
      }
      if (event.key.toLowerCase() === 'q') {
        if (this.infoPopupOpen) this.closeInfoPopup();
        const nearbyBody = this.getNearbyMissionBody();
        if (this.surfaceModeBodyId || nearbyBody) {
          this.toggleSurfaceMode();
        }
        return;
      }
      if (event.key.toLowerCase() !== 'e' || this.infoPopupOpen || !this.activeTarget) return;

      if (this.isTargetInteractable(this.activeTarget)) {
        this.openInfoPopup(this.activeTarget);
      }
    };
    keyboard.on('keydown', this.handleInteractionKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off('keydown', this.handleInteractionKey);
    });
  }

  createHUD() {
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.hudTitle = this.add.text(22, 18, gameConfig.title.primary, {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.hudTitleFontSize}px`,
      fontStyle: 'bold',
      color: gameConfig.palette.text,
      letterSpacing: 2,
      stroke: gameConfig.palette.background,
      strokeThickness: 4,
    });
    this.flashlightStatus = this.add.text(
      47,
      62,
      translate(this.language, 'exploration.flashlightOff'),
      {
        fontFamily: gameConfig.visual.monoFontFamily,
        fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
        color: gameConfig.palette.muted,
        stroke: gameConfig.palette.background,
        strokeThickness: 4,
      },
    );
    this.flashlightKey = this.add.container(29, 68);
    const flashlightKeyBackground = this.add.graphics();
    flashlightKeyBackground.fillStyle(0x233d55, 0.95);
    flashlightKeyBackground.fillRoundedRect(-9, -9, 18, 18, 4);
    flashlightKeyBackground.lineStyle(1, Number.parseInt(gameConfig.palette.electric.slice(1), 16), 0.65);
    flashlightKeyBackground.strokeRoundedRect(-9, -9, 18, 18, 4);
    const flashlightKeyLabel = this.add.text(0, 0, 'F', {
      fontFamily: gameConfig.visual.monoFontFamily, fontSize: '11px', fontStyle: 'bold', color: gameConfig.palette.text,
    }).setOrigin(0.5);
    this.flashlightKey.add([flashlightKeyBackground, flashlightKeyLabel]);
    this.hudSubtitle = this.add.text(23, 43, translate(this.language, 'exploration.subtitle'), {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: `${gameConfig.visual.hudBodyFontSize}px`,
      color: gameConfig.palette.muted,
      stroke: gameConfig.palette.background,
      strokeThickness: 4,
    });
    this.discoveryCard = this.add.container(16, 82);
    this.discoveryCardBackground = this.add.graphics();
    this.discoveryTitle = this.add.text(12, 11, translate(this.language, 'exploration.discoveryTitle'), {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: '13px',
      fontStyle: 'bold',
      color: gameConfig.palette.text,
    });
    this.discoveryCounter = this.add.text(204, 12, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: '12px',
      color: gameConfig.palette.text,
    }).setOrigin(1, 0);
    this.discoveryTrack = this.add.rectangle(12, 37, 192, 4, 0x304151, 0.9).setOrigin(0, 0);
    this.discoveryProgress = this.add.rectangle(12, 37, 0, 4,
      Number.parseInt(gameConfig.palette.electric.slice(1), 16), 0.9).setOrigin(0, 0);
    this.discoveryDestinationTitle = this.add.text(12, 53,
      translate(this.language, 'exploration.nextDestination'), {
        fontFamily: gameConfig.visual.monoFontFamily,
        fontSize: '10px',
        color: gameConfig.palette.muted,
      });
    this.discoveryDestination = this.add.text(12, 70, '', {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: '12px',
      color: gameConfig.palette.text,
      wordWrap: { width: 166 },
      maxLines: 2,
    });
    this.nextDestinationButton = this.add.container(193, 77).setSize(28, 28);
    const nextBackground = this.add.rectangle(0, 0, 28, 28, 0x233d55, 0.75);
    const nextArrow = this.add.text(0, -1, '›', {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: '24px',
      color: gameConfig.palette.text,
    }).setOrigin(0.5);
    this.nextDestinationButton.add([nextBackground, nextArrow]);
    this.nextDestinationButton.setInteractive(new Phaser.Geom.Rectangle(-14, -14, 28, 28),
      Phaser.Geom.Rectangle.Contains);
    this.nextDestinationButton.input.cursor = 'pointer';
    this.nextDestinationButton.on('pointerdown', () => this.selectNextGuideTarget());
    this.destinationTooltip = this.add.text(222, 66, translate(this.language, 'exploration.selectNextDestination'), {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: '10px',
      color: gameConfig.palette.text,
      backgroundColor: gameConfig.palette.buttonFill,
      padding: { left: 6, right: 6, top: 4, bottom: 4 },
    }).setVisible(false);
    this.nextDestinationButton.on('pointerover', () => this.destinationTooltip.setVisible(true));
    this.nextDestinationButton.on('pointerout', () => this.destinationTooltip.setVisible(false));
    this.discoveryCard.add([this.discoveryCardBackground, this.discoveryTitle, this.discoveryCounter,
      this.discoveryTrack, this.discoveryProgress, this.discoveryDestinationTitle, this.discoveryDestination,
      this.nextDestinationButton, this.destinationTooltip]);
    this.completionNotice = this.add.text(0, 0, '', {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: '14px',
      color: gameConfig.palette.text,
      backgroundColor: gameConfig.palette.buttonFill,
      padding: { left: 12, right: 12, top: 8, bottom: 8 },
      align: 'center',
      wordWrap: { width: 280 },
    }).setOrigin(0.5).setVisible(false);
    this.guideArrow = this.add.graphics().setVisible(false);
    this.guideArrow.lineStyle(1.5, Number.parseInt(gameConfig.palette.muted.slice(1), 16), 0.9);
    this.guideArrow.beginPath();
    this.guideArrow.moveTo(-6, -5);
    this.guideArrow.lineTo(5, 0);
    this.guideArrow.lineTo(-6, 5);
    this.guideArrow.strokePath();
    this.guideLabel = this.add.text(0, 0, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: '11px',
      color: gameConfig.palette.muted,
      backgroundColor: gameConfig.palette.background,
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
    }).setOrigin(0.5).setVisible(false);
    this.guideTarget = null;
    this.manualGuideTargetId = null;
    this.nextGuideSelection = 0;
    this.musicButton = this.add.container(76, 207).setSize(120, 30);
    const musicBackground = this.add.rectangle(0, 0, 120, 30,
      Number.parseInt(gameConfig.palette.buttonFill.slice(1), 16), 0.85)
      .setStrokeStyle(1, Number.parseInt(gameConfig.palette.muted.slice(1), 16), 0.5);
    this.musicIcon = this.add.text(-47, -1, '♫', {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: '18px',
      color: gameConfig.palette.text,
    }).setOrigin(0.5);
    this.musicMutedMark = this.add.graphics();
    this.musicMutedMark.lineStyle(2, Number.parseInt(gameConfig.palette.text.slice(1), 16), 0.9);
    this.musicMutedMark.lineBetween(-55, 8, -39, -8);
    this.musicLabel = this.add.text(-31, 0, translate(this.language, 'exploration.musicLabel'), {
      fontFamily: gameConfig.visual.monoFontFamily, fontSize: '11px', color: gameConfig.palette.text,
    }).setOrigin(0, 0.5);
    this.musicState = this.add.text(50, 0, '', {
      fontFamily: gameConfig.visual.monoFontFamily, fontSize: '10px', color: gameConfig.palette.muted,
    }).setOrigin(1, 0.5);
    this.musicButton.add([musicBackground, this.musicIcon, this.musicMutedMark, this.musicLabel, this.musicState]);
    this.musicTooltip = this.add.text(16, 236, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: '11px',
      color: gameConfig.palette.text,
      backgroundColor: gameConfig.palette.buttonFill,
      padding: { left: 6, right: 6, top: 4, bottom: 4 },
    }).setOrigin(0, 0.5).setVisible(false);
    this.musicButton.setInteractive(new Phaser.Geom.Rectangle(-60, -15, 120, 30),
      Phaser.Geom.Rectangle.Contains);
    this.musicButton.input.cursor = 'pointer';
    this.musicButton.on('pointerdown', () => {
      this.ambientMusic.toggle();
      this.updateMusicButton();
    });
    this.musicButton.on('pointerover', () => this.musicTooltip.setVisible(true));
    this.musicButton.on('pointerout', () => this.musicTooltip.setVisible(false));
    this.musicVolumeControl = this.add.container(151, 207).setSize(84, 30);
    this.musicVolumeGraphics = this.add.graphics();
    this.musicVolumeValue = this.add.text(88, 0, '', {
      fontFamily: gameConfig.visual.monoFontFamily, fontSize: '11px', color: gameConfig.palette.text,
    }).setOrigin(0, 0.5);
    this.musicVolumeControl.add([this.musicVolumeGraphics, this.musicVolumeValue]);
    this.musicVolumeControl.setInteractive(new Phaser.Geom.Rectangle(42, 0, 84, 30),
      Phaser.Geom.Rectangle.Contains);
    this.musicVolumeControl.input.cursor = 'pointer';
    this.musicVolumeControl.on('pointerdown', (pointer) => {
      this.musicVolumeDragging = true;
      this.setMusicVolumeFromPointer(pointer);
    });
    this.musicVolumeControl.on('pointerover', () => {
      this.musicTooltip.setText(translate(this.language, 'exploration.musicVolume')).setVisible(true);
    });
    this.musicVolumeControl.on('pointerout', () => this.musicTooltip.setVisible(false));
    this.handleMusicVolumeMove = (pointer) => {
      if (this.musicVolumeDragging) this.setMusicVolumeFromPointer(pointer);
    };
    this.handleMusicVolumeUp = () => { this.musicVolumeDragging = false; };
    this.input.on('pointermove', this.handleMusicVolumeMove, this);
    this.input.on('pointerup', this.handleMusicVolumeUp, this);
    this.updateMusicButton();
    this.updateDiscoveryCounter();
    this.movementHint = this.add.text(22, 0, translate(this.language, 'exploration.movementHint'), {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.hudBodyFontSize}px`,
      color: gameConfig.palette.muted,
      stroke: gameConfig.palette.background,
      strokeThickness: 4,
    }).setOrigin(0, 1);
    this.zoomIndicator = this.add.text(0, 18, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.hudBodyFontSize}px`,
      color: gameConfig.palette.muted,
      stroke: gameConfig.palette.background,
      strokeThickness: 4,
    }).setOrigin(1, 0);
    this.targetNameHUD = this.add.text(0, 22, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.hudTitleFontSize}px`,
      color: gameConfig.palette.text,
      align: 'center',
      letterSpacing: 2,
      stroke: gameConfig.palette.background,
      strokeThickness: 4,
    }).setOrigin(0.5, 0).setVisible(false);
    this.surfaceObjectiveCounter = this.add.text(0, 0, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
      color: gameConfig.palette.electric,
      backgroundColor: gameConfig.palette.buttonFill,
      padding: { left: 9, right: 9, top: 6, bottom: 6 },
      stroke: gameConfig.palette.background,
      strokeThickness: 3,
    }).setOrigin(1, 0).setVisible(false);

    this.proximityPanel = this.add.container(0, 0).setVisible(false);
    this.proximityBackground = this.add.graphics();
    this.proximityName = this.add.text(
      0,
      -18,
      '',
      {
        fontFamily: gameConfig.visual.bodyFontFamily,
        fontSize: `${gameConfig.visual.hudBodyFontSize + 1}px`,
        fontStyle: 'bold',
        color: gameConfig.palette.text,
        stroke: gameConfig.palette.background,
        strokeThickness: 3,
        lineSpacing: 4,
        wordWrap: { width: gameConfig.visual.proximityPanelWidth - 28 },
      },
    ).setOrigin(0, 0.5);
    const createKeyHint = (key) => {
      const container = this.add.container(0, 16).setVisible(false);
      const background = this.add.graphics();
      background.fillStyle(0x233d55, 1);
      background.fillRoundedRect(0, -10, 21, 20, 4);
      background.lineStyle(1, Number.parseInt(gameConfig.palette.electric.slice(1), 16), 0.75);
      background.strokeRoundedRect(0, -10, 21, 20, 4);
      const keyLabel = this.add.text(10.5, 0, key, {
        fontFamily: gameConfig.visual.monoFontFamily, fontSize: '12px', fontStyle: 'bold', color: gameConfig.palette.text,
      }).setOrigin(0.5);
      const action = this.add.text(28, 0, '', {
        fontFamily: gameConfig.visual.bodyFontFamily, fontSize: '12px', color: gameConfig.palette.text,
      }).setOrigin(0, 0.5);
      container.add([background, keyLabel, action]);
      return { container, action };
    };
    this.surfaceKeyHint = createKeyHint('Q');
    this.interactKeyHint = createKeyHint('E');
    this.proximityPanel.add([this.proximityBackground, this.proximityName,
      this.surfaceKeyHint.container, this.interactKeyHint.container]);

    this.finishButton = createActionButton(this, {
      width: 250,
      height: 42,
      text: translate(this.language, 'conclusion.finish'),
      palette: gameConfig.palette,
      visual: gameConfig.visual,
      onPress: () => {
        this.scene.launch('ConclusionScene');
        this.scene.pause();
      },
    });
    this.finishButton.label.setFontSize(12).setLetterSpacing(0);

    this.hud.add([
      this.hudTitle,
      this.hudSubtitle,
      this.flashlightStatus,
      this.flashlightKey,
      this.discoveryCard,
      this.completionNotice,
      this.guideArrow,
      this.guideLabel,
      this.musicButton,
      this.musicVolumeControl,
      this.musicTooltip,
      this.movementHint,
      this.zoomIndicator,
      this.targetNameHUD,
      this.proximityPanel,
      this.surfaceObjectiveCounter,
      this.finishButton.container,
    ]);

    this.createInfoPopup();
    this.createTimelineControl();
  }

  createLighting() {
    this.ambientDarkness = this.add.graphics().setDepth(8);
    this.ambientDarkness.fillStyle(0x000000, 1);
    this.ambientDarkness.fillRect(
      this.worldBounds.x,
      this.worldBounds.y,
      this.worldBounds.width,
      this.worldBounds.height,
    );
    this.ambientDarkness.setAlpha(0);
    this.worldObjects.push(this.ambientDarkness);

    this.flashlightEnabled = false;
    this.flashlightGraphics = this.add.graphics()
      .setDepth(12)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.worldObjects.push(this.flashlightGraphics);
  }

  updateLighting() {
    const sun = this.celestialBodies.get('sun');
    if (sun && !this.surfaceModeBodyId) {
      const distance = this.getTargetDistance(sun);
      const normalizedDistance = distance / 1050;
      const solarIllumination = 1 / (1 + normalizedDistance ** 2);
      const darkness = Phaser.Math.Clamp(
        0.66 * (1 - solarIllumination),
        0,
        0.62,
      );
      this.ambientDarkness.setAlpha(darkness);
    }

    if (!this.flashlightEnabled || !this.flashlightGraphics.visible) return;

    const graphics = this.flashlightGraphics;
    const { x, y, rotation } = this.spacecraft.container;
    const forwardX = Math.sin(rotation);
    const forwardY = -Math.cos(rotation);
    const perpendicularX = Math.cos(rotation);
    const perpendicularY = Math.sin(rotation);
    const drawBeam = (length, width, alpha) => {
      graphics.fillStyle(Number.parseInt(gameConfig.palette.proximity.slice(1), 16), alpha);
      graphics.beginPath();
      graphics.moveTo(x, y);
      graphics.lineTo(
        x + forwardX * length + perpendicularX * width / 2,
        y + forwardY * length + perpendicularY * width / 2,
      );
      graphics.lineTo(
        x + forwardX * length - perpendicularX * width / 2,
        y + forwardY * length - perpendicularY * width / 2,
      );
      graphics.closePath();
      graphics.fillPath();
    };

    graphics.clear();
    drawBeam(430, 190, 0.08);
    drawBeam(320, 125, 0.12);
    drawBeam(205, 72, 0.18);
    drawBeam(120, 34, 0.22);
    graphics.lineStyle(1.5, Number.parseInt(gameConfig.palette.proximity.slice(1), 16), 0.24);
    graphics.beginPath();
    graphics.moveTo(x, y);
    graphics.lineTo(
      x + forwardX * 430 + perpendicularX * 95,
      y + forwardY * 430 + perpendicularY * 95,
    );
    graphics.moveTo(x, y);
    graphics.lineTo(
      x + forwardX * 430 - perpendicularX * 95,
      y + forwardY * 430 - perpendicularY * 95,
    );
    graphics.strokePath();
  }

  createTimelineControl() {
    this.timelineGraphics = this.add.graphics();
    this.timelineYearLabel = this.add.text(0, 0, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
      color: gameConfig.palette.electric,
      stroke: gameConfig.palette.background,
      strokeThickness: 3,
      align: 'center',
    }).setOrigin(0.5, 1);
    this.timelineStartLabel = this.add.text(0, 0, String(TIMELINE_START_YEAR), {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
      color: gameConfig.palette.muted,
      stroke: gameConfig.palette.background,
      strokeThickness: 3,
    }).setOrigin(0.5);
    this.timelineEndLabel = this.add.text(0, 0, String(TIMELINE_END_YEAR), {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
      color: gameConfig.palette.muted,
      stroke: gameConfig.palette.background,
      strokeThickness: 3,
    }).setOrigin(0.5);
    this.timelineTitle = this.add.text(0, 0, translate(this.language, 'exploration.timeline.title'), {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
      color: gameConfig.palette.text,
      fontStyle: 'bold',
      stroke: gameConfig.palette.background,
      strokeThickness: 3,
    }).setOrigin(0, 0.5);
    this.timelineMilestoneNotice = this.add.text(0, 0, '', {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCaptionFontSize}px`,
      color: gameConfig.palette.text,
      align: 'center',
      backgroundColor: gameConfig.palette.buttonFill,
      padding: { left: 14, right: 14, top: 9, bottom: 9 },
      wordWrap: { width: Math.min(620, this.scale.gameSize.width - 40) },
      stroke: gameConfig.palette.background,
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setVisible(false);

    this.timelineTrackZone = this.add.zone(0, 0, 1, 28).setOrigin(0, 0)
      .setInteractive(
        new Phaser.Geom.Rectangle(0, 0, 1, 28),
        Phaser.Geom.Rectangle.Contains,
      );
    this.timelineTrackZone.on('pointerdown', (pointer) => {
      this.timelineDragging = true;
      this.setTimelineYearFromPointer(pointer.x);
      this.input.on('pointermove', this.handleTimelinePointerMove, this);
      this.input.on('pointerup', this.handleTimelinePointerUp, this);
    });
    this.handleTimelinePointerMove = (pointer) => {
      if (this.timelineDragging) this.setTimelineYearFromPointer(pointer.x);
    };
    this.handleTimelinePointerUp = () => {
      this.timelineDragging = false;
      this.input.off('pointermove', this.handleTimelinePointerMove, this);
      this.input.off('pointerup', this.handleTimelinePointerUp, this);
    };
    this.hud.add([
      this.timelineGraphics,
      this.timelineYearLabel,
      this.timelineStartLabel,
      this.timelineEndLabel,
      this.timelineTitle,
      this.timelineTrackZone,
      this.timelineMilestoneNotice,
    ]);
  }

  loadRememberedMissionIds() {
    try {
      const saved = globalThis.localStorage?.getItem(LEGACY_PROGRESS_KEY);
      if (!saved) return new Set();
      const ids = JSON.parse(saved);
      if (!Array.isArray(ids)) throw new Error('El progreso guardado no es una lista.');
      const validIds = new Set(this.equipmentData.records.map((record) => record.id));
      return new Set(ids.filter((id) => validIds.has(id)));
    } catch (error) {
      console.warn('[ExplorationScene] No se pudo leer el progreso de misiones.', error);
      return new Set();
    }
  }

  rememberLegacy(id) {
    if (this.rememberedMissionIds.has(id)) return;
    this.rememberedMissionIds.add(id);
    try {
      globalThis.localStorage?.setItem(
        LEGACY_PROGRESS_KEY,
        JSON.stringify([...this.rememberedMissionIds]),
      );
    } catch (error) {
      console.warn('[ExplorationScene] No se pudo guardar el progreso de misiones.', error);
    }
  }

  layoutTimelineControl(gameSize) {
    const y = gameSize.height - 27;
    const trackLeft = Math.min(190, Math.max(148, gameSize.width * 0.16));
    const trackRight = Math.max(trackLeft + 100, gameSize.width - 72);
    this.timelineTrackLeft = trackLeft;
    this.timelineTrackWidth = trackRight - trackLeft;
    this.timelineTitle.setPosition(18, y);
    this.timelineStartLabel.setPosition(trackLeft - 20, y);
    this.timelineEndLabel.setPosition(trackRight + 20, y);
    this.timelineTrackZone
      .setPosition(trackLeft, y - 14)
      .setSize(this.timelineTrackWidth, 28);
    this.timelineTrackZone.input.hitArea.setTo(0, 0, this.timelineTrackWidth, 28);
    this.timelineYearLabel.setPosition((trackLeft + trackRight) / 2, y - 7);
    this.drawTimelineTrack();
  }

  drawTimelineTrack() {
    const y = this.scale.gameSize.height - 27;
    const ratio = this.selectedTimelineYear === null
      ? 1
      : (this.selectedTimelineYear - TIMELINE_START_YEAR)
        / (TIMELINE_END_YEAR - TIMELINE_START_YEAR);
    const handleX = this.timelineTrackLeft + this.timelineTrackWidth * ratio;
    this.timelineGraphics.clear();
    this.timelineGraphics.lineStyle(4, Number.parseInt(gameConfig.palette.muted.slice(1), 16), 0.48);
    this.timelineGraphics.beginPath();
    this.timelineGraphics.moveTo(this.timelineTrackLeft, y);
    this.timelineGraphics.lineTo(this.timelineTrackLeft + this.timelineTrackWidth, y);
    this.timelineGraphics.strokePath();
    this.timelineGraphics.lineStyle(4, Number.parseInt(gameConfig.palette.electric.slice(1), 16), 0.95);
    this.timelineGraphics.beginPath();
    this.timelineGraphics.moveTo(this.timelineTrackLeft, y);
    this.timelineGraphics.lineTo(handleX, y);
    this.timelineGraphics.strokePath();
    this.timelineGraphics.fillStyle(Number.parseInt(gameConfig.palette.text.slice(1), 16), 1);
    this.timelineGraphics.fillCircle(handleX, y, 7);
    const labelX = this.timelineTrackWidth < 200
      ? this.timelineTrackLeft + this.timelineTrackWidth / 2
      : Phaser.Math.Clamp(
        handleX,
        this.timelineTrackLeft + 100,
        this.timelineTrackLeft + this.timelineTrackWidth - 100,
      );
    this.timelineYearLabel.setText(this.getTimelineStatusLabel()).setPosition(labelX, y - 10);
  }

  setTimelineYearFromPointer(pointerX) {
    const previousYear = this.selectedTimelineYear ?? TIMELINE_END_YEAR;
    const ratio = Phaser.Math.Clamp(
      (pointerX - this.timelineTrackLeft) / this.timelineTrackWidth,
      0,
      1,
    );
    this.selectedTimelineYear = Math.round(
      TIMELINE_START_YEAR + ratio * (TIMELINE_END_YEAR - TIMELINE_START_YEAR),
    );
    if (this.selectedTimelineYear !== previousYear) {
      this.showCrossedTimelineMilestones(previousYear, this.selectedTimelineYear);
    }
    this.applyTimelineFilter();
    this.drawTimelineTrack();
  }

  applyTimelineFilter() {
    this.equipmentMarkers.forEach((marker) => {
      const visible = this.selectedTimelineYear === null
        || this.getTimelineYear(marker.data) <= this.selectedTimelineYear;
      marker.setTimelineVisible(visible);
      if (this.surfaceModeBodyId) {
        marker.container.setVisible(visible && marker.bodyId === this.surfaceModeBodyId);
      }
      marker.setOrbitalView(
        marker.bodyId === this.surfaceModeBodyId && visible,
        this.surfaceViewZoom,
      );
    });

    if (this.surfaceModeBodyId
      && !this.equipmentMarkers.some((marker) => (
        marker.bodyId === this.surfaceModeBodyId && this.isVisibleOnTimeline(marker)
      ))) {
      this.toggleSurfaceMode();
    }

    this.updateSurfaceObjectiveCounter();
    this.updateProximity();
  }

  isVisibleOnTimeline(target) {
    return !target.data.equipmentType
      || this.selectedTimelineYear === null
      || this.getTimelineYear(target.data) <= this.selectedTimelineYear;
  }

  getTimelineYear(record) {
    return record.arrivalYear ?? record.launchYear;
  }

  getTimelineStatusLabel() {
    const yearLabel = this.selectedTimelineYear === null
      ? translate(this.language, 'exploration.timeline.all')
      : String(this.selectedTimelineYear);
    const activeCount = this.equipmentData.records.filter((record) => (
      this.selectedTimelineYear === null
      || this.getTimelineYear(record) <= this.selectedTimelineYear
    )).length;
    const missionLabel = translate(
      this.language,
      activeCount === 1
        ? 'exploration.timeline.activeMissionSingular'
        : 'exploration.timeline.activeMissionPlural',
    );
    return `${yearLabel} — [ ${activeCount} ${missionLabel} ]`;
  }

  showCrossedTimelineMilestones(previousYear, currentYear) {
    const milestones = Object.keys(translate(this.language, 'exploration.timeline.milestones'))
      .map(Number)
      .filter((year) => currentYear >= previousYear
        ? year > previousYear && year <= currentYear
        : year >= currentYear && year < previousYear)
      .sort((first, second) => currentYear >= previousYear
        ? first - second
        : second - first);
    this.timelineMilestoneQueue.push(...milestones);
    this.showNextTimelineMilestone();
  }

  showNextTimelineMilestone() {
    if (this.timelineMilestoneShowing || this.timelineMilestoneQueue.length === 0) return;
    const year = this.timelineMilestoneQueue.shift();
    const milestone = translate(this.language, `exploration.timeline.milestones.${year}`);
    if (!milestone || milestone === `exploration.timeline.milestones.${year}`) {
      this.showNextTimelineMilestone();
      return;
    }

    this.timelineMilestoneShowing = true;
    this.timelineMilestoneNotice
      .setText(milestone)
      .setPosition(this.scale.gameSize.width / 2, this.scale.gameSize.height - 155)
      .setAlpha(0)
      .setVisible(true);
    this.tweens.add({
      targets: this.timelineMilestoneNotice,
      alpha: { from: 0, to: 1 },
      y: this.scale.gameSize.height - 165,
      duration: 250,
      hold: 1500,
      yoyo: true,
      ease: 'Sine.InOut',
      onComplete: () => {
        this.timelineMilestoneNotice.setVisible(false);
        this.timelineMilestoneShowing = false;
        this.showNextTimelineMilestone();
      },
    });
  }

  configureCameras() {
    const cameraConfig = gameConfig.world.camera;
    this.worldCamera = this.cameras.main;
    this.worldCamera.setBounds(0, 0, this.worldBounds.width, this.worldBounds.height);
    this.worldCamera.setZoom(cameraConfig.zoom);
    this.defaultCameraZoom = cameraConfig.zoom;
    this.currentCameraZoom = cameraConfig.zoom;
    this.worldCamera.centerOn(this.spacecraft.x, this.spacecraft.y);
    this.worldCamera.startFollow(
      this.spacecraft.container,
      true,
      cameraConfig.lerpX,
      cameraConfig.lerpY,
    );
    this.worldCamera.ignore(this.hud);

    const { width, height } = this.scale.gameSize;
    this.hudCamera = this.cameras.add(0, 0, width, height);
    this.hudCamera.setZoom(1);
    this.hudCamera.ignore(this.worldObjects);
    this.updateZoomIndicator();
  }

  updateZoomIndicator() {
    const percent = Math.round((this.currentCameraZoom ?? gameConfig.world.camera.zoom) * 100);
    this.zoomIndicator?.setText(
      `${translate(this.language, 'exploration.zoomLabel')}: ${percent}%`,
    );
  }

  layoutHUD(gameSize) {
    this.hudTitle.setPosition(22, 18);
    this.hudSubtitle.setPosition(23, 43);
    this.flashlightStatus.setPosition(47, 62);
    this.discoveryCard.setPosition(16, 82);
    this.discoveryCardBackground.clear();
    this.discoveryCardBackground.fillStyle(Number.parseInt(gameConfig.palette.buttonFill.slice(1), 16), 0.9);
    this.discoveryCardBackground.fillRoundedRect(0, 0, 216, 106, 8);
    this.discoveryCardBackground.lineStyle(1, Number.parseInt(gameConfig.palette.electric.slice(1), 16), 0.4);
    this.discoveryCardBackground.strokeRoundedRect(0, 0, 216, 106, 8);
    this.destinationTooltip.setPosition(gameSize.width >= this.destinationTooltip.width + 246 ? 222 : 0,
      gameSize.width >= this.destinationTooltip.width + 246 ? 66 : 146);
    this.completionNotice.setPosition(gameSize.width / 2, 260);
    this.completionNotice.setWordWrapWidth(Math.max(100, Math.min(360, gameSize.width - 48)), true);
    this.zoomIndicator.setPosition(gameSize.width - 22, 62);
    this.targetNameHUD.setPosition(gameSize.width / 2, 22);
    this.movementHint.setPosition(22, gameSize.height - (gameSize.width < 600 && this.proximityPanel.visible ? 145 : 65));

    const finishWidth = Math.min(250, Math.max(130, Math.min(gameSize.width * 0.48, gameSize.width - 188)));
    this.finishButton.setSize(finishWidth, 42);
    this.finishButton.container.input.hitArea.setTo(0, 0, finishWidth, 42);
    this.finishButton.label.setFontSize(finishWidth < 200 ? 9 : 12);
    this.finishButton.container.setPosition(gameSize.width - finishWidth / 2 - 16, 36);
    this.hudTitle.setFontSize(gameSize.width < 450 ? 13 : gameConfig.visual.hudTitleFontSize);

    const panelWidth = this.getProximityPanelWidth();
    this.drawProximityBackground(panelWidth);
    this.proximityName.setPosition(-panelWidth / 2 + 14, -18);
    this.proximityName.setWordWrapWidth(panelWidth - 28, true);
    this.surfaceKeyHint.container.setPosition(-panelWidth / 2 + 14, 16);
    this.interactKeyHint.container.setPosition(-panelWidth / 2 + Math.min(196, panelWidth - 92), 16);
    this.proximityPanel.setPosition(
      gameSize.width / 2,
      gameSize.height - gameConfig.visual.proximityPanelHeight / 2 - 62,
    );

    this.layoutTimelineControl(gameSize);
    this.surfaceObjectiveCounter.setPosition(gameSize.width - 18, 85);
    this.hudCamera?.setViewport(0, 0, gameSize.width, gameSize.height);

    if (this.touchControls) {
      this.hudTitle.setPosition(16, 10).setFontSize(13);
      this.hudSubtitle.setPosition(16, 29);
      this.flashlightKey.setPosition(24, 58);
      this.flashlightStatus.setPosition(41, 52);
      this.discoveryCard.setPosition(14, 73).setScale(0.7);
      this.musicButton.setPosition(76, 166);
      this.musicVolumeControl.setPosition(151, 166);
      this.musicTooltip.setPosition(16, 193);
      this.movementHint.setVisible(false);
    }

    if (this.activeTarget) this.positionProximityPanel();
    if (this.infoPopupOpen) {
      this.positionInfoPopup();
      this.setCompactPopupHud();
    }
  }

  handleResize(gameSize) {
    this.layoutHUD(gameSize);
  }

  update(time, delta) {
    if (!this.spacecraft || !this.keys) return;
    const input = this.movementInput;
    input.up.isDown = this.keys.up.isDown || this.keys.arrowUp.isDown;
    input.down.isDown = this.keys.down.isDown || this.keys.arrowDown.isDown;
    input.left.isDown = this.keys.left.isDown || this.keys.arrowLeft.isDown;
    input.right.isDown = this.keys.right.isDown || this.keys.arrowRight.isDown;
    input.touchX = this.touchControls?.x ?? 0;
    input.touchY = this.touchControls?.y ?? 0;
    this.touchControls?.updateState();

    const movementDelta = this.game.loop.rawDelta;
    const cameraDelta = Math.min(movementDelta, 100);
    const cameraLerp = 1 - Math.exp(-cameraDelta / 110);
    this.worldCamera.lerp.set(cameraLerp, cameraLerp);

    if (!this.surfaceEntryTween?.isPlaying()) {
      this.spacecraft.update(
        input,
        movementDelta,
        this.surfaceModeBodyId ? this.surfaceWorldBounds : this.worldBounds,
      );
    }
    this.updateProximity();
    this.updateSurfaceView(delta);
    this.updateLighting();
    this.updateExplorationGuide(time);

    if (this.infoPopupOpen) this.positionInfoPopup();
  }

  updateProximity() {
    const { radius, hysteresis } = gameConfig.world.proximity;
    let nearestTarget = null;
    let nearestDistance = Infinity;
    let activeDistance = Infinity;

    for (const target of this.targets) {
      if ((this.surfaceModeBodyId && target.bodyId !== this.surfaceModeBodyId)
        || !this.isVisibleOnTimeline(target)) continue;

      const distance = this.getTargetDistance(target) - target.proximityRadius;
      if (distance > radius) continue;
      if (target.id === this.activeTarget?.id) activeDistance = distance;
      if (distance < nearestDistance) {
        nearestTarget = target;
        nearestDistance = distance;
      }
    }

    if (this.activeTarget && activeDistance < Infinity
      && (!nearestTarget || nearestTarget.id === this.activeTarget.id
        || nearestDistance + hysteresis >= activeDistance)) {
      nearestTarget = this.activeTarget;
    }

    if (!nearestTarget) {
      if (this.activeTarget) this.activeTarget.setHighlighted(false);
      this.activeTarget = null;
      this.targetNameHUD.setVisible(false);
      this.updateSurfacePrompt();
      return;
    }

    if (nearestTarget.id !== this.activeTarget?.id) {
      if (this.activeTarget) this.activeTarget.setHighlighted(false);
      this.activeTarget = nearestTarget;
      this.activeTarget.setHighlighted(true);
      this.proximityName.setText(this.activeTarget.name);
      this.targetNameHUD.setText(this.activeTarget.name);
    }

    this.targetNameHUD.setVisible(!this.touchControls && this.scale.gameSize.width >= 600
      && this.isTargetInteractable(this.activeTarget));
    this.updateSurfacePrompt();
  }

  getAvailableMissionBodies() {
    const surfaceBodyIds = new Set(['moon', 'mars']);
    const missionBodyIds = new Set(
      this.equipmentMarkers
        .filter((marker) => this.isVisibleOnTimeline(marker)
          && surfaceBodyIds.has(marker.bodyId))
        .map((marker) => marker.bodyId),
    );
    return [...missionBodyIds]
      .map((bodyId) => this.celestialBodies.get(bodyId))
      .filter(Boolean);
  }

  getNearbyMissionBody() {
    const availableBodies = this.getAvailableMissionBodies();
    if (this.activeTarget && this.isTargetInteractable(this.activeTarget)) {
      const targetBodyId = this.activeTarget.bodyId ?? this.activeTarget.id;
      const targetBody = availableBodies.find((body) => body.id === targetBodyId);
      if (targetBody) return targetBody;
    }

    let nearestBody = null;
    let nearestDistance = Infinity;
    for (const body of availableBodies) {
      const centerDistance = this.getTargetDistance(body);
      const surfaceDistance = Math.max(0, centerDistance - body.radius);
      const tolerance = Math.max(body.radius * 1.5, 120);
      if (surfaceDistance <= tolerance && surfaceDistance < nearestDistance) {
        nearestBody = body;
        nearestDistance = surfaceDistance;
      }
    }

    return nearestBody;
  }

  updateSurfacePrompt() {
    if (this.infoPopupOpen) {
      this.proximityPanel.setVisible(false);
      return;
    }
    if (this.surfaceModeBodyId) {
      const interactableMission = this.activeTarget
        && this.activeTarget.bodyId === this.surfaceModeBodyId
        && this.isTargetInteractable(this.activeTarget);
      this.setProximityPrompt(interactableMission ? this.activeTarget.name : '',
        'exploration.actionLeaveSurface', Boolean(interactableMission));
      return;
    }

    const nearbyBody = this.getNearbyMissionBody();
    if (nearbyBody) {
      const interactable = this.activeTarget && this.isTargetInteractable(this.activeTarget);
      this.setProximityPrompt(interactable ? this.activeTarget.name : nearbyBody.name,
        'exploration.actionEnterSurface', Boolean(interactable));
      return;
    }

    if (this.activeTarget && this.isTargetInteractable(this.activeTarget)) {
      this.setProximityPrompt(this.activeTarget.name, null, true);
      return;
    }

    if (this.proximityPanel.visible) {
      this.tweens.killTweensOf(this.proximityPanel);
      this.proximityPanel.setVisible(false);
      this.movementHint.setY(this.scale.gameSize.height - 65);
    }
  }

  setProximityPrompt(name, surfaceAction, canInteract) {
    this.proximityName.setText(name);
    this.surfaceKeyHint.container.setVisible(Boolean(surfaceAction));
    if (surfaceAction) this.surfaceKeyHint.action.setText(translate(this.language, surfaceAction));
    this.interactKeyHint.container.setVisible(canInteract);
    if (canInteract) this.interactKeyHint.action.setText(translate(this.language, 'exploration.actionViewInfo'));
    const panelWidth = this.getProximityPanelWidth();
    this.interactKeyHint.container.x = -panelWidth / 2 + (surfaceAction
      ? Math.min(196, panelWidth - this.interactKeyHint.action.width - 42) : 14);
    if (!this.proximityPanel.visible) {
      this.proximityPanel.setVisible(true).setAlpha(0);
      this.tweens.add({ targets: this.proximityPanel, alpha: 1, duration: 180 });
    }
    if (this.scale.gameSize.width < 600) this.movementHint.setY(this.scale.gameSize.height - 145);
  }

  drawProximityBackground(panelWidth) {
    const height = gameConfig.visual.proximityPanelHeight;
    this.proximityBackground.clear();
    this.proximityBackground.fillStyle(Number.parseInt(gameConfig.palette.buttonFill.slice(1), 16), 0.94);
    this.proximityBackground.fillRoundedRect(-panelWidth / 2, -height / 2, panelWidth, height, 8);
    this.proximityBackground.lineStyle(1, Number.parseInt(gameConfig.palette.electric.slice(1), 16), 0.65);
    this.proximityBackground.strokeRoundedRect(-panelWidth / 2, -height / 2, panelWidth, height, 8);
  }

  getProximityPanelWidth() {
    const width = this.scale.gameSize.width;
    return this.touchControls
      ? Math.min(gameConfig.visual.proximityPanelWidth, Math.max(220, width - 332))
      : Math.min(gameConfig.visual.proximityPanelWidth, width - 32);
  }

  hideTouchControls() {
    this.touchControls?.setVisible(false);
  }

  showTouchControls() {
    this.touchControls?.setVisible(!this.infoPopupOpen);
  }

  toggleSurfaceMode() {
    if (this.surfaceModeBodyId) {
      this.surfaceModeBodyId = null;
      this.surfaceEntryTween?.stop();
      this.surfaceEntryTween = null;
      this.surfaceTerrain.setVisible(false);
      if (this.spacecraftSurfaceRestorePosition) {
        this.spacecraft.container.setPosition(
          this.spacecraftSurfaceRestorePosition.x,
          this.spacecraftSurfaceRestorePosition.y,
        );
        this.spacecraft.container.setRotation(this.spacecraftSurfaceRestorePosition.rotation);
        this.spacecraftSurfaceRestorePosition = null;
      }
      this.spacecraft.velocity.set(0, 0);
      this.equipmentMarkers.forEach((marker) => {
        marker.setOrbitalView(false);
        if (marker.surfaceRestorePosition) {
          marker.container.setPosition(
            marker.surfaceRestorePosition.x,
            marker.surfaceRestorePosition.y,
          );
          marker.surfaceRestorePosition = null;
        }
      });
      this.worldObjects.forEach((object) => object.setVisible(true));
      this.ambientDarkness.setVisible(true);
      this.flashlightGraphics.setVisible(this.flashlightEnabled);
      this.surfaceTerrain.setVisible(false);
      this.setSurfaceHudVisible(true);
      this.equipmentMarkers.forEach((marker) => {
        marker.container.setVisible(marker.timelineVisible);
      });
      this.spacecraft.container.setVisible(true);
      this.surfaceSpacecraftScale = this.spacecraft.container.scaleX;
      this.worldCamera.stopFollow();
      this.worldCamera.setBounds(0, 0, this.worldBounds.width, this.worldBounds.height);
      this.worldCamera.centerOn(this.spacecraft.x, this.spacecraft.y);
      this.worldCamera.startFollow(
        this.spacecraft.container,
        true,
        gameConfig.world.camera.lerpX,
        gameConfig.world.camera.lerpY,
      );
      this.worldCamera.setZoom(this.defaultCameraZoom);
      this.currentCameraZoom = this.defaultCameraZoom;
      if (this.activeTarget) this.activeTarget.setHighlighted(false);
      this.activeTarget = null;
      this.targetNameHUD.setVisible(false);
      this.surfaceObjectiveCounter.setVisible(false);
      this.updateZoomIndicator();
      this.updateSurfacePrompt();
      return;
    }

    const body = this.getNearbyMissionBody();
    if (!body || (body.id !== 'moon' && body.id !== 'mars')) return;

    this.surfaceModeBodyId = body.id;
    this.surfaceViewZoom = SURFACE_VIEW_ZOOM;
    const bounds = {
      x: body.x - SURFACE_MAP_WIDTH / 2,
      y: body.y - SURFACE_MAP_HEIGHT / 2,
      width: SURFACE_MAP_WIDTH,
      height: SURFACE_MAP_HEIGHT,
    };
    this.surfaceWorldBounds = bounds;
    this.drawSurfaceTerrain(body, bounds);
    this.spacecraftSurfaceRestorePosition = {
      x: this.spacecraft.x,
      y: this.spacecraft.y,
      rotation: this.spacecraft.container.rotation,
    };

    this.equipmentMarkers.forEach((marker) => {
      marker.surfaceRestorePosition = {
        x: marker.container.x,
        y: marker.container.y,
      };
    });

    const missionMarkers = this.equipmentMarkers.filter((marker) => (
      marker.bodyId === body.id && this.isVisibleOnTimeline(marker)
    ));
    const surfaceWaypoints = [
      0.2,
      0.36,
      0.52,
      0.68,
      0.82,
      0.93,
    ];
    missionMarkers.forEach((marker, index) => {
      const progress = surfaceWaypoints[index % surfaceWaypoints.length];
      const x = bounds.x + SURFACE_MAP_WIDTH * progress;
      const y = this.getSurfaceGroundY(bounds, progress) - 18;
      marker.container.setPosition(x - marker.localX, y - marker.localY);
    });

    this.worldObjects.forEach((object) => object.setVisible(false));
    this.ambientDarkness.setVisible(false);
    this.flashlightGraphics.setVisible(this.flashlightEnabled);
    this.surfaceTerrain.setVisible(true);
    this.spacecraft.container.setVisible(true);
    missionMarkers.forEach((marker) => {
      marker.container.setVisible(true);
      marker.setOrbitalView(true, this.surfaceViewZoom);
    });
    this.setSurfaceHudVisible(false);

    this.worldCamera.stopFollow();
    this.worldCamera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    this.worldCamera.setZoom(this.surfaceViewZoom);
    this.currentCameraZoom = this.surfaceViewZoom;
    const targetX = bounds.x + SURFACE_MAP_WIDTH * 0.06;
    const targetY = this.getSurfaceGroundY(bounds, 0.06) - 70;
    this.spacecraft.velocity.set(0, 0);
    this.surfaceEntryTween?.stop();
    this.surfaceEntryTween = this.tweens.add({
      targets: this.spacecraft.container,
      x: targetX,
      y: targetY,
      duration: 900,
      ease: 'Sine.Out',
      onComplete: () => {
        this.surfaceEntryTween = null;
      },
    });
    this.worldCamera.startFollow(
      this.spacecraft.container,
      true,
      gameConfig.world.camera.lerpX * 1.8,
      gameConfig.world.camera.lerpY * 1.8,
    );
    if (this.activeTarget) this.activeTarget.setHighlighted(false);
    this.activeTarget = null;
    this.targetNameHUD.setVisible(false);
    this.updateZoomIndicator();
    this.updateSurfaceObjectiveCounter();
    this.updateSurfacePrompt();
  }

  updateSurfaceObjectiveCounter() {
    if (!this.surfaceModeBodyId || !this.surfaceObjectiveCounter) {
      this.surfaceObjectiveCounter?.setVisible(false);
      return;
    }

    const surfaceMissions = this.equipmentMarkers.filter((marker) => (
      marker.bodyId === this.surfaceModeBodyId && this.isVisibleOnTimeline(marker)
    ));
    const foundCount = surfaceMissions.filter((marker) => (
      this.rememberedMissionIds.has(marker.id)
    )).length;
    const label = translate(this.language, 'exploration.surfaceMode.objectiveCount');
    this.surfaceObjectiveCounter
      .setText(label.replace('{found}', foundCount).replace('{total}', surfaceMissions.length))
      .setVisible(true);
  }

  setSurfaceHudVisible(value) {
    [
      this.timelineGraphics,
      this.timelineYearLabel,
      this.timelineStartLabel,
      this.timelineEndLabel,
      this.timelineTitle,
      this.timelineTrackZone,
      this.timelineMilestoneNotice,
    ].forEach((element) => element?.setVisible(value));
  }

  drawSurfaceTerrain(body, bounds) {
    const isMars = body.id === 'mars';
    const color = (key) => Number.parseInt(gameConfig.palette[key].slice(1), 16);
    const worldX = (ratio) => bounds.x + bounds.width * ratio;
    const worldY = (ratio) => bounds.y + bounds.height * ratio;
    const drawPolygon = (points, fillColor, alpha) => {
      this.surfaceTerrain.fillStyle(fillColor, alpha);
      this.surfaceTerrain.fillPoints(
        points.map(([x, y]) => new Phaser.Geom.Point(worldX(x), worldY(y))),
        true,
      );
    };

    this.surfaceTerrain.clear();
    if (isMars) {
      this.surfaceTerrain.fillGradientStyle(
        color('marsDark'),
        color('mars'),
        color('sun'),
        color('marsRim'),
        1,
      );
    } else {
      this.surfaceTerrain.fillStyle(color('background'), 1);
    }
    this.surfaceTerrain.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

    if (!isMars) {
      this.surfaceTerrain.fillStyle(color('star'), 0.72);
      for (let index = 0; index < 110; index += 1) {
        const x = ((index * 127 + 41) % 997) / 997;
        const y = ((index * 73 + 19) % 503) / 503;
        const radius = index % 9 === 0 ? 2 : 1;
        this.surfaceTerrain.fillCircle(worldX(x), worldY(y * 0.54), radius);
      }

      const earthX = worldX(0.73);
      const earthY = worldY(0.43);
      this.surfaceTerrain.fillStyle(color('earth'), 1);
      this.surfaceTerrain.fillCircle(earthX, earthY, 62);
      this.surfaceTerrain.lineStyle(3, color('iceHighlight'), 0.8);
      this.surfaceTerrain.strokeCircle(earthX, earthY, 62);
      this.surfaceTerrain.fillStyle(color('earthLand'), 0.88);
      this.surfaceTerrain.fillEllipse(earthX - 18, earthY - 8, 33, 25);
      this.surfaceTerrain.fillEllipse(earthX + 21, earthY + 18, 20, 32);
    } else {
      const sunX = worldX(0.86);
      const sunY = worldY(0.44);
      this.surfaceTerrain.fillStyle(color('sunFlare'), 0.82);
      this.surfaceTerrain.fillCircle(sunX, sunY, 42);
      this.surfaceTerrain.fillStyle(color('sunCorona'), 0.16);
      this.surfaceTerrain.fillCircle(sunX, sunY, 92);
    }

    drawPolygon(
      [[0, 0.7], [0.08, 0.57], [0.15, 0.68], [0.25, 0.53], [0.34, 0.67],
        [0.45, 0.55], [0.54, 0.68], [0.66, 0.52], [0.76, 0.66], [0.88, 0.55],
        [1, 0.68], [1, 1], [0, 1]],
      color(isMars ? 'marsDark' : 'moonCrater'),
      isMars ? 0.72 : 0.9,
    );
    drawPolygon(
      [[0, 0.73], [0.12, 0.65], [0.22, 0.72], [0.36, 0.62], [0.47, 0.71],
        [0.59, 0.64], [0.71, 0.72], [0.83, 0.63], [1, 0.71], [1, 1], [0, 1]],
      color(isMars ? 'mars' : 'moon'),
      isMars ? 0.58 : 0.72,
    );

    const groundProfile = SURFACE_GROUND_PROFILE.map(([x, y]) => [x, y]);
    drawPolygon(
      [...groundProfile, [1, 1], [0, 1]],
      color(isMars ? 'marsDark' : 'moonCrater'),
      1,
    );
    this.surfaceTerrain.lineStyle(4, color(isMars ? 'marsRim' : 'moon'), 0.72);
    this.surfaceTerrain.beginPath();
    groundProfile.forEach(([x, y], index) => {
      if (index === 0) this.surfaceTerrain.moveTo(worldX(x), worldY(y));
      else this.surfaceTerrain.lineTo(worldX(x), worldY(y));
    });
    this.surfaceTerrain.strokePath();

    const craterXs = [0.12, 0.27, 0.39, 0.61, 0.77, 0.9];
    craterXs.forEach((x, index) => {
      const y = this.getSurfaceGroundY(bounds, x) + 22;
      const craterWidth = 34 + (index % 3) * 12;
      const craterHeight = craterWidth * 0.36;
      this.surfaceTerrain.fillStyle(color(isMars ? 'marsDark' : 'background'), 0.42);
      this.surfaceTerrain.fillEllipse(worldX(x), y, craterWidth, craterHeight);
      this.surfaceTerrain.lineStyle(2, color(isMars ? 'marsRim' : 'metal'), 0.55);
      this.surfaceTerrain.strokeEllipse(worldX(x), y, craterWidth, craterHeight);
    });

    const rockXs = [0.06, 0.16, 0.32, 0.47, 0.58, 0.72, 0.86, 0.97];
    rockXs.forEach((x, index) => {
      const groundY = this.getSurfaceGroundY(bounds, x);
      const rockX = worldX(x);
      const rockY = groundY - (12 + (index % 3) * 5);
      const size = 10 + (index % 4) * 5;
      this.surfaceTerrain.fillStyle(color(isMars ? 'marsRim' : 'metal'), 0.7);
      this.surfaceTerrain.fillPoints([
        new Phaser.Geom.Point(rockX - size, rockY + 5),
        new Phaser.Geom.Point(rockX - size * 0.45, rockY - size),
        new Phaser.Geom.Point(rockX + size * 0.3, rockY - size * 0.72),
        new Phaser.Geom.Point(rockX + size, rockY + 5),
      ], true);
    });
  }

  getSurfaceGroundY(bounds, progress) {
    const segmentIndex = SURFACE_GROUND_PROFILE.findIndex(([nextX], index) => (
      index < SURFACE_GROUND_PROFILE.length - 1
      && progress <= nextX
    ));
    const leftIndex = segmentIndex < 0 ? SURFACE_GROUND_PROFILE.length - 2 : segmentIndex;
    const [leftX, leftY] = SURFACE_GROUND_PROFILE[leftIndex];
    const [rightX, rightY] = SURFACE_GROUND_PROFILE[leftIndex + 1];
    const ratio = Phaser.Math.Clamp((progress - leftX) / (rightX - leftX), 0, 1);
    return bounds.y + bounds.height * Phaser.Math.Linear(leftY, rightY, ratio);
  }

  updateSurfaceView(delta) {
    if (!this.worldCamera) return;
    const inSurfaceMode = Boolean(this.surfaceModeBodyId);
    const targetZoom = inSurfaceMode ? this.surfaceViewZoom : this.defaultCameraZoom;
    const targetScale = inSurfaceMode ? SURFACE_SPACECRAFT_SCALE : 1;
    const scaleSmoothing = 1 - Math.exp(-delta / 480);
    this.surfaceSpacecraftScale = Phaser.Math.Linear(
      this.surfaceSpacecraftScale,
      targetScale,
      scaleSmoothing,
    );
    this.spacecraft.container.setScale(this.surfaceSpacecraftScale);

    const zoomSmoothing = 1 - Math.exp(-delta / 560);
    this.currentCameraZoom = Phaser.Math.Linear(
      this.currentCameraZoom,
      targetZoom,
      zoomSmoothing,
    );
    if (Math.abs(this.worldCamera.zoom - this.currentCameraZoom) > 0.001) {
      this.worldCamera.setZoom(this.currentCameraZoom);
      this.updateZoomIndicator();
    }
  }

  positionProximityPanel() {
    const { width, height } = this.scale.gameSize;
    const panelWidth = this.getProximityPanelWidth();
    this.drawProximityBackground(panelWidth);
    this.proximityName.setWordWrapWidth(panelWidth - 28, true);
    this.proximityName.setPosition(-panelWidth / 2 + 14, -18);
    this.surfaceKeyHint.container.setPosition(-panelWidth / 2 + 14, 16);
    this.interactKeyHint.container.setPosition(-panelWidth / 2
      + (this.surfaceKeyHint.container.visible ? Math.min(196, panelWidth - 92) : 14), 16);
    this.proximityPanel.setPosition(
      width / 2,
      height - gameConfig.visual.proximityPanelHeight / 2 - 62,
    );
  }

  getTargetPosition(target) {
    if (target.container) {
      return {
        x: target.container.x + (target.localX ?? 0),
        y: target.container.y + (target.localY ?? 0),
      };
    }

    return { x: target.x, y: target.y };
  }

  getTargetDistance(target) {
    const targetX = target.container
      ? target.container.x + (target.localX ?? 0)
      : target.x;
    const targetY = target.container
      ? target.container.y + (target.localY ?? 0)
      : target.y;
    return Math.hypot(this.spacecraft.x - targetX, this.spacecraft.y - targetY);
  }

  isTargetInteractable(target) {
    const distance = this.getTargetDistance(target);
    return distance - target.proximityRadius <= gameConfig.world.proximity.interactionRadius;
  }

  createInfoPopup() {
    const width = gameConfig.visual.infoPopupWidth;
    const height = gameConfig.visual.infoPopupHeight;
    const padding = gameConfig.visual.infoPopupPadding;
    const contentWidth = width - padding * 2;
    const contentTop = -height / 2 + padding + 88;
    const contentHeight = height - padding * 2 - 150;
    const contentLeft = -width / 2 + padding;
    const fillColor = Number.parseInt(gameConfig.palette.buttonFill.slice(1), 16);
    const borderColor = Number.parseInt(gameConfig.palette.electric.slice(1), 16);

    this.infoPopup = this.add.container(0, 0).setDepth(1100).setVisible(false);
    this.infoPopupHeight = height;
    this.infoPopupBackground = this.add
      .rectangle(0, 0, width, height, fillColor, 0.97)
      .setStrokeStyle(1.5, borderColor, 0.95);
    this.infoPopupIcon = this.add
      .circle(-width / 2 + padding + 16, -height / 2 + padding + 16, 15,
        Number.parseInt(gameConfig.palette.proximity.slice(1), 16))
      .setStrokeStyle(2, Number.parseInt(gameConfig.palette.text.slice(1), 16), 0.9);
    this.infoPopupTitle = this.add.text(-width / 2 + padding + 42, -height / 2 + padding, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupTitleFontSize}px`,
      fontStyle: 'bold',
      color: gameConfig.palette.text,
      lineSpacing: 2,
      wordWrap: { width: width - padding * 2 - 112 },
    });
    this.infoPopupArchiveLabel = this.add.text(
      -width / 2 + padding + 42,
      -height / 2 + padding,
      translate(this.language, 'exploration.archive.title'),
      {
        fontFamily: gameConfig.visual.monoFontFamily,
        fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
        fontStyle: 'bold',
        color: gameConfig.palette.electric,
        letterSpacing: 1,
      },
    );
    this.infoPopupClose = this.add.text(width / 2 - padding, -height / 2 + padding, translate(this.language, 'buttons.close'), {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupCloseFontSize}px`,
      color: gameConfig.palette.electric,
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.infoPopupClose.on('pointerdown', () => this.closeInfoPopup());

    this.infoPopupBody = this.add.text(contentLeft, contentTop, '', {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: `${gameConfig.visual.infoPopupBodyFontSize}px`,
      color: gameConfig.palette.text,
      lineSpacing: 6,
      wordWrap: { width: contentWidth },
    });
    this.infoPopupGallery = this.add.container(0, 0).setVisible(false);
    this.infoPopupContent = this.add.container(0, 0);
    this.infoPopupStatusBadge = this.add.text(0, 0, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
      fontStyle: 'bold',
      color: gameConfig.palette.electric,
      backgroundColor: gameConfig.palette.buttonHover,
      padding: { left: 10, right: 10, top: 6, bottom: 6 },
      wordWrap: { width: contentWidth },
    }).setVisible(false);
    this.infoPopupContent.add([
      this.infoPopupStatusBadge,
      this.infoPopupBody,
      this.infoPopupGallery,
    ]);

    this.infoPopupTabButtons = {};
    const tabKeys = ['story', 'science', 'status'];
    const tabWidth = (width - padding * 2 - 16) / tabKeys.length;
    tabKeys.forEach((tab, index) => {
      const button = this.add.text(0, 0, translate(this.language, `exploration.archive.tabs.${tab}`), {
        fontFamily: gameConfig.visual.monoFontFamily,
        fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
        color: gameConfig.palette.muted,
        align: 'center',
        backgroundColor: gameConfig.palette.background,
        padding: { left: 8, right: 8, top: 9, bottom: 9 },
        fixedWidth: tabWidth,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => this.setInfoPopupTab(tab));
      this.infoPopupTabButtons[tab] = button;
    });

    this.infoPopupContentMaskSource = this.make.graphics({ x: 0, y: 0, add: false });
    this.infoPopupContentMaskSource.fillStyle(0xffffff, 1);
    this.infoPopupContentMaskSource.fillRect(contentLeft, contentTop, contentWidth, contentHeight);
    this.infoPopupContent.setMask(this.infoPopupContentMaskSource.createGeometryMask());

    this.infoPopup.add([
      this.infoPopupBackground,
      this.infoPopupIcon,
      this.infoPopupArchiveLabel,
      this.infoPopupTitle,
      this.infoPopupClose,
      this.infoPopupContent,
    ]);
    this.infoPopup.add(Object.values(this.infoPopupTabButtons));
    this.hud.add(this.infoPopup);

    this.input.on('wheel', this.handleInfoPopupWheel, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('wheel', this.handleInfoPopupWheel, this);
      this.infoPopupContentMaskSource.destroy();
      this.infoPopupImageMaskSource?.destroy();
    });
  }

  setInfoPopupTab(tab) {
    this.infoPopupTab = tab;
    this.infoPopupScrollOffset = 0;
    this.infoPopupContent.setY(0);

    const content = this.getArchiveContent(this.infoPopupTarget);
    this.infoPopupBody.setText(content[tab] ?? '');
    this.infoPopupStatusBadge
      .setText(content.status ?? '')
      .setVisible(tab === 'status');
    this.infoPopupStatusDetails = content.statusDetails ?? '';
    this.infoPopupTabButtons.story.setColor(
      tab === 'story' ? gameConfig.palette.text : gameConfig.palette.muted,
    ).setBackgroundColor(tab === 'story'
      ? gameConfig.palette.buttonHover
      : gameConfig.palette.background);
    this.infoPopupTabButtons.science.setColor(
      tab === 'science' ? gameConfig.palette.text : gameConfig.palette.muted,
    ).setBackgroundColor(tab === 'science'
      ? gameConfig.palette.buttonHover
      : gameConfig.palette.background);
    this.infoPopupTabButtons.status.setColor(
      tab === 'status' ? gameConfig.palette.text : gameConfig.palette.muted,
    ).setBackgroundColor(tab === 'status'
      ? gameConfig.palette.buttonHover
      : gameConfig.palette.background);

    if (tab === 'status') this.infoPopupBody.setText(content.statusDetails ?? '');
    const statusOffset = tab === 'status'
      ? this.infoPopupStatusBadge.height + 12
      : 0;
    const galleryHeight = tab === 'science' && this.infoPopupGalleryItems.length > 0
      ? gameConfig.visual.infoPopupGalleryGap
        + gameConfig.visual.infoPopupGalleryImageHeight
        + 54
      : 0;
    this.infoPopupContentHeight = this.infoPopupBody.height + statusOffset + galleryHeight;
    this.resizeInfoPopupToContent();
    this.updateInfoPopupScrollBounds();
  }

  getArchiveContent(target) {
    const data = target.data;
    const getField = (field) => localizedField(data, field, this.language);
    const labels = translate(this.language, 'exploration.infoLabels');

    if (data.equipmentType) {
      return {
        story: getField('legacyStory') ?? getField('description') ?? '',
        science: getField('scienceDiscoveries')
          ?? getField('scientificDescription')
          ?? getField('discoveries')
          ?? '',
        status: getField('currentStatus') ?? getField('operationalStatus') ?? '',
        statusDetails: [
          getField('equipmentType')
            && `${labels.category}: ${getField('equipmentType')}`,
          data.launchYear && `${labels.launchYear}: ${data.launchYear}`,
          getField('missionDuration')
            && `${translate(this.language, 'exploration.archive.duration')}: ${getField('missionDuration')}`,
          getField('mapPlacementNote'),
        ].filter(Boolean).join('\n'),
      };
    }

    if (data.type === 'star') {
      return {
        story: getField('description') ?? '',
        science: [
          `${labels.spectralType}: ${data.spectralType}`,
          `${labels.surfaceTemperature}: ${Number(data.surfaceTemperatureK).toLocaleString(
            this.language === 'en' ? 'en-US' : 'es-ES',
          )} K`,
          `${labels.mass}: ${getField('mass')}`,
          `${labels.composition}: ${(getField('composition') ?? []).join(' · ')}`,
        ].join('\n\n'),
        status: translate(this.language, 'exploration.archive.starStatus'),
        statusDetails: translate(this.language, 'exploration.archive.noMission'),
      };
    }

    const isMoon = data.type === 'moon';
    const parent = isMoon ? this.celestialBodies.get(data.parentId) : null;
    const history = isMoon ? getField('discoveryHistory') : getField('observationHistory');
    const science = isMoon
      ? [getField('scientificImportance'), getField('interestingFact')]
      : [getField('characteristics')?.join('\n'), getField('interestingFact')];

    return {
      story: [getField('description'), history].filter(Boolean).join('\n\n'),
      science: [
        isMoon && parent ? `${labels.parent}: ${parent.name}` : null,
        ...science,
      ].filter(Boolean).join('\n\n'),
      status: translate(
        this.language,
        isMoon ? 'exploration.archive.naturalSatellite' : 'exploration.archive.naturalWorld',
      ),
      statusDetails: translate(this.language, 'exploration.archive.noMission'),
    };
  }

  resizeInfoPopupToContent() {
    const width = gameConfig.visual.infoPopupWidth;
    const padding = gameConfig.visual.infoPopupPadding;
    const maxHeight = gameConfig.visual.infoPopupHeight;
    const minHeight = gameConfig.visual.infoPopupMinHeight;
    const titleWidth = width - padding * 2 - 112;
    const title = this.infoPopupTitle.text;
    const titleFontSize = title.length > 44
      ? gameConfig.visual.infoPopupTitleFontSize - 4
      : title.length > 32
        ? gameConfig.visual.infoPopupTitleFontSize - 2
        : gameConfig.visual.infoPopupTitleFontSize;
    this.infoPopupTitle
      .setFontSize(titleFontSize)
      .setWordWrapWidth(titleWidth, true);
    const tabOffset = Math.max(58, 18 + this.infoPopupTitle.height + 12);
    const contentTopOffset = tabOffset + 34;
    const contentBottomPadding = 36;
    this.infoPopupHeight = Phaser.Math.Clamp(
      this.infoPopupContentHeight
        + padding * 2
        + contentTopOffset
        + contentBottomPadding,
      minHeight,
      maxHeight,
    );
    this.infoPopupContentTopOffset = contentTopOffset;

    const top = -this.infoPopupHeight / 2 + padding;
    this.infoPopupBackground.setSize(width, this.infoPopupHeight);
    this.infoPopupIcon.setPosition(-width / 2 + padding + 16, top + 16);
    this.infoPopupArchiveLabel.setPosition(-width / 2 + padding + 42, top);
    this.infoPopupTitle.setPosition(-width / 2 + padding + 42, top + 18);
    this.infoPopupClose.setPosition(width / 2 - padding, top);
    const tabY = top + tabOffset;
    Object.values(this.infoPopupTabButtons).forEach((button, index) => {
      button.setPosition(
        -width / 2 + padding + (index + 0.5) * (width - padding * 2 - 16) / 3 + index * 8,
        tabY,
      );
    });
    const contentTop = top + contentTopOffset;
    this.infoPopupStatusBadge.setPosition(-width / 2 + padding, contentTop);
    this.infoPopupBody.setPosition(
      -width / 2 + padding,
      contentTop + (this.infoPopupTab === 'status'
        ? this.infoPopupStatusBadge.height + 12
        : 0),
    );

    if (this.infoPopupGalleryItems?.length) {
      this.infoPopupGalleryY = this.infoPopupBody.y
        + this.infoPopupBody.height
        + gameConfig.visual.infoPopupGalleryGap
        + gameConfig.visual.infoPopupGalleryImageHeight / 2;
      this.infoPopupGallery.setPosition(0, this.infoPopupGalleryY);
    }

    const contentHeight = this.infoPopupHeight
      - padding * 2
      - contentTopOffset
      - contentBottomPadding;
    this.infoPopupContentMaskSource.clear();
    this.infoPopupContentMaskSource.fillStyle(0xffffff, 1);
    this.infoPopupContentMaskSource.fillRect(
      -width / 2 + padding,
      contentTop,
      width - padding * 2,
      contentHeight,
    );
    this.infoPopupBody.setWordWrapWidth(width - padding * 2, true);
    this.infoPopupGallery.setVisible(
      this.infoPopupTab === 'science' && this.infoPopupGalleryItems.length > 0,
    );
    if (this.infoPopupTab === 'status') {
      this.infoPopupStatusBadge.setText(
        this.getArchiveContent(this.infoPopupTarget).status ?? '',
      );
      this.infoPopupBody.setText(this.infoPopupStatusDetails);
    }
  }

  openInfoPopup(target) {
    const alreadyDiscovered = this.discoveredIds.has(target.id);
    this.discoveredIds.add(target.id);
    this.nextGuideSelection = 0;
    let completed = false;
    if (!alreadyDiscovered) {
      if (this.manualGuideTargetId === target.id) this.manualGuideTargetId = null;
      this.updateDiscoveryCounter();
      completed = this.discoveryTotal > 0 && this.discoveredIds.size === this.discoveryTotal;
    }
    if (target.data.equipmentType) {
      this.rememberLegacy(target.id);
      this.updateSurfaceObjectiveCounter();
    }
    this.infoPopupTarget = target;
    this.infoPopupTitle.setText(localizedField(target.data, 'name', this.language) ?? target.name);
    this.infoPopupScrollOffset = 0;
    this.infoPopupContent.setY(0);
    this.populateInfoGallery(target);
    this.setInfoPopupTab('story');

    const visual = target.data.visual;
    const colorKey = visual?.colorKey ?? visual?.accentColorKey;
    const iconColor = colorKey
      ? gameConfig.palette[colorKey]
      : gameConfig.palette.proximity;
    this.infoPopupIcon.setFillStyle(Number.parseInt(iconColor.slice(1), 16), 1);
    this.infoPopupOpen = true;
    this.infoPopup.setVisible(true);
    this.hideTouchControls();
    this.proximityPanel.setVisible(false);
    this.setCompactPopupHud();
    this.positionInfoPopup();
    if (completed) this.showExplorationCompletion();
    this.loadInfoGallery(target);
  }

  updateDiscoveryCounter() {
    this.discoveryCounter.setText(`${this.discoveredIds.size} / ${this.discoveryTotal}`);
    this.discoveryProgress.setSize(192 * (this.discoveryTotal ? this.discoveredIds.size / this.discoveryTotal : 0), 4);
  }

  updateMusicButton() {
    const enabled = this.ambientMusic.enabled;
    this.musicIcon.setAlpha(enabled ? 1 : 0.4);
    this.musicMutedMark.setVisible(!enabled);
    this.musicState.setText(translate(this.language, enabled ? 'exploration.musicOn' : 'exploration.musicOff'));
    this.musicTooltip.setText(translate(this.language, enabled ? 'exploration.musicMute' : 'exploration.musicEnable'));
    const position = 4 + this.ambientMusic.volume * 76;
    this.musicVolumeGraphics.clear();
    this.musicVolumeGraphics.lineStyle(3, 0x304151, 1);
    this.musicVolumeGraphics.lineBetween(4, 0, 80, 0);
    this.musicVolumeGraphics.lineStyle(3, Number.parseInt(gameConfig.palette.electric.slice(1), 16), 0.9);
    this.musicVolumeGraphics.lineBetween(4, 0, position, 0);
    this.musicVolumeGraphics.fillStyle(Number.parseInt(gameConfig.palette.text.slice(1), 16), 1);
    this.musicVolumeGraphics.fillCircle(position, 0, 5);
    this.musicVolumeValue.setText(`${Math.round(this.ambientMusic.volume * 100)}%`);
  }

  setMusicVolumeFromPointer(pointer) {
    const volume = Phaser.Math.Clamp((pointer.x - this.musicVolumeControl.x - 4) / 76, 0, 1);
    this.ambientMusic.setVolume(volume);
    this.updateMusicButton();
  }

  showExplorationCompletion() {
    const message = translate(this.language, 'exploration.explorationComplete')
      .replace('{found}', this.discoveredIds.size)
      .replace('{total}', this.discoveryTotal);
    this.completionNotice.setText(message);
    const { width, height } = this.scale.gameSize;
    const halfHeight = this.completionNotice.height / 2;
    let noticeY = 260;
    if (this.infoPopupOpen) {
      const popupHalfWidth = gameConfig.visual.infoPopupWidth * this.infoPopup.scaleX / 2;
      const popupHalfHeight = this.infoPopupHeight * this.infoPopup.scaleY / 2;
      const overlapsX = Math.abs(width / 2 - this.infoPopup.x)
        < this.completionNotice.width / 2 + popupHalfWidth;
      const overlapsY = Math.abs(noticeY - this.infoPopup.y) < halfHeight + popupHalfHeight;
      if (overlapsX && overlapsY) {
        const below = this.infoPopup.y + popupHalfHeight + halfHeight + 12;
        const above = this.infoPopup.y - popupHalfHeight - halfHeight - 12;
        if (below <= height - 150) noticeY = below;
        else if (above >= 235) noticeY = above;
        else {
          this.completionPending = true;
          return;
        }
      }
    }
    this.completionPending = false;
    this.completionNotice.setPosition(width / 2, noticeY).setVisible(true).setAlpha(1);
    this.hud.bringToTop(this.completionNotice);
    this.tweens.add({ targets: this.completionNotice, alpha: 0, delay: 5000, duration: 800,
      onComplete: () => this.completionNotice.setVisible(false) });
  }

  isGuideTargetAvailable(target, includeDiscovered = false) {
    return (includeDiscovered || !this.discoveredIds.has(target.id)) && this.isVisibleOnTimeline(target)
      && (!this.surfaceModeBodyId || target.bodyId === this.surfaceModeBodyId);
  }

  createGuideOrder() {
    const children = new Map();
    const deepSpace = [];
    for (const target of this.targets) {
      if (target.data.missionCategory === 'deep-space') {
        deepSpace.push(target);
        continue;
      }
      const parentId = target.data.parentId ?? target.bodyId;
      if (!parentId) continue;
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(target);
    }
    for (const group of children.values()) {
      group.sort((first, second) => (first.data.distanceFromParentKm ?? Infinity)
        - (second.data.distanceFromParentKm ?? Infinity));
    }
    const result = [];
    const visited = new Set();
    const append = (target) => {
      if (!target || visited.has(target.id)) return;
      visited.add(target.id);
      result.push(target);
      for (const child of children.get(target.id) ?? []) append(child);
    };
    append(this.celestialBodies.get('sun'));
    const planets = this.planetsData.objects.slice()
      .sort((first, second) => first.distanceFromSunKm - second.distanceFromSunKm);
    for (const planet of planets) append(this.celestialBodies.get(planet.id));
    for (const target of this.targets) {
      if (target.data.missionCategory !== 'deep-space') append(target);
    }
    deepSpace.sort((first, second) => first.id.localeCompare(second.id));
    for (const target of deepSpace) append(target);
    return result;
  }

  selectNextGuideTarget() {
    const available = this.orderedGuideTargets.filter((target) => this.isGuideTargetAvailable(target, true));
    if (available.length === 0) return;
    const currentIndex = available.findIndex((target) => target.id === this.guideTarget?.id);
    this.manualGuideTargetId = available[(currentIndex + 1) % available.length].id;
    this.nextGuideSelection = 0;
    this.updateExplorationGuide(this.time.now);
  }

  updateExplorationGuide(time) {
    if (time >= this.nextGuideSelection) {
      this.nextGuideSelection = time + 250;
      const selected = this.orderedGuideTargets.find((target) => target.id === this.manualGuideTargetId
        && this.isGuideTargetAvailable(target, true))
        ?? this.orderedGuideTargets.find((target) => this.isGuideTargetAvailable(target));
      this.guideTarget = selected;
      if (!selected || selected.id !== this.manualGuideTargetId) this.manualGuideTargetId = null;
      this.discoveryDestinationTitle.setText(translate(this.language, this.manualGuideTargetId
        ? 'exploration.selectedDestination' : 'exploration.nextDestination'));
      this.discoveryDestination.setText(selected?.name ?? translate(this.language, 'exploration.noDestination'));
      if (selected) this.guideLabel.setText(`${selected.name} · ${Math.round(this.getTargetDistance(selected))} UN`);
    }

    const target = this.guideTarget;
    if (!target || this.infoPopupOpen) {
      this.guideArrow.setVisible(false);
      this.guideLabel.setVisible(false);
      return;
    }
    const camera = this.worldCamera;
    const { width, height } = this.scale.gameSize;
    const position = this.getTargetPosition(target);
    const targetX = camera.x + (position.x - camera.worldView.x) * camera.zoom;
    const targetY = camera.y + (position.y - camera.worldView.y) * camera.zoom;
    const onScreen = targetX >= 0 && targetX <= width && targetY >= 0 && targetY <= height;
    if (onScreen) {
      this.guideArrow.setVisible(false);
      this.guideLabel.setVisible(false);
      return;
    }

    const directionX = targetX - width / 2;
    const directionY = targetY - height / 2;
    const limitX = (width / 2 - 30) / Math.max(Math.abs(directionX), 0.001);
    const limitY = Math.max(20, height / 2 - 90) / Math.max(Math.abs(directionY), 0.001);
    const distance = Math.min(limitX, limitY);
    const arrowX = width / 2 + directionX * distance;
    let arrowY = height / 2 + directionY * distance;
    const angle = Math.atan2(directionY, directionX);
    const besideJoystick = Boolean(this.touchControls && arrowX < 110);
    if (besideJoystick) arrowY = height - (height <= 340 ? 53 : 65);
    this.guideArrow.setPosition(arrowX, arrowY).setRotation(angle).setVisible(true);
    const labelHalfWidth = Math.min(this.guideLabel.width / 2, width / 2 - 8);
    this.guideLabel.setPosition(
      Phaser.Math.Clamp(besideJoystick ? arrowX + labelHalfWidth + 16 : arrowX,
        labelHalfWidth + 8, width - labelHalfWidth - 8),
      besideJoystick ? arrowY
        : Phaser.Math.Clamp(arrowY + (arrowY < height / 2 ? 19 : -19), 92, height - 92),
    ).setVisible(true);
  }

  loadInfoGallery(target) {
    const galleryIds = new Set((target.data.gallery ?? []).map((item) => item.assetId));
    const missingImages = this.assets.images.filter((image) => (
      galleryIds.has(image.id) && !this.textures.exists(image.id)
    ));
    if (missingImages.length === 0) return;

    missingImages.forEach((image) => this.queueImage(image));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (!this.scene.isActive() || !this.infoPopupOpen || this.infoPopupTarget !== target) return;
      const scrollOffset = this.infoPopupScrollOffset;
      this.populateInfoGallery(target);
      this.setInfoPopupTab(this.infoPopupTab);
      this.infoPopupScrollOffset = Math.min(scrollOffset, this.infoPopupScrollMax);
      this.infoPopupContent.setY(-this.infoPopupScrollOffset);
      this.positionInfoPopup();
    });
    if (!this.load.isLoading()) this.load.start();
  }

  populateInfoGallery(target) {
    this.infoPopupGallery.removeAll(true);
    this.infoPopupGallery.setVisible(false);
    this.infoPopupImageMaskSource?.destroy();
    this.infoPopupImageMaskSource = null;
    this.infoPopupImageMask = null;
    this.infoPopupImage = null;
    this.infoPopupGalleryItems = (target.data.gallery ?? []).filter((item) => (
      item.assetId
      && this.assets.images.some((asset) => asset.id === item.assetId)
      && this.textures.exists(item.assetId)
    ));
    this.infoPopupScrollOffset = 0;
    this.infoPopupContent.setY(0);

    if (this.infoPopupGalleryItems.length === 0) return;

    const width = gameConfig.visual.infoPopupWidth - gameConfig.visual.infoPopupPadding * 2;
    const imageHeight = gameConfig.visual.infoPopupGalleryImageHeight;
    const imageWidth = width;
    const frame = this.add.graphics();
    frame.fillStyle(Number.parseInt(gameConfig.palette.background.slice(1), 16), 0.92);
    frame.fillRoundedRect(-imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight, 8);
    frame.lineStyle(1, Number.parseInt(gameConfig.palette.electric.slice(1), 16), 0.62);
    frame.strokeRoundedRect(-imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight, 8);
    this.infoPopupGallery.add(frame);

    this.infoPopupImage = this.add.image(0, 0, this.infoPopupGalleryItems[0].assetId);
    this.fitInfoPopupImage();
    this.infoPopupImageMaskSource = this.make.graphics({ x: 0, y: 0, add: false });
    this.infoPopupImageMaskSource.fillStyle(0xffffff, 1);
    this.infoPopupImageMaskSource.fillRoundedRect(-imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight, 8);
    this.infoPopupImageMask = this.infoPopupImageMaskSource.createGeometryMask();
    this.infoPopupImage.setMask(this.infoPopupImageMask);
    this.infoPopupGallery.add(this.infoPopupImage);

    this.infoPopupCaption = this.add.text(0, imageHeight / 2 + 8, '', {
      fontFamily: gameConfig.visual.bodyFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCaptionFontSize}px`,
      color: gameConfig.palette.text,
      align: 'center',
      wordWrap: { width: imageWidth - 24 },
    }).setOrigin(0.5, 0);
    this.infoPopupCredit = this.add.text(0, imageHeight / 2 + 29, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
      color: gameConfig.palette.muted,
      align: 'center',
    }).setOrigin(0.5, 0);
    this.infoPopupGallery.add([this.infoPopupCaption, this.infoPopupCredit]);

    if (this.infoPopupGalleryItems.length > 1) this.createInfoGalleryControls(imageWidth, imageHeight);
    this.infoPopupGalleryIndex = 0;
    this.updateInfoGallerySlide();
  }

  createInfoGalleryControls(width, imageHeight) {
    const controlY = imageHeight / 2 + 48;
    const color = gameConfig.palette.electric;
    const createControl = (x, label, onPress) => {
      const control = this.add.text(x, controlY, label, {
        fontFamily: gameConfig.visual.monoFontFamily,
        fontSize: `${gameConfig.visual.infoPopupGalleryControlFontSize}px`,
        color,
        backgroundColor: gameConfig.palette.buttonFill,
        padding: { left: 8, right: 8, top: 3, bottom: 3 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      control.on('pointerdown', onPress);
      this.infoPopupGallery.add(control);
    };

    createControl(-width / 2 + 22, '<', () => this.changeInfoGallerySlide(-1));
    createControl(width / 2 - 22, '>', () => this.changeInfoGallerySlide(1));
    this.infoPopupGalleryCounter = this.add.text(0, controlY, '', {
      fontFamily: gameConfig.visual.monoFontFamily,
      fontSize: `${gameConfig.visual.infoPopupGalleryCreditFontSize}px`,
      color: gameConfig.palette.muted,
      align: 'center',
    }).setOrigin(0.5);
    this.infoPopupGallery.add(this.infoPopupGalleryCounter);
  }

  updateInfoGallerySlide() {
    const item = this.infoPopupGalleryItems[this.infoPopupGalleryIndex];
    if (!item || !this.infoPopupImage) return;
    const asset = this.assets.images.find((entry) => entry.id === item.assetId);
    this.infoPopupImage.setTexture(item.assetId);
    this.fitInfoPopupImage();
    this.infoPopupCaption.setText(item.caption ?? (asset ? localizedAssetCaption(asset, this.language) : ''));
    const credit = item.credit ?? asset?.credit;
    this.infoPopupCredit.setText(credit ? `© ${credit}` : '');
    if (this.infoPopupGalleryCounter) {
      this.infoPopupGalleryCounter.setText(`${this.infoPopupGalleryIndex + 1} / ${this.infoPopupGalleryItems.length}`);
    }
  }

  fitInfoPopupImage() {
    const imageWidth = gameConfig.visual.infoPopupWidth - gameConfig.visual.infoPopupPadding * 2;
    const imageHeight = gameConfig.visual.infoPopupGalleryImageHeight;
    const scale = Math.min(imageWidth / this.infoPopupImage.width, imageHeight / this.infoPopupImage.height);
    this.infoPopupImage.setScale(scale);
  }

  changeInfoGallerySlide(direction) {
    const count = this.infoPopupGalleryItems?.length ?? 0;
    if (count < 2) return;
    this.infoPopupGalleryIndex = (this.infoPopupGalleryIndex + direction + count) % count;
    this.updateInfoGallerySlide();
  }

  updateInfoPopupScrollBounds() {
    const padding = gameConfig.visual.infoPopupPadding;
    const viewportHeight = this.infoPopupHeight
      - padding * 2
      - this.infoPopupContentTopOffset
      - 36;
    this.infoPopupScrollMax = Math.max(0, this.infoPopupContentHeight - viewportHeight);
    this.infoPopupContent.setY(-this.infoPopupScrollOffset);
  }

  handleInfoPopupWheel(pointer, _objects, _deltaX, deltaY) {
    if (!this.infoPopupOpen || !this.infoPopupScrollMax) return;
    const width = gameConfig.visual.infoPopupWidth * this.infoPopup.scaleX;
    const height = this.infoPopupHeight * this.infoPopup.scaleY;
    const withinPopup = Math.abs(pointer.x - this.infoPopup.x) <= width / 2
      && Math.abs(pointer.y - this.infoPopup.y) <= height / 2;
    if (!withinPopup) return;

    this.infoPopupScrollOffset = Phaser.Math.Clamp(
      this.infoPopupScrollOffset + deltaY,
      0,
      this.infoPopupScrollMax,
    );
    this.infoPopupContent.setY(-this.infoPopupScrollOffset);
    this.updateInfoPopupMasks();
  }

  closeInfoPopup() {
    this.infoPopupOpen = false;
    this.infoPopupTarget = null;
    this.infoPopup.setVisible(false);
    this.showTouchControls();
    this.setCompactPopupHud();
    this.updateSurfacePrompt();
    if (this.completionPending) this.showExplorationCompletion();
  }

  setCompactPopupHud() {
    const show = !this.infoPopupOpen || this.scale.gameSize.width >= 600;
    this.discoveryCard.setVisible(show);
    this.musicButton.setVisible(show);
    this.musicVolumeControl.setVisible(show);
    this.movementHint.setVisible(show && !this.touchControls);
    this.flashlightKey.setVisible(show);
    this.flashlightStatus.setVisible(show);
    this.zoomIndicator.setVisible(show);
    if (!show) this.musicTooltip.setVisible(false);
  }

  positionInfoPopup() {
    const target = this.infoPopupTarget;
    if (!target) return;

    const camera = this.worldCamera;
    const viewport = this.scale.gameSize;
    const baseWidth = gameConfig.visual.infoPopupWidth;
    const baseHeight = this.infoPopupHeight;
    const scale = Math.min(1, (viewport.width - 24) / baseWidth, (viewport.height - 24) / baseHeight);
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    const targetPosition = this.getTargetPosition(target);
    const targetX = camera.x + (targetPosition.x - camera.worldView.x) * camera.zoom;
    const targetY = camera.y + (targetPosition.y - camera.worldView.y) * camera.zoom;
    const targetRadius = target.proximityRadius * camera.zoom;
    const gap = 18 * scale;
    const margin = 12;
    const minCenterY = height / 2 + margin;
    const maxCenterY = viewport.height - height / 2 - margin;
    const aboveY = targetY - targetRadius - gap - height / 2;
    const belowY = targetY + targetRadius + gap + height / 2;

    let panelX = targetX;
    let panelY;

    if (aboveY >= minCenterY) {
      panelY = aboveY;
    } else if (belowY <= maxCenterY) {
      panelY = belowY;
    } else {
      const leftSpace = targetX - targetRadius - gap - margin;
      const rightSpace = viewport.width - targetX - targetRadius - gap - margin;
      const canPlaceLeft = leftSpace >= width;
      const canPlaceRight = rightSpace >= width;

      if (canPlaceLeft || canPlaceRight) {
        const placeRight = canPlaceRight && (!canPlaceLeft || rightSpace >= leftSpace);
        panelX = placeRight
          ? targetX + targetRadius + gap + width / 2
          : targetX - targetRadius - gap - width / 2;
        panelY = Phaser.Math.Clamp(targetY, minCenterY, maxCenterY);
      } else {
        panelY = Phaser.Math.Clamp(targetY, minCenterY, maxCenterY);
      }
    }

    panelX = Phaser.Math.Clamp(panelX, width / 2 + margin, viewport.width - width / 2 - margin);
    panelY = Phaser.Math.Clamp(panelY, minCenterY, maxCenterY);
    this.infoPopup.setScale(scale).setPosition(panelX, panelY);
    this.updateInfoPopupMasks();
  }

  updateInfoPopupMasks() {
    if (!this.infoPopup) return;
    const scale = this.infoPopup.scaleX;
    this.infoPopupContentMaskSource.setPosition(this.infoPopup.x, this.infoPopup.y).setScale(scale);

    if (this.infoPopupImageMaskSource && this.infoPopupGallery?.visible) {
      const galleryX = this.infoPopup.x + this.infoPopupGallery.x * scale;
      const galleryY = this.infoPopup.y
        + (this.infoPopupContent.y + this.infoPopupGallery.y) * scale;
      this.infoPopupImageMaskSource.setPosition(galleryX, galleryY).setScale(scale);
    }
  }
}