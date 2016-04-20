'use strict';

global.$ = global.jQuery = require('jquery');

/*
 TODO:
  - Auto logo display when music stoped.
  - Add a option of start on play
  - Display playlist index of total
  - Seek music using progress bar
  - Fix wrong resize of hill viz
  - Slide animation of details panel and playlist
  - Add a checkbox of set skip this song
  - Change UI: https://github.com/simurai/umbrUI
  - Add View > Transparency
  - Fix entry limit 100
*/

const NProgress = require('nprogress');
const Vivus = require('vivus');
const app = require('./app');
const mime = require('./mime');

const getFile = require('./helpers/getfile');
const Emitter = require('./helpers/emitter');
const Playlist = require('./helpers/playlist');
const MIDIParser = require('./helpers/midiparser');
const Visualizer = require('./helpers/visualizer');
const Output = require('./helpers/output');
const Recorder = require('./helpers/recorder');

const GME = require('./playbacks/gme'); // Game Music Emulators
const MOD = require('./playbacks/mod'); // OpenMPT
const PSF = require('./playbacks/psf'); // PSF simulation
// FIXME 끊어지는 문제 있음
const USF = require('./playbacks/usf');
const VGM = require('./playbacks/vgm'); // VGMPlay
const MIDI = require('./playbacks/midi'); // TiMidity++
const MT32 = require('./playbacks/mt32'); // Munt
const AdPlug = require('./playbacks/adplug');
const AdlMidi = require('./playbacks/adlmidi');
const Chiptune = require('./playbacks/chiptune');
const WebSynth = Chiptune('WebSynth');
const WebSF2 = Chiptune('WebSF2');

const AUDIO = {};
let FOCUSED = false;

function hasLib(uint8arr) {
  let str = '';

  for (let i = 0; i < uint8arr.length; i++) {
    if (uint8arr[i] > 0 && uint8arr[i] < 128) {
      str += String.fromCharCode(uint8arr[i]);
    }
  }

  const result = {};
  const index = str.indexOf('_lib=');

  if (index === -1) return {};

  const find = str.substr(index);
  find.trim().split('\n').forEach(e => {
    if (e.indexOf('=') !== -1) {
      const row = e.split('=');
      result[row[0]] = row[1];
    }
  });

  return result;
}

// drag and drop event
function dragAndDropHelper(opt, done) {
  const show = opt.show && document.getElementById(opt.show);
  const hide = opt.hide && document.getElementById(opt.hide);
  const filetype = opt.type;

  let count = 0;
  let files = [];
  let loaded = 0;

  function toggle(state) {
    if (state) {
      show && (show.style.display = 'block');
      hide && (hide.style.display = 'none');
    } else {
      show && (show.style.display = 'none');
      hide && (hide.style.display = 'block');
    }
  }

  function entry(items) {
    files = [];
    count = 0;
    for (let i = 0; i < items.length; i++) {
      const file = items[i].webkitGetAsEntry();
      // webkitGetAsEntry is where the magic happens
      traverseFileTree(file);
    }
    app.taskProgressBar(0);
  }

  function traverseFileTree(item, path) {
    count++;
    path = path || '';
    if (item.isFile) {
      // Get file
      item.file(file => {
        // console.debug('File:', path + file.name);
        file._path = path;
        files.push(file);
        if (--count === 0) {
          done(files);
        }
      });
    } else if (item.isDirectory) {
      // Get folder contents
      const dirReader = item.createReader();
      dirReader.readEntries(entries => {
        for (let i = 0; i < entries.length; i++) {
          traverseFileTree(entries[i], path + item.name + '/');
        }
        count--;
      });
    }
  }

  function stop(evt) {
    evt.dataTransfer.dropEffect = 'copy';
    evt.stopPropagation();
    evt.preventDefault();
  }

  if (typeof FileReader === 'undefined') return;

  document.addEventListener('dragenter', evt => {
    stop(evt);
    loaded++;
    toggle(true);
  });
  document.addEventListener('dragleave', evt => {
    stop(evt);
    if (--loaded === 0) {
      toggle(false);
    }
  });
  document.addEventListener('dragover', stop, false);
  document.addEventListener('drop', evt => {
    toggle(false);
    stop(evt);

    if (evt.dataTransfer.items && evt.dataTransfer.items.length > 0) {
      return entry(evt.dataTransfer.items);
    }

    if (evt.dataTransfer.files && evt.dataTransfer.files.length > 0) {
      return done(evt.dataTransfer.files);
    }

    if (filetype && evt.dataTransfer.types) {
      const items = evt.dataTransfer.types.filter(item => item === filetype).map(type => {
        const data = evt.dataTransfer.getData(type);
        return { type, data };
      });

      done(items);
    }
  }, false);
}

