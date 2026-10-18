# Rebuild the public (obfuscated) files from the local sources in src/.
# Edit files inside src\ ONLY, then run:
#   powershell -ExecutionPolicy Bypass -File src\build.ps1
# The root-level script.js / db-firebase.js / style.css / index.html are the deployed,
# obfuscated + minified versions - never edit them directly.
# MAXIMUM HIDE MODE: public sees ONLY heavily obfuscated code + single-line HTML (like Next.js production build).
# Real readable logic stays in gitignored src/ and is NEVER committed.

Write-Host "Obfuscating script.js (MAX)..." -ForegroundColor Cyan
npx --yes javascript-obfuscator src/script.js --output script.js --compact true --control-flow-flattening true --control-flow-flattening-threshold 0.75 --dead-code-injection true --dead-code-injection-threshold 0.4 --disable-console-output true --identifier-names-generator hexadecimal --rename-globals false --self-defending true --debug-protection true --debug-protection-interval 4000 --string-array true --string-array-threshold 1 --string-array-encoding rc4 --string-array-wrappers-count 2 --string-array-wrappers-chained-calls true --string-array-wrappers-type variable --string-array-rotate true --string-array-shuffle true --string-array-index-shift true --string-array-calls-transform true --string-array-calls-transform-threshold 0.75 --transform-object-keys true --unicode-escape-sequence true --numbers-to-expressions true --split-strings true --split-strings-chunk-length 5 --simplify true --target browser

Write-Host "Obfuscating db-firebase.js (MAX)..." -ForegroundColor Cyan
npx --yes javascript-obfuscator src/db-firebase.js --output db-firebase.js --compact true --control-flow-flattening true --control-flow-flattening-threshold 0.75 --dead-code-injection true --dead-code-injection-threshold 0.4 --disable-console-output false --identifier-names-generator hexadecimal --rename-globals false --self-defending true --debug-protection true --debug-protection-interval 4000 --string-array true --string-array-threshold 1 --string-array-encoding rc4 --string-array-wrappers-count 2 --string-array-wrappers-chained-calls true --string-array-wrappers-type variable --string-array-rotate true --string-array-shuffle true --string-array-index-shift true --string-array-calls-transform true --string-array-calls-transform-threshold 0.75 --transform-object-keys true --unicode-escape-sequence true --numbers-to-expressions true --split-strings true --split-strings-chunk-length 5 --simplify true --target browser

Write-Host "Minifying style.css..." -ForegroundColor Cyan
npx --yes clean-css-cli -o style.css src/style.css

Write-Host "Minifying index.html to single-line (Next.js-style)..." -ForegroundColor Cyan
npx --yes html-minifier-terser src/index.html --collapse-whitespace --remove-comments --remove-redundant-attributes --remove-script-type-attributes --remove-style-link-type-attributes --minify-css true --minify-js true --collapse-boolean-attributes --remove-tag-whitespace --sort-attributes --sort-class-name --keep-closing-slash -o index.html
# Post-process: ensure UTF-8 without BOM and fix misplaced BOM after DOCTYPE (html-minifier may emit EF BB BF at offset 15)
$idx = "index.html"
if (Test-Path $idx) {
  $b = [IO.File]::ReadAllBytes($idx)
  # Strip leading BOM if present
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $b = $b[3..($b.Length-1)] }
  [IO.File]::WriteAllBytes($idx, $b)
  $t = [IO.File]::ReadAllText($idx, [Text.Encoding]::UTF8)
  # Remove misplaced BOM string that appears as UTF-8 bytes after DOCTYPE
  $t = $t.Replace([string][char]0xFEFF, "")
  $t = $t.Replace("ï»¿", "")
  $t = $t.Replace("<!DOCTYPE html>ï»¿<html", "<!DOCTYPE html><html")
  $t = $t.Replace("<!DOCTYPE html>`u{FEFF}<html", "<!DOCTYPE html><html")
  [IO.File]::WriteAllText($idx, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "Index.html BOM cleaned and saved as UTF-8 without BOM" -ForegroundColor DarkGray
}

Write-Host "Build complete - MAX obfuscation + single-line HTML. Commit and push the root files to deploy." -ForegroundColor Green
