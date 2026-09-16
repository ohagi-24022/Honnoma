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

const LOOSE_ICON_SLOTS = [
  { baseName: 'HonnomaIcon20', pixels: 40, scale: '2x' },
  { baseName: 'HonnomaIcon20', pixels: 60, scale: '3x' },
  { baseName: 'HonnomaIcon29', pixels: 58, scale: '2x' },
  { baseName: 'HonnomaIcon29', pixels: 87, scale: '3x' },
  { baseName: 'HonnomaIcon40', pixels: 80, scale: '2x' },
  { baseName: 'HonnomaIcon40', pixels: 120, scale: '3x' },
  { baseName: 'HonnomaIcon60', pixels: 120, scale: '2x' },
  { baseName: 'HonnomaIcon60', pixels: 180, scale: '3x' },
  { baseName: 'HonnomaIcon76', pixels: 76, scale: '1x' },
  { baseName: 'HonnomaIcon76', pixels: 152, scale: '2x' },
  { baseName: 'HonnomaIcon83-5', pixels: 167, scale: '2x' },
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

function looseIconFileName(slot) {
  return slot.scale === '1x' ? `${slot.baseName}.png` : `${slot.baseName}@${slot.scale}.png`;
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

  for (const slot of LOOSE_ICON_SLOTS) {
    const filename = looseIconFileName(slot);
    const { source } = await generateImageAsync(
      { projectRoot, cacheType: `${CACHE_TYPE}-loose` },
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
    await fs.promises.writeFile(path.join(getIosNamedProjectPath(projectRoot), filename), source);
  }

  console.log(`[with-classic-ios-icons] wrote ${images.length} asset catalog icons and ${LOOSE_ICON_SLOTS.length} loose icons from ${icon}`);
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
    const projectName = nextConfig.modRequest.projectName;
    for (const slot of LOOSE_ICON_SLOTS) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: `${projectName}/${looseIconFileName(slot)}`,
        groupName: projectName,
        project: nextConfig.modResults,
        isBuildFile: true,
        verbose: true,
      });
    }

    const configurations = nextConfig.modResults.pbxXCBuildConfigurationSection();
    for (const buildConfig of Object.values(configurations)) {
      if (buildConfig && buildConfig.buildSettings) {
        buildConfig.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME = 'AppIcon';
        buildConfig.buildSettings.INFOPLIST_ENABLE_CFBUNDLEICONS_MERGE = 'YES';
      }
    }
    return nextConfig;
  });

  return config;
};