// Set File Drag and Drop
function setDragAndDrop() {
  const list = {};

  dragAndDropHelper({
    show: 'over',
    type: 'text/plain'
  }, files => {
    console.debug('File Drop Callback', files);
    init(files);
  });

  function init(files) {
    list.songs = [];
    list.count = 0;

    Muki.pause();
    analysisFiles(files);
  }

  function analysisFiles(files, oneMore) {
    if (!files || !files.length) {
      app.taskProgressBar(1);
      // throw new Error('File Not found!');
      Player.error('File Not found!');
      Muki.resume();
      return;
    }

    const drivers = [];
    const unsupported = [];

    list.total = list.count += files.length;

    function countdown() {
      if (!--list.count) {
        // 누락된 라이브러리 찾기
        for (let j = 0; j < unsupported.length; j++) {
          if (drivers.indexOf(unsupported[j].name) !== -1) {
            // unsupported[j].type = 'audio/unknownlib';
            console.debug('unsupported[j]', unsupported[j]);
            readFile(unsupported[j], 'audio/unknownlib');
          }
        }

        makeList();
        app.notification(`${list.songs.length} playable file${list.songs.length > 1 ? 's' : ''} loaded.`);
      }
      app.taskProgressBar((list.total - list.count) / list.total);
    }

    function makeSong(data) {
      if (data.type === 'audio/midi') {
        try {
          const midi = new MIDIParser(data.data);
          if (midi.isMT32()) {
            console.log('MT-32 mode requested, or sysex detected.');
            data.type = 'audio/midi-mt32';
          }
        } catch (err) {
          console.warn('Unsupported midi type: ', err);
          countdown();
          return;
        }
      } else if (
        data.type === 'audio/usf' ||
        data.type === 'audio/psf' ||
        data.type === 'audio/psf2') {
        // 라이브러리 파일명 가져오기
        const parsed = hasLib(new Uint8Array(data.data));
        if (parsed._lib) {
          data.lib = parsed._lib;
          if (drivers.indexOf(data.lib) === -1) {
            drivers.push(data.lib);
          }
        }
      }

      if (data.type.match(/\/(psflib|psf2lib|usflib|unknownlib)/)) {
        app.addLibrary(data);
        console.info(`Loaded the sound library: ${data.path}${data.name}`);
        // TODO display lib added message
      } else {
        list.songs.push(data);
      }

      countdown();
    }

    function readFile(file, type) {
      if (file.data) {
        file.type = type;
        makeSong(file);
        return;
      }

      const reader = new FileReader;
      reader.onload = function(evt) {
        const data = evt.target.result;
        makeSong({
          name: file.name,
          path: file._path,
          type,
          data
        });
      };

      reader.readAsArrayBuffer(file);
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const type = mime.guess((file.name || '').toLowerCase());

      if (type === 'application/zip') {
        console.log('ZIP file detected unzipping...');
        unzip(file);
        continue;
      }

      if (!type && file.type === 'text/plain') {
        console.log('Text dropped to window. MML is not supported yet!');
        countdown();
        continue;
      }

      if (Player.backends[type]) {
        readFile(file, type);
      } else {
        console.warn(`Unsupported file type: ${file.name}`);
        unsupported.push(file);
        countdown();
      }
    }

    if (oneMore) {
      countdown();
    }
  }

  function unzip(zipfile) {
    if (zipfile.data) {
      readZip(zipfile, zipfile.data);
      return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
      readZip(zipfile, evt.target.result);
    };

    reader.readAsArrayBuffer(zipfile);
  }

  function readZip(zipfile, buffer) {
    const files = [];
    const zip = app.readZip(buffer);
    const dir = app.pathParse(zipfile.name).name;

    for (const name in zip.files) {
      const file = zip.file(name);
      if (file) {
        const stat = app.pathParse(dir + '/' + file.name);
        files.push({
          name: stat.base,
          path: stat.dir + '/',
          data: file.asArrayBuffer()
        });
      }
    }

    analysisFiles(files, true);
  }

  function makeList() {
    const playlist = new Playlist(list.songs, Player.shuffling);
    app.addToArchive(playlist);
    Muki.hitPlay(playlist);
  }

  return init;
}

