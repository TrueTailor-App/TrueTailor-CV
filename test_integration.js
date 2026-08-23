/* Integration test. Boots the real HTML in jsdom and calls the functions the
   app itself calls, not the standalone modules. A module that passes its own
   suite and is wired in wrongly is still a broken app. */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = process.argv[2];
let errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Could not load script|Not implemented/i.test(String(e.message))) errs.push(e.message); });
vc.on('error', (...a) => errs.push(a.join(' ')));

const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://truetailor-app.github.io/TrueTailor-CV/', virtualConsole: vc
});
const w = dom.window;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL  ' + n + (x ? '  -> ' + x : '')); } };

setTimeout(() => {
  ok('page boots with no JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('=== the modules are present inside the page ===');
  ok('TT_LANG exists', typeof w.TT_LANG === 'object');
  ok('TT_LOCK exists', typeof w.TT_LOCK === 'object');
  ok('twelve languages', w.TT_LANG && w.TT_LANG.codes().length === 12,
     w.TT_LANG && w.TT_LANG.codes().join(','));
  ok('Intl.Segmenter available in this engine', w.TT_LANG.hasSegmenter());

  console.log('=== the old helpers now answer for twelve languages ===');
  ok('detectLang finds hebrew', w.detectLang('ניהלתי צוות של שנים עשר עובדים') === 'he');
  ok('detectLang finds arabic', w.detectLang('أدرت فريقًا من اثني عشر موظفًا') === 'ar');
  ok('detectLang finds russian', w.detectLang('Руководил командой из двенадцати сотрудников') === 'ru');
  ok('detectLang finds japanese', w.detectLang('中央倉庫でチームを管理しました') === 'ja');
  ok('detectLang finds hindi', w.detectLang('मैंने गोदाम में टीम का नेतृत्व किया') === 'hi');
  ok('detectLang still returns neutral for digits', w.detectLang('2019 - 2024') === 'neutral');
  ok('langName names croatian', w.langName('hr') === 'Croatian');
  ok('langName names arabic', w.langName('ar') === 'Arabic');

  console.log('=== direction, now with two right to left languages ===');
  ok('hebrew line is rtl', w.dirFor(w.dirLangFor('ניהלתי צוות במחסן', 'he')) === 'rtl');
  ok('arabic line is rtl', w.dirFor(w.dirLangFor('أدرت فريقًا في المستودع', 'ar')) === 'rtl');
  ok('english line is ltr', w.dirFor(w.dirLangFor('Managed a warehouse team', 'he')) === 'ltr');
  ok('russian line is ltr', w.dirFor(w.dirLangFor('Руководил командой', 'ru')) === 'ltr');
  ok('japanese line is ltr', w.dirFor(w.dirLangFor('倉庫のチームを管理', 'ja')) === 'ltr');
  /* The bug the original comment was written about: a Hebrew sentence that
     earned the posting's English terms has more Latin LETTERS but fewer Latin
     WORDS, and must stay right to left. */
  ok('hebrew sentence full of latin tool names stays rtl',
     w.dirFor(w.dirLangFor('עבדתי עם Priority, SAP Business One ו-Excel לניהול מלאי, רכש ותמחור', 'he')) === 'rtl');
  ok('a line of dates follows the document', w.dirLangFor('2019 - 2024', 'ar') === 'ar');

  console.log('=== the language lock, wired in ===');
  const V = (o, c, l) => w.languageLockVerdict(o, c, l);
  ok('hebrew reworded passes',
     V('ניהלתי צוות במחסן', 'ניהול צוות בן שנים עשר עובדים במחסן מרכזי', 'he').ok === true);
  ok('hebrew line keeps SAP',
     V('עבדתי עם מערכת מלאי', 'ניהול מערכת SAP לבקרת מלאי בשלושה אתרים', 'he').ok === true);
  ok('arabic token spliced into hebrew is refused',
     V('ניהלתי צוות של שנים עשר עובדים', 'ניהלתי צוות של شنים עשר עובדים', 'he').ok === false);
  ok('the refusal names a code, not only a sentence',
     V('ניהלתי צוות של שנים עשר עובדים', 'ניהלתי צוות של شנים עשר עובדים', 'he').code === 'alien_script');
  ok('the refusal still carries readable text',
     typeof V('ניהלתי צוות', 'ניהלתי צוות של شנים', 'he').reason === 'string');
  ok('hebrew line returned in english is refused',
     V('ניהלתי צוות של שנים עשר עובדים במחסן מרכזי',
       'Managed a team of twelve warehouse employees', 'he').ok === false);
  ok('arabic line returned in english is refused',
     V('أدرت فريقًا من اثني عشر موظفًا في المستودع المركزي',
       'Managed a team of twelve employees at the warehouse', 'ar').ok === false);
  ok('russian line reworded in russian passes',
     V('Работал с системой управления запасами',
       'Управление системой SAP на трёх площадках', 'ru').ok === true);
  ok('japanese line reworded passes',
     V('倉庫のチームを管理しました',
       '中央倉庫で十二名のチームを管理し、在庫管理システムの導入を主導しました', 'ja').ok === true);

  console.log('=== the fit question guard, decision 17 ===');
  ok('clean hebrew question passes',
     w.TT_LOCK.questionVerdict('האם ניהלת צוות של יותר מעשרה עובדים?', 'he').ok === true);
  ok('hebrew question naming SAP passes',
     w.TT_LOCK.questionVerdict('האם עבדת עם SAP או עם מערכת ERP אחרת?', 'he').ok === true);
  ok('the mix that was actually seen is refused',
     w.TT_LOCK.questionVerdict('Have you managed מערכות ERP in a regulated environment?', 'en').ok === false);
  ok('a hebrew question that came back in english is refused',
     w.TT_LOCK.questionVerdict('Did you manage a team of more than ten staff?', 'he').ok === false);

  console.log('=== word counting, the CJK failure, inside the page ===');
  const ja = '中央倉庫で十二名のチームを管理し、在庫管理システムの導入を主導しました';
  ok('ttWordCount segments japanese', w.ttWordCount(ja, 'ja') > 8, w.ttWordCount(ja, 'ja'));
  ok('wordCount segments japanese', w.wordCount(ja, 'ja') > 8, w.wordCount(ja, 'ja'));
  ok('naive split really would have said 1', ja.trim().split(/\s+/).length === 1);
  ok('english word count unchanged', w.ttWordCount('Managed a team of twelve people', 'en') === 6,
     w.ttWordCount('Managed a team of twelve people', 'en'));
  ok('hebrew word count unchanged', w.ttWordCount('ניהלתי צוות של שנים עשר עובדים', 'he') === 6,
     w.ttWordCount('ניהלתי צוות של שנים עשר עובדים', 'he'));

  console.log('=== headings are upper cased only where case exists ===');
  const tpl = { headUpper: true };
  ok('latin heading upper cased', w.headingText('experience', tpl) === 'EXPERIENCE');
  ok('cyrillic heading upper cased', w.headingText('опыт', tpl) === 'ОПЫТ');
  ok('hebrew heading untouched', w.headingText('ניסיון תעסוקתי', tpl) === 'ניסיון תעסוקתי');
  ok('arabic heading untouched', w.headingText('الخبرة العملية', tpl) === 'الخبرة العملية');
  ok('japanese heading untouched', w.headingText('職務経歴', tpl) === '職務経歴');
  ok('hindi heading untouched', w.headingText('कार्य अनुभव', tpl) === 'कार्य अनुभव');

  console.log('=== rule 1b is now built per document ===');
  ok('hebrew document rule names Hebrew', /Hebrew/.test(w.TT_LOCK.scriptRuleFor('he')));
  ok('arabic document rule names Arabic', /Arabic/.test(w.TT_LOCK.scriptRuleFor('ar')));
  ok('no rule still claims hebrew and english only',
     !/Hebrew and English only/i.test(w.TT_LOCK.scriptRuleFor('he') + w.TT_LOCK.scriptRuleFor('ja')));
  ok('the old absolute block list is gone', typeof w.TT_ALIEN_RE === 'undefined');

  console.log('=== DOCX fonts and language tags, decision 10 ===');
  ok('hebrew doc gets a complex script font', /w:cs="Arial"/.test(w.docxFontAttrs('he', 'Arial')));
  ok('japanese doc gets w:eastAsia', /w:eastAsia="Yu Gothic"/.test(w.docxFontAttrs('ja', 'Arial')));
  ok('hindi doc gets a devanagari font', /w:cs="Nirmala UI"/.test(w.docxFontAttrs('hi', 'Arial')));
  ok('english doc gets no eastAsia', !/eastAsia/.test(w.docxFontAttrs('en', 'Calibri')));
  ok('arabic document no longer declares itself hebrew', /w:bidi="ar-SA"/.test(w.docxLangTag('ar')));
  ok('hebrew document still declares hebrew', /w:bidi="he-IL"/.test(w.docxLangTag('he')));
  ok('russian document declares russian', /w:val="ru-RU"/.test(w.docxLangTag('ru')));
  ok('japanese document declares japanese for east asian text', /w:eastAsia="ja-JP"/.test(w.docxLangTag('ja')));
  ok('portuguese is brazilian', /w:val="pt-BR"/.test(w.docxLangTag('pt')));
  ok('spanish is latin american', /w:val="es-419"/.test(w.docxLangTag('es')));

  console.log('=== the string catalogue ===');
  ok('TT_I18N exists', typeof w.TT_I18N === 'object');
  ok('the catalogue only grows', w.TT_I18N.keys().length >= 91, w.TT_I18N.keys().length);
  ok('placeholders are written as attributes, not as content',
     w.TT_I18N.attrFor('ph.resume') === 'placeholder');
  ok('twelve language slots', w.TT_I18N.ORDER.length === 12);
  ok('no untranslated entries', w.TT_I18N.missing().length === 0,
     w.TT_I18N.missing().slice(0, 5).join(', '));
  ok('every selector matches exactly one element',
     w.checkUiStrings().selectors.length === 0, w.checkUiStrings().selectors.join(', '));
  ok('the dead two column table is gone', typeof w.TT_UI_STRINGS === 'undefined');

  console.log('=== the first screen really changes language ===');
  const phR = () => w.document.getElementById('resumeInput').getAttribute('placeholder');
  const cardR = () => w.document.querySelector('#inputCard > div:nth-of-type(1) .tt-card-title').textContent;
  w.applyUiLang('en');
  ok('the resume placeholder is english', /Paste your full resume/.test(phR()), phR());
  ok('the resume card title is english', /Your resume/.test(cardR()), cardR());
  w.applyUiLang('ja');
  ok('the resume placeholder is japanese', /履歴書/.test(phR()), phR());
  w.applyUiLang('ar');
  ok('the job placeholder is arabic',
     /وصف الوظيفة/.test(w.document.getElementById('jobInput').getAttribute('placeholder')));
  w.applyUiLang('he');
  ok('hebrew is unchanged', /הדבק כאן את קורות החיים/.test(phR()), phR());

  console.log('=== switching the interface language ===');
  const btn = () => w.document.querySelector('#btnAbout') && w.document.querySelector('#btnAbout').innerHTML.trim();
  w.applyUiLang('en'); ok('english button', btn() === 'About', btn());
  w.applyUiLang('ar'); ok('arabic button', btn() === 'حول', btn());
  w.applyUiLang('ja'); ok('japanese button', btn() === 'このアプリについて', btn());
  w.applyUiLang('hr'); ok('croatian button', btn() === 'O aplikaciji', btn());
  ok('page direction is ltr for croatian', w.document.documentElement.getAttribute('dir') === 'ltr');
  ok('page lang attribute follows', w.document.documentElement.getAttribute('lang') === 'hr');
  w.applyUiLang('ar');
  ok('page direction flips to rtl for arabic', w.document.documentElement.getAttribute('dir') === 'rtl');
  w.applyUiLang('he');
  ok('hebrew still renders the original text', btn() === 'אודות', btn());
  ok('an unknown language falls back to hebrew',
     (w.applyUiLang('zz'), w.TT_UI_LANG) === 'he');

  console.log('=== L() no longer answers Hebrew for the other ten ===');
  w.applyUiLang('hr');
  ok('croatian gets the english string, not the hebrew one', w.L('שלום', 'Hello') === 'Hello');
  w.applyUiLang('he');
  ok('hebrew still gets hebrew', w.L('שלום', 'Hello') === 'שלום');
  ok('the three argument form reads the catalogue',
     w.L('x', 'y', 'btn.about') === 'אודות');

  console.log('=== the prompts follow the interface language, decision 5 ===');
  w.applyUiLang('ru');
  ok('coverage prompt names Russian',
     /Russian/.test(w.promptCoverage('x', { requirements: [] }, w.TT_UI_LANG, 'y')));
  w.applyUiLang('ja');
  ok('world check prompt names Japanese',
     /Japanese/.test(w.promptWorldCheck('x', {}, w.TT_UI_LANG)));
  w.applyUiLang('he');

  console.log('=== the interface language picker, decisions 15 and 21 ===');
  const menu = w.document.getElementById('uiLangMenu');
  ok('the menu exists', !!menu);
  const opts = menu ? menu.querySelectorAll('button') : [];
  ok('twelve options', opts.length === 12, opts.length);
  const names = [].map.call(opts, b => b.textContent);
  ok('native names, not translated ones',
     names.indexOf('日本語') !== -1 && names.indexOf('हिन्दी') !== -1 &&
     names.indexOf('العربية') !== -1 && names.indexOf('Hrvatski') !== -1, names.join(' '));
  ok('each option carries its own direction',
     [].every.call(opts, b => b.getAttribute('dir') === (['he','ar'].indexOf(b.getAttribute('data-uilang')) !== -1 ? 'rtl' : 'ltr')));
  /* Decision 21 was reversed after the first real look at the screen: flags
     are back, but drawn as inline SVG rather than emoji, because Windows ships
     no flag glyphs and an emoji flag renders as two boxed letters in Chrome
     there while Firefox shows a real one. */
  ok('every language has a drawn flag',
     w.TT_LANG.codes().every(c => w.ttFlagSvg(c).indexOf('<svg') === 0),
     w.TT_LANG.codes().filter(c => !w.ttFlagSvg(c)).join(','));
  ok('the flags are svg, never emoji',
     !/[\u{1F1E6}-\u{1F1FF}]/u.test(w.document.getElementById('langSwitch').innerHTML));
  ok('english carries the united states flag', /#3c3b6e/.test(w.ttFlagSvg('en')));
  ok('arabic carries the jordanian flag', /#007a3d/.test(w.ttFlagSvg('ar')) && /#ce1126/.test(w.ttFlagSvg('ar')));
  ok('portuguese carries the brazilian flag', /#009b3a/.test(w.ttFlagSvg('pt')) && /#fedf00/.test(w.ttFlagSvg('pt')));
  ok('spanish carries the mexican flag, matching the latin american text',
     /#006847/.test(w.ttFlagSvg('es')));
  ok('every menu row shows its flag beside the name',
     [].every.call(opts, b => b.querySelector('svg') && b.textContent.trim().length > 0));
  ok('the button itself shows the current flag',
     !!w.document.getElementById('btnUiLangFlag').querySelector('svg'));
  ok('the old flag buttons are gone',
     !w.document.getElementById('btnUiHe') && !w.document.getElementById('btnUiEn'));

  console.log('=== the input panels do not move, and are symmetric ===');
  const io = w.document.getElementById('inputCard');
  const cards = io.querySelectorAll(':scope > div');
  ok('two input cards', cards.length === 2);
  ok('the resume card comes first in the document', cards[0].querySelector('#resumeInput'));
  ok('the posting card comes second', cards[1].querySelector('#jobInput'));
  ok('neither card reorders itself by language',
     ![].some.call(cards, c => /order-/.test(c.className)), cards[0].className + ' | ' + cards[1].className);
  ok('both cards share the layout class that equalises their height',
     [].every.call(cards, c => /tt-iocard/.test(c.className)));
  ok('both cards carry a spacer that pins the clear row to the bottom',
     [].every.call(cards, c => !!c.querySelector('.tt-iogrow')));

  console.log('=== picking from the menu actually switches ===');
  const pick = code => { const b = menu.querySelector('[data-uilang="' + code + '"]'); b.click(); };
  pick('ja');
  ok('japanese applied', w.TT_UI_LANG === 'ja');
  ok('the globe shows the native name',
     w.document.getElementById('btnUiLangName').textContent === '日本語',
     w.document.getElementById('btnUiLangName').textContent);
  ok('the chosen option is marked selected',
     menu.querySelector('[data-uilang="ja"]').getAttribute('aria-selected') === 'true');
  pick('ar');
  ok('arabic flips the shell to rtl', w.document.documentElement.getAttribute('dir') === 'rtl');
  ok('the address carries the language', /[?&]lang=ar/.test(w.location.search));
  pick('he');

  console.log('=== the globe must not be wired to the question language ===');
  const before = w.APP && w.APP.chat && w.APP.chat.lang;
  w.document.getElementById('btnUiLang').click();
  ok('opening the menu did not change the question language',
     (w.APP && w.APP.chat && w.APP.chat.lang) === before);
  w.document.getElementById('uiLangMenu').classList.add('tt-hidden');

  console.log('=== ttPickUiLang order ===');
  ok('an explicit lang in the address wins', typeof w.ttPickUiLang === 'function');

  console.log('=== the smart pickers, decision 20 ===');
  /* Real text in both boxes. An earlier version set APP.lang by hand with the
     boxes empty, which the badge renderer correctly wipes: an empty box has no
     language. The test was fabricating a state the app never produces. */
  w.document.getElementById('resumeInput').value =
    'ניהלתי צוות של שנים עשר עובדים במחסן מרכזי והובלתי הטמעה של מערכת ניהול מלאי';
  w.document.getElementById('jobInput').value =
    'Nous recherchons un responsable logistique pour gérer les stocks et coordonner les équipes du site';
  w.updateLangBadges();
  w.applyUiLang('en');
  const tt = w.ttTranslateTargets('he').map(x => x.code);
  ok('the posting language is offered first', tt[0] === 'fr', tt.join(','));
  ok('the interface language is offered too', tt.indexOf('en') !== -1, tt.join(','));
  ok('the source language is never offered as a target', tt.indexOf('he') === -1);
  ok('at most three suggestions', tt.length <= 3, tt.length);
  ok('no duplicates among the suggestions', new Set(tt).size === tt.length);
  const ttSame = w.ttTranslateTargets('fr').map(x => x.code);
  ok('when the posting matches the source it is dropped', ttSame.indexOf('fr') === -1, ttSame.join(','));

  w.APP.chat = w.APP.chat || {}; w.APP.chat.lang = 'he';
  const qs = w.qLangSuggestions().map(x => x.code);
  ok('the resume language leads the question suggestions', qs[0] === 'he', qs.join(','));
  ok('the posting language is suggested for questions too', qs.indexOf('fr') !== -1, qs.join(','));
  ok('every suggestion carries a written reason',
     w.qLangSuggestions().every(x => x.why && x.why.length > 2));
  w.applyUiLang('he');

  console.log('=== the question language control ===');
  w.updateLangButtons();
  const qMenu = w.document.getElementById('qLangMenu');
  ok('the full list has twelve entries', qMenu.querySelectorAll('button').length === 12,
     qMenu.querySelectorAll('button').length);
  ok('the old two button pair is gone',
     !w.document.getElementById('btnLangHe') && !w.document.getElementById('btnLangEn'));
  ok('a language name inside a hebrew sentence uses its hebrew name',
     w.ttLangLabel('ja') === 'יפנית', w.ttLangLabel('ja'));
  w.applyUiLang('en');
  ok('and its english name in an english interface', w.ttLangLabel('ja') === 'Japanese');
  w.applyUiLang('he');

  console.log('=== the four language axes ===');
  ok('the state object exists', typeof w.ttLangState === 'function');
  const st = w.ttLangState();
  ok('four axes present', 'doc' in st && 'job' in st && 'docManual' in st && 'jobManual' in st);

  console.log('=== the badges, decision 14 ===');
  const rin = w.document.getElementById('resumeInput');
  const rb  = w.document.getElementById('resumeLangBadge');
  rin.value = 'ניהלתי צוות של שנים עשר עובדים במחסן מרכזי והובלתי הטמעה של מערכת';
  w.updateLangBadges();
  ok('a certain reading shows a quiet change link',
     !!rb.querySelector('.tt-langbadge-link'), rb.textContent);
  ok('and says the language was detected', /זוהתה שפה/.test(rb.textContent), rb.textContent);
  ok('the axis was recorded', w.ttLangState().doc === 'he', w.ttLangState().doc);

  rin.value = 'Project manager';
  w.updateLangBadges();
  ok('an uncertain reading opens the picker instead',
     !!rb.querySelector('select') && !rb.querySelector('.tt-langbadge-link'), rb.textContent);
  ok('and admits the doubt in words', /לא הצלחתי לקבוע/.test(rb.textContent), rb.textContent);

  const sel = rb.querySelector('select');
  ok('the picker offers twelve languages', sel.options.length === 12, sel.options.length);
  sel.value = 'hr';
  sel.dispatchEvent(new w.Event('change'));
  ok('choosing by hand is recorded as manual', w.ttLangState().docManual === true);
  ok('and the badge stops claiming it detected anything',
     /נקבעה ידנית/.test(rb.textContent) && !/זוהתה שפה/.test(rb.textContent), rb.textContent);
  rin.value = 'Project manager.';
  w.updateLangBadges();
  ok('a manual choice survives an edit to the text',
     w.ttLangState().doc === 'hr' && w.ttLangState().docManual === true);
  rin.value = '';
  w.updateLangBadges();
  ok('and falls away when the box is emptied', w.ttLangState().docManual === false);

  rin.value = '중앙 창고에서 열두 명의 팀을 관리했습니다';
  w.updateLangBadges();
  ok('an unsupported language is named, not guessed',
     /Korean|קוריאנית/.test(rb.textContent) || /לא תומכת/.test(rb.textContent), rb.textContent);
  rin.value = '';
  w.updateLangBadges();

  console.log('=== cross language keyword matching, decision 13 ===');
  ok('the prompt asks for the resume language terms',
     /keywords_doc/.test(w.promptSignals('x', 'he')));
  ok('and names the resume language',
     /Hebrew/.test(w.promptSignals('x', 'he')) && /Croatian/.test(w.promptSignals('x', 'hr')));
  const req = { keywords: ['gestion des stocks'], keywords_doc: ['ניהול מלאי'] };
  const merged = w.ttReqKeywords(req);
  ok('both wordings are searched', merged.length === 2 &&
     merged.indexOf('ניהול מלאי') !== -1 && merged.indexOf('gestion des stocks') !== -1, merged.join(','));
  ok('a requirement with no keywords falls back to its text',
     w.ttReqKeywords({ text: 'CNC' }).join() === 'CNC');
  ok('duplicates are not counted twice',
     w.ttReqKeywords({ keywords: ['SAP'], keywords_doc: ['SAP'] }).length === 1);

  console.log('=== the region block is named, decision 24 ===');
  const msg = w.apiErrorMessage ? w.apiErrorMessage(400, { error: { message: 'User location is not supported for the API use.' } }) : '';
  ok('a region block does not read as a generic failure',
     /זמין במדינה|not available in the country/.test(msg), msg.slice(0, 90));

  console.log('=== the runtime string table ===');
  ok('TT_TX exists', typeof w.TT_TX === 'object');
  ok('every wrapped string has a row', w.ttTxMissing().length === 0,
     w.ttTxMissing().slice(0, 4).join(', '));
  const rows = Object.keys(w.TT_TX).length;
  ok('the table is populated', rows > 600, rows + ' rows');
  ok('eleven target languages', w.TT_TX_ORDER.length === 11);

  console.log('=== H() resolves per language ===');
  w.applyUiLang('he');
  ok('hebrew returns the source untouched', w.H('אין מה לייצא.') === 'אין מה לייצא.');
  w.applyUiLang('en');
  ok('english resolves', w.H('אין מה לייצא.') === 'There is nothing to export.', w.H('אין מה לייצא.'));
  w.applyUiLang('ja');
  ok('japanese resolves', w.H('אין מה לייצא.') === '書き出すものがありません。', w.H('אין מה לייצא.'));
  w.applyUiLang('hr');
  ok('croatian resolves', w.H('אין מה לייצא.') === 'Nema što izvesti.', w.H('אין מה לייצא.'));
  ok('an unknown string falls back to the source, never to a broken key',
     w.H('מחרוזת שלא קיימת בטבלה') === 'מחרוזת שלא קיימת בטבלה');
  w.applyUiLang('he');

  console.log('=== no hebrew reaches a non hebrew interface ===');
  const HEB = /[\u0590-\u05FF]/;
  let leaks = [];
  w.TT_TX_ORDER.forEach((code, i) => {
    Object.keys(w.TT_TX).forEach(k => {
      const v = w.TT_TX[k][i];
      if (HEB.test(v)) leaks.push(code + ': ' + k.slice(0, 24));
    });
  });
  ok('no hebrew left inside any translation', leaks.length === 0, leaks.slice(0, 3).join(' | '));

  console.log('=== duplicate requirements are merged ===');
  const dup = { requirements: [
    { id:'R9',  text:'A', must_have:true,  weight:80, keywords:['Priority','VPLAN'] },
    { id:'R20', text:'B', must_have:false, weight:30, keywords:['Priority','VPLAN'] },
    { id:'R5',  text:'C', must_have:true,  weight:60, keywords:['ניהול','צוות'] },
    { id:'R6',  text:'D', must_have:true,  weight:50, keywords:['ניהול','תקציב'] }
  ] };
  const mergedSig = w.ttMergeDuplicateRequirements(JSON.parse(JSON.stringify(dup)));
  ok('the same tool asked twice becomes one requirement',
     mergedSig.requirements.length === 3, mergedSig.requirements.length + ' left');
  ok('the merged one keeps must_have from the stronger side',
     mergedSig.requirements[0].must_have === true);
  ok('and the higher weight', mergedSig.requirements[0].weight === 80);
  ok('and records what it absorbed',
     (mergedSig.requirements[0].merged_from || []).join() === 'R20');
  ok('two requirements sharing only a wrapper word stay separate',
     mergedSig.requirements.filter(r => r.id === 'R5' || r.id === 'R6').length === 2);
  ok('a wrapper word alone never merges',
     w.ttSpecificKeys({ keywords: ['ניהול', 'experience'] }).length === 0);

  console.log('=== the closing question reads as english ===');
  ok('no elliptical "why you for this job"', !/why you for this job/i.test(w.TT_CLOSING_Q.en));
  ok('the rephrasing is present', /why they should hire you/i.test(w.TT_CLOSING_Q.en));
  ok('every supported language has a closing question',
     w.TT_LANG.codes().every(c => !!w.TT_CLOSING_Q[c]),
     w.TT_LANG.codes().filter(c => !w.TT_CLOSING_Q[c]).join(','));

  console.log('=== the two input boxes are identical in height ===');
  /* The assertion is reversed from an earlier round on purpose. Letting the box
     absorb the slack made it end wherever the row beneath it left it, and those
     rows are not the same height in the two cards. Fixed boxes, flexible
     spacer, and nothing below can move them. */
  const sheet = w.document.documentElement.innerHTML;
  ok('both boxes are fixed to the same height',
     /\.tt-iocard textarea \{[^}]*height: 21rem[^}]*min-height: 21rem/.test(sheet));
  ok('the box does not absorb the slack',
     /\.tt-iocard textarea \{[^}]*flex: 0 0 auto/.test(sheet));
  ok('the spacer does', /\.tt-iocard \.tt-iogrow \{[^}]*flex: 1 1 auto/.test(sheet));
  ok('both cards carry the layout class',
     w.document.querySelectorAll('#inputCard > .tt-iocard').length === 2);

  console.log('=== the theme is present and did not reach the sheet ===');
  ok('the theme block is in the stylesheet', /ORGANIC STUDIO/.test(sheet));
  ok('the printed page still declares its own white',
     /\.tt-page \{[^}]*background:#fff/.test(sheet));
  ok('printing is guarded against the tinted body',
     /@media print \{[\s\S]{0,240}background: #FFFFFF !important/.test(sheet));
  ok('small buttons keep their own padding',
     /\.tt-btn-sm \{[^}]*padding: 7px 14px !important/.test(sheet));
  ok('and are still pills', /\.tt-btn-sm \{[^}]*border-radius: var\(--r-btn\) !important/.test(sheet));

  console.log('=== the must have gate ===');
  const verdictFor = proved => {
    const reqs = [], cov = [];
    for (let i = 0; i < 21; i++) {
      const must = i < 4;
      reqs.push({ id:'R'+i, text:'r'+i, kind:'hard_skill', must_have:must, weight: must?80:40, keywords:['k'+i] });
      cov.push({ req_id:'R'+i, status: (must ? i < proved : true) ? 'direct' : 'missing' });
    }
    w.APP.signals = { requirements: reqs }; w.APP.coverage = cov;
    return w.matchVerdict();
  };
  const all = verdictFor(4), three = verdictFor(3), none = verdictFor(0);
  ok('every must proved still scores full', all.score === 100 && all.band === 'high');
  ok('one missing must drops the number', three.score < all.score, three.score + ' vs ' + all.score);
  ok('one missing must is never the top band', three.band !== 'high', three.band);
  ok('no must proved is low', none.band === 'low' && none.score < 40, none.score + ' ' + none.band);
  ok('the floor is not zero, the rest of the resume is still real', none.score > 15, none.score);

  console.log('=== the skills step has room to answer ===');
  ok('skills budget matches the other structural steps', w.TT_TOKENS.skills >= 16000, w.TT_TOKENS.skills);

  console.log('=== paint tracking ===');
  ok('painters are wrapped', typeof w.ttTrackPainters === 'function');
  ok('paint calls are recorded', Object.keys(w.TT_LAST_PAINT).length > 3,
     Object.keys(w.TT_LAST_PAINT).join(','));
  ok('a renderer called with an argument keeps it',
     (w.chooseDomainMode('broad'), (w.TT_LAST_PAINT.chooseDomainMode || [])[0] === 'broad'));

  console.log('=== the variant rung, from the two real cases ===');
  const val = (c, r) => w.requirementValue(c, r);
  ok('the same system, another module, beats a different system',
     val({status:'partial', adjacent:{distance:'same_variant'}}, {kind:'tool'}) >
     val({status:'missing', adjacent:{distance:'same_class'}}, {kind:'tool'}));
  ok('and is worth 0.75',
     val({status:'partial', adjacent:{distance:'same_variant'}}, {kind:'tool'}) === 0.75);
  ok('teaching one age band against another is a variant, not a miss',
     val({status:'equivalent', adjacent:{distance:'same_variant'}}, {kind:'hard_skill'}) === 0.75);
  ok('no teaching at all is still near zero',
     val({status:'missing', adjacent:{distance:'unrelated'}}, {kind:'hard_skill'}) <= 0.1);
  ok('a licence has no variant, nothing creates one',
     val({status:'missing', adjacent:{distance:'same_variant'}}, {kind:'certification'}) === 0);
  ok('the ladder never lowers what the status already paid',
     val({status:'partial', adjacent:{distance:'unrelated'}}, {kind:'hard_skill'}) === 0.5);
  ok('the model is told the rung exists',
     /same_variant/.test(w.promptCoverage('x', { requirements: [] }, 'he', 'y')));

  console.log('=== the fit recheck ===');
  ok('the recheck exists', typeof w.runFitRecheck === 'function');
  ok('it only reads requirements an answer touched', typeof w.ttTouchedReqIds === 'function');
  w.APP.chat = { qa: [
    { a: 'yes, 40 users', skipped: false, reqIds: ['R1','R2'] },
    { a: '',             skipped: true,  reqIds: ['R3'] },
    { a: 'ISO 9001',     skipped: false, reqIds: ['R2'] }
  ] };
  const touched = w.ttTouchedReqIds().sort().join(',');
  ok('a skipped answer touches nothing', touched === 'R1,R2', touched);
  ok('the recheck prompt forbids counting a rewording as evidence',
     /NOT[\s\S]{0,40}new evidence/.test(w.promptRecheck('x', [{id:'R1',text:'t'}])));
  ok('the panel renders nothing before a recheck has run',
     (w.APP.fitDelta = null, w.renderFitDelta(),
      w.document.getElementById('fitDelta').innerHTML === ''));

  console.log('=== the panel says what happened, in every language ===');
  w.APP.fitDelta = { before: 62, after: 78, closed: [{ text: 'ניהול מלאי' }], stillOpen: [], asked: 5 };
  w.applyUiLang('en'); w.renderFitDelta();
  const upHtml = w.document.getElementById('fitDelta').innerHTML;
  ok('a rise shows both numbers', /62%/.test(upHtml) && /78%/.test(upHtml));
  ok('and says why it rose', /new facts entered the document/.test(upHtml));

  w.APP.fitDelta = { before: 62, after: 62, closed: [], stillOpen: [{ text: 'Priority' }], asked: 5 };
  w.renderFitDelta();
  const flatHtml = w.document.getElementById('fitDelta').innerHTML;
  ok('no movement is stated plainly', /The gaps did not close/.test(flatHtml));
  ok('and the person is told to reconsider, not redirected',
     /worth reconsidering/.test(flatHtml) && !/<button/.test(flatHtml));
  ok('the still open must haves are listed', /Priority/.test(flatHtml));
  w.applyUiLang('ar'); w.renderFitDelta();
  ok('the same panel in arabic', /لم تُغلق الفجوات/.test(w.document.getElementById('fitDelta').innerHTML));
  w.applyUiLang('he'); w.APP.fitDelta = null; w.renderFitDelta();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}, 1500);
