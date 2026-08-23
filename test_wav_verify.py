"""Second, independent check. Node proving its own output correct proves
nothing; this reads the file JavaScript wrote using Python's stdlib `wave`
parser, which knows nothing about the encoder that produced it. If a real
decoder can open it and recover the tone, the header is right."""

import wave, struct, math, sys, os

# next to this script, so it runs from any folder and any drive
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'probe.wav')
if not os.path.exists(path):
    print('probe.wav not found. Run "node test_wav.js" first.')
    sys.exit(2)
ok = fail = 0

def check(name, cond, extra=''):
    global ok, fail
    if cond:
        ok += 1; print('  PASS  ' + name)
    else:
        fail += 1; print('  FAIL  ' + name + ('  <%s>' % extra if extra else ''))

print('\n--- stdlib wave parser ---')
with wave.open(path, 'rb') as w:
    check('opens without error', True)
    check('1 channel', w.getnchannels() == 1, w.getnchannels())
    check('16 bit (2 bytes)', w.getsampwidth() == 2, w.getsampwidth())
    check('16000 Hz', w.getframerate() == 16000, w.getframerate())
    check('1600 frames', w.getnframes() == 1600, w.getnframes())
    check('no compression', w.getcomptype() == 'NONE', w.getcomptype())
    frames = w.readframes(w.getnframes())

check('payload is 3200 bytes', len(frames) == 3200, len(frames))
samples = struct.unpack('<1600h', frames)

print('\n--- did the 440 Hz tone survive the round trip ---')
peak = max(abs(s) for s in samples)
check('peak near 0.8 full scale', 25000 < peak < 27000, peak)

# zero crossings: a 440 Hz tone in 0.1 s crosses zero about 88 times
crossings = sum(1 for i in range(1, len(samples))
                if (samples[i - 1] < 0) != (samples[i] < 0))
check('zero crossings imply ~440 Hz', 84 <= crossings <= 92, crossings)

# correlate against a clean 440 Hz reference; a wrong sample rate or a byte
# order mistake in the header destroys this even when the peak looks fine
ref = [math.sin(2 * math.pi * 440 * i / 16000) for i in range(1600)]
dot = sum(samples[i] * ref[i] for i in range(1600))
norm = math.sqrt(sum(s * s for s in samples)) * math.sqrt(sum(r * r for r in ref))
corr = dot / norm if norm else 0
check('correlation with clean 440 Hz > 0.99', corr > 0.99, round(corr, 5))

print('\n--- raw header bytes ---')
with open(path, 'rb') as f:
    hdr = f.read(44)
check('RIFF magic', hdr[0:4] == b'RIFF', hdr[0:4])
check('WAVE magic', hdr[8:12] == b'WAVE', hdr[8:12])
check('fmt  chunk', hdr[12:16] == b'fmt ', hdr[12:16])
check('data chunk', hdr[36:40] == b'data', hdr[36:40])
check('riff size little endian', struct.unpack('<I', hdr[4:8])[0] == 3200 + 36)
check('audio format = 1 (PCM)', struct.unpack('<H', hdr[20:22])[0] == 1)
check('byte rate = 32000', struct.unpack('<I', hdr[28:32])[0] == 32000)

print('\n%d passed, %d failed\n' % (ok, fail))
sys.exit(1 if fail else 0)