const Player = Emitter({
  // songLength: 0,
  repeating: app.readSetting('repeat'),
  shuffling: app.readSetting('shuffle'),
  isPaused: false,
  isPlaying: false,
  isRecording: false,
  recorder: null,
  currentSong: {},
  log(message) {
    console.log('[Player] ' + message);
  },

  init() {
    this.synths = {};
    this.backends = {};
  },

  addBackend(module, synth) {
    module.types.forEach(type => (this.backends[type] = module));
    module.on('loading', () => {
      NProgress.remove();
      this.trigger('loading');
    });
    module.on('progress', Control.setProgress.bind(Control));
    module.on('finished', () => {
      if (this.repeating === 'one') {
        this.playSong(this.currentSong);
      } else {
        this.next();
      }
    });
    module.on('crashed', this.crashed.bind(this));
    module.on('error', this.error.bind(this));
    module.on('playing', (e, t) => this.playing(false, e, t));
    module.on('stopped', (e, t) => this.stopped(false, e, t));
    module.on('resumed', (e, t) => this.playing(true));
    module.on('paused', (e, t) => this.stopped(true));
    module.on('load_start', () => NProgress.set(0));
    module.on('load_progress', (e) => NProgress.set(e / 100));
    module.on('load_end', () => NProgress.done());

    if (synth) {
      this.synths[synth] = module;
    }
  },

  setPlaylist(list, notSave) {
    // console.debug('Player.setPlaylist', list.songs);

    if (!list.songs.length) {
      // throw new Error('Not found songs!');
      return Player.error('Playable file not found!');
    }

    this.playlist && this.stop();
    this.playlist = list;
  },

  setShuffle() {
    app.saveSetting('shuffle', this.shuffling = !this.shuffling);

    if (this.playlist) {
      const name = this.currentSong && this.currentSong.name;
      this.playlist.shuffle(this.shuffling, name);
      UI.listSongs(this.playlist.list(), this.playlist.index);
    }
  },

  getSong() {
    this.stop();
    this.trigger('loading');
    this.playlist.feed((next, song) => {
      if (next) {
        this.next();
      } else {
        if (song) {
          this.playSong(song);
          song = null;
        } else {
          this.playlistFinished(next);
        }
      }
    });
  },

  setMidiSynth(synth) {
    if (!synth) {
      return;
    }

    app.saveSetting('midi-synth', synth);

    this.backends['audio/midi'] = this.synths[synth];
    // this.backends['audio/midi-mt32'] = this.synths[synth];

    const stat = this.backendStatus();
    const song = this.currentSong;
    if (stat === 'playing' && song.type === 'audio/midi') {
      this.stop();
      this.play();
    }
  },

  getSongFromMuki(name) {
    const dataUrl = `${app.home}/songs/${name}/data`;
    const infoUrl = `${app.home}/songs/${name}/info`;
    const play = function(err, song) {
      if (!err) {
        this.playSong(song);
      }
    };

    getFile(dataUrl, {responseType: 'arraybuffer'}, (err, status, data, type) => {
      if (err || status !== 200 || !data) {
        return play(err || new Error('Unable to get song at ' + dataUrl));
      }

      const song = {
        file: name,
        name,
        data,
        type
      };
      const arr = song.name.split(/--|\./);
      const album = arr[0];
      const title = song.name.indexOf('--') !== -1 ? arr[1] : null;

      song.slug = album;

      getFile(infoUrl, (_err, _status, _data) => {
        if (_err) {
          return play(null, song);
        }

        song.info = JSON.parse(_data);

        if (!song.info.title) {
          if (title) {
            song.info.album = State.titleize(album);
            song.name = title;
          } else {
            if (typeof song.info.track !== 'undefined') {
              song.name = 'Track ' + (parseInt(song.info.track, 10) + 1);
            }
          }
        }

        play(null, song);
      });
    });
  },

  playSong(song) {
    // console.debug('Player.playSong', song);

    if (Intro.isPlaying()) {
      Intro.cancel();
    }

    if (!song || !song.data) {
      throw new Error('No data passed!');
    }

    if (!this.backends[song.type]) {
      return this.error(new Error('Empty or invalid format: ' + song.type));
    }

    let midi;
    const backend = this.backends[song.type];

    if (this.currentBackend && backend !== this.currentBackend) {
      console.debug('Shifting Backend to ' + song.type);
      this.stop();
    }

    this.log(`Playing song: ${song.name}`);
    // app.notification(`${song.group ? song.group + '\n' : ''}${song.name}`);

    this.currentSong = song;
    this.currentBackend = backend;

    Control.setLength(0);

    backend.once('length', length => {
      // this.songLength = length;
      Control.setLength(length);
      song.duration = Control.formatTime(Control.totalTime);
    });

    if (song.type.match('midi')) {
      midi = new MIDIParser(song.data);
      const tempo = midi.tempo();
      tempo && this.trigger('tempo', tempo);
      song.tracks = midi.title();
    }

    setTimeout(() => {
      this.isPaused = false;
      this.isPlaying = true;
      backend.play(song, midi);
      app.saveSetting('lastPlayed', song.name);
      app.addToRecent(song);
    }, 100);
  },

  error(err) {
    this.trigger('error', err);
  },

  crashed(err) {
    this.trigger('crash', err || new Error('Application crashed.'));
  },

  playing(flag, t, n) {
    Control.toggle(true);
    Control.setActive('play');

    const state = flag ? 'resumed' : 'started';
    this.trigger(state, t, n);
  },

  stopped(flag) {
    Control.setActive('stop');
    flag || Control.setProgress(0);

    const state = flag ? 'paused' : 'stopped';
    this.trigger(state);
  },

  playlistFinished() {
    if (this.repeating === 'all') {
      this.restart();
    } else {
      this.trigger('finished');
      this.stopped();
    }
  },

  restart() {
    if (this.playlist) {
      this.playlist.index = 0;
      Control.setPlaying(this.playlist.index);
      this.play();
    } else {
      console.log('No playlist set. Cannot restart');
    }
  },

  play() {
    if (this.playlist) {
      this.getSong();
      return true;
    }

    console.log('No playlist set. Cannot play.');
    return false;
  },

  startRecording() {
    if (this.recorder) {
      return console.warn('Already process in recording!');
    }

    this.isRecording = true;
    Control.setRecording(true);

    if (AUDIO.source) {
      console.log('Initializing recorder.', AUDIO.source);
      this.recorder = new Recorder(AUDIO.source);
      this.recorder.started_at = new Date;
      this.recorder.record();
    } else {
      console.log('No audio source set!');
    }
  },

  stopRecording() {
    if (!this.recorder) {
      return console.log('Not recording!');
    }

    this.isRecording = false;
    Control.setWaiting(true);

    const date = new Date;
    const sec = Math.ceil((date - this.recorder.started_at) / 1e3);
    const name = 'record-' + sec + 's-' + (new Date).getTime() + '.mp3';

    console.info('Saving recorded audio. Got ' + sec + ' seconds.');

    this.recorder.exportWAV(data => {
      app.writeFile('./record.wav', data, err => {
        Recorder.encodeMP3(`${app.dataPath}/Archives/record.wav`, 128, () => {
          this.saveRecording(name);
        });
      });
    });
  },

  saveRecording(name) {
    app.showSaveDialog({
      name,
      title: 'Save Record File',
      data: app.readFile('./record.mp3')
    }, (err) => {
      Control.setWaiting(false);
    });

    this.recorder.clear();
    this.recorder = null;
  },

  record() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      const stat = this.backendStatus();
      let playing = stat === 'playing';

      if (stat === 'stopped') {
        playing = this.play();
      }

      if (stat === 'paused') {
        this.resume();
        playing = true;
      }

      if (playing) {
        this.startRecording();
      }
    }
  },

  stop() {
    this.currentBackend && this.currentBackend.stop();
    this.isPlaying = false;
  },

  prev() {
    if (!this.playlist) {
      return console.log('No playlist set. Cannot skip to prev.');
    }

    if (this.currentBackend && this.currentBackend.prev_track && this.currentBackend.prev_track()) {
      return this.log('Skipped to prev track in multitrack song.');
    }

    if (!(this.playlist.index <= 0)) {
      const index = this.playlist.prev();
      Control.setPlaying(index);
      this.getSong();
    }
  },

  next() {
    if (!this.playlist) {
      return console.log('No playlist set. Cannot skip to next.');
    }

    if (this.currentBackend && this.currentBackend.next_track && this.currentBackend.next_track()) {
      return this.log('Skipped to next track in multitrack song.');
    }

    const index = this.playlist.next();
    if (index >= 0) {
      Control.setPlaying(index);
      this.getSong();
    }
  },

  pause() {
    if (this.isRecording) {
      this.stopRecording();
    }

    this.currentBackend && this.currentBackend.pause();
    this.isPaused = true;
  },

  resume() {
    this.currentBackend && this.currentBackend.resume();
    this.isPaused = false;
  },

  skipTo(num) {
    const list = this.playlist;
    const index = parseInt(num, 10);

    if (list && list.index !== index) {
      list.set(index);
      Control.setPlaying(index);
      this.getSong();
    }
  },

  backendStatus() {
    return this.currentBackend ? this.currentBackend.status() : 0;
  },

  playPause() {
    if (!this.currentBackend) {
      this.log('No current backend.');
      return this.play();
    }

    const status = this.backendStatus();

    if (status === 'playing') {
      this.pause();
    } else if (status === 'paused') {
      this.resume();
    } else if (status === 'stopped') {
      this.play();
    } else if (status === 'playing') {
      this.pause();
    } else {
      this.log('Cannot play/pause, backend is ' + status);
    }
  }
});

