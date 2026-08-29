const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || 'index.html';

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('Error: Input file not found.');
  process.exit(1);
}

let htmlContent = fs.readFileSync(inputFile, 'utf8');

// ---------------------------------------------------------------------------
// 1. CSP — VERIFIED, NO LONGER DUPLICATED HERE
//
// This file used to carry its own full copy of the Content-Security-Policy and
// inject it "only if the HTML does not already have one". The HTML has had one
// in <head> for a long time, so the injection never actually ran — and the copy
// kept here quietly rotted for months:
//
//   * it still allowed www.googletagmanager.com, www.google-analytics.com and
//     analytics.google.com, which v39.49.0 deliberately REMOVED from the app
//     (the privacy policy promises there is no analytics, in twelve languages);
//   * it was missing accounts.google.com, oauth2.googleapis.com,
//     gmail.googleapis.com and www.googleapis.com entirely — so on the one day
//     it did fire, Google sign-in and the Gmail draft button would both have
//     broken, with no error on screen, because a blocked CSP fetch fails
//     silently.
//
// Two copies of a security header that only one of them is ever enforced is not
// defence in depth, it is a trap. So this step no longer WRITES a policy. It
// CHECKS that the HTML brought one, and stops the build if it did not — which
// is the failure this was really meant to prevent, made loud instead of silent.
//
// If a directive ever needs changing, change it in the HTML file. There is now
// exactly one place to change.
// ---------------------------------------------------------------------------
if (!/http-equiv=["']Content-Security-Policy["']/i.test(htmlContent)) {
  console.error('Error: the input HTML has no Content-Security-Policy meta tag.');
  console.error('       Refusing to build. Add the policy to the HTML <head>, which is');
  console.error('       the single source of truth for it — do not re-add a copy here.');
  process.exit(1);
}

// A cheap regression guard for the one directive set that has already gone
// stale once. If an analytics origin comes back into the app, this build fails
// rather than shipping a page that contradicts its own privacy policy.
const cspMatch = htmlContent.match(/http-equiv=["']Content-Security-Policy["']\s+content="([^"]*)"/i);
const cspText = cspMatch ? cspMatch[1] : '';
if (/googletagmanager\.com|google-analytics\.com/i.test(cspText)) {
  console.error('Error: the CSP allows an analytics origin (googletagmanager / google-analytics).');
  console.error('       The privacy policy, the About panel and the legal text all state that');
  console.error('       there is no analytics. Remove the origin, or update all of that text');
  console.error('       first — but do not ship the two contradicting each other.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Right-click / DevTools deterrent
//
// Kept as-is because it is Kobi's call, but two things are worth knowing and
// were not written down anywhere before:
//
//   * The `debugger` + reload loop below fires ONCE A SECOND, and reloads the
//     page whenever a debugger is attached. Anyone who opens DevTools on the
//     live site — including Kobi diagnosing a report, or a pilot user who is
//     simply curious — gets an unstoppable reload loop and cannot use the app.
//     This was investigated once as the prime suspect for the v39.46.1 "login
//     loop" and cleared only because DevTools happened to be closed that day.
//   * It stops nobody who wants the source: "view-source:", Ctrl+S, the
//     network tab of a second browser, or curl all bypass it in seconds.
//
// So it costs real usability against a determined reader it cannot stop. Worth
// reconsidering before the pilot widens; not changed here without a decision.
// ---------------------------------------------------------------------------
const securityCode = `
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); return false; }, true);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'F12' || e.keyCode === 123) { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c'].indexOf(e.key) !== -1) { e.preventDefault(); return false; }
    if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); return false; }
  }, true);
  setInterval(function() {
    var start = performance.now();
    debugger;
    if (performance.now() - start > 100) { window.location.reload(); }
  }, 1000);
`;

// ---------------------------------------------------------------------------
// 3. Obfuscate the inline scripts
// ---------------------------------------------------------------------------
const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let injected = false;
let obfuscatedCount = 0;
let fellBackCount = 0;

const obfuscatedHtml = htmlContent.replace(scriptRegex, (match, scriptAttrs, jsCode) => {
  if (/src\s*=/i.test(scriptAttrs) || !jsCode.trim()) {
    return match;
  }

  let codeToProcess = jsCode;
  if (!injected) {
    codeToProcess = securityCode + '\n' + jsCode;
    injected = true;
  }

  try {
    const obfuscatedCode = JavaScriptObfuscator.obfuscate(codeToProcess, {
      compact: true,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: true,
      simplify: true,
      stringArray: false
    }).getObfuscatedCode();

    obfuscatedCount++;
    return `<script${scriptAttrs}>${obfuscatedCode}</script>`;
  } catch (err) {
    /* The fallback used to swallow the error entirely and quietly ship a
       regex-"minified" block instead. That regex strips // comments, and a
       single https:// inside a string is enough for it to eat the rest of the
       line - so the rescue path could produce a broken page more easily than
       the failure it was rescuing. Say what happened, loudly. */
    fellBackCount++;
    console.warn('[WARN] Obfuscation failed on one script block: ' + (err && err.message));
    console.warn('       Falling back to regex minification, which is NOT safe for this');
    console.warn('       file (it strips // comments and can eat a line containing a URL).');
    console.warn('       Test the built index.html before deploying it.');
    const minifiedCode = codeToProcess
      .replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*/g, '')
      .replace(/\s+/g, ' ');
    return `<script${scriptAttrs}>${minifiedCode}</script>`;
  }
});

if (!injected) {
  console.error('Error: no inline <script> block was found, so the security code was never');
  console.error('       injected. The input file is probably not the app HTML.');
  process.exit(1);
}

fs.writeFileSync(outputFile, obfuscatedHtml, 'utf8');
console.log('[OK] CSP verified (single source of truth: the HTML file).');
console.log('[OK] Security code injected into the first inline script block.');
console.log('[OK] ' + obfuscatedCount + ' script block(s) obfuscated' +
  (fellBackCount ? ', ' + fellBackCount + ' fell back to regex minification — TEST BEFORE DEPLOY' : '') + '.');
