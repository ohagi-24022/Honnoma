const fs = require('fs');
const path = require('path');
const { IOSConfig, withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');

const ICONSET_PATH = path.join('Images.xcassets', 'AppIcon.appiconset');
const CACHE_TYPE = 'honnoma-classic-ios-icons';

const IOS_ICON_SLOTS = [
  { idiom: 'iphone', size: '20x20', scale: '2x', pixels: 40 },
  { idiom: 'iphone', size: '20x20', scale: '3x', pixels: 60 },
  { idiom: 'iphone', size: '29x29', scale: '2x', pixels: 58 },
  { idiom: 'iphone', size: '29x29', scale: '3x', pixels: 87 },
  { idiom: 'iphone', size: '40x40', scale: '2x', pixels: 80 },
  { idiom: 'iphone', size: '40x40', scale: '3x', pixels: 120 },
  { idiom: 'iphone', size: '60x60', scale: '2x', pixels: 120 },
  { idiom: 'iphone', size: '60x60', scale: '3x', pixels: 180 },
  { idiom: 'ipad', size: '20x20', scale: '1x', pixels: 20 },
  { idiom: 'ipad', size: '20x20', scale: '2x', pixels: 40 },
  { idiom: 'ipad', size: '29x29', scale: '1x', pixels: 29 },
  { idiom: 'ipad', size: '29x29', scale: '2x', pixels: 58 },
  { idiom: 'ipad', size: '40x40', scale: '1x', pixels: 40 },
  { idiom: 'ipad', size: '40x40', scale: '2x', pixels: 80 },
  { idiom: 'ipad', size: '76x76', scale: '1x', pixels: 76 },
  { idiom: 'ipad', size: '76x76', scale: '2x', pixels: 152 },
  { idiom: 'ipad', size: '83.5x83.5', scale: '2x', pixels: 167 },
  { idiom: 'ios-marketing', size: '1024x1024', scale: '1x', pixels: 1024 },
];

function resolveIconPath(config) {
  const iosIcon = config.ios && config.ios.icon;
  if (typeof iosIcon === 'string') return iosIcon;
  if (iosIcon && typeof iosIcon === 'object') {
    return iosIcon.light || iosIcon.dark || iosIcon.tinted || config.icon;
  }
  return config.icon;
}

function getIosNamedProjectPath(projectRoot) {
  const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
  return path.join(projectRoot, 'ios', projectName);
}

function iconFileName(slot) {
  return `AppIcon-${slot.idiom}-${slot.size.replace('.', '-')}-${slot.scale}.png`;
}

async function writeClassicIconsAsync(config, projectRoot) {
  const icon = resolveIconPath(config);
  if (!icon || typeof icon !== 'string') return;

  const iconsetDir = path.join(getIosNamedProjectPath(projectRoot), ICONSET_PATH);
  await fs.promises.rm(iconsetDir, { recursive: true, force: true });
  await fs.promises.mkdir(iconsetDir, { recursive: true });

  const images = [];
  for (const slot of IOS_ICON_SLOTS) {
    const filename = iconFileName(slot);
    const { source } = await generateImageAsync(
      { projectRoot, cacheType: CACHE_TYPE },
      {
        src: icon,
        name: filename,
        width: slot.pixels,
        height: slot.pixels,
        resizeMode: 'cover',
        removeTransparency: true,
        backgroundColor: '#ffffff',
      },
    );
    await fs.promises.writeFile(path.join(iconsetDir, filename), source);
    images.push({
      filename,
      idiom: slot.idiom,
      scale: slot.scale,
      size: slot.size,
    });
  }

  await fs.promises.writeFile(
    path.join(iconsetDir, 'Contents.json'),
    JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2),
  );
}

module.exports = function withClassicIosIcons(config) {
  config = withDangerousMod(config, [
    'ios',
    async (nextConfig) => {
      await writeClassicIconsAsync(nextConfig, nextConfig.modRequest.projectRoot);
      return nextConfig;
    },
  ]);

  config = withXcodeProject(config, (nextConfig) => {
    const configurations = nextConfig.modResults.pbxXCBuildConfigurationSection();
    for (const buildConfig of Object.values(configurations)) {
      if (buildConfig && buildConfig.buildSettings) {
        buildConfig.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME = 'AppIcon';
      }
    }
    return nextConfig;
  });

  return config;
};
