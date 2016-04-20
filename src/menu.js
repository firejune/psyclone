'use strict';

const { remote, shell } = require('electron');
const pack = require('../package.json');
const development = !!remote.getGlobal('development');
const isDarwin = process.platform === 'darwin';

function createMenuTemplate(app, type) {
  const win = remote.getCurrentWindow();
  const recents = app.state('recents');
  const archives = app.state('archives');
  const recent = [];
  const archive = [];

  let Controls;
  let Playback;
  let Visualizer;
  let Archive;
  let Recent;
  let Details;
  let Playlist;
  let View;

  for (const data of recents) {
    recent.push({
      label: startAndEnd(data.name),
      click: app.playSong.bind(app, data)
    });
  }

  for (const group of Object.keys(archives)) {
    const label = group.slice(0, -1).replace(/(\.[a-z0-9]{2,4})?\....?$/, '');
    archive.push({
      label: `${startAndEnd(label)} (${archives[group].length})`,
      click: app.playArchive.bind(app, group)
    });
  }

  if (type === 'dock') {
    archive.splice(10);
    return archive;
  }

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => app.openFile() },
        Recent = { label: 'Open Recent', enabled: recent.length > 0, submenu: recent },
        Archive = { label: 'Open Archive', enabled: archive.length > 0, submenu: archive },
        { type: 'separator' },
        { label: 'Import Archive', click: () => app.importArchive() },
        { label: 'Export Archive', click: () => app.exportArchive() },
        { type: 'separator' },
        { label: 'Reset All Settings', click: () => app.resetAllSettings() },
        { label: 'Delete Archives', click: () => app.clearArchive() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectall' }
      ]
    },
    {
      label: 'View', submenu: View = [
        Details = { label: 'Toggle Details', accelerator: 'CmdOrCtrl+I', type: 'checkbox', checked: app.state('details'), click: () => app.toggleDetails() },
        Playlist = { label: 'Toggle Playlist', accelerator: 'Ctrl+Tab', type: 'checkbox', checked: app.state('playlist'), click: () => app.togglePlaylist() },
        { type: 'separator' },
        Visualizer = {
          label: 'Visualizer', submenu: [
            { label: 'None', type: 'checkbox', checked: app.state('viz', 'none'), click: () => app.changeVisualizer('none') },
            { label: 'Bouncing Bubbles', type: 'checkbox', checked: app.state('viz', 'Circles'), click: () => app.changeVisualizer('Circles') },
            { label: 'Plasma Lights', type: 'checkbox', checked: app.state('viz', 'Lights'), click: () => app.changeVisualizer('Lights') },
            { label: 'Sonogram Hills', type: 'checkbox', checked: app.state('viz', 'Hills'), click: () => app.changeVisualizer('Hills') }
          ]
        },
        { type: 'separator' },
        { label: 'Full Screen', accelerator: isDarwin ? 'Ctrl+Command+F' : 'F11', type: 'checkbox', checked: win.isFullScreen(), click: () => win.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' },
        { label: 'Display Notification', type: 'checkbox', checked: app.state('notification'), click: () => app.displayNotification() }
      ]
    },
    {
      label: 'Controls',
      submenu: Controls = [
        { label: 'Play/Pause', accelerator: 'Space', click: () => app.playPause() },
        { label: 'Record', accelerator: 'Alt+Space', click: () => app.record() },
        { type: 'separator' },
        { label: 'Shuffle', type: 'checkbox', checked: app.state('shuffle'), click: () => app.toggleShuffle() },
        { label: 'Repeat', submenu: [
          { label: 'Off', type: 'checkbox', checked: app.state('repeat', 'off'), click: () => app.changeRepeat('off') },
          { label: 'One', type: 'checkbox', checked: app.state('repeat', 'one'), click: () => app.changeRepeat('one') },
          { label: 'All', type: 'checkbox', checked: app.state('repeat', 'all'), click: () => app.changeRepeat('all') }
        ] },
        { type: 'separator' },
        { label: 'Next', accelerator: 'Right', click: () => app.next() },
        { label: 'Previous', accelerator: 'Left', click: () => app.prev() },
        { type: 'separator' },
        { label: 'Mute', type: 'checkbox', checked: app.state('mute'), accelerator: 'CmdOrCtrl+Shift+M', click: () => app.toggleMute() },
        { label: 'Increase Volume', accelerator: 'Up', click: () => app.volumeUp() },
        { label: 'Decrease Volume', accelerator: 'Down', click: () => app.volumeDown() }
      ]
    },
    Playback = {
      label: 'Playback',
      submenu: [
        { label: 'Timidity (General MIDI)', type: 'checkbox', checked: app.state('synth', 'timidity'), click: () => app.setMidiSynth('timidity') },
        { label: 'libAdlMIDI (OPL3 Adlib)', type: 'checkbox', checked: app.state('synth', 'adlib'), click: () => app.setMidiSynth('adlib') },
        { label: 'Munt (Roland MT-32/CM-32L)', type: 'checkbox', checked: app.state('synth', 'mt32'), click: () => app.setMidiSynth('mt32') },
        { label: 'Wasy (Web Audio Synth)', type: 'checkbox', checked: app.state('synth', 'websynth'), click: () => app.setMidiSynth('websynth') },
        { label: 'WebSF2 (SoundFont2 Synth)', type: 'checkbox', checked: app.state('synth', 'websf2'), click: () => app.setMidiSynth('websf2') },
        { type: 'separator' },
        { label: 'Enable Dynamics Compressor', type: 'checkbox', checked: app.state('compressor'), click: () => app.compressor() }
      ]
    },
    {
      label: 'Window', submenu: [
        { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Close', accelerator: 'CmdOrCtrl+W', role: 'close' },
        { type: 'separator' },
        { label: 'Bring All to Front', role: 'front' },
        { type: 'separator' },
        { label: 'Always On Top', type: 'checkbox', checked: win.isAlwaysOnTop(), click: () => win.setAlwaysOnTop(!win.isAlwaysOnTop()) }
      ]
    },
    {
      label: 'Help', role: 'help', submenu: [
        { label: 'About', click: () => shell.openExternal('http://muki.io/pages/about') },
        { label: 'Help & FAQ', click: () => shell.openExternal('http://muki.io/pages/help') },
        { label: 'Homepage', click: () => shell.openExternal(pack.homepage) },
        { label: 'Bug Report', click: () => shell.openExternal(pack.bugs.url) }
      ]
    }
  ];

  // for right-click context menu
  if (type === 'context') {
    Controls.unshift({ type: 'separator' });
    Controls.unshift(Playback);

    Controls.unshift({ type: 'separator' });
    Controls.unshift(Playlist);
    Controls.unshift(Details);
    Controls.unshift(Visualizer);

    Controls.unshift({ type: 'separator' });
    Controls.unshift(Archive);
    Controls.unshift(Recent);

    return Controls;
  }

  if (development) {
    View.push({ type: 'separator' });
    View.push({ label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.reload() });
    View.push({ label: 'Show Developer Tools', accelerator: isDarwin ? 'Alt+Command+I' : 'Ctrl+Shift+I', type: 'checkbox', checked: win.isDevToolsOpened(), click: () => win.toggleDevTools() });
  }

  if (isDarwin) {
    template.unshift({
      label: 'Electron',
      submenu: [
        { label: `About ${pack.name}`, role: 'about' },
        { type: 'separator' },
        { label: 'Services', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: `Hide ${pack.name}`, accelerator: 'Command+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Command+Alt+H', role: 'hideothers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => remote.app.quit() }
      ]
    });
  }

  return template;
}

function startAndEnd(str) {
  if (str.length > 35) {
    return `${str.substr(0, 18)} ... ${str.substr(str.length - 10, str.length)}`;
  }
  return str;
}

module.exports = createMenuTemplate;
