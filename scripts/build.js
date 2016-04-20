#!/usr/bin/env node
'use strict';

/**
 * Builds app binaries for OS X, Linux, and Windows.
 *
 * Usage:
 *
 *   $ npm run build
 * or
 *   $ npm run build -- [platform] [sign] [package]
 *
 * Windows build notes:
 * To package the Windows app from non-Windows platforms, Wine needs to be installed.
 * On OS X, first install XQuartz, then run:
 *
 *   brew install wine
 *   brew install mono
 */

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const series = require('run-series');
const minimist = require('minimist');
const zip = require('cross-zip');
const packager = require('electron-packager');
const pkg = require('../package.json');

const APP_NAME = pkg.productName || pkg.name;
const APP_VERSION = pkg.version;
const APP_PATH = process.cwd();
const APP_ICON = path.join(__dirname, 'static', 'icon');
const APP_FILE_ICON = path.join(__dirname, 'static', 'icon');
const BUILD_PATH = 'build';
const BUILD_NAME = `${APP_NAME.toLowerCase()}-v${APP_VERSION}`;
const STATIC_PATH = path.join(__dirname, 'static');
const GITHUB_URL = pkg.repository.url;
const GITHUB_URL_RAW = 'https://raw.githubusercontent.com/firejune/psyclone/master';

/*
 * Path to folder with the following files:
 *   - Windows Authenticode private key and cert (authenticode.p12)
 *   - Windows Authenticode password file (authenticode.txt)
 */
const CERT_PATH = process.platform === 'win32' ? 'D:' : '/Volumes/Certs';
const DIST_PATH = path.join(APP_PATH, BUILD_PATH);

const argv = minimist(process.argv.slice(2), {
  'boolean': [
    'sign'
  ],
  'default': {
    'package': 'all',
    sign: false
  },
  string: [
    'package'
  ]
});

function build() {
  const platform = argv._[0];
  console.log(`Build platform: ${platform || 'all'}`);

  // clear dist path
  rimraf.sync(DIST_PATH);

  if (platform === 'darwin') {
    buildDarwin(printDone);
  } else if (platform === 'win32') {
    buildWin32(printDone);
  } else if (platform === 'linux') {
    buildLinux(printDone);
  } else {
    buildDarwin((err) => {
      printDone(err);
      buildWin32((err_) => {
        printDone(err_);
        buildLinux(printDone);
      });
    });
  }
}

const all = {
  // Build 64 bit binaries only.
  arch: 'x64',

  // The human-readable copyright line for the app.
  'app-copyright': pkg.license,

  // The release version of the application. Maps to the `ProductVersion` metadata
  // property on Windows, and `CFBundleShortVersionString` on OS X.
  'app-version': APP_VERSION,

  // Package the application's source code into an archive, using Electron's archive
  // format. Mitigates issues around long path names on Windows and slightly speeds up
  // require().
  asar: true,

  // A glob expression, that unpacks the files with matching names to the
  // "app.asar.unpacked" directory.
  'asar-unpack': 'psyclone*',

  // The build version of the application. Maps to the FileVersion metadata property on
  // Windows, and CFBundleVersion on OS X. We're using the short git hash (e.g. 'e7d837e')
  // Windows requires the build version to start with a number :/ so we stick on a prefix
  'build-version': `0-${cp.execSync('git rev-parse --short HEAD').toString().replace('\n', '')}`,

  // The application source directory.
  dir: APP_PATH,

  // Pattern which specifies which files to ignore when copying files to create the
  // package(s).
  ignore: /^\/(src|app|scripts|build)$/,

  // The application name.
  name: APP_NAME,

  // The base directory where the finished package(s) are created.
  out: DIST_PATH,

  // Replace an already existing output directory.
  overwrite: true,

  // Runs `npm prune --production` which remove the packages specified in
  // "devDependencies" before starting to package the app.
  prune: true,

  // The Electron version with which the app is built (without the leading 'v')
  version: pkg.devDependencies['electron-prebuilt'].replace('^', '')
};

