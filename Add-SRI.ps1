# =============================================================================
#  Add-SRI.ps1
#
#  Adds Subresource Integrity to the three cdnjs scripts in TrueTailor CV.
#
#  The hashes below were derived from the upstream sources that cdnjs mirrors
#  verbatim (the jszip git tag, and the mammoth and pdfjs-dist npm tarballs).
#  They were NOT confirmed against cdnjs itself, because that host was not
#  reachable from where they were produced.
#
#  So this script does not trust them. It downloads each file from cdnjs, hashes
#  what actually arrives, and compares. The html is rewritten only if all three
#  match. If any one differs, nothing is written and the file is left exactly as
#  it was. A wrong hash would block the script in the browser and silently break
#  Word export and PDF/docx upload, which is the thing being avoided here.
#
#  Usage, from the project folder:
#      powershell -ExecutionPolicy Bypass -File .\Add-SRI.ps1
#
#  Or against a specific file:
#      powershell -ExecutionPolicy Bypass -File .\Add-SRI.ps1 -Path "C:\some\index.html"
# =============================================================================

[CmdletBinding()]
param(
    [string]$Path = ".\TrueTailor_CV_v35_7.html"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$targets = @(
    @{ Path = "jszip/3.10.1/jszip.min.js"
       Hash = "sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG" },
    @{ Path = "mammoth/1.6.0/mammoth.browser.min.js"
       Hash = "sha384-nFoSjZIoH3CCp8W639jJyQkuPHinJ2NHe7on1xvlUA7SuGfJAfvMldrsoAVm6ECz" },
    @{ Path = "pdf.js/3.11.174/pdf.min.js"
       Hash = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e" }
)

function Get-Sri([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA384]::Create()
    try   { "sha384-" + [Convert]::ToBase64String($sha.ComputeHash($Bytes)) }
    finally { $sha.Dispose() }
}

# ---------------------------------------------------------------- find the file
if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "File not found: $Path" -ForegroundColor Red
    Write-Host "Run this from the project folder, or pass -Path with the full path." -ForegroundColor Yellow
    exit 1
}
$full = (Resolve-Path -LiteralPath $Path).Path
Write-Host "File: $full`n"

# ------------------------------------------------- step 1, verify against cdnjs
Write-Host "Step 1 of 3  checking what cdnjs actually serves" -ForegroundColor Cyan
$allMatch = $true

foreach ($t in $targets) {
    $url = "https://cdnjs.cloudflare.com/ajax/libs/" + $t.Path
    Write-Host ("  " + $t.Path)
    try {
        $resp  = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60
        $bytes = $resp.RawContentStream.ToArray()
    } catch {
        Write-Host "    could not download: $($_.Exception.Message)" -ForegroundColor Red
        $allMatch = $false
        continue
    }
    $live = Get-Sri $bytes
    if ($live -eq $t.Hash) {
        Write-Host ("    match   " + $bytes.Length + " bytes") -ForegroundColor Green
    } else {
        Write-Host "    MISMATCH" -ForegroundColor Red
        Write-Host "      expected: $($t.Hash)"
        Write-Host "      served  : $live"
        $allMatch = $false
    }
}

if (-not $allMatch) {
    Write-Host "`nStopping. Nothing was written and your file is untouched." -ForegroundColor Yellow
    Write-Host "Send the 'served' hashes above back and they can be used instead." -ForegroundColor Yellow
    exit 1
}

# ------------------------------------------------------ step 2, rewrite the tags
Write-Host "`nStep 2 of 3  rewriting the script tags" -ForegroundColor Cyan

# ReadAllText / WriteAllText on purpose. Get-Content splits on line endings and
# Set-Content -Encoding UTF8 writes a BOM on Windows PowerShell, and this file
# must stay UTF-8 with no BOM and LF endings.
$noBom = New-Object System.Text.UTF8Encoding($false)
$text  = [IO.File]::ReadAllText($full, $noBom)
$orig  = $text

foreach ($t in $targets) {
    $old = '<script src="https://cdnjs.cloudflare.com/ajax/libs/' + $t.Path + '"></script>'
    $new = '<script src="https://cdnjs.cloudflare.com/ajax/libs/' + $t.Path + '" integrity="' + $t.Hash + '" crossorigin="anonymous"></script>'

    if ($text -like "*integrity=`"$($t.Hash)`"*") {
        Write-Host ("  already present  " + $t.Path) -ForegroundColor DarkGray
        continue
    }
    $count = ([regex]::Matches($text, [regex]::Escape($old))).Count
    if ($count -ne 1) {
        Write-Host ("  tag not found exactly once (" + $count + "): " + $t.Path) -ForegroundColor Red
        Write-Host "  Stopping. Nothing was written." -ForegroundColor Yellow
        exit 1
    }
    $text = $text.Replace($old, $new)
    Write-Host ("  done  " + $t.Path) -ForegroundColor Green
}

if ($text -eq $orig) {
    Write-Host "`nNothing to change, the file already has all three." -ForegroundColor Yellow
    exit 0
}

# --------------------------------------------- keep the comment above them true
# That block currently explains why SRI is NOT applied, and claims the pdf.js
# worker needs the same treatment. Both statements stop being true the moment
# this script runs, and a comment that lies is worse than no comment.
$staleWhy = @"
     The fix is one attribute per script. It is NOT applied here on purpose,
     because an integrity attribute holding a placeholder does not fail
     quietly: the browser refuses to run the script and the app dies. The
     hashes have to be real before the attributes go on.

     To generate them, run this for each of the three URLs:

       curl -s <THE URL BELOW> | openssl dgst -sha384 -binary | openssl base64 -A

     then add to that script tag:

       integrity="sha384-<the output>" crossorigin="anonymous"

     Test each one immediately after adding it: a wrong hash shows up as the
     library being undefined, which this app reports as "הספרייה לא נטענה".
"@
$freshWhy = @"
     APPLIED to the three cdnjs scripts below. Each hash was checked against
     what cdnjs actually serves before it was written in, by Add-SRI.ps1. A
     hash that does not match does not fail quietly: the browser refuses to
     run the script, and this app then reports "הספרייה לא נטענה".

     If one of these libraries is ever upgraded, the hash must be regenerated
     in the same breath. Re-running Add-SRI.ps1 with the new version and hash
     is the intended way. Generating one by hand:

       curl -s <THE URL BELOW> | openssl dgst -sha384 -binary | openssl base64 -A
"@

$staleWorker = @"
     pdf.js also loads a worker at runtime, and that URL needs the same
     treatment. It is set in code, search for GlobalWorkerOptions.workerSrc.
"@
$freshWorker = @"
     pdf.js also loads a worker at runtime, set in code, search for
     GlobalWorkerOptions.workerSrc. That one CANNOT be covered by integrity:
     there is no such attribute for a worker loaded from a URL. What limits it
     is the worker-src directive in the Content Security Policy above, which
     confines it to the same cdnjs origin. That is origin control, not content
     control, and it is weaker. Compiling these libraries in would remove the
     exposure entirely.
"@

foreach ($pair in @(@($staleWhy,$freshWhy), @($staleWorker,$freshWorker))) {
    $from = $pair[0] -replace "`r`n", "`n"
    $to   = $pair[1] -replace "`r`n", "`n"
    if ($text.Contains($from)) {
        $text = $text.Replace($from, $to)
        Write-Host "  comment above the tags brought up to date" -ForegroundColor Green
    } else {
        Write-Host "  note: comment text not matched, left as it was" -ForegroundColor DarkYellow
    }
}

# --------------------------------------------------- step 3, back up then write
Write-Host "`nStep 3 of 3  saving" -ForegroundColor Cyan
$backup = "$full.backup"
Copy-Item -LiteralPath $full -Destination $backup -Force
Write-Host "  backup: $backup"

[IO.File]::WriteAllText($full, $text, $noBom)
Write-Host "  written: $full" -ForegroundColor Green

Write-Host "`nDone. Now open the file in a browser and confirm three things:" -ForegroundColor Cyan
Write-Host "  1. the page loads and looks normal"
Write-Host "  2. uploading a PDF still works        (this is pdf.js)"
Write-Host "  3. uploading a .docx still works      (this is mammoth)"
Write-Host "  4. exporting to Word still works      (this is jszip)"
Write-Host "`nIf anything fails, restore with:" -ForegroundColor Yellow
Write-Host "  Copy-Item -LiteralPath `"$backup`" -Destination `"$full`" -Force"
