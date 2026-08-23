/* Tests the WAV encoder that actually ships.
 *
 * The functions are pulled out of the HTML file at run time rather than kept
 * in a second copy here: a copy drifts, and a test that passes against a copy
 * of last week's encoder is worse than no test.
 *
 * Run from this folder:   node test_wav.js
 * It writes probe.wav, which test_wav_verify.py then reads back with a real
 * WAV parser. Run that second.
 */

const fs = require('fs');
const path = require('path');

if (typeof btoa === 'undefined') {
  global.btoa = s => Buffer.from(s, 'binary').toString('base64');
}

// ---- find the app file next to this script, whatever it is called ----------
const here = __dirname;
const app = process.argv[2] ||
  fs.readdirSync(here).filter(f => /^TrueTailor_CV_.*\.html$/i.test(f)).sort().pop();
if (!app) { console.error('No TrueTailor_CV_*.html found in ' + here); process.exit(2); }
const appPath = path.isAbsolute(app) ? app : path.join(here, app);
console.log('testing the encoder inside: ' + path.basename(appPath));

const html = fs.readFileSync(appPath, 'utf8');

// ---- lift the four functions out of the file -------------------------------
const NAMES = ['ttVoiceMonoMix', 'ttVoiceResample', 'ttVoiceWavEncode',
               'ttVoicePeak', 'ttVoiceBase64'];
let src = '';
for (const n of NAMES) {
  const start = html.indexOf('function ' + n + '(');
  if (start === -1) { console.error('FATAL: ' + n + ' not found in the app file'); process.exit(2); }
  // walk the braces to the end of the function
  let i = html.indexOf('{', start), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) { console.error('FATAL: could not read the body of ' + n); process.exit(2); }
  src += html.slice(start, end) + '\n';
}
src += 'module.exports = {' + NAMES.join(',') + '};';
const C = (new Function('module', 'btoa', src + '\nreturn module.exports;'))(
  { exports: {} }, global.btoa);
console.log('lifted ' + NAMES.length + ' functions straight out of the app\n');

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failed.push(name); console.log('  FAIL  ' + name + (extra !== undefined ? '  <' + extra + '>' : '')); }
}

console.log('--- mono mix ---');
{
  const l = new Float32Array([1, 0, -1, 0.5]);
  const r = new Float32Array([0, 1, -1, -0.5]);
  const m = C.ttVoiceMonoMix([l, r], 4);
  ok('stereo averaged', Math.abs(m[0] - 0.5) < 1e-6 && Math.abs(m[2] + 1) < 1e-6);
  ok('cancelling pair -> 0', Math.abs(m[3]) < 1e-6);
  const one = C.ttVoiceMonoMix([new Float32Array([0.25, -0.25])], 2);
  ok('mono passthrough', one[0] === 0.25 && one[1] === -0.25);
  const dead = C.ttVoiceMonoMix([new Float32Array([0, 0]), new Float32Array([1, 1])], 2);
  ok('audio only on the right channel survives', dead[0] === 0.5, dead[0]);
}