const darwin = {
  platform: 'darwin',

  // The bundle identifier to use in the application's plist (OS X only).
  'app-bundle-id': 'com.rsupport.psyclone',

  // The application category type, as shown in the Finder via "View" -> "Arrange by
  // Application Category" when viewing the Applications directory (OS X only).
  'app-category-type': 'public.app-category.utilities',

  // The bundle identifier to use in the application helper's plist (OS X only).
  'helper-bundle-id': 'com.rsupport.psyclone-helper',

  // Application icon.
  icon: `${APP_ICON}.icns`
};

const win32 = {
  platform: 'win32',

  // Object hash of application metadata to embed into the executable (Windows only)
  'version-string': {

    // Company that produced the file.
    CompanyName: APP_NAME,

    // Name of the program, displayed to users
    FileDescription: APP_NAME,

    // Original name of the file, not including a path. This information enables an
    // application to determine whether a file has been renamed by a user. The format of
    // the name depends on the file system for which the file was created.
    OriginalFilename: `${APP_NAME}.exe`,

    // Name of the product with which the file is distributed.
    ProductName: APP_NAME,

    // Internal name of the file, if one exists, for example, a module name if the file
    // is a dynamic-link library. If the file has no internal name, this string should be
    // the original filename, without extension. This string is required.
    InternalName: APP_NAME
  },

  // Application icon.
  icon: `${APP_ICON}.ico`
};

const linux = {
  platform: 'linux',

  // Build 32/64 bit binaries.
  arch: 'all'

  // Note: Application icon for Linux is specified via the BrowserWindow `icon` option.
};

build();

