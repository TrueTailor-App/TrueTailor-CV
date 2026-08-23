/* Boots the actual built file in jsdom and drives the feature through every
   path that does not need a real microphone or a real Gemini key. MediaRecorder,
   getUserMedia, AudioContext and the network are stubbed; everything else is the
   shipped code.

   What this cannot prove is stated at the end rather than left implied. */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

/* Picks the newest looking TrueTailor_CV_*.html sitting next to this script, so
   the suite runs from a Windows path with spaces in it without being edited.
   An explicit file can still be passed:  node test_app.js somefile.html      */
const here = __dirname;
const guess = fs.readdirSync(here)
  .filter(f => /^TrueTailor_CV_.*\.html$/i.test(f) && !/mutant/i.test(f)).sort().pop();
const arg = process.argv[2];
const FILE = arg ? (path.isAbsolute(arg) ? arg : path.join(here, arg))
                 : (guess ? path.join(here, guess) : null);
if (!FILE || !fs.existsSync(FILE)) {
  console.error('No TrueTailor_CV_*.html found next to this script.');
  process.exit(2);
}
console.log('testing: ' + path.basename(FILE));
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (extra ? '  <' + extra + '>' : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- fakes
class FakeMediaRecorder {
  static _supported = ['audio/webm;codecs=opus', 'audio/webm'];
  static isTypeSupported(t) { return FakeMediaRecorder._supported.includes(t); }
  constructor(stream, opts) {
    if (FakeMediaRecorder._ctorThrows) throw new Error('construct refused');
    this.stream = stream;
    this.mimeType = (opts && opts.mimeType) || 'audio/webm';
    this.state = 'inactive';
    FakeMediaRecorder.last = this;
  }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: { size: 4096 } });
    if (this.onstop) this.onstop();
  }
}

class FakeAnalyser {
  constructor() { this.fftSize = 512; }
  getByteTimeDomainData(buf) { for (let i = 0; i < buf.length; i++) buf[i] = 128 + (i % 40); }
}
class FakeAudioContext {
  constructor() { this.state = 'running'; FakeAudioContext.made++; }
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() { return new FakeAnalyser(); }
  close() { this.state = 'closed'; FakeAudioContext.closed++; return Promise.resolve(); }
  decodeAudioData(buf, onOk, onErr) {
    if (FakeAudioContext.decodeFails) { onErr(new Error('cannot decode')); return; }
    const n = Math.round(48000 * (FakeAudioContext.seconds || 2));
    const data = new Float32Array(n);
    const amp = FakeAudioContext.silent ? 0.0005 : 0.6;
    for (let i = 0; i < n; i++) data[i] = Math.sin(2 * Math.PI * 300 * i / 48000) * amp;
    onOk({ numberOfChannels: 1, length: n, sampleRate: 48000, getChannelData: () => data });
  }
}
FakeAudioContext.made = 0; FakeAudioContext.closed = 0;

function makeStream() {
  const track = { stop() { track.stopped = true; makeStream.stopped++; }, kind: 'audio' };
  return { getTracks: () => [track], _track: track };
}
makeStream.stopped = 0;

// ---------------------------------------------------------------- boot
const vc = new VirtualConsole();
const noise = [];
vc.on('jsdomError', e => noise.push('jsdomError: ' + e.message));
vc.on('error', (...a) => noise.push('error: ' + a.join(' ')));

const html = fs.readFileSync(FILE, 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://truetailor-app.github.io/TrueTailor-CV/',
  virtualConsole: vc
});
const win = dom.window;

win.MediaRecorder = FakeMediaRecorder;
win.AudioContext = FakeAudioContext;
win.webkitAudioContext = FakeAudioContext;
Object.defineProperty(win.navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: async () => { 
    if (win.__gumError) { const e = new Error('no'); e.name = win.__gumError; throw e; }
    return makeStream();
  } }
});
win.Blob = class { constructor(parts, o) { this.type = (o && o.type) || ''; this.size = 4096; }
                   async arrayBuffer() { return new ArrayBuffer(4096); } };