console.log('\n--- resample 48k -> 16k ---');
{
  const same = new Float32Array([1, 2, 3]);
  ok('same rate returns the input untouched', C.ttVoiceResample(same, 16000, 16000) === same);

  const input = new Float32Array(48000);
  for (let i = 0; i < 48000; i++) input[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
  const out = C.ttVoiceResample(input, 48000, 16000);
  ok('length is 16000', out.length === 16000, out.length);
  ok('speech amplitude survives', C.ttVoicePeak(out) > 0.7, C.ttVoicePeak(out).toFixed(3));

  // the anti-aliasing claim, measured rather than asserted
  const hi = new Float32Array(48000);
  for (let k = 0; k < 48000; k++) hi[k] = Math.sin(2 * Math.PI * 12000 * k / 48000);
  const avg = C.ttVoicePeak(C.ttVoiceResample(hi, 48000, 16000));
  const naive = new Float32Array(16000);
  for (let m = 0; m < 16000; m++) naive[m] = hi[m * 3];
  ok('12kHz (above Nyquist) is crushed by window averaging', avg < 0.35, avg.toFixed(3));
  ok('sample-picking would NOT have crushed it', C.ttVoicePeak(naive) > 0.9,
     C.ttVoicePeak(naive).toFixed(3));

  ok('44.1k -> 16k length', C.ttVoiceResample(new Float32Array(44100), 44100, 16000).length === 16000);
  ok('empty input does not crash', C.ttVoiceResample(new Float32Array(0), 48000, 16000).length >= 1);
}

console.log('\n--- clipping ---');
{
  const v = new DataView(C.ttVoiceWavEncode(new Float32Array([1.4, -1.9, 0]), 16000));
  ok('over +1.0 clamps to 32767', v.getInt16(44, true) === 32767, v.getInt16(44, true));
  ok('under -1.0 clamps to -32768', v.getInt16(46, true) === -32768, v.getInt16(46, true));
  ok('silence is zero', v.getInt16(48, true) === 0);
}

console.log('\n--- header ---');
{
  const s = new Float32Array(1600);
  for (let i = 0; i < 1600; i++) s[i] = Math.sin(2 * Math.PI * 440 * i / 16000) * 0.8;
  const buf = C.ttVoiceWavEncode(s, 16000);
  const v = new DataView(buf);
  const tag = o => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  ok('byte length is 44 + 2n', buf.byteLength === 44 + 3200);
  ok('RIFF', tag(0) === 'RIFF');
  ok('WAVE', tag(8) === 'WAVE');
  ok('fmt ', tag(12) === 'fmt ');
  ok('data', tag(36) === 'data');
  ok('riff size is total minus 8', v.getUint32(4, true) === buf.byteLength - 8);
  ok('format code 1 (uncompressed PCM)', v.getUint16(20, true) === 1);
  ok('1 channel', v.getUint16(22, true) === 1);
  ok('16000 Hz', v.getUint32(24, true) === 16000);
  ok('byte rate 32000', v.getUint32(28, true) === 32000);
  ok('block align 2', v.getUint16(32, true) === 2);
  ok('16 bit', v.getUint16(34, true) === 16);
  ok('data size 2n', v.getUint32(40, true) === 3200);
  fs.writeFileSync(path.join(here, 'probe.wav'), Buffer.from(buf));
  console.log('        wrote probe.wav for test_wav_verify.py');
}

console.log('\n--- base64 ---');
{
  const small = C.ttVoiceWavEncode(new Float32Array([0, 0.5]), 16000);
  const b64 = C.ttVoiceBase64(small);
  ok('round trips byte for byte', Buffer.from(b64, 'base64').equals(Buffer.from(small)));
  ok('begins with the RIFF signature', b64.slice(0, 4) === 'UklG', b64.slice(0, 8));

  // the size that actually leaves the browser at the 90 second ceiling, and the
  // array that a single fromCharCode.apply would have blown the stack on
  const big = C.ttVoiceWavEncode(new Float32Array(16000 * 90), 16000);
  const t0 = Date.now();
  const bigB64 = C.ttVoiceBase64(big);
  ok('90 seconds encodes without a stack overflow', bigB64.length > 0);
  ok('90 seconds round trips', Buffer.from(bigB64, 'base64').length === big.byteLength);
  console.log('        90s: wav ' + (big.byteLength / 1048576).toFixed(2) + ' MB, base64 ' +
              (bigB64.length / 1048576).toFixed(2) + ' MB, ' + (Date.now() - t0) + ' ms');
  ok('well under the 20MB inline request ceiling', bigB64.length < 20 * 1048576);
}

console.log('\n--- peak / silence gate ---');
{
  ok('digital silence reads 0', C.ttVoicePeak(new Float32Array(1000)) === 0);
  ok('room tone stays under the 0.01 gate', C.ttVoicePeak(new Float32Array(100).fill(0.004)) < 0.01);
  ok('speech clears the gate', C.ttVoicePeak(new Float32Array([0, 0.3, -0.05])) > 0.01);
  // tolerance, not equality: a Float32Array does not hold 0.9 exactly
  ok('a negative peak is counted',
     Math.abs(C.ttVoicePeak(new Float32Array([-0.9, 0.1])) - 0.9) < 1e-6);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) console.log('FAILED:\n  ' + failed.join('\n  '));
process.exit(fail ? 1 : 0);
