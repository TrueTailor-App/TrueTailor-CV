const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || 'index.html';

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('Error: Input file not found.');
  process.exit(1);
}

let htmlContent = fs.readFileSync(inputFile, 'utf8');

// 1. הגדרת תגית CSP
// v39.46.0: added the Supabase sign-in gate. script-src gained
// cdn.jsdelivr.net (that is where the supabase-js tag loads from - not
// mirrored on cdnjs, the CDN already used above). connect-src gained
// https://*.supabase.co (every call the SDK makes after it loads: auth,
// getSession, the increment_usage rpc). No other directive needed one -
// the Google OAuth hop is a full top-level page redirect, not a fetch/XHR,
// so it is not something connect-src/script-src governs.
const cspMetaTag = `
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://www.googletagmanager.com https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: https://fonts.gstatic.com;
  connect-src 'self' blob: data: https://generativelanguage.googleapis.com https://cdnjs.cloudflare.com https://www.google-analytics.com https://analytics.google.com https://*.amazonaws.com https://*.supabase.co;
  worker-src 'self' blob: https://cdnjs.cloudflare.com;
  img-src 'self' data: blob: https://www.google-analytics.com https://*.google-analytics.com;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';">
`;

// 2. קוד חסימת קליק ימני ו-DevTools
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

if (!htmlContent.includes('Content-Security-Policy')) {
  htmlContent = htmlContent.replace(/<\/head>/i, `${cspMetaTag}\n</head>`);
}

// 3. עיבוד, הזרקת אבטחה וערפול JS
const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let injected = false;

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

    return `<script${scriptAttrs}>${obfuscatedCode}</script>`;
  } catch (err) {
    const minifiedCode = codeToProcess
      .replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*/g, '')
      .replace(/\s+/g, ' ');
    return `<script${scriptAttrs}>${minifiedCode}</script>`;
  }
});

fs.writeFileSync(outputFile, obfuscatedHtml, 'utf8');
console.log('[OK] Security injected & HTML obfuscated successfully!');