/* ============================================================================
   XSS regression test for TrueTailor CV.

   Does not read the code and hope. Feeds real injection payloads through the
   actual rendering functions, then inspects the DOM they produce for anything
   that could execute: script tags, event-handler attributes, javascript: urls,
   iframes, embedded objects.

   The point of keeping this around is the future. The app is disciplined today
   because every path into innerHTML runs through escapeHtml. This test fails
   the moment somebody adds a path that does not.

   Setup, once:      npm install jsdom
   Run:              node xss-regression.test.js
                     node xss-regression.test.js "C:\\path\\to\\index.html"

   Exit code 0 means clean, 1 means something can execute, 2 means bad usage.

   Sanity check on the test itself: change escapeHtml to return its input
   unchanged, run this, and it should report nine or more RISK lines. A test
   that never fails is not evidence.
   ========================================================================= */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const FILE = process.argv[2] || 'TrueTailor_CV_v35_7.html';
if (!fs.existsSync(FILE)) {
  console.error('File not found: ' + FILE +
    '\nRun from the project folder, or: node xss-regression.test.js "path\\to\\index.html"');
  process.exit(2);
}
const html = fs.readFileSync(FILE, 'utf8');

const PAYLOADS = [
  '<script>window.__PWNED=1<\/script>',
  '<img src=x onerror="window.__PWNED=1">',
  '<svg/onload=window.__PWNED=1>',
  '"><script>window.__PWNED=1<\/script>',
  "'><img src=x onerror=window.__PWNED=1>",
  '<a href="javascript:window.__PWNED=1">click</a>',
  '<iframe src="javascript:window.__PWNED=1"></iframe>',
  '</span><script>window.__PWNED=1<\/script><span>',
  '<body onload=window.__PWNED=1>',
  '<details open ontoggle=window.__PWNED=1>'
];

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  SAFE  ' + n))
                          : (fail++, console.log('  RISK  ' + n + (x ? '  -> ' + x : '')));

function inspect(markup) {
  /* parse the produced markup and look for anything executable */
  const d = new JSDOM('<div id="r"></div>').window.document;
  d.getElementById('r').innerHTML = String(markup == null ? '' : markup);
  const root = d.getElementById('r');
  const bad = [];
  if (root.querySelector('script')) bad.push('script tag');
  if (root.querySelector('iframe,object,embed')) bad.push('frame/object');
  root.querySelectorAll('*').forEach(el => {
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) bad.push('handler ' + a.name + ' on <' + el.tagName.toLowerCase() + '>');
      if (/^(href|src|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))
        bad.push('javascript: in ' + a.name);
    }
  });
  return bad;
}

new JSDOM(html, {
  url: 'https://truetailor-app.github.io/TrueTailor-CV/',
  runScripts: 'dangerously', pretendToBeVisual: true,
  virtualConsole: new VirtualConsole()
}).window.addEventListener('load', function () {
  const w = this;

  console.log('\n== escapeHtml itself ==');
  PAYLOADS.forEach((p, i) => {
    const bad = inspect(w.escapeHtml(p));
    ok('payload ' + (i + 1) + ' neutralised', bad.length === 0, bad.join(', '));
  });

  console.log('\n== answerLayerHtml (spell-check overlay) ==');
  PAYLOADS.forEach((p, i) => {
    const bad = inspect(w.answerLayerHtml(p, []));
    const bad2 = inspect(w.answerLayerHtml('x ' + p + ' y', [{ before: p }]));
    ok('payload ' + (i + 1) + ' neutralised (plain + marked)',
       bad.length === 0 && bad2.length === 0, bad.concat(bad2).join(', '));
  });

  console.log('\n== buildPrintHtml (export / print path) ==');
  const tpl = (w.TT_TEMPLATES && Object.keys(w.TT_TEMPLATES)[0]) || 'classic';
  PAYLOADS.forEach((p, i) => {
    let bad;
    try { bad = inspect(w.buildPrintHtml('שם מלא\n' + p + '\n\nניסיון\n' + p, tpl)); }
    catch (e) { bad = ['threw: ' + e.message]; }
    ok('payload ' + (i + 1) + ' neutralised', bad.length === 0, bad.join(', '));
  });

  console.log('\n== whole-document sweep after rendering ==');
  ok('no window.__PWNED anywhere', !w.__PWNED);
  const liveBad = [];
  w.document.querySelectorAll('*').forEach(el => {
    for (const a of el.attributes) if (/^on/i.test(a.name)) liveBad.push(el.tagName + '@' + a.name);
  });
  ok('no inline event-handler attributes in the live document',
     liveBad.length === 0, liveBad.slice(0, 5).join(', '));

  console.log('\n' + (fail === 0 ? 'NO INJECTION FOUND IN ' + pass + ' PROBES'
                                 : pass + ' safe, ' + fail + ' RISKS'));
  process.exit(fail ? 1 : 0);
});