const UI = (() => {
  const visuals = Object.keys(Visualizer).concat(['none']);
  let visual;
  let modal;
  let playing;
  // let timer;

  const ui = {
    defaultVisualizer: 'Circles',
    filterSongs(str) {
      if (!str) {
        $('#songlist li').show();
        return;
      }
      $('#songlist li').each((idx, item) => {
        const $item = $(item);
        if ($item.find('a').html().toLowerCase().indexOf(str.toLowerCase()) !== -1) {
          $item.show();
        } else {
          $item.hide();
        }
      });
    },

    listSongs(list, index) {
      let i = 0;
      const $songlist = $('#songlist');
      const html = list.map(name => {
        const selected = i === index ? 'class="selected"' : '';
        return '<li ' + selected + '><a href="#" data-index="' + i++ + '">' + name + '</a></li>';
      }).join('');

      $songlist.html(html);
      if ($('#sidepane').is(':visible') && $songlist.find('.selected').length) {
        $songlist.find('.selected')[0].scrollIntoView(true);
      }
    },

    toggleSidepane() {
      const pane = document.getElementById('sidepane');
      const display = pane.style.display === 'block' ? 'none' : 'block';

      pane.style.display = display;

      if (display === 'block') {
        const $selected = $('#songlist .selected');
        $selected.length && $selected[0].scrollIntoView(true);
      }
    },

    loadSearchbox() {
      $('#search').on('keyup search', function(evt) {
        const val = this.name.value;
        UI.filterSongs(val);
      });
    },

    renderLogo(quickly, callback) {
      function fade(time) {
        $('#animation').fadeOut(time, function() {
          $(this).remove();
          callback && callback();
        });
      }

      function onEnd() {
        if (quickly) {
          $('#corner-logo').fadeIn();
          fade(300);
        } else {
          setTimeout(() => {
            $('#real img').animate({opacity: 1}, 1e3);
            $('#real big').animate({opacity: 1}, 2e3);
            fade(1e3);
          }, 100);
        }
      }

      quickly && $('#logo').addClass('center');

      const svgLogo = {
        file: './assets/img/muki-lines.svg',
        type: 'async',
        duration: 150,
        pathTimingFunction: Vivus.EASE_OUT,
        animTimingFunction: Vivus.EASE
      };

      try {
        this.vivus = new Vivus('animation', svgLogo, onEnd);
      } catch (err) {
        onEnd();
      }
    },

    hideLogo() {
      $('#corner-logo').fadeIn();
      $('#logo #real').fadeOut();
    },

    showLogo() {
      $('#corner-logo').fadeOut();
      $('#logo #real').fadeIn();
    },

    isModalVisible() {
      return !!modal;
    },

    hideModal(page) {
      page = page || modal;

      $(page).removeClass('active').addClass('below');
      // $('body').removeClass('noscroll');

      /*
      // $(page).removeClass('open');
      clearTimeout(timer);
      timer = setTimeout(() => {
        $(page).removeClass('active').addClass('below');
      }, 400);
      */

      if (page === modal) {
        modal = null;
      }
    },

    openModal(page, callback) {
      // $('body').addClass('noscroll');

      $(page).css('visibility', 'visible').removeClass('below').addClass('active').on('hide', () => {
        $(page).removeClass('active').addClass('below');
        // $('body').removeClass('noscroll');
      }).find('.close').on('click', evt => {
        $(page).removeClass('active').addClass('below');
        // $('body').removeClass('noscroll');
        evt.preventDefault();
        ui.hideModal();
        callback && callback();
      });

      // clearTimeout(timer);
      // $(page).addClass('open');
      const scrollHeight = $(page).find('.content')[0].scrollHeight;
      $(page).toggleClass('noscroll', scrollHeight <= $(page).height());

      modal = page;
    },

    showPage(opt) {
      const page = opt.params.page;
      page && ui.openModal('#page-' + page);
    },

    nextVisualizer() {
      if (!visual) {
        return ui.changeVisualizer(visuals[0]);
      }

      let index = visuals.indexOf(visual.name);
      index + 1 === visuals.length && (index = -1);
      ui.changeVisualizer(visuals[index + 1]);
    },

    changeVisualizer(viz, withStart) {
      app.saveSetting('visualizer', viz);

      if (visual) {
        visual.unload();
        visual = null;
      }

      if (viz === 'none') {
        $('#viz').addClass('off');
      } else {
        visual = Visualizer[viz];
        if (visual.type !== 'WebGL' || global.WebGLRenderingContext) {
          visual.load('viz');
          withStart || playing || ui.startViz(AUDIO.source, AUDIO.context);
        } else {
          ui.nextVisualizer();
        }
      }
    },

    startViz(source, context) {
      $('#viz').removeClass('off');
      try {
        visual.start(source, context);
      } catch (err) {
        ui.nextVisualizer();
      }
    },

    init(viz, synth) {
      viz = viz || ui.defaultVisualizer;

      ui.changeVisualizer(viz, true);
      ui.loadSearchbox();

      Player.on('started', (source, context) => {
        playing = false;
        visual && source && context && ui.startViz(source, context);
      });
      Player.on('tempo', (value) => {
        visual && visual.tempo && visual.tempo(value);
      });
      Player.on('stopped', () => {
        visual && visual.stop();
      });
      Player.on('paused', () => {
        playing = true;
        visual && visual.freeze();
      });
    }
  };

  return ui;
})();

const Intro = (() => {
  require('./libs/starfield');
  require('./libs/typed');

  let $elem;
  let starfield;
  let onEnd;
  let isPlaying = false;
  const strings = [];

  function start(elem, callback) {
    if (isPlaying) {
      callback && callback();
    } else {
      isPlaying = true;
      onEnd = callback;
      $elem = $(elem);

      $('.skip-intro').on('click', cancel);
      starfield = $elem.starfield({
        starDensity: 0.1,
        mouseScale: 0.5,
        seedMovement: true
      });

      $elem.show();

      setTimeout(() => {
        $elem.find('p').typed({
          contentType: 'text',
          strings,
          typeSpeed: 20,
          backDelay: 2e3,
          backSpeed: -15,
          callback: () => setTimeout(() => stop(callback), 3e3)
        });
      }, 2e3);
    }
  }

  function cancel(evt) {
    evt && evt.preventDefault();
    isPlaying && stop(onEnd);
  }

  function stop(callback) {
    if (isPlaying) {
      isPlaying = false;
      $elem.fadeOut(1e3, () => {
        starfield.unload();
        $elem.remove();
        callback && callback();
      });
    } else {
      callback && callback();
    }
  }

  strings.push('Hello there.');
  strings.push("Remember the sound of the early 90's? ^800 Back then at the 1.44 MB floppy era?");
  strings.push('Everything was MIDI those days. ^500 You know, ^200 those tiny songs we heard in most computer games.');
  strings.push('Then we got CD-ROMs, MP3s and bigger hard drives, ^200 and we kinda forgot about MIDI.');
  strings.push('Or did we?');
  strings.push("This project is about bringing back MIDI and other rare formats of the day, ^300 and replay them using today's technology.");
  strings.push("How do you think they'd sound if we played them back using only your browser?");
  strings.push('Now stay awhile, ^300 and listen.');

  return {
    start,
    stop,
    cancel,
    isPlaying() {
      return isPlaying;
    }
  };
})();

const Control = {
  elements: {},
  init(els) {
    const str = 'songlist playIcon timeCursor timeElapsed';
    str.split(' ').forEach(id => {
      this.elements[id] = document.getElementById(els[id]);
    });

    if (this.elements.songlist) {
      $(this.elements.songlist).on('click', 'a', function(evt) {
        evt.preventDefault();
        Player.skipTo($(this).data('index'));
      });
    }
  },

  formatTime(num) {
    const min = num / 60 >> 0;
    let sec = String(num - 60 * min >> 0);

    if (sec.length === 1) {
      sec = '0' + sec;
    }

    return min + ':' + sec;
  },

  setLength(length) {
    this.totalTime = parseFloat(length);
  },

  resetProgress() {
    this.totalTime = 0;
    this.setProgress(0);
  },

  setProgress(time) {
    if (time === 0 || Player.backendStatus() === 'playing') {
      const els = this.elements;
      if (els.timeCursor) {
        const elapsed = time >> 0;
        const percent = this.totalTime === 0 ? 0 : time / this.totalTime;

        els.timeCursor.style.width = 100 * percent + '%';
        els.timeElapsed.innerHTML = this.formatTime(elapsed);
      }
    }
  },

  setPlaying(index) {
    const $song = $('#songlist a[data-index=' + index + ']');
    if ($song.length) {
      $song.parent().addClass('selected').siblings().removeClass('selected');
      if ($('#sidepane').is(':visible')) {
        $song.parent()[0].scrollIntoView(true);
      }
    }
  },

  setActive(state) {
    $('#playPause-button').toggleClass('playing', state === 'play');
  },

  setWaiting(progressing) {
    $('#record-button').toggleClass('progressing', progressing);
    if (!progressing) {
      this.setRecording(false);
    }
  },

  setRecording(recording) {
    $('#record-button').toggleClass('recording', recording);
  },

  toggle(state) {
    state ? UI.hideLogo() : UI.showLogo();

    $(this.elements.controls).find('input').each(function() {
      $(this).attr('disabled', !state);
    });
  }
};

const State = {
  disabled: true,
  titleize(str) {
    return str.replace(/-|_/g, ' ').replace(/(?:^|\s)\S/g, e => e.toUpperCase());
  },

  upper_roman_numerals(str) {
    return str.replace(/ (v|x)?(i{1,3})(v|x)?(:|\s|$)/i, e =>
      ((e[0] || '') + e[1] + (e[2] || '') + (e[3] || '') + (e[4] || '')).toUpperCase()
    );
  },

  setLoading() {
    this.disabled = true;
    $('#song-album').text('[ Loading... ]');
  },

  clear() {
    this.disabled = true;
    this.showName({});
  },

  show(song) {
    if (!song.name) {
      return this.clear();
    }

    this.disabled = false;

    const info = song.info || {};
    if (!info.title) {
      info.title = this.titleize(song.name).replace(/(\.[a-z0-9]{2,4})?\....?$/, '');
    }
    if (!info.album && song.path) {
      info.album = this.titleize(song.path.split('/')[0]).replace(/(\.[a-z0-9]{2,4})?\....?$/, '');
    }
    if (info.album) {
      info.album = this.upper_roman_numerals(info.album);
    }
    if (song.type) {
      info.type = song.type.replace('audio/', '').toUpperCase();
    }

    this.showName(info);
    app.setFilename(`./${song.path}${song.name}`);
  },

  showName(info) {
    // console.log('showName', info);
    $('#song-type').text(info.type || '').toggle(!!info.type);
    $('#song-title').text(info.title || '');
    $('#song-album').text(info.album || '');

    app.setTitle(info.title);

    if (UI.isModalVisible()) {
      this.showDetails(null, true);
    }
  },

  showDetails(evt, changed) {
    if (UI.isModalVisible() && !changed) {
      UI.hideModal();
      return;
    }

    function getPlayback(source) {
      let playback = 'Unknown';

      switch (source) {
        case 'audio/hsc': case 'audio/sng': case 'audio/imf': case 'audio/wlf': case 'audio/adlib':
        case 'audio/a2m': case 'audio/amd': case 'audio/bam': case 'audio/cmf': case 'audio/mdi':
        case 'audio/d00': case 'audio/dfm': case 'audio/hsp': case 'audio/ksm': case 'audio/mad':
        case 'audio/midi-adplug': case 'audio/sci': case 'audio/laa': case 'audio/mkj':
        case 'audio/cff': case 'audio/dmo': case 'audio/s3m-adlib': case 'audio/dtm':
        case 'audio/mtk': case 'audio/rad': case 'audio/raw': case 'audio/sat': case 'audio/sa2':
        case 'audio/xad': case 'audio/lds': case 'audio/m': case 'audio/rol': case 'audio/xsm':
        case 'audio/dro': case 'audio/msc': case 'audio/rix': case 'audio/adl': case 'audio/jbm':
          playback = 'AdPlug - AdLib Sound'; break;

        case 'audio/ay': case 'audio/gbs': case 'audio/gym': case 'audio/hes': case 'audio/kss':
        case 'audio/nsf': case 'audio/nsfe': case 'audio/sap': case 'audio/spc':
          playback = 'GME - Game Music Emu'; break; // Nintendo Game Platform

        case 'audio/amf': case 'audio/psm': case 'audio/mod': case 'audio/s3m': case 'audio/it':
        case 'audio/xm':
          playback = 'MOD - Tracked music'; break;

        case 'audio/vgm': case 'audio/vgz':
          playback = 'VGM - Video Game Music'; break; // Sega Genesis

        case 'audio/xmi': case 'audio/midi-mt32-gm': case 'audio/midi-mt32':
          playback = 'MT-32 - Multi-Timbre - 32'; break; // Roland MT-32/CM-32L

        case 'audio/mus': case 'audio/midi':
          playback = 'MIDI - Musical Instrument Digital Interface'; break; // General MIDI

        case 'audio/psf': case 'audio/psf2':
          playback = 'PSF - Portable Sound Format'; break; // PlayStation 1/2

        case 'audio/usf':
          playback = 'USF - Ultra 64 Sound Format'; // Nintendo 64
      }

      return playback;
    }

    evt && evt.preventDefault();

    const song = Player.currentSong;
    if (!song.info && song.name) {
      song.info = {
        title: this.titleize(song.name).replace(/(\.[a-z0-9]{2,4})?\....?$/, ''),
        album: song.path && song.path.split('/')[0],
        game_publisher: 'Unknown'
      };
    }

    if (song.info && !this.disabled) {
      const info = song.info;
      const playback = getPlayback(song.type);
      let html = '<h2>Song:</strong> ' + info.title + '</h2>';

      html += '<ul>';
      // html += '<li><strong>Game:</strong> ' + (info.album || 'Unknown') + '</li>';
      html += '<li><strong>Playback:</strong> ' + playback + '</li>';
      html += '<li><strong>Duration:</strong> ' + song.duration + '</li>';
      if (song.tracks) html += '<li><strong>Description:</strong> <pre>' + song.tracks + '</pre></li>';
      // html += '<li><strong>Copyright:</strong> ' + info.game_publisher + '</li>';
      // html += '<li><strong>Game info:</strong> See on ' + slug() + '</li>';
      html += '</ul>';

      // 공유하기 항목 출력
      if (song.file) {
        html += '<h2>Share this song!</h2>';
        html += '<p>Copy the URL below and let someone else enjoy it too.';
        html += '<input id="share-url" onclick="this.select()" value="' + app.home + '/song/' + song.file + '" />';
      }

      $('#page-song-details .content').html(html);
      UI.openModal('#page-song-details');
    }
  }
};

