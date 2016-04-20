'use strict';

function isMT32(subext) {
  return mt32[subext];
}

function guess(filename) {
  const splited = filename.split('.');
  const extension = splited[splited.length - 1].toLowerCase();

  if (extension === 'mid' && isMT32(splited[splited.length - 2])) {
    return isMT32(splited[splited.length - 2]);
  }

  return mime[extension];
}

const mime = {
  mid: 'audio/midi',
  xmi: 'audio/xmi',
  mus: 'audio/mus',
  amf: 'audio/amf',
  psm: 'audio/psm',
  mod: 'audio/mod',
  s3m: 'audio/s3m',
  it: 'audio/it',
  xm: 'audio/xm',
  ay: 'audio/ay',
  gbs: 'audio/gbs',
  gym: 'audio/gym',
  hes: 'audio/hes',
  kss: 'audio/kss',
  nsf: 'audio/nsf',
  nsfe: 'audio/nsfe',
  sap: 'audio/sap',
  spc: 'audio/spc',
  vgm: 'audio/vgm',
  vgz: 'audio/vgz',
  usf: 'audio/usf',
  miniusf: 'audio/usf',
  usflib: 'audio/usflib',
  psf: 'audio/psf',
  psf2: 'audio/psf2',
  psflib: 'audio/psflib',
  psf2lib: 'audio/psf2lib',
  hsc: 'audio/hsc',
  sng: 'audio/sng',
  imf: 'audio/imf',
  wlf: 'audio/wlf',
  adlib: 'audio/adlib',
  a2m: 'audio/a2m',
  amd: 'audio/amd',
  bam: 'audio/bam',
  cmf: 'audio/cmf',
  mdi: 'audio/mdi',
  d00: 'audio/d00',
  dfm: 'audio/dfm',
  hsp: 'audio/hsp',
  ksm: 'audio/ksm',
  mad: 'audio/mad',
  dmo: 'audio/dmo',
  sci: 'audio/sci',
  laa: 'audio/laa',
  mkj: 'audio/mkj',
  cff: 'audio/cff',
  dtm: 'audio/dtm',
  mtk: 'audio/mtk',
  rad: 'audio/rad',
  raw: 'audio/raw',
  sat: 'audio/sat',
  sa2: 'audio/sa2',
  xad: 'audio/xad',
  lds: 'audio/lds',
  m: 'audio/m',
  rol: 'audio/rol',
  xsm: 'audio/xsm',
  dro: 'audio/dro',
  msc: 'audio/msc',
  rix: 'audio/rix',
  adl: 'audio/adl',
  jbm: 'audio/jbm',
  zip: 'application/zip',
  muki: 'application/muki'
};

const mt32 = {
  mt32: 'audio/midi-mt32'
};

module.exports = { guess, mime };
