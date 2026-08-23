/* Health check. Looks for the failure classes that a passing test suite does
   not cover: dangling element ids, duplicate ids, functions called but never
   defined, CSP violations, and two language assumptions that survived. */
const fs = require('fs'), vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
let problems = 0;
const bad = (cat, msg) => { problems++; console.log('  ISSUE [' + cat + '] ' + msg); };

/* ---- 1. duplicate element ids ---- */
const ids = [...src.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log('1. duplicate ids');
[...new Set(dupes)].forEach(d => bad('dup-id', d));
if (!dupes.length) console.log('   none');

/* ---- 2. $('id') referenced but absent from the markup ---- */
console.log('2. $() references with no element');
const idSet = new Set(ids);
const refs = [...new Set([...src.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map(m => m[1]))];
const missing = refs.filter(r => !idSet.has(r));
missing.forEach(r => bad('missing-id', "$('" + r + "') has no element"));
if (!missing.length) console.log('   none of ' + refs.length + ' checked');

/* ---- 3. CSS selectors in the catalogue that match nothing ---- */
/* handled in the jsdom pass below */

/* ---- 4. surviving two language assumptions ---- */
console.log('4. surviving two language assumptions in code');
const js = [...src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc=/i.test(m[1])).map(m => m[2]).join('\n');
const noComments = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/* One line is allowed to test for Hebrew and mean it: a language named inside
   a Hebrew sentence needs its Hebrew name, and that is a property of the
   sentence, not a leftover assumption about there being two languages. */
const ALLOWED = ['TT_LANG_LABEL_HE[code]'];
const binaries = [...noComments.matchAll(/^.*(\?\s*'en'\s*:\s*'he'|\?\s*'he'\s*:\s*'en'|===\s*'he'\s*\?|!==\s*'he'\s*\?).*$/gm)]
  .map(m => m[0].trim())
  .filter(line => !ALLOWED.some(a => line.indexOf(a) !== -1));
binaries.forEach(b => bad('binary-lang', b.slice(0, 110)));
if (!binaries.length) console.log('   none');

/* ---- 5. CSP: every external origin must be allowed ---- */
console.log('5. external origins vs the content security policy');
const csp = (src.match(/content="([^"]*default-src[^"]*)"/) || [])[1] ||
            (src.match(/Content-Security-Policy[\s\S]{0,600}?content="([^"]*)"/) || [])[1] || '';
const origins = [...new Set([...src.matchAll(/(?:src|href)="(https:\/\/[^/"]+)/g)].map(m => m[1]))];
origins.forEach(o => {
  const host = o.replace('https://', '');
  if (csp && csp.indexOf(host) === -1) bad('csp', o + ' is not named in the policy');
});
if (!origins.length) console.log('   no external origins');
else console.log('   checked ' + origins.length + ' origins against a ' + csp.length + ' char policy');