const Muki = Emitter({
  resotreVolume: null,

  loadPlayer() {
    Player.init();

    const context = new AudioContext;
    const output = Output.setup(context);
    const synth = app.readSetting('midi-synth');

    Player.addBackend(MOD.init(context, output));
    Player.addBackend(GME.init(context, output));
    Player.addBackend(PSF.init(context, output));
    Player.addBackend(VGM.init(context, output));
    Player.addBackend(USF.init(context, output));
    Player.addBackend(AdPlug.init(context, output));
    Player.addBackend(MT32.init(context, output), 'mt32');
    Player.addBackend(AdlMidi.init(context, output), 'adlib');
    Player.addBackend(WebSynth.init(context, output), 'websynth');
    Player.addBackend(WebSF2.init(context, output), 'websf2');
    Player.addBackend(MIDI.init(context, output), 'timidity');
    Player.setMidiSynth(synth);

    Control.init({
      songlist: 'songlist',
      controls: '.controls',
      playIcon: 'play-icon',
      timeCursor: 'cursor',
      timeElapsed: 'time'
    });

    return synth;
  },

  handlePlayerEvents() {
    Player.on('loading', (e, t) => {
      State.setLoading();
      $('#capsule').addClass('blink');
    });
    Player.on('started', (source, context) => {
      AUDIO.source = source;
      AUDIO.context = context;
      State.show(Player.currentSong);
      $('#capsule').removeClass('blink');
    });
    Player.on('stopped', () => {
      State.clear();
    });
    Player.on('finished', () => {
      $('#capsule').removeClass('blink');
    });
    Player.on('error', err => {
      $('#capsule').removeClass('blink');
      alert(`ERROR:\n\n${err && err.message || err}`);
      // console.log('Chipas cripas. Got error: ' + err.message);
    });
    Player.on('crash', () => {
      alert('ERROR:\n\nHOLY SHENANIGANS! Reload, but keeping current index.');
      // console.error('HOLY SHENANIGANS! Reload, but keeping current index.');
    });
  },

  setPlaylist(playlist) {
    Player.setPlaylist(playlist);
    if (typeof UI && UI.listSongs !== 'undefined') {
      UI.listSongs(playlist.list(), playlist.index);
    }
  },

  hitPlay(playlist, playSongName, noAutoPlay) {
    if (playSongName && playlist.set_song) {
      playlist.set_song(playSongName);
    }

    this.setPlaylist(playlist);

    if (noAutoPlay !== true) {
      Player.play();
    }
  },

  pause() {
    if (Player.isPlaying && !Player.isPaused) {
      Player.playPause();
    }
  },

  resume() {
    if (Player.isPlaying && Player.isPaused) {
      Player.playPause();
    }
    app.updateMenu();
  },

  state(type, state) {
    switch (type) {
      case 'recents':
        return app.readSetting('recents');
      case 'archives':
        return app.readSetting('archives');
      case 'notification':
        return app.readSetting('notification');
      case 'details':
        return UI.isModalVisible();
      case 'playlist':
        return $('#list-button').hasClass('active');
      case 'mute':
        return this.resotreVolume !== null;
      case 'shuffle':
        return Player.shuffling;
      case 'repeat':
        return Player.repeating === state;
      case 'viz':
        return app.readSetting('visualizer') === state;
      case 'synth':
        return app.readSetting('midi-synth') === state;
      case 'compressor':
        return app.readSetting('enableCompressor');
    }
  },

  displayNotification() {
    app.saveSetting('notification', !this.state('notification'));
  },

  changeRepeat(state) {
    const mode = ['off', 'all', 'one'];
    if (mode.indexOf(state) !== -1) {
      Player.repeating = state;
    } else {
      let idx = mode.indexOf(Player.repeating) + 1;
      if (idx > 2) {
        idx = 0;
      }
      Player.repeating = mode[idx];
    }

    $('#repeat-button')
      .toggleClass('active', Player.repeating !== 'off')
      .toggleClass('one', Player.repeating === 'one');

    app.saveSetting('repeat', Player.repeating);
    app.updateMenu();
  },

  setMidiSynth(state) {
    Player.setMidiSynth(state);
    app.updateMenu();
  },

  changeVisualizer(state) {
    UI.changeVisualizer(state);
    app.updateMenu();
  },

  playSong(data) {
    Player.playSong(app.getData(data));
    app.saveSetting('lastArchive', null);
  },

  playArchive(archive, playSongName) {
    const songs = app.getArchiveData(archive);
    const playlist = new Playlist(songs, Player.shuffling);
    this.hitPlay(playlist, playSongName);
    app.addToArchive(playlist);
  },

  exportArchive() {
    this.pause();
    app.exportArchive((err) => {
      if (err) {
        console.warn(err);
      }
      this.resume();
    });
  },

  importArchive() {
    app.showOpenDialog({
      title: 'Select Muki Archives',
      filters: [{ name: 'Muki Archive', extensions: ['muki'] }]
    }, (err, files) => {
      if (err) {
        return console.warn(err);
      }
      this.pause();
      app.importArchive(files, () => {
        this.resume();
        app.notification('Archive Import Done.');
      });
    });
  },

  clearArchive() {
    this.pause();
    app.clearArchive(this.resume);
  },

  resetAllSettings() {
    this.pause();
    app.resetAllSettings(this.resume);
  },

  openFile() {
    app.showOpenDialog({
      title: 'Select Song Files or Folder',
      filters: [
        { name: 'AdPlug(AdLib Sound)', extensions: 'hsc sng imf wlf adlib a2m amd bam cmf mdi d00 dfm hsp ksm mad sci laa mkj cff dmo dtm mtk rad raw sat sa2 xad lds m rol xsm dro msc rix adl jbm'.split(' ') },
        { name: 'GME(Game Music Emu)', extensions: 'ay gbs gym hes kss nsf nsfe sap spc'.split(' ') }, // Nintendo Game Platform
        { name: 'VGM(Video Game Music)', extensions: ['vgm', 'vgz'] }, // Sega Genesis
        { name: 'MOD(Tracked music)', extensions: ['amf', 'psm', 'mod', 's3m', 'it', 'xm'] },
        { name: 'PSF(Portable Sound Format)', extensions: ['psf', 'psf2', 'psf2lib', 'psflib'] }, // PlayStation 1/2
        { name: 'USF(Ultra 64 Sound Format)', extensions: ['usf', 'usflib'] }, // Nintendo 64
        { name: 'MT-32(Multi-Timbre - 32)', extensions: ['xmi'] }, // Roland MT-32/CM-32L
        { name: 'MIDI(Musical Instrument Digital Interface)', extensions: ['mus', 'mid'] }, // General MIDI
        { name: 'ZIP Archive', extensions: ['zip'] }
      ],
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      returnType: 'ArrayBuffer'
    }, (err, files) => {
      if (err) {
        return console.warn(err);
      }
      this.analysisFiles(files);
    });
  },

  toggleMute() {
    let volume;
    if (this.resotreVolume === null) {
      volume = 0;
      this.resotreVolume = Output.currentVol();
    } else {
      volume = this.resotreVolume;
      this.resotreVolume = null;
    }

    $('#volume').prev()
      .toggleClass('icon-mute', volume === 0)
      .toggleClass('icon-volume', volume !== 0);

    Output.setVol(volume);
  },

  volumeUp() {
    if (FOCUSED) {
      return;
    }

    let volume = Output.currentVol();
    volume += 0.1;
    if (volume > 1) {
      volume = 1;
    }

    Output.setVol(volume);
    $('#volume').val(100 * volume);
  },

  volumeDown() {
    if (FOCUSED) {
      return;
    }

    let volume = Output.currentVol();
    volume -= 0.1;
    if (volume < 0) {
      volume = 0;
    }

    Output.setVol(volume);
    $('#volume').val(100 * volume);
  },

  initVolumeControl() {
    let timer;
    let over = 0;
    const $vol = $('#volume');
    const $icon = $vol.prev();
    const $song = $('#song-info');

    $icon.on('click', () => {
      if (!$icon.hasClass('icon-mute')) {
        return;
      }

      this.toggleMute();
    });

    $('.volume-container').on('mouseover', () => {
      if ($icon.hasClass('icon-mute')) {
        return;
      }

      over = 1;

      if ($vol.width() === 0) {
        $song.addClass('volume-on');
        $vol.animate({ width: '100px', opacity: 1 }, 300);
      }
    }).on('mouseout', () => {
      over = 0;
      clearTimeout(timer);
      timer = setTimeout(() => {
        over === 0 && $vol.animate({ width: '0px', opacity: 0 }, 300, () => {
          $song.removeClass('volume-on');
        });
      }, 300);
    });

    $vol.on('change', function() {
      const volume = this.value / 100;
      Output.setVol(volume);
    });

    const curvol = 100 * Output.currentVol();
    $vol.val(curvol);
  },

  toggleShuffle() {
    $('#shuffle-button').toggleClass('active');
    Player.setShuffle();
  },

  toggleDetails() {
    State.showDetails();
  },

  togglePlaylist() {
    $('#list-button').toggleClass('active');
    UI.toggleSidepane();
    // app.saveSetting('showList', $(this).hasClass('active'));
  },

  progress: (progress) => NProgress.set(progress),
  record: () => Player.record(),
  next: () => !FOCUSED && Player.next(),
  prev: () => !FOCUSED && Player.prev(),
  playPause: () => !FOCUSED && Player.playPause(),
  compressor: () => Output.toggleCompressor()
});

