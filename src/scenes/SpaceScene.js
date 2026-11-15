import Phaser from 'phaser';
import gameConfig from '../data/game-config.json';
import assetsUrl from '../data/assets.json?url&no-inline';
import storyUrl from '../data/intro-story.json?url&no-inline';
import createActionButton from '../utils/createActionButton.js';
import createStarfield from '../utils/createStarfield.js';
import { getAmbientMusic } from '../utils/AmbientMusic.js';
import { getSavedLanguage, saveLanguage, translate } from '../utils/localization.js';

export default class SpaceScene extends Phaser.Scene {
  constructor() {
    super('SpaceScene');
  }

  preload() {
    this.load.json('introStory', storyUrl);
    this.load.json('assetManifest', assetsUrl);
  }

  create() {
    this.story = this.cache.json.get('introStory');
    this.assetManifest = this.cache.json.get('assetManifest');
    this.palette = gameConfig.palette;
    this.visual = gameConfig.visual;
    this.transitionMs = this.story.transitionMs;
    this.language = getSavedLanguage();
    document.documentElement.lang = this.language;
    this.currentMessageIndex = 0;
    this.inputLocked = false;

    createStarfield(this, gameConfig);
    this.createMenu();
    this.createStoryLayer();
    this.layout(this.scale.gameSize);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  createMenu() {
    const { palette, visual } = this;
    this.menuLayer = this.add.container(0, 0);
    this.mainTitle = this.add
      .text(0, 0, gameConfig.title.primary, {
        fontFamily: visual.displayFontFamily,
        fontSize: `${visual.titleFontSize}px`,
        fontStyle: 'bold',
        color: palette.text,
        align: 'center',
        letterSpacing: 5,
      })
      .setOrigin(0.5)
      .setShadow(0, 2, palette.electric, 18, false, true);
    this.subtitle = this.add
      .text(0, 0, gameConfig.title.secondary, {
        fontFamily: visual.monoFontFamily,
        fontSize: `${visual.subtitleFontSize}px`,
        color: palette.electric,
        align: 'center',
        letterSpacing: 5,
      })
      .setOrigin(0.5);
    this.tagline = this.add
      .text(0, 0, translate(this.language, 'homeTagline'), {
        fontFamily: visual.bodyFontFamily,
        fontSize: `${visual.taglineFontSize}px`,
        color: palette.muted,
      })
      .setOrigin(0.5);
    this.startButton = createActionButton(this, {
      width: visual.buttonWidth,
      height: visual.buttonHeight,
      text: translate(this.language, 'buttons.start'),
      palette,
      visual,
      onPress: () => {
        getAmbientMusic(this.game).start();
        this.openStory();
      },
    });
    this.createLanguageSelector();

    this.menuLayer.add([
      this.mainTitle,
      this.subtitle,
      this.tagline,
      this.languageLabel,
      this.languageButtons.es.container,
      this.languageButtons.en.container,
      this.startButton.container,
    ]);
  }

  createLanguageSelector() {
    this.languageLabel = this.add.text(0, 0, translate(this.language, 'languagePrompt'), {
      fontFamily: this.visual.monoFontFamily,
      fontSize: `${this.visual.languagePromptFontSize}px`,
      color: this.palette.muted,
      align: 'center',
      letterSpacing: 1,
    }).setOrigin(0.5);
    this.languageButtons = {
      es: this.createLanguageButton('es'),
      en: this.createLanguageButton('en'),
    };
    this.updateLanguageSelection();
  }

  createLanguageButton(language) {
    const width = this.visual.languageButtonWidth;
    const height = this.visual.languageButtonHeight;
    const container = this.add.container(0, 0).setSize(width, height);
    const background = this.add
      .rectangle(0, 0, width, height, Number.parseInt(this.palette.buttonFill.slice(1), 16), 0.88)
      .setStrokeStyle(1, Number.parseInt(this.palette.electric.slice(1), 16), 0.55);
    const label = this.add.text(0, 0, translate(this.language, `languageOptions.${language}`), {
      fontFamily: this.visual.monoFontFamily,
      fontSize: `${this.visual.languageButtonFontSize}px`,
      fontStyle: 'bold',
      color: this.palette.text,
      align: 'center',
    }).setOrigin(0.5);

    container.add([background, label]);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on('pointerdown', () => this.setLanguage(language));
    container.on('pointerover', () => {
      background.setFillStyle(Number.parseInt(this.palette.buttonHover.slice(1), 16), 0.95);
    });
    container.on('pointerout', () => this.updateLanguageSelection());

    return { container, background, label };
  }

  updateLanguageSelection() {
    Object.entries(this.languageButtons).forEach(([language, button]) => {
      const selected = language === this.language;
      button.background
        .setFillStyle(Number.parseInt((selected ? this.palette.buttonHover : this.palette.buttonFill).slice(1), 16), selected ? 1 : 0.78)
        .setStrokeStyle(selected ? 2 : 1, Number.parseInt(this.palette.electric.slice(1), 16), selected ? 1 : 0.45);
    });
  }

  setLanguage(language) {
    if (language === this.language) return;
    this.language = language;
    saveLanguage(language);
    document.documentElement.lang = language;
    this.languageLabel.setText(translate(language, 'languagePrompt'));
    Object.entries(this.languageButtons).forEach(([key, button]) => {
      button.label.setText(translate(language, `languageOptions.${key}`));
    });
    this.tagline.setText(translate(language, 'homeTagline'));
    this.startButton.label.setText(translate(language, 'buttons.start'));
    this.continueButton.label.setText(translate(language, 'buttons.continue'));
    this.backButton.label.setText(translate(language, 'buttons.back'));
    this.exploreButton.label.setText(translate(language, 'buttons.startExploration'));
    this.finalText.setText(translate(language, 'story.finalMessage'));
    this.updateLanguageSelection();
  }
  createStoryLayer() {
    const { palette, visual } = this;
    this.storyLayer = this.add.container(0, 0).setVisible(false).setAlpha(0);
    this.messageText = this.add
      .text(0, 0, '', {
        fontFamily: visual.bodyFontFamily,
        fontSize: `${visual.messageFontSize}px`,
        color: palette.text,
        align: 'center',
        lineSpacing: 12,
        wordWrap: { width: 900 },
      })
      .setOrigin(0.5);
    this.progressText = this.add
      .text(0, 0, '', {
        fontFamily: visual.monoFontFamily,
        fontSize: `${visual.progressFontSize}px`,
        color: palette.muted,
        align: 'center',
        letterSpacing: 3,
      })
      .setOrigin(0.5);
    this.finalText = this.add
      .text(0, 0, translate(this.language, 'story.finalMessage'), {
        fontFamily: visual.displayFontFamily,
        fontSize: `${visual.finalFontSize}px`,
        fontStyle: 'bold',
        color: palette.text,
        align: 'center',
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setShadow(0, 2, palette.electric, 16, false, true)
      .setVisible(false);

    this.continueButton = createActionButton(this, {
      width: visual.buttonWidth,
      height: visual.buttonHeight,
      text: translate(this.language, 'buttons.continue'),
      palette,
      visual,
      onPress: () => this.advanceStory(),
    });
    this.backButton = createActionButton(this, {
      width: visual.backButtonWidth,
      height: visual.backButtonHeight,
      text: translate(this.language, 'buttons.back'),
      palette,
      visual,
      onPress: () => this.returnToMenu(),
    });
    this.exploreButton = createActionButton(this, {
      width: visual.exploreButtonWidth,
      height: visual.buttonHeight,
      text: translate(this.language, 'buttons.startExploration'),
      palette,
      visual,
      onPress: () => this.startExploration(),
    });

    this.exploreButton.container.setVisible(false);
    this.continueButton.setEnabled(false);
    this.backButton.setEnabled(false);
    this.exploreButton.setEnabled(false);
    this.storyLayer.add([
      this.messageText,
      this.progressText,
      this.finalText,
      this.continueButton.container,
      this.backButton.container,
      this.exploreButton.container,
    ]);
  }

  layout(gameSize) {
    const { width, height } = gameSize;
    const centerX = width / 2;
    const centerY = height / 2;
    const factor = Math.min(1, width / 780, height / 620);

    if (this.mainTitle) {
      this.mainTitle.setPosition(centerX, centerY - 96 * factor);
      this.mainTitle.setFontSize(Math.max(25, this.visual.titleFontSize * factor));
      this.subtitle.setPosition(centerX, centerY - 34 * factor);
      this.subtitle.setFontSize(Math.max(14, this.visual.subtitleFontSize * factor));
      this.tagline.setPosition(centerX, centerY + 25 * factor);
      this.tagline.setFontSize(Math.max(13, this.visual.taglineFontSize * factor));
      this.languageLabel.setPosition(centerX, centerY + 65 * factor);
      this.languageButtons.es.container.setPosition(centerX - this.visual.languageButtonWidth / 2 - 5, centerY + 94 * factor);
      this.languageButtons.en.container.setPosition(centerX + this.visual.languageButtonWidth / 2 + 5, centerY + 94 * factor);
      this.startButton.container.setPosition(centerX, centerY + 155 * factor);
      this.startButton.setSize(Math.min(this.visual.buttonWidth, width * 0.86), this.visual.buttonHeight);
      this.startButton.label.setFontSize(Math.max(13, this.visual.buttonFontSize * factor));
    }

    if (this.messageText) {
      this.messageText.setPosition(centerX, height * 0.48);
      this.messageText.setFontSize(Math.max(20, this.visual.messageFontSize * factor));
      this.messageText.setWordWrapWidth(width * 0.82, true);
      this.progressText.setPosition(centerX, height * 0.2);
      this.backButton.container.setPosition(
        Math.min(this.visual.backButtonWidth / 2 + 22, width / 2 - 12),
        Math.max(this.visual.backButtonHeight / 2 + 14, height * 0.09),
      );
      this.backButton.label.setFontSize(Math.max(11, this.visual.backButtonFontSize * factor));
      this.continueButton.container.setPosition(centerX, height * 0.79);
      this.continueButton.setSize(Math.min(this.visual.buttonWidth, width * 0.86), this.visual.buttonHeight);
      this.continueButton.label.setFontSize(Math.max(13, this.visual.buttonFontSize * factor));
      this.finalText.setPosition(centerX, height * 0.43);
      this.finalText.setFontSize(Math.max(22, this.visual.finalFontSize * factor));
      this.finalText.setWordWrapWidth(width * 0.86, true);
      this.exploreButton.container.setPosition(centerX, height * 0.61);
      this.exploreButton.setSize(Math.min(this.visual.exploreButtonWidth, width * 0.9), this.visual.buttonHeight);
      this.exploreButton.label.setFontSize(Math.max(12, this.visual.buttonFontSize * factor));
    }
  }

  openStory() {
    if (this.inputLocked) return;
    this.inputLocked = true;
    this.startButton.setEnabled(false);
    this.tweens.add({
      targets: this.menuLayer,
      alpha: 0,
      duration: this.transitionMs,
      onComplete: () => {
        this.menuLayer.setVisible(false);
        this.currentMessageIndex = 0;
        this.showMessage();
        this.storyLayer.setVisible(true).setAlpha(0);
        this.tweens.add({
          targets: this.storyLayer,
          alpha: 1,
          duration: this.transitionMs,
          onComplete: () => {
            this.inputLocked = false;
            this.continueButton.setEnabled(true);
            this.backButton.setEnabled(true);
          },
        });
      },
    });
  }

  showMessage(startHidden = false) {
    const message = this.story.messages[this.currentMessageIndex];
    const messageKey = `story.messages.${message.id}`;
    const translatedMessage = translate(this.language, messageKey);
    const messageText = translatedMessage === messageKey ? message.text : translatedMessage;
    const alpha = startHidden ? 0 : 1;
    this.messageText.setText(messageText).setVisible(true).setAlpha(alpha);
    this.progressText
      .setText(`${String(message.order).padStart(2, '0')} / ${String(this.story.messages.length).padStart(2, '0')}`)
      .setVisible(true)
      .setAlpha(alpha);
    this.continueButton.container.setVisible(true).setAlpha(alpha);
    this.finalText.setVisible(false);
    this.exploreButton.container.setVisible(false);
  }

  advanceStory() {
    if (this.inputLocked) return;
    this.inputLocked = true;
    this.continueButton.setEnabled(false);
    this.backButton.setEnabled(false);

    this.tweens.add({
      targets: [this.messageText, this.progressText, this.continueButton.container],
      alpha: 0,
      duration: this.transitionMs,
      onComplete: () => {
        if (this.currentMessageIndex < this.story.messages.length - 1) {
          this.currentMessageIndex += 1;
          this.showMessage(true);
          this.tweens.add({
            targets: [this.messageText, this.progressText, this.continueButton.container],
            alpha: 1,
            duration: this.transitionMs,
            onComplete: () => {
              this.inputLocked = false;
              this.continueButton.setEnabled(true);
              this.backButton.setEnabled(true);
            },
          });
          return;
        }

        this.messageText.setVisible(false);
        this.progressText.setVisible(false);
        this.continueButton.container.setVisible(false);
        this.finalText.setVisible(true).setAlpha(0);
        this.exploreButton.container.setVisible(true).setAlpha(0);
        this.tweens.add({
          targets: [this.finalText, this.exploreButton.container],
          alpha: 1,
          duration: this.transitionMs,
          onComplete: () => {
            this.inputLocked = false;
            this.backButton.setEnabled(true);
            this.exploreButton.setEnabled(true);
          },
        });
      },
    });
  }

  returnToMenu() {
    if (this.inputLocked) return;
    this.inputLocked = true;
    this.backButton.setEnabled(false);
    this.continueButton.setEnabled(false);
    this.exploreButton.setEnabled(false);
    this.tweens.add({
      targets: this.storyLayer,
      alpha: 0,
      duration: this.transitionMs,
      onComplete: () => {
        this.storyLayer.setVisible(false);
        this.menuLayer.setVisible(true).setAlpha(0);
        this.tweens.add({
          targets: this.menuLayer,
          alpha: 1,
          duration: this.transitionMs,
          onComplete: () => {
            this.currentMessageIndex = 0;
            this.inputLocked = false;
            this.startButton.setEnabled(true);
          },
        });
      },
    });
  }

  startExploration() {
    if (this.inputLocked) return;
    this.inputLocked = true;
    this.backButton.setEnabled(false);
    this.exploreButton.setEnabled(false);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(this.story.destinationScene);
    });
    this.cameras.main.fadeOut(this.transitionMs, 0, 0, 0);
  }
}