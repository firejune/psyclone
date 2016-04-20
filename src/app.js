'use strict';

const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const JSZip = require('jszip');
const createMenuTemplate = require('./menu');
const { homepage } = require('../package.json');
const { remote, webFrame, ipcRenderer } = require('electron');
const { shell, app, Menu } = remote;
const os = {darwin: 'osx', linux: 'linux', win32: 'windows'}[process.platform];
const maxRecent = 24;
const maxArchive = 24;

// 두 손까락 더블 탭 줌 막기
webFrame.setZoomLevelLimits(1, 1);

const electron = {
  os,
  development: !!remote.getGlobal('development'),
  home: homepage,
  name: app.getName(),
  version: app.getVersion(),
  appPath: app.getAppPath(),
  dataPath: app.getPath('userData'),
  homePath: app.getPath('home'),
  separator: path.sep,
  pathSeparator: os === 'windows' ? '\\' : '/',

  register(actions) {
    this.actions = actions;
    this.progress = actions.progress;

    // fix renderer process bloking
    ipcRenderer.on('log', (e, ...args) => console.debug('[IPC]', ...args));
    ipcRenderer.on('error', (e, ...args) => console.error('[IPC]', ...args));
    ipcRenderer.on('context-menu', (event, idx, subidx) => this.executeContextMenu(idx, subidx));
    ipcRenderer.on('open-file', (event, file) => this.actions.trigger('open-file', file));
    ipcRenderer.on('open-file-start', (event) => this.actions.openFile());

    ipcRenderer.send('ipc-ready');

    this.updateMenu();
  },

  // File system API
  pathParse(stat) {
    return path.parse(stat);
  },

  pathExists(filepath) {
    filepath = path.resolve(`${this.dataPath}/Archives`, filepath);
    return fs.existsSync(filepath);
  },

  getFile(filepath, type) {
    filepath = path.resolve(`${this.appPath}`, filepath);
    return fs.readFileSync(filepath, type);
  },

  readFile(filepath, type) {
    filepath = path.resolve(`${this.dataPath}/Archives`, filepath);

    return type === 'ArrayBuffer'
      ? toArrayBuffer(fs.readFileSync(filepath))
      : fs.readFileSync(filepath, type);
  },

  unlinkFile(filepath) {
    filepath = path.resolve(`${this.dataPath}/Archives`, filepath);
    return rimraf.sync(filepath);
  },

  writeFile(filepath, data, done) {
    filepath = path.resolve(`${this.dataPath}/Archives`, filepath);

    const stat = path.parse(filepath);
    data = data.constructor === ArrayBuffer ? toBuffer(data) : data;
    done = done || function() {};
    mkdirp.sync(stat.dir);

    return fs.writeFile(filepath, data, done);
  },

  traverseFileTree(filenames, done, type) {
    if (!filenames || !filenames.length) {
      done(new Error('File Not Found'));
      return;
    }

    const files = [];
    let count = 0;
    let total;

    function traverseFileTree(filepath, parent = '') {
      const stat = fs.statSync(filepath);
      const file = path.parse(filepath);
      let error = null;
      total = count++;

      if (stat.isFile()) {
        // Async file get
        fs.readFile(filepath, (err, data) => {
          // console.log('File:', parent + file.base);
          files.push({
            data: type === 'ArrayBuffer' ? toArrayBuffer(data) : data,
            name: file.base,
            path: parent
          });

          if (--count === 0) {
            done(error, files);
          }
          electron.taskProgressBar((total - count) / total);
        });
      } else if (stat.isDirectory()) {
        // Get folder contents
        fs.readdir(filepath, (err, entries) => {
          if (err) {
            console.error(error = err);
            count--;
            return;
          }
          // console.debug(filepath + '/' + entries[0], parent + file.base + '/');
          for (let i = 0; i < entries.length; i++) {
            traverseFileTree(filepath + '/' + entries[i], parent + file.base + '/');
          }

          count--;
        });
      }
    }

    for (const filepath of filenames) {
      traverseFileTree(filepath);
    }

    this.taskProgressBar(0);
  },

  readZip(data) {
    data = typeof data === 'string' ? this.readFile(data) : data;
    return new JSZip(data);
  },

  // Dialog API
  showSaveDialog(props, done) {
    ipcRenderer.send('open-save-dialog', props);
    ipcRenderer.once('open-save-dialog', (event, filename) => {
      if (!filename) {
        return done(new Error('File save canceled'));
      }

      if (props.data) {
        fs.writeFile(filename, props.data, done);
      } else {
        done(null, filename);
      }
    });
  },

  showOpenDialog(props, done) {
    ipcRenderer.send('open-file-dialog', props);
    ipcRenderer.once('open-file-dialog', (event, filenames) => {
      if (!filenames) {
        done(new Error('Canceled file open'));
        return;
      }
      this.traverseFileTree(filenames, done, props.returnType);
    });
  },

  // Menu API
  executeContextMenu(idx, subidx) {
    const template = createMenuTemplate(this.actions, 'context');
    if (subidx !== undefined) {
      template[idx].submenu[subidx].click();
    } else {
      template[idx].click();
    }
  },

  setDockMenu() {
    if (!app.dock) return;
    const template = createMenuTemplate(this.actions, 'dock');
    const dockMenu = Menu.buildFromTemplate(template);
    app.dock.setMenu(dockMenu);
  },

  showContextMenu() {
    const template = createMenuTemplate(this.actions, 'context');
    ipcRenderer.send('context-menu', template);
  },

  updateMenu() {
    const template = createMenuTemplate(this.actions);
    const menu = Menu.buildFromTemplate(template);

    Menu.setApplicationMenu(menu);
    this.setDockMenu();
  },

  // Desktop Window API
  setTitle(title) {
    let mainTitle = this.name;
    if (title) {
      mainTitle += ` - ${title}`;
    } else {
      mainTitle += ' - Sequenced Music Player';
    }

    remote.getCurrentWindow().setTitle(mainTitle);
  },

  setFilename(filepath) {
    filepath = path.resolve(`${this.dataPath}/Archives`, filepath);
    const win = remote.getCurrentWindow();
    win.setRepresentedFilename(filepath);
    // win.setDocumentEdited(true);
  },

  isFullScreen() {
    return remote.getCurrentWindow().isFullScreen();
  },

  getSize() {
    return remote.getCurrentWindow().getSize();
  },

  setSize(width, height) {
    remote.getCurrentWindow().setSize(width, height);
  },

  openBrowserWindow(url) {
    shell.openExternal(url);
  },

  notification(body, done) {
    if (!this.readSetting('notification')) {
      return;
    }

    const notification = new Notification(this.name, {
      // dir: 'auto', // or ltr, rtl
      // lang: 'EN', // lang used within the notification.
      // tag: 'notificationPopup', // An element ID to get/set the content
      // icon: '' //The URL of an image to be used as an icon
      body
    });

    if (done) {
      notification.onclick = done;
    }
  },

  taskProgressBar(progress) {
    const win = remote.getCurrentWindow();
    win.setProgressBar(progress);

    if (this.progress) {
      this.progress(progress);
    }

    // auto closing after 400ms
    if (progress >= 1) {
      setTimeout(() => {
        win.setProgressBar(-1);
        this.progress(-1);
      }, 400);
    }
  },

  quit() {
    app.quit();
  },

  // Local Database API
  setDefaultSettings() {
    const version = this.readSetting('version', this.version);
    const midiSynth = this.readSetting('midi-synth', 'timidity');
    const recentOpened = this.readSetting('recentOpened');
    const random = this.readSetting('random');

    this.readSetting('recents', []);
    this.readSetting('archives', {});
    this.readSetting('libraries', {});
    this.readSetting('lastArchive', null);
    this.readSetting('lastPlayed', null);
    this.readSetting('repeat', 'off');
    this.readSetting('shuffle', false);
    this.readSetting('visited', false);
    this.readSetting('notification', true);
    this.readSetting('visualizer', 'Circles');
    this.readSetting('enableCompressor', true);

    if (version !== this.version) {
      this.saveSetting('version', this.version);
    }

    // dependent on v0.3.34
    if (midiSynth === 'soundfont') {
      this.saveSetting('midi-synth', 'timidity');
    }
    if (random !== undefined) {
      this.saveSetting('shuffle', random);
      this.saveSetting('random');
    }

    // dependent on v0.3.31
    if (recentOpened) {
      this.saveSetting('recents', recentOpened);
      this.saveSetting('recentOpened');
    }
  },

  saveSetting(set, def) {
    // console.log('app.saveSetting', set, def);
    if (def === undefined) {
      delete localStorage[set];
    } else {
      localStorage[set] = JSON.stringify(def);
    }
  },

  readSetting(set, def) {
    // console.log('app.readSetting', set, def);
    if (localStorage.hasOwnProperty(set)) {
      return JSON.parse(localStorage[set]);
    }

    // set default value
    if (def !== undefined) {
      this.saveSetting(set, def);
    }

    return def !== undefined ? def : null;
  },

  resetAllSettings(done) {
    if (confirm('Are you sure you want to reset all settings?')) {
      const recents = this.readSetting('recents');
      const archives = this.readSetting('archives');
      const libraries = this.readSetting('libraries');
      const lastArchive = this.readSetting('lastArchive');
      const lastPlayed = this.readSetting('lastPlayed');

      localStorage.clear();

      this.saveSetting('recents', recents);
      this.saveSetting('archives', archives);
      this.saveSetting('libraries', libraries);
      this.saveSetting('lastArchive', lastArchive);
      this.saveSetting('lastPlayed', lastPlayed);
    }

    done();
  },

  // Local Archive API
  addLibrary(lib) {
    console.debug('app.addLibrary', `./${lib.path}${lib.name}`);
    const libraries = this.readSetting('libraries');
    this.writeFile(libraries[lib.name] = `./${lib.path}${lib.name}`, lib.data);
    this.saveSetting('libraries', libraries);
  },

  getLibrary(lib, type) {
    console.debug('app.getLibrary', lib);

    const libraries = this.readSetting('libraries');
    const filepath = `./${lib.path}${lib.name}`;

    if (this.pathExists(filepath)) {
      lib.data = this.readFile(filepath, 'ArrayBuffer');
    }

    if (!lib.data && !path.extname(filepath) && type === 'usf') {
      lib.data = this.readFile(`${filepath}.usflib`, 'ArrayBuffer');
    }

    if (!lib.data && libraries[lib.name]) {
      lib.data = this.readFile(libraries[lib.name], 'ArrayBuffer');
    }

    return lib.data && lib || null;
  },

  getData(target) {
    if (target.path && target.name) {
      target.data = this.readFile(`./${target.path}${target.name}`, 'ArrayBuffer');
      return target;
    }

    if (!target.length) {
      return [];
    }

    target.map(file => {
      try {
        file.data = this.readFile(`./${file.path}${file.name}`, 'ArrayBuffer');
      } catch (e) {
        console.warn(`Missing archive ${file.path}${file.name}`);
      }
      return file;
    });

    return target.filter(file => !!file.data);
  },

  getArchiveData(groupId) {
    const archive = this.readSetting('archives')[groupId];
    return this.getData(archive);
  },

  getRecentOpened() {
    const recents = this.readSetting('recents');
    return this.getData(recents);
  },

  addToArchive(list, done) {
    const saved = this.readSetting('archives');
    const libraries = this.readSetting('libraries');
    const archives = {};
    for (const song of list.songs) {
      const filename = song.file || song.name;

      if (!archives[song.path]) {
        archives[song.path] = [];
      }

      archives[song.path].push({
        name: filename,
        path: song.path,
        type: song.type,
        data: song.data,
        lib: song.lib
      });
    }

    let lastArchive = null;
    let count = 0;

    function countdown() {
      if (--count === 0) {
        done && done();
      }
    }

    // saving files
    for (const group of Object.keys(archives)) {
      if (group) {
        lastArchive = group;
      }

      for (const song of archives[group]) {
        this.writeFile(`./${group}${song.name}`, song.data, countdown);
        delete song.data;
        count++;
      }
    }

    this.saveSetting('lastArchive', lastArchive);
    delete archives[''];

    // make archives and clear
    for (const group of Object.keys(saved)) {
      if (Object.keys(archives).length > maxArchive) {
        // delete archive folder
        try {
          this.unlinkFile(`./${group}`);
        } catch (e) {
          console.error('Archive Group Delete Failed', e);
        }

        // delete library info in storage
        for (const lib of Object.keys(libraries)) {
          if (libraries[lib].indexOf(group) !== -1) {
            delete libraries[lib];
          }
        }
        continue;
      }

      if (!archives[group]) {
        archives[group] = saved[group];
      }
    }

    this.saveSetting('archives', archives);
    this.saveSetting('libraries', libraries);
    this.updateMenu();
  },

  addToRecent(song) {
    const saved = this.readSetting('recents');
    const filename = song.file || song.name;
    const filepath = song.path + filename;
    const recents = [{
      name: filename,
      path: song.path,
      album: song.album,
      type: song.type,
      lib: song.lib
    }];

    for (const data of saved) {
      if (recents.length > maxRecent) {
        if (!data.path) {
          try {
            this.unlinkFile(`./${data.path}${data.name}`);
          } catch (e) {
            console.error('Recent Item Delete Failed', e);
          }
        }
        continue;
      }

      if (data.path + data.name !== filepath) {
        recents.push(data);
      }
    }

    console.log('addToRecent', `${this.dataPath}/Archives/${filepath}`);
    app.addRecentDocument(`${this.dataPath}/Archives/${filepath}`);

    this.saveSetting('recents', recents);
    this.updateMenu();
  },

  importArchive(files, done) {
    const zipfile = files[0];
    const zip = this.readZip(zipfile.data);

    let count = 0;
    let total;

    function countdown() {
      if (--count === 0) {
        done();
      }
      electron.taskProgressBar((total - count) / total);
    }

    for (const name in zip.files) {
      const file = zip.file(name);
      if (file) {
        // restore and merging storage
        if (file.name === 'archives.json') {
          const archives = this.readSetting('archives');
          const libraries = this.readSetting('libraries');
          const storage = JSON.parse(file.asText());
          // console.debug('archives.json', storage);

          Object.assign(archives, storage.archives);
          Object.assign(libraries, storage.libraries);

          this.saveSetting('archives', archives);
          this.saveSetting('libraries', libraries);
          continue;
        }

        const stat = this.pathParse(file.name);
        this.writeFile(`./${stat.dir}/${stat.base}`, file.asNodeBuffer(), countdown);
        total = count++;
      }
    }
  },

  exportArchive(done) {
    console.debug('Starting archive export');

    const root = `${this.dataPath}/Archives`;
    const archives = this.readSetting('archives');
    const libraries = this.readSetting('libraries');

    // fix renderer process crash
    ipcRenderer.send('fs-write', `${root}/archives.json`, JSON.stringify({archives, libraries}));
    ipcRenderer.once('fs-write', (event, err) => {
      if (err) {
        return done(err);
      }

      fs.readdir(root, (err1, entries) => {
        if (err1 || !entries) {
          return done(err1 || new Error('Failed export archive'));
        }

        const filenames = [];
        for (let i = 0; i < entries.length; i++) {
          filenames.push(root + '/' + entries[i]);
        }

        this.traverseFileTree(filenames, (err2, files) => {
          this.unlinkFile('./archives.json');

          if (err2) {
            return done(err2);
          }

          // console.debug('Archive export done!', zip);
          electron.showSaveDialog({
            title: 'Save Muki Archives',
            name: 'archives.muki'
          }, (err3, filename) => {
            if (err3 || !filename) {
              return done(err3 || new Error('File path not found'));
            }

            const zip = new JSZip();
            for (const file of files) {
              zip.file(`${file.path}${file.name}`, file.data);
            }

            fs.writeFile(filename, zip.generate({type: 'nodebuffer'}), done);
          });
        });
      });
    });
  },

  clearArchive(done) {
    if (confirm('Are you sure you want to delete all archives?')) {
      this.unlinkFile('./');
      this.saveSetting('recents', []);
      this.saveSetting('archives', {});
      this.saveSetting('libraries', {});
      this.saveSetting('lastArchive', null);
      this.saveSetting('lastPlayed', null);
      app.clearRecentDocuments();
    }

    done();
  }
};

electron.setDefaultSettings();

/*
function toArrayBuffer(buffer) {
  const ab = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buffer.length; ++i) {
    view[i] = buffer[i];
  }
  return view.buffer;
}
function toBuffer(ab) {
  const buffer = new Buffer(ab.byteLength);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buffer.length; ++i) {
    buffer[i] = view[i];
  }
  return buffer;
}
*/

function toArrayBuffer(buffer) {
  return new Uint8Array(buffer).buffer;
}

function toBuffer(ab) {
  return new Buffer(new Uint8Array(ab));
}


module.exports = electron;