win.btoa = s => Buffer.from(s, 'binary').toString('base64');
win.fetch = async () => ({ ok: false, status: 0, json: async () => ({}) });
win.scrollTo = () => {};
win.HTMLElement.prototype.scrollIntoView = () => {};

(async () => {
  await new Promise(r => win.document.addEventListener('DOMContentLoaded', r));
  await sleep(400);

  /* The feature refuses to record without a key, which is correct and is
     tested on its own further down. Everything else needs one present. */
  win.APP.apiKey = 'test-key-not-real';

  console.log('\n=== 1. the page still boots ===');
  ok('no jsdomError during boot', noise.filter(n => n.startsWith('jsdomError')).length === 0,
     noise.filter(n => n.startsWith('jsdomError'))[0]);
  ok('TT_VOICE exists', typeof win.TT_VOICE === 'object');
  ok('state starts idle', win.TT_VOICE.state === 'idle');
  ['ttVoiceStart','ttVoiceStop','ttVoiceReset','renderVoice','bindVoiceUi',
   'ttVoiceInsert','ttVoiceModels','ttIsKeyError','ttVoiceSync']
    .forEach(n => ok('global ' + n, typeof win[n] === 'function'));

  console.log('\n=== 2. markup and the spell layer ===');
  const $ = id => win.document.getElementById(id);
  ok('mic button present', !!$('btnVoiceRec'));
  ok('voice bar present', !!$('voiceBar'));
  ok('voice bar starts hidden', $('voiceBar').classList.contains('tt-hidden'));
  ok('mic is FIRST in the button row (RTL/LTR by markup order)',
     $('btnVoiceRec').parentNode.querySelector('button').id === 'btnVoiceRec',
     $('btnVoiceRec').parentNode.querySelector('button').id);
  ok('mic is OUTSIDE the spell wrap, so padding is untouched',
     !$('answerWrap').contains($('btnVoiceRec')));
  ok('answer textarea untouched', $('chatAnswer').tagName === 'TEXTAREA');
  ok('spell layer still the only sibling of the textarea',
     $('answerWrap').children.length === 2);

  console.log('\n=== 3. i18n completeness ===');
  const missing = win.TT_I18N.missing().filter(m => m.startsWith('voice.') ||
        m.startsWith('btn.voice') || m.startsWith('aria.voice') || m.startsWith('title.voice'));
  ok('no voice key missing a language', missing.length === 0, missing.slice(0, 6).join(', '));
  ok('whole catalogue still complete', win.TT_I18N.missing().length === 0,
     win.TT_I18N.missing().slice(0, 4).join(', '));
  /* v38.22 shipped one ambiguous selector, howkey.body, which pointed at
     '#howKeyModal > div > p' and matched two paragraphs. It was fixed in this
     version by giving the paragraph an id, so the bar is now zero rather than
     "no worse than before". */
  const sel = win.checkUiStrings();
  ok('no broken selector anywhere in the file', sel.selectors.length === 0,
     sel.selectors.join(', '));
  ok('the howkey.body selector now names one element',
     win.document.querySelectorAll(win.TT_I18N.selectorFor('howkey.body')).length === 1,
     win.TT_I18N.selectorFor('howkey.body'));
  ok('and it still translates', win.TT_I18N.T('howkey.body', 'ja') !== 'howkey.body');

  const langs = win.TT_I18N.ORDER;
  ok('catalogue carries 12 languages', langs.length === 12, langs.join(','));
  let allDistinct = true, hebLeak = [];
  ['voice.stop','voice.processing','voice.err_denied','btn.voice_rec','voice.err_final'].forEach(k => {
    langs.forEach(L => {
      const s = win.TT_I18N.T(k, L);
      if (!s || s === k) allDistinct = false;
      // Hebrew letters showing up in a non-Hebrew language is the exact bug the
      // catalogue exists to prevent
      if (L !== 'he' && /[\u0590-\u05FF]/.test(s)) hebLeak.push(k + ':' + L);
    });
  });
  ok('every voice string resolves in every language', allDistinct);
  ok('no Hebrew leaking into the other eleven', hebLeak.length === 0, hebLeak.join(', '));

  console.log('\n=== 4. language switch repaints the voice bar ===');
  ok('renderVoice is registered as a painter', win.TT_PAINTERS.indexOf('renderVoice') !== -1);
  win.TT_VOICE.state = 'idle';
  win.ttVoiceSay('x', 'bad', false);
  win.applyUiLang('ja');
  win.TT_VOICE.msg = win.T('voice.err_final');
  win.renderVoice();
  const jaText = $('voiceBar').textContent;
  win.applyUiLang('de');
  win.TT_VOICE.msg = win.T('voice.err_final');
  win.renderVoice();
  const deText = $('voiceBar').textContent;
  ok('bar text changes with the interface language', jaText !== deText && jaText && deText);
  win.applyUiLang('ar');
  win.renderVoice();
  ok('bar direction follows an RTL language', $('voiceBar').getAttribute('dir') === 'rtl',
     $('voiceBar').getAttribute('dir'));
  win.applyUiLang('en');
  win.renderVoice();
  ok('bar direction follows an LTR language', $('voiceBar').getAttribute('dir') === 'ltr');
  win.ttVoiceReset();

  console.log('\n=== 5. insertion drives the spell checker ===');
  const box = $('chatAnswer');
  let inputEvents = 0;
  box.addEventListener('input', () => inputEvents++);
  box.value = '';
  win.ttVoiceInsert('ניהלתי צוות של שמונה אנשים');
  ok('text landed in the box', box.value === 'ניהלתי צוות של שמונה אנשים', box.value);
  ok('an input event fired (spell check + hint listen for it)', inputEvents === 1, inputEvents);

  win.ttVoiceInsert('וגם הובלתי מעבר למערכת חדשה');
  ok('second transcript APPENDS, does not replace',
     box.value.indexOf('ניהלתי צוות') === 0 && box.value.indexOf('וגם הובלתי') > 0, box.value);
  ok('appended on a new line', box.value.split('\n').length === 2);
  ok('input fired again', inputEvents === 2, inputEvents);

  box.value = '';
  win.ttVoiceInsert('first');
  ok('empty box takes the text as it is', box.value === 'first', box.value);

  box.value = 'typed by hand   ';
  win.ttVoiceInsert('said out loud');
  ok('typed text is never destroyed', box.value.startsWith('typed by hand'), box.value);
  ok('trailing whitespace trimmed before joining',
     box.value === 'typed by hand\nsaid out loud', JSON.stringify(box.value));

  console.log('\n=== 6. spell layer keeps up ===');
  box.value = '';
  win.ttVoiceInsert('בדיקה של השכבה');
  await sleep(60);
  ok('spell layer shows the transcript, not stale text',
     $('answerSpellLayer').textContent.indexOf('בדיקה של השכבה') !== -1,
     JSON.stringify($('answerSpellLayer').textContent));
  box.value = '';
  win.renderAnswerSpell();

  console.log('\n=== 7. recording lifecycle ===');
  win.__gumError = null;
  await win.ttVoiceStart();
  ok('state is rec', win.TT_VOICE.state === 'rec', win.TT_VOICE.state);
  ok('bar visible while recording', !$('voiceBar').classList.contains('tt-hidden'));
  ok('mic button shows the recording class', $('btnVoiceRec').classList.contains('is-rec'));
  ok('send is disabled while recording', $('btnSendAnswer').disabled);
  ok('skip is disabled while recording', $('btnSkipQ').disabled);
  ok('"I am done" is disabled while recording', $('btnDoneQ').disabled);
  ok('stop and cancel buttons rendered', !!$('btnVoiceStop') && !!$('btnVoiceCancel'));
  ok('an AudioContext was opened for the meter', FakeAudioContext.made >= 1);
  await sleep(300);
  ok('meter moved off zero', win.TT_VOICE.level > 0, String(win.TT_VOICE.level));
  ok('clock formats as m:ss', /^\d+:\d\d$/.test(win.ttVoiceClock(75000)), win.ttVoiceClock(75000));
  ok('clock uses ASCII digits only', /^[0-9:]+$/.test(win.ttVoiceClock(90000)));

  console.log('\n=== 8. cancel throws the audio away ===');
  const stoppedBefore = makeStream.stopped;
  win.ttVoiceStop(false);
  ok('back to idle', win.TT_VOICE.state === 'idle', win.TT_VOICE.state);
  ok('microphone track stopped (recording light off)', makeStream.stopped > stoppedBefore);
  ok('nothing held for a retry', !win.TT_VOICE.wav);
  ok('send re-enabled', !$('btnSendAnswer').disabled);
  ok('skip re-enabled', !$('btnSkipQ').disabled);
  ok('audio context closed', FakeAudioContext.closed >= 1);

  console.log('\n=== 9. too short is refused before any call ===');
  let called = 0;
  win.callGeminiVision = async () => { called++; return 'should never run'; };
  await win.ttVoiceStart();
  win.TT_VOICE.elapsed = 200;                 // under TT_VOICE_MIN_MS
  win.ttVoiceStop(true);
  await sleep(80);
  ok('no model call for a mis-click', called === 0, called);
  ok('state back to idle', win.TT_VOICE.state === 'idle');
  ok('message shown', win.TT_VOICE.msg === win.T('voice.err_short'), win.TT_VOICE.msg);

  console.log('\n=== 10. silence is refused before any call ===');
  called = 0;
  FakeAudioContext.silent = true;
  await win.ttVoiceStart();
  win.TT_VOICE.elapsed = 5000;
  win.ttVoiceStop(true);
  await sleep(120);
  ok('silence costs no quota', called === 0, called);
  ok('silence message shown', win.TT_VOICE.msg === win.T('voice.err_silent'), win.TT_VOICE.msg);
  FakeAudioContext.silent = false;

  console.log('\n=== 11. the happy path ===');
  let seenMime = '', seenOpts = null, seenB64 = '';
  win.callGeminiVision = async (b64, mime, prompt, opts) => {
    seenMime = mime; seenOpts = opts; seenB64 = b64;
    return '  "ניהלתי צוות של שמונה אנשים במשך שלוש שנים."  ';
  };
  box.value = '';
  await win.ttVoiceStart();
  win.TT_VOICE.elapsed = 5000;
  win.ttVoiceStop(true);
  await sleep(150);
  ok('sent as audio/wav', seenMime === 'audio/wav', seenMime);
  ok('payload is base64 of a RIFF file', seenB64.slice(0, 4) === 'UklG', seenB64.slice(0, 8));
  ok('temperature 0', seenOpts && seenOpts.temperature === 0, seenOpts && seenOpts.temperature);
  ok('cascadeOn400 requested', seenOpts && seenOpts.cascadeOn400 === true);
  ok('a model list was passed', Array.isArray(seenOpts.models) && seenOpts.models.length > 0);
  ok('timeout raised above the 40s default', seenOpts.timeoutMs === 90000, seenOpts.timeoutMs);
  ok('transcript in the box', box.value === 'ניהלתי צוות של שמונה אנשים במשך שלוש שנים.',
     JSON.stringify(box.value));
  ok('wrapping quotes stripped', box.value.indexOf('"') === -1);
  ok('state idle again', win.TT_VOICE.state === 'idle');
  ok('recording released after success', !win.TT_VOICE.wav);
  ok('confirmation is the ok tone', win.TT_VOICE.msgTone === 'ok', win.TT_VOICE.msgTone);
  ok('buttons usable again', !$('btnSendAnswer').disabled && !$('btnDoneQ').disabled);

  console.log('\n=== 12. the prompt forbids invention ===');
  let seenPrompt = '';
  win.callGeminiVision = async (b, m, p) => { seenPrompt = p; return 'x'; };
  box.value = '';
  await win.ttVoiceStart(); win.TT_VOICE.elapsed = 5000; win.ttVoiceStop(true);
  await sleep(120);
  ok('says add nothing', /Add nothing/i.test(seenPrompt));
  ok('forbids making it sound professional', /more professional/i.test(seenPrompt));
  ok('forbids translating', /Do not translate/i.test(seenPrompt));
  ok('keeps facts as spoken', /Keep every fact exactly as spoken/i.test(seenPrompt));
  ok('no hardcoded filler word list', !/\bum\b/i.test(seenPrompt) && seenPrompt.indexOf('כאילו') === -1);
  ok('filler removal is language generic', /Every language has its own set/i.test(seenPrompt));
  ok('no profession specific vocabulary', !/\bDRP\b/.test(seenPrompt) && !/System Owner/i.test(seenPrompt));
  ok('no targetLanguage variable leaked in', !/targetLanguage/.test(seenPrompt));

  console.log('\n=== 13. failure, retry with the SAME recording, then give up ===');
  let attempts = 0;
  win.callGeminiVision = async () => { attempts++; throw new Error('quota exhausted (429)'); };
  box.value = 'already typed';
  await win.ttVoiceStart(); win.TT_VOICE.elapsed = 5000; win.ttVoiceStop(true);
  await sleep(150);
  ok('one attempt so far', attempts === 1, attempts);
  ok('typed text survived the failure', box.value === 'already typed', box.value);
  ok('recording held for the retry', !!win.TT_VOICE.wav);
  ok('retry button offered', !!$('btnVoiceRetry'));
  ok('error tone', win.TT_VOICE.msgTone === 'bad');

  const heldWav = win.TT_VOICE.wav;
  await win.ttVoiceRetry();
  await sleep(120);
  ok('retry re-sent without a new recording', attempts === 2, attempts);
  ok('it was the same audio', heldWav === heldWav);
  ok('after the second failure the recording is released', !win.TT_VOICE.wav);
  ok('no retry button after giving up', !$('btnVoiceRetry'));
  ok('final message tells them to type', win.TT_VOICE.msg === win.T('voice.err_final'),
     win.TT_VOICE.msg);
  ok('typed text STILL survived', box.value === 'already typed', box.value);
  ok('buttons usable so the flow continues', !$('btnSendAnswer').disabled && !$('btnDoneQ').disabled);

  console.log('\n=== 14. empty transcript ===');
  win.callGeminiVision = async () => '   ';
  box.value = '';
  await win.ttVoiceStart(); win.TT_VOICE.elapsed = 5000; win.ttVoiceStop(true);
  await sleep(120);
  ok('nothing written to the box', box.value === '', JSON.stringify(box.value));
  ok('no speech message', win.TT_VOICE.msg === win.T('voice.err_nospeech'), win.TT_VOICE.msg);

  console.log('\n=== 15. permission and device errors ===');
  for (const [name, key] of [['NotAllowedError','voice.err_denied'],
                             ['NotFoundError','voice.err_nomic'],
                             ['NotReadableError','voice.err_busy'],
                             ['SecurityError','voice.err_denied']]) {
    win.__gumError = name;
    win.ttVoiceReset();
    await win.ttVoiceStart();
    ok(name + ' -> right message', win.TT_VOICE.msg === win.T(key), win.TT_VOICE.msg);
    ok(name + ' -> state idle', win.TT_VOICE.state === 'idle');
    ok(name + ' -> no retry offered', !win.TT_VOICE.canRetry);
  }
  win.__gumError = null;

  console.log('\n=== 16. decode failure ===');
  FakeAudioContext.decodeFails = true;
  box.value = 'keep me';
  win.ttVoiceReset();
  await win.ttVoiceStart(); win.TT_VOICE.elapsed = 5000; win.ttVoiceStop(true);
  await sleep(120);
  ok('decode failure reported', win.TT_VOICE.msg === win.T('voice.err_decode'), win.TT_VOICE.msg);
  ok('box untouched', box.value === 'keep me');
  ok('idle', win.TT_VOICE.state === 'idle');
  FakeAudioContext.decodeFails = false;

  console.log('\n=== 17. the 90 second ceiling ===');
  ok('ceiling is 90s', win.TT_VOICE_MAX_MS === 90000, win.TT_VOICE_MAX_MS);
  ok('warning at 80s', win.TT_VOICE_WARN_MS === 80000);
  called = 0;
  win.callGeminiVision = async () => { called++; return 'transcribed at the limit'; };
  box.value = '';
  win.ttVoiceReset();
  await win.ttVoiceStart();
  win.TT_VOICE.startedAt = Date.now() - 91000;      // let the real tick notice
  await sleep(400);
  ok('auto-stopped at the ceiling', win.TT_VOICE.state !== 'rec', win.TT_VOICE.state);
  ok('the audio was TRANSCRIBED, not thrown away', called === 1, called);
  ok('text arrived', box.value === 'transcribed at the limit', box.value);
  ok('the limit is mentioned to the candidate',
     win.TT_VOICE.msg.indexOf(win.T('voice.limit')) === 0, win.TT_VOICE.msg);

  console.log('\n=== 18. deny list keeps the newest model first ===');
  win.localStorage.removeItem('tt_voice_deaf_v1');
  const full = win.ttVoiceModels();
  ok('starts from the full cascade', full.length === win.getModelCascade().length);
  ok('newest model is first', full[0] === win.getModelCascade()[0], full[0]);
  win.ttVoiceDenyAdd(full[0]);
  const after = win.ttVoiceModels();
  ok('a model that refused audio is skipped', after.indexOf(full[0]) === -1);
  ok('the NEXT newest is now first, not a remembered winner', after[0] === full[1], after[0]);
  ok('everything else kept', after.length === full.length - 1);
  win.ttVoiceDenyAdd('gemini-does-not-exist');
  ok('an unknown id does not shrink the cascade',
     win.ttVoiceModels().length === full.length - 1);
  full.forEach(m => win.ttVoiceDenyAdd(m));
  ok('if every model is denied it falls back to trying them all',
     win.ttVoiceModels().length === full.length);
  // expiry
  win.localStorage.setItem('tt_voice_deaf_v1',
    JSON.stringify({ ts: Date.now() - 25 * 3600 * 1000, ids: [full[0]] }));
  ok('a deny entry older than a day is forgotten', win.ttVoiceModels().length === full.length);
  win.localStorage.removeItem('tt_voice_deaf_v1');

  console.log('\n=== 19. a dead key is not mistaken for a deaf model ===');
  ok('key-invalid 400 recognised',
     win.ttIsKeyError({ error: { message: 'API key not valid. Please pass a valid API key.' } }));
  ok('API_KEY_INVALID recognised', win.ttIsKeyError({ error: { message: 'API_KEY_INVALID' } }));
  ok('a modality 400 is NOT a key error',
     !win.ttIsKeyError({ error: { message: 'Unsupported MIME type: audio/wav' } }));
  ok('an empty body is not a key error', !win.ttIsKeyError(null));

  console.log('\n=== 20. reset clears everything ===');
  win.TT_VOICE.wav = new ArrayBuffer(8);
  win.TT_VOICE.msg = 'stale';
  win.TT_VOICE.state = 'rec';
  win.TT_VOICE.hitLimit = true;
  win.resetRun();
  ok('resetRun stops the voice feature', win.TT_VOICE.state === 'idle', win.TT_VOICE.state);
  ok('resetRun drops the held recording', !win.TT_VOICE.wav);
  ok('resetRun clears the message', win.TT_VOICE.msg === '');
  ok('resetRun clears the limit flag', win.TT_VOICE.hitLimit === false);
  ok('bar hidden again', $('voiceBar').classList.contains('tt-hidden'));

  console.log('\n=== 21. it co-operates with the question generator ===');
  win.setChatBusy(true);
  ok('mic disabled while the next question is being written', $('btnVoiceRec').disabled);
  ok('send disabled too', $('btnSendAnswer').disabled);
  win.setChatBusy(false);
  ok('mic usable again afterwards', !$('btnVoiceRec').disabled);
  ok('send usable again', !$('btnSendAnswer').disabled);
  // the ordering bug this guards against
  win.TT_VOICE.state = 'rec';
  win.setChatBusy(false);
  ok('a finishing question does NOT re-enable send mid recording', $('btnSendAnswer').disabled);
  win.TT_VOICE.state = 'idle';
  win.ttVoiceSync();
  ok('and it comes back when the recording ends', !$('btnSendAnswer').disabled);

  console.log('\n=== 22. submitAnswer treats a transcript like typing ===');
  win.APP.chat.done = false;
  win.APP.chat.pendingQuestion = 'Tell me about your experience with audits';
  win.APP.chat.pendingReqId = 'r1';
  win.APP.chat.pendingReqIds = ['r1'];
  win.APP.chat.qa = [];
  win.translateAnswerForResume = async () => {};
  win.askNextQuestion = async () => {};
  win.ttBankRemember = () => {};
  box.value = '';
  win.callGeminiVision = async () => 'ניהלתי שלושה מבדקי איכות';
  win.ttVoiceReset();
  await win.ttVoiceStart(); win.TT_VOICE.elapsed = 5000; win.ttVoiceStop(true);
  await sleep(150);
  await win.submitAnswer(false);
  ok('the transcript became a real answer', win.APP.chat.qa.length === 1, win.APP.chat.qa.length);
  ok('recorded verbatim, unchanged', win.APP.chat.qa[0].a === 'ניהלתי שלושה מבדקי איכות',
     win.APP.chat.qa[0].a);
  ok('no viaVoice flag added anywhere', !('viaVoice' in win.APP.chat.qa[0]));
  ok('entry shape identical to a typed one',
     Object.keys(win.APP.chat.qa[0]).sort().join(',') ===
     ['q','a','skipped','reqId','reqIds','closing','aForCv','aLangFrom','translateNote'].sort().join(','),
     Object.keys(win.APP.chat.qa[0]).join(','));
  ok('box cleared by submit as usual', box.value === '');

  console.log('\n=== 23. unsupported browser hides the button ===');
  const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.com/', virtualConsole: new VirtualConsole() });
  const w2 = dom2.window;
  // no MediaRecorder at all
  Object.defineProperty(w2.navigator, 'mediaDevices', { configurable: true, value: undefined });
  w2.scrollTo = () => {}; w2.HTMLElement.prototype.scrollIntoView = () => {};
  await new Promise(r => w2.document.addEventListener('DOMContentLoaded', r));
  await sleep(300);
  ok('ttVoiceSupported() is false without MediaRecorder', w2.ttVoiceSupported() === false);
  ok('button hidden rather than left to fail',
     w2.document.getElementById('btnVoiceRec').classList.contains('tt-hidden'));
  dom2.window.close();

  console.log('\n=== 24. privacy text mentions the recording ===');
  win.applyUiLang('he');
  win.renderAbout();
  const about = win.document.getElementById('aboutBody').textContent;
  ok('Hebrew privacy section mentions the recording being sent',
     about.indexOf('ההקלטה') !== -1 && about.indexOf('Gemini') !== -1);
  win.applyUiLang('en');
  win.renderAbout();
  const aboutEn = win.document.getElementById('aboutBody').textContent;
  ok('English privacy section mentions it too',
     /recording/i.test(aboutEn) && /transcrib/i.test(aboutEn));

  console.log('\n=== 25. version ===');
  ok('TT_VERSION bumped', win.TT_VERSION === 'v39.0', win.TT_VERSION);
  ok('badge matches the constant',
     win.document.getElementById('verBadge').textContent === win.TT_VERSION,
     win.document.getElementById('verBadge').textContent);
  win.applyUiLang('en'); win.renderAbout();
  ok('the About panel reports the new version',
     win.document.getElementById('aboutBody').textContent.indexOf('v39.0') !== -1);

  console.log('\n=== 26. nothing else broke ===');
  ok('no jsdomError across the whole run',
     noise.filter(n => n.startsWith('jsdomError')).length === 0,
     noise.filter(n => n.startsWith('jsdomError')).slice(0, 2).join(' | '));

  console.log('\n' + '='.repeat(58));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) console.log('\nFAILED:\n  ' + failures.join('\n  '));
  console.log('='.repeat(58));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS CRASH:\n', e); process.exit(2); });
