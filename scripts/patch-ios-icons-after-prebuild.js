const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;

const projectRoot = process.cwd();

function findIosProjectDir() {
  const iosRoot = path.join(projectRoot, 'ios');
  if (!fs.existsSync(iosRoot)) return null;
  const candidates = fs.readdirSync(iosRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(iosRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'Info.plist')));
  return candidates[0] || null;
}

function findPbxprojPath() {
  const iosRoot = path.join(projectRoot, 'ios');
  if (!fs.existsSync(iosRoot)) return null;
  const candidates = fs.readdirSync(iosRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.xcodeproj'))
    .map((entry) => path.join(iosRoot, entry.name, 'project.pbxproj'))
    .filter((file) => fs.existsSync(file));
  return candidates[0] || null;
}

function patchInfoPlist(infoPlistPath) {
  const raw = fs.readFileSync(infoPlistPath, 'utf8');
  const data = plist.parse(raw);
  data.CFBundleIcons = {
    CFBundlePrimaryIcon: {
      CFBundleIconFiles: ['HonnomaIcon20', 'HonnomaIcon29', 'HonnomaIcon40', 'HonnomaIcon60'],
      UIPrerenderedIcon: true,
    },
  };
  data['CFBundleIcons~ipad'] = {
    CFBundlePrimaryIcon: {
      CFBundleIconFiles: ['HonnomaIcon20', 'HonnomaIcon29', 'HonnomaIcon40', 'HonnomaIcon76', 'HonnomaIcon83-5'],
      UIPrerenderedIcon: true,
    },
  };
  delete data.CFBundleIconName;
  fs.writeFileSync(infoPlistPath, plist.build(data), 'utf8');
}

function patchPbxproj(pbxprojPath) {
  let text = fs.readFileSync(pbxprojPath, 'utf8');
  text = text.replace(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g, 'ASSETCATALOG_COMPILER_APPICON_NAME = "";');
  text = text.replace(/INFOPLIST_ENABLE_CFBUNDLEICONS_MERGE = YES;/g, 'INFOPLIST_ENABLE_CFBUNDLEICONS_MERGE = NO;');
  if (!text.includes('INFOPLIST_ENABLE_CFBUNDLEICONS_MERGE = NO;')) {
    text = text.replace(/(ASSETCATALOG_COMPILER_APPICON_NAME = "";)/g, '$1\n\t\t\t\tINFOPLIST_ENABLE_CFBUNDLEICONS_MERGE = NO;');
  }
  fs.writeFileSync(pbxprojPath, text, 'utf8');
}

function main() {
  if (process.env.EAS_BUILD_PLATFORM && process.env.EAS_BUILD_PLATFORM !== 'ios') {
    console.log('[patch-ios-icons] skipped: not an iOS EAS build');
    return;
  }

  const iosProjectDir = findIosProjectDir();
  const pbxprojPath = findPbxprojPath();
  if (!iosProjectDir || !pbxprojPath) {
    console.log('[patch-ios-icons] skipped: ios project is not available yet');
    return;
  }

  const infoPlistPath = path.join(iosProjectDir, 'Info.plist');
  patchInfoPlist(infoPlistPath);
  patchPbxproj(pbxprojPath);
  console.log(`[patch-ios-icons] patched ${path.relative(projectRoot, infoPlistPath)} and ${path.relative(projectRoot, pbxprojPath)}`);
}

main();