function buildDarwin(cb) {
  const plist = require('plist');
  console.log('OS X: Packaging electron...');

  packager(Object.assign({}, all, darwin), (err, buildPath) => {
    if (err) return cb(err);
    console.log(`OS X: Packaged electron. ${buildPath[0]}`);

    const appPath = path.join(buildPath[0], `${APP_NAME}.app`);
    const contentsPath = path.join(appPath, 'Contents');
    const resourcesPath = path.join(contentsPath, 'Resources');
    const infoPlistPath = path.join(contentsPath, 'Info.plist');
    const infoPlist = plist.parse(fs.readFileSync(infoPlistPath, 'utf8'));
    const signed = argv.sign ? '-signed' : '';
    const destArch = buildPath[0].split('-').pop();

    // TODO: Use new `extend-info` and `extra-resource` opts to electron-packager,
    // available as of v6.
    infoPlist.CFBundleDocumentTypes = [
      {
        CFBundleTypeExtensions: ['psyclone'],
        CFBundleTypeIconFile: `${path.basename(APP_FILE_ICON)}.icns`,
        CFBundleTypeName: 'Psyclone Archives',
        CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner',
        LSItemContentTypes: ['com.rsupport.psyclone']
      },
      {
        CFBundleTypeName: 'Any',
        CFBundleTypeOSTypes: ['****'],
        CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner',
        LSTypeIsPackage: false
      }
    ];

    infoPlist.CFBundleURLTypes = [
      {
        CFBundleTypeRole: 'Editor',
        CFBundleURLIconFile: `${path.basename(APP_FILE_ICON)}.icns`,
        CFBundleURLName: 'Psyclone Archives',
        CFBundleURLSchemes: ['psyclone']
      }
    ];

    fs.writeFileSync(infoPlistPath, plist.build(infoPlist));

    // Copy psyclone file icon into app bundle
    cp.execSync(`cp ${APP_FILE_ICON}.icns ${resourcesPath}`);

    if (process.platform === 'darwin') {
      if (argv.sign) {
        const sign = require('electron-osx-sign');

        /*
         * Sign the app with Apple Developer ID certificate. We sign the app for 2 reasons:
         *   - So the auto-updater (Squirrrel.Mac) can check that app updates are signed by
         *     the same author as the current version.
         *   - So users will not a see a warning about the app coming from an "Unidentified
         *     Developer" when they open it for the first time (OS X Gatekeeper).
         *
         * To sign an OS X app for distribution outside the App Store, the following are
         * required:
         *   - Xcode
         *   - Xcode Command Line Tools (xcode-select --install)
         *   - Membership in the Apple Developer Program
         */
        const signOpts = {
          app: appPath,
          platform: 'darwin',
          verbose: true
        };

        sign(signOpts, (err_) => {
          if (err_) return cb(err_);
          pack();
        });
      } else {
        pack();
        console.log('Application is NOT signed. Do not ship this to users!');
      }
    } else {
      console.log('BUILD FAILED!');
    }

    function pack() {
      // always produce .zip file, used for automatic updates
      packageZip();

      if (argv.package === 'dmg' || argv.package === 'all') {
        packageDmg(cb);
      }
    }

    function packageZip() {
      // Create .zip file (used by the auto-updater)
      console.log('Created OS X .zip file.');

      const inPath = path.join(buildPath[0], `${APP_NAME}.app`);
      const outPath = path.join(DIST_PATH, `${BUILD_NAME}-darwin-${destArch}${signed}.zip`);
      zip(inPath, outPath);

      console.log('OS X: Created zip.');
    }

    function packageDmg() {
      console.log('OS X: Creating dmg...');

      const appDmg = require('appdmg');
      const targetPath = path.join(DIST_PATH, `${BUILD_NAME}-darwin-${destArch}${signed}.dmg`);
      rimraf.sync(targetPath);

      // Create a .dmg (OS X disk image) file, for easy user installation.
      const dmgOpts = {
        basepath: APP_PATH,
        target: targetPath,
        specification: {
          title: APP_NAME,
          icon: `${APP_ICON}.icns`,
          background: path.join(STATIC_PATH, 'appdmg.png'),
          'icon-size': 128,
          contents: [
            { x: 122, y: 240, type: 'file', path: appPath },
            { x: 380, y: 240, type: 'link', path: '/Applications' },
            // Hide hidden icons out of view, for users who have hidden files shown.
            // https://github.com/LinusU/node-appdmg/issues/45#issuecomment-153924954
            { x: 50, y: 500, type: 'position', path: '.background' },
            { x: 100, y: 500, type: 'position', path: '.DS_Store' },
            { x: 150, y: 500, type: 'position', path: '.Trashes' },
            { x: 200, y: 500, type: 'position', path: '.VolumeIcon.icns' }
          ]
        }
      };

      const dmg = appDmg(dmgOpts);
      dmg.on('error', cb);
      dmg.on('progress', (info) => {
        if (info.type === 'step-begin') console.log(`${info.title}...`);
      });
      dmg.on('finish', (info) => {
        console.log('Created OS X disk image (.dmg) file.', info);
        cb(null);
      });
    }
  });
}

function buildWin32(cb) {
  const installer = require('electron-winstaller');
  console.log('Windows: Packaging electron...');

  packager(Object.assign({}, all, win32), (err, buildPath) => {
    if (err) return cb(err);
    console.log(`Windows: Packaged electron. ${buildPath[0]}`);

    const destArch = buildPath[0].split('-').pop();
    let signWithParams;
    if (process.platform === 'win32') {
      if (argv.sign) {
        const certificateFile = path.join(CERT_PATH, 'authenticode.p12');
        const certificatePassword = fs.readFileSync(path.join(CERT_PATH, 'authenticode.txt'), 'utf8');
        const timestampServer = 'http://timestamp.comodoca.com';
        signWithParams = `/a /f "${certificateFile}" /p "${certificatePassword}" /tr "${timestampServer}" /td sha256`;
      } else {
        console.log('Application is NOT signed. Do not ship this to users!');
      }
    }

    const tasks = [];
    if (argv.package === 'exe' || argv.package === 'all') {
      tasks.push((cb_) => packageInstaller(cb_));
    }
    if (argv.package === 'portable' || argv.package === 'all') {
      tasks.push((cb_) => packagePortable(cb_));
    }
    series(tasks, cb);

    function packagePortable(cb_) {
      // Create Windows portable app
      console.log('Windows: Creating portable app...');

      const inPath = path.join(DIST_PATH, path.basename(buildPath[0]));
      const outPath = path.join(DIST_PATH, `${BUILD_NAME}-win32-${destArch}.zip`);
      zip(inPath, outPath);

      console.log('Windows: Created portable app.');
      cb_(null);
    }

    function packageInstaller(cb_) {
      console.log('Windows: Creating installer...');

      installer.createWindowsInstaller({
        appDirectory: buildPath[0],
        authors: pkg.description,
        description: APP_NAME,
        exe: `${APP_NAME}.exe`,
        iconUrl: `${GITHUB_URL_RAW}/scripts/static/icon.ico`,
        loadingGif: path.join(STATIC_PATH, 'loading.gif'),
        name: APP_NAME,
        noMsi: true,
        outputDirectory: DIST_PATH,
        productName: APP_NAME,
        remoteReleases: GITHUB_URL,
        setupExe: `${BUILD_NAME}-win32-setup-${destArch}.exe`,
        setupIcon: `${APP_ICON}.ico`,
        signWithParams,
        title: APP_NAME,
        usePackageJson: false,
        version: APP_VERSION
      }).then(() => {
        console.log('Windows: Created installer.');
        cb_(null);
      }).catch(cb_);
    }
  });
}

function buildLinux(cb) {
  console.log('Linux: Packaging electron...');

  packager(Object.assign({}, all, linux), (err, buildPath) => {
    if (err) return cb(err);
    console.log(`Linux: Packaged electron. ${buildPath[0]}`);

    const tasks = [];
    buildPath.forEach((filesPath) => {
      const destArch = filesPath.split('-').pop();
      if (argv.package === 'deb' || argv.package === 'all') {
        tasks.push((cb_) => packageDeb(filesPath, destArch, cb_));
      }
      if (argv.package === 'zip' || argv.package === 'all') {
        tasks.push((cb_) => packageZip(filesPath, destArch, cb_));
      }
    });
    series(tasks, cb);
  });

  function packageDeb(filesPath, destArch, cb_) {
    // Create .deb file for Debian-based platforms
    console.log(`Linux: Creating ${destArch} deb...`);

    const deb = require('nobin-debian-installer')();
    // install app peth in linux
    const destPath = path.join('/opt', APP_NAME);

    pkg.name = APP_NAME;
    deb.pack({
      'package': pkg,
      info: {
        arch: destArch === 'x64' ? 'amd64' : 'i386',
        name: APP_NAME.toLowerCase(),
        targetDir: DIST_PATH,
        depends: 'libc6 (>= 2.4)',
        scripts: {
          postinst: path.join(STATIC_PATH, 'linux', 'postinst'),
          prerm: path.join(STATIC_PATH, 'linux', 'prerm')
        }
      }
    }, [{
      src: ['./**'],
      dest: destPath,
      expand: true,
      cwd: filesPath
    }], (err) => {
      if (err) return cb_(err);
      console.log(`Linux: Created ${destArch} deb.`);
      cb_(null);
    });
  }

  function packageZip(filesPath, destArch, cb_) {
    // Create .zip file for Linux
    console.log(`Linux: Creating ${destArch} zip...`);

    const inPath = path.join(DIST_PATH, path.basename(filesPath));
    const outPath = path.join(DIST_PATH, `${BUILD_NAME}-linux-${destArch}.zip`);
    zip(inPath, outPath);

    console.log(`Linux: Created ${destArch} zip.`);
    cb_(null);
  }
}

function printDone(err) {
  if (err) console.error(err.message || err);
  else console.log('Build Done!');
}