// dom-ready
$(() => {
  const visual = app.readSetting('visualizer');
  const synth = Muki.loadPlayer();
  let autoplay = true;

  Muki.handlePlayerEvents();
  Muki.initVolumeControl();
  Muki.analysisFiles = setDragAndDrop();
  Muki.on('open-file', (file) => {
    if (Intro.isPlaying()) {
      Intro.cancel();
    }
    Muki.pause();
    autoplay = false;

    const type = mime.guess(file.toLowerCase());
    if (type === 'application/muki') {
      alert('Muki archive detected starting import...');
      app.traverseFileTree([file], (err, files) => {
        if (err) return alert(err && err.message ? err.message : err);
        app.importArchive(files, () => {
          app.notification('Archive Import Done.');
          Muki.resume();
        });
      }, 'ArrayBuffer');
      return;
    }

    app.traverseFileTree([file], (err, files) => {
      if (err) return alert(err && err.message ? err.message : err);
      Muki.analysisFiles(files);
    }, 'ArrayBuffer');
  });

  // Muki.trigger('open-file', '/Users/Firejune/Workspace/Muki/test/SILPGM.MID');

  UI.init(visual, synth);

  // show intro if first time running
  const visited = app.readSetting('visited');
  if (!visited) {
    app.saveSetting('visited', true);

    Intro.start('#intro', () => {
      UI.renderLogo(false, () => {
        $('#player').fadeIn(800);
      });
    });
  } else {
    $('#player').toggle(true);

    UI.renderLogo(false, () => {
      if (!Player.currentBackend && autoplay) {
        const lastPlayedArchive = app.readSetting('lastArchive');
        let songs;

        if (lastPlayedArchive) {
          // Auto Play Recent Archive
          songs = app.getArchiveData(lastPlayedArchive);
        } else {
          // Auto Play Recent Songs
          songs = app.getRecentOpened();
        }

        if (songs.length) {
          const playlist = new Playlist(songs, Player.shuffling);
          Muki.hitPlay(playlist, app.readSetting('lastPlayed'));
        }
      }
    });
  }

  $('input').on('focus', () => { FOCUSED = true; }).on('blur', () => { FOCUSED = false; });
  $('#corner-logo').on('click', () => app.openBrowserWindow(app.home));
  $('#song-info').on('click', Muki.toggleDetails);
  $('#list-button').on('click', Muki.togglePlaylist);
  $('#shuffle-button').on('click', Muki.toggleShuffle)
    .toggleClass('active', Player.shuffling);
  $('#repeat-button').on('click', Muki.changeRepeat)
    .toggleClass('active', Player.repeating !== 'off')
    .toggleClass('one', Player.repeating === 'one');
  $('.player-button').on('click', function() {
    const method = $(this).attr('id').replace('-button', '');
    Player[method].call(Player);
  });

  $(document).keydown(evt => {
    if (!(FOCUSED || evt.ctrlKey || evt.metaKey)) {
      switch (evt.keyCode) {
        // ESC
        case 27:
          if (Intro.isPlaying()) {
            Intro.cancel();
          }
          break;

        // Space
        case 32:
          evt.preventDefault();
          !FOCUSED && Player.playPause();
          break;

        // I
        case 73:
          // Pe.toggle();
          break;
      }
    }
  });

  $(global).on('contextmenu', (evt) => {
    evt.preventDefault();
    app.showContextMenu();
  });
});

app.register(Muki);