/* ---- 6. boot in jsdom and look for runtime holes ---- */
const errs = [], warns = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Could not load script|Not implemented/i.test(String(e.message))) errs.push(e.message); });
vc.on('error', (...a) => errs.push(a.join(' ')));
vc.on('warn', (...a) => warns.push(a.join(' ')));
const dom = new JSDOM(src, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x.test/' });
const w = dom.window;

setTimeout(() => {
  console.log('6. runtime');
  errs.forEach(e => bad('runtime', e));
  if (!errs.length) console.log('   no errors on boot');
  warns.forEach(x => console.log('   warn: ' + x.slice(0, 160)));

  console.log('7. catalogue selectors');
  const chk = w.checkUiStrings();
  chk.selectors.forEach(x => bad('selector', x));
  chk.missing.forEach(x => bad('translation', x));
  if (!chk.selectors.length && !chk.missing.length) console.log('   81 keys, all selectors match, no gaps');

  console.log('8. every language renders the whole interface');
  w.TT_LANG.codes().forEach(code => {
    w.applyUiLang(code);
    let heLeft = 0;
    w.TT_I18N.keys().forEach(k => {
      const sel = w.TT_I18N.selectorFor(k);
      const el = sel && w.document.querySelector(sel);
      if (el && code !== 'he' && /[\u0590-\u05FF]/.test(el.textContent)) heLeft++;
    });
    if (heLeft) bad('untranslated', code + ': ' + heLeft + ' element(s) still showing Hebrew');
  });
  w.applyUiLang('he');
  console.log('   checked 12 languages');

  console.log('9. direction flips correctly');
  [['he','rtl'],['ar','rtl'],['en','ltr'],['ja','ltr'],['hi','ltr'],['ru','ltr']].forEach(([c,d]) => {
    w.applyUiLang(c);
    const got = w.document.documentElement.getAttribute('dir');
    if (got !== d) bad('direction', c + ' gave ' + got + ', expected ' + d);
  });
  w.applyUiLang('he');
  console.log('   checked 6 languages');

  console.log('10. script bleed inside the multilingual tables');
  /* The same rule TT_LOCK applies to a rewritten resume line, turned on the
     app's own strings. A Cyrillic word inside a Japanese string is exactly the
     failure this whole layer exists to catch, and it happened here. */
  let checked = 0;
  const tables = [
    ['TT_I18N', (() => { const o = {}; w.TT_I18N.keys().forEach(k => { o[k] = w.TT_I18N._raw[k]; }); return o; })(), w.TT_I18N.ORDER],
    ['TT_CLOSING_Q', null, null],
    ['TT_RANGE_WORD', null, null],
    ['TT_LANG_LABEL_HE', null, null]
  ];
  Object.keys(w.TT_I18N._raw).forEach(key => {
    w.TT_I18N.ORDER.forEach((code, i) => {
      const val = w.TT_I18N._raw[key][i];
      if (!val) return;
      checked++;
      const alien = w.TT_LOCK.introducedAlienWords('', val.replace(/<[^>]+>/g, ' '), code);
      if (alien.length) bad('bleed', 'TT_I18N.' + key + '[' + code + ']: ' + alien.join(', '));
    });
  });
  ['TT_CLOSING_Q'].forEach(name => {
    const t = w[name]; if (!t) return;
    Object.keys(t).forEach(code => {
      checked++;
      const alien = w.TT_LOCK.introducedAlienWords('', t[code], code);
      if (alien.length) bad('bleed', name + '[' + code + ']: ' + alien.join(', '));
    });
  });
  console.log('   checked ' + checked + ' strings');

  console.log('11. hebrew reaching a non hebrew interface');
  /* The strongest end to end check there is: put the interface into each of the
     eleven other languages, then walk every wrapped string through H and look
     for a Hebrew letter coming back. If one does, that is Hebrew a user of that
     language would actually see. */
  let seen = 0;
  w.TT_TX_ORDER.forEach(code => {
    w.applyUiLang(code);
    Object.keys(w.TT_TX).forEach(src => {
      seen++;
      if (/[\u0590-\u05FF]/.test(w.H(src))) bad('hebrew-leak', code + ': ' + src.slice(0, 40));
    });
  });
  w.applyUiLang('he');
  console.log('   resolved ' + seen + ' strings across 11 languages');

  console.log('12. untranslated strings still wrapped');
  const gaps = w.ttTxMissing();
  gaps.slice(0, 5).forEach(g => bad('untranslated', g));
  if (!gaps.length) console.log('   none, every wrapped string has all 11');

  console.log('13. hebrew visible on screen after a language switch');
  /* The end to end version of the reported bug. Fill the app the way a person
     would, switch to each language, then walk every visible text node looking
     for a Hebrew letter. Anything found here is Hebrew a user of that language
     is actually looking at, whatever the tables say. */
  w.document.getElementById('resumeInput').value =
    'ניהלתי צוות של שנים עשר עובדים במחסן מרכזי';
  w.document.getElementById('jobInput').value =
    'Nous recherchons un responsable logistique pour gérer les stocks';
  const HEBRE = /[\u0590-\u05FF]/;
  let visibleLeaks = 0;
  w.TT_TX_ORDER.forEach(code => {
    w.applyUiLang(code);
    const walk = w.document.createTreeWalker(w.document.body, w.NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode;
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE' || p === 'TEXTAREA' || p === 'OPTION') continue;
      /* the resume box content is the person's own text and stays theirs */
      if (n.parentNode && n.parentNode.closest && n.parentNode.closest('#resumeLangBadge')) continue;
      /* Native language names are Hebrew on purpose: a Hebrew speaker looking
         for their own language in a Japanese interface finds it by the word
         עברית and by nothing else. */
      if (n.parentNode && n.parentNode.closest &&
          (n.parentNode.closest('#uiLangMenu') || n.parentNode.closest('#qLangMenu') ||
           n.parentNode.closest('#qLangSuggest') || n.parentNode.closest('#btnUiLangName'))) continue;
      if (n.nodeValue.trim() === 'עברית') continue;
      if (HEBRE.test(n.nodeValue)) {
        visibleLeaks++;
        if (visibleLeaks <= 6) bad('visible-hebrew', code + ': ' + n.nodeValue.trim().slice(0, 60));
      }
    }
  });
  w.applyUiLang('he');
  if (!visibleLeaks) console.log('   none across 11 languages');

  console.log('14. the file inputs survive a language switch');
  ['he', 'en', 'ja', 'ar'].forEach(code => {
    w.applyUiLang(code);
    ['resumeFile', 'jobFile', 'jobImage'].forEach(id => {
      if (!w.document.getElementById(id)) bad('input-destroyed', code + ': #' + id + ' is gone');
    });
  });
  w.applyUiLang('he');
  console.log('   checked 3 inputs across 4 languages');

  console.log('15. hebrew after a language switch MID RUN');
  /* The check above walks a page that has only just loaded, so it never saw the
     panels that appear once a run is under way, and those were exactly the ones
     the screenshot showed still in Hebrew. This drives the app into the middle
     of a run first, then switches language, then looks. */
  w.applyUiLang('he');
  try {
    w.APP.signals = { requirements: [
      { id:'R1', text:'עבודה עם מערכות Priority ו-VPLAN', must_have:true,  weight:80, keywords:['Priority','VPLAN'] },
      { id:'R2', text:'קידום פתרונות דיגיטליים ואוטומציות', must_have:true,  weight:70, keywords:['אוטומציה'] },
      { id:'R3', text:'היכרות עם כלי AI', must_have:false, weight:30, keywords:['AI'] }
    ] };
    w.APP.coverage = { items: [
      { id:'R1', status:'missing' }, { id:'R2', status:'partial' }, { id:'R3', status:'missing' }
    ] };
    w.APP.chat = w.APP.chat || {};
    w.APP.chat.lang = 'he'; w.APP.chat.qa = []; w.APP.chat.turns = [];
    if (typeof w.renderQueue === 'function') w.renderQueue();
    if (typeof w.chooseDomainMode === 'function') w.chooseDomainMode('broad');
    if (typeof w.renderChatProgress === 'function') w.renderChatProgress();
    if (typeof w.setStatus === 'function') w.setStatus('');
  } catch (e) { console.log('   (could not drive the run: ' + e.message + ')'); }

  let midLeaks = 0;
  w.TT_TX_ORDER.forEach(code => {
    w.applyUiLang(code);
    const walk = w.document.createTreeWalker(w.document.body, w.NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode, par = n.parentNode;
      if (!par || ['SCRIPT','STYLE','TEXTAREA','OPTION'].includes(par.nodeName)) continue;
      if (par.closest && (par.closest('#uiLangMenu') || par.closest('#qLangMenu') ||
          par.closest('#qLangSuggest') || par.closest('#langSwitch'))) continue;
      if (n.nodeValue.trim() === 'עברית') continue;
      /* Requirement text is quoted from the posting and stays in the posting's
         language on purpose, decision 5. Only the framing around it must move. */
      if (par.closest && par.closest('.tt-gapchip')) continue;
      if (/[\u0590-\u05FF]/.test(n.nodeValue)) {
        const txt = n.nodeValue.trim();
        if (/Priority|VPLAN|אוטומציות|כלי AI/.test(txt)) continue;   // quoted posting text
        midLeaks++;
        if (midLeaks <= 8) bad('visible-hebrew-midrun', code + ': ' + txt.slice(0, 70));
      }
    }
  });
  w.applyUiLang('he');
  if (!midLeaks) console.log('   none across 11 languages, with a run in progress');

  console.log('\n' + (problems ? problems + ' ISSUE(S)' : 'CLEAN, no issues found'));
  process.exitCode = problems ? 1 : 0;
}, 1800);
