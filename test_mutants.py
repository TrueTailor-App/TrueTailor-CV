#!/usr/bin/env python3
"""A suite that passes proves nothing until it is shown to fail. Each mutant
below is a plausible mistake someone could make in this feature. If the suite
still passes on a mutant, the suite is not testing that thing and the PASS was
decoration."""

import subprocess, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
CAND = sorted(f for f in os.listdir(HERE)
              if f.lower().startswith('truetailor_cv_')
              and f.lower().endswith('.html') and 'mutant' not in f.lower())
if not CAND:
    print('No TrueTailor_CV_*.html found next to this script.')
    sys.exit(2)
GOOD = os.path.join(HERE, CAND[-1])
TMP = os.path.join(HERE, 'mutant.html')

MUTANTS = [
    ('input event never fired (spell check would go stale)',
     "  try { box.dispatchEvent(new Event('input', { bubbles: true })); fired = true; } catch (e) {}",
     "  try { fired = true; } catch (e) {}"),

    ('transcript REPLACES the box instead of appending',
     "  box.value = had ? (had + '\\n' + text) : text;",
     "  box.value = text;"),

    ('cascadeOn400 dropped, so one deaf model kills the feature',
     "        cascadeOn400: true,             // a model that cannot read audio says 400",
     "        cascadeOn400: false,            // a model that cannot read audio says 400"),

    ('deny list inverted into "remember the winner", freezing the cascade',
     "  var list = all.filter(function (m) { return deny.indexOf(m) === -1; });",
     "  var list = all.filter(function (m) { return deny.indexOf(m) !== -1; });"),

    ('the 90s ceiling throws the recording away instead of sending it',
     "      TT_VOICE.hitLimit = true;\r\n      ttVoiceStop(true);",
     "      TT_VOICE.hitLimit = true;\r\n      ttVoiceStop(false);"),

    ('microphone track never released (recording light stays on)',
     "    if (TT_VOICE.stream) TT_VOICE.stream.getTracks().forEach(function (t) { t.stop(); });",
     "    if (TT_VOICE.stream) TT_VOICE.stream.getTracks().forEach(function (t) { return t; });"),

    ('prompt told to polish the answer (the invention risk)',
     "    '5. Do not rewrite, improve, shorten, expand, or make the wording sound more professional. This is a transcript, not a draft.',",
     "    '5. Refine the wording into a clear and professional tone.',"),

    ('one language dropped from a voice string (11 instead of 12)',
     "  put('voice.cancel', null, ['בטל', 'إلغاء', 'Cancel', 'Annuler', 'Cancelar', 'Abbrechen', 'Annulla', 'Cancelar', 'Odustani', 'Отмена', 'キャンセル', 'रद्द करें']);",
     "  put('voice.cancel', null, ['בטל', 'إلغاء', 'Cancel', 'Annuler', 'Cancelar', 'Abbrechen', 'Annulla', 'Cancelar', 'Odustani', 'Отмена', 'キャンセル']);"),

    ('Hebrew left in the English slot (the leak the catalogue exists to stop)',
     "  put('voice.stop', null, ['עצור ותמלל', 'أوقف وفرّغ', 'Stop and transcribe',",
     "  put('voice.stop', null, ['עצור ותמלל', 'أوقف وفرّغ', 'עצור ותמלל',"),

    ('silence gate removed, so an empty room costs a call',
     "    if (ttVoicePeak(mono) < TT_VOICE_SILENCE) {",
     "    if (false) {"),

    ('resetRun no longer clears the voice state',
     "  if (typeof ttVoiceReset === 'function') ttVoiceReset();",
     "  if (false) ttVoiceReset();"),

    ('send button re-enabled mid recording by a finishing question',
     "    if (b) b.disabled = active || TT_VOICE.chatBusy;",
     "    if (b) b.disabled = TT_VOICE.chatBusy;"),

    ('a dead key mistaken for a model that cannot read audio',
     "  return /API key not valid|API_KEY_INVALID|API_KEY_SERVICE_BLOCKED/i.test(detail);",
     "  return false;"),
]

good = open(GOOD, encoding='utf-8', newline='').read()

# sanity: the clean file must pass, or every mutant "detection" is meaningless
r = subprocess.run(['node', 'test_app.js', GOOD], capture_output=True, text=True,
                   cwd=HERE, shell=(os.name == 'nt'))
if r.returncode != 0:
    print('the clean file does not pass; nothing below means anything')
    sys.exit(2)
print('testing: ' + os.path.basename(GOOD))
print('clean file passes.  now breaking it on purpose:\n')

caught = missed = skipped = 0
for name, old, new in MUTANTS:
    if good.count(old) != 1:
        print('  SKIP    %-62s (anchor matched %d times)' % (name[:62], good.count(old)))
        skipped += 1
        continue
    open(TMP, 'w', encoding='utf-8', newline='').write(good.replace(old, new, 1))
    r = subprocess.run(['node', 'test_app.js', TMP], capture_output=True, text=True,
                       cwd=HERE, shell=(os.name == 'nt'))
    if r.returncode != 0:
        n = r.stdout.count('  FAIL')
        print('  caught  %-62s (%d test%s failed)' % (name[:62], n, '' if n == 1 else 's'))
        caught += 1
    else:
        print('  MISSED  %-62s  <suite still passed>' % name[:62])
        missed += 1

if os.path.exists(TMP):
    os.remove(TMP)

print('\n%d caught, %d missed, %d skipped' % (caught, missed, skipped))
sys.exit(1 if (missed or skipped) else 0)
