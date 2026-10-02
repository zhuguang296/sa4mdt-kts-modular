# ============================================================
# One-shot build: run frontend regression tests, then compile the exe.
#
#   Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
#           powershell -File build.ps1 -SkipTests
#           powershell -File build.ps1 -Clean
#           powershell -File build.ps1 -Installer     (also build the NSIS setup)
#           powershell -File build.ps1 -Release       (release: implies
#                                                      -Installer, then archives
#                                                      into ktsbb\<version>\)
#
# NOTE: this file is intentionally ASCII-only. Windows PowerShell 5.1 reads
# .ps1 files as ANSI unless they carry a UTF-8 BOM, so non-ASCII text here
# turns into mojibake that can break parsing (unbalanced quotes). The UI and
# all documentation are still fully Chinese; only this build script is ASCII.
# ============================================================
param(
  [switch]$SkipTests,
  [switch]$Clean,
  [switch]$Installer,
  # -Release: publish-ready build. Implies -Installer and, on success, archives
  # the exe + installer + that version's .MD into ktsbb\<version>\.
  # Only use this when the user actually asked for a release.
  [switch]$Release
)

if ($Release) { $Installer = $true }

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    WARN $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "    FAIL $msg" -ForegroundColor Red; exit 1 }

# ---------- 1. Toolchain ----------
Step 1 "Checking build toolchain"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Die "cargo not found. Install Rust first: https://rustup.rs"
}
Ok "cargo $((cargo --version) -split ' ')[1]"

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Ok "node $(node --version)" }
else { Warn "node not found - frontend tests will be skipped" }

# link.exe must be on PATH or the Rust link step fails.
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
  Warn "link.exe not on PATH, trying to locate the MSVC linker..."
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $vcTools = & $vswhere -latest -products * `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      -property installationPath
    if ($vcTools) {
      $msvc = Get-ChildItem "$vcTools\VC\Tools\MSVC" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
      if ($msvc) {
        $bin = Join-Path $msvc.FullName 'bin\Hostx64\x64'
        if (Test-Path "$bin\link.exe") {
          $env:PATH = "$bin;$env:PATH"
          Ok "added linker to PATH: $bin"
        }
      }
    }
  }
  if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
    Die "link.exe still not found. Install Visual Studio Build Tools with the C++ workload, or run this script from an 'x64 Native Tools Command Prompt'."
  }
}

# ---------- 1b. Sync the version from its single source ----------
# VERSION at the repo root is the ONLY place the version number is written by
# hand. Everything else (Cargo.toml, tauri.conf.json, the exe's file properties,
# and the "About" page in settings) is derived from it. Without this step the
# number tends to drift: the exe says 1.0.0 while the UI says something else.
#
# Done in node, NOT PowerShell: tauri.conf.json contains Chinese, and
# Get-Content/Set-Content in PowerShell 5.1 decode UTF-8 as ANSI and write it
# back mangled. That exact round-trip has already corrupted a source file once.
if ($node) {
  Step 1b "Syncing version from VERSION"
  node tests/sync-version.mjs
  if ($LASTEXITCODE -ne 0) { Die "version sync failed" }
} else {
  Warn "node not found; skipping version sync"
}

# ---------- 2. Frontend regression tests ----------
if (-not $SkipTests -and $node) {
  Step 2 "Running frontend regression tests"

  # Syntax-check every script first. Without this, a typo in a test file only
  # shows up when that test runs - and live-ui.js only runs at step 6, after a
  # full 3-minute compile. Checking upfront makes the failure instant.
  $syntaxBad = 0
  $scripts = @()
  $scripts += Get-ChildItem (Join-Path $root 'src\frontend\js') -Recurse -Filter *.js -File
  $scripts += Get-ChildItem (Join-Path $root 'tests') -Filter *.js -File
  foreach ($s in $scripts) {
    & node --check $s.FullName 2>$null
    if ($LASTEXITCODE -ne 0) {
      Warn "syntax error: $($s.FullName)"
      $syntaxBad++
    }
  }
  if ($syntaxBad -gt 0) { Die "$syntaxBad script(s) have syntax errors" }
  Ok "$($scripts.Count) scripts parse cleanly"

  # Encoding health. A PowerShell Get-Content/Out-File round-trip decodes UTF-8 as
  # ANSI and writes it back mangled; the result is still valid JS, so neither
  # node --check nor any unit test notices - the Chinese comments and UI strings
  # just silently turn to garbage. This has actually happened once.
  node tests/encoding.js
  if ($LASTEXITCODE -ne 0) { Die "encoding check failed" }

  node tests/coverage.js
  if ($LASTEXITCODE -ne 0) { Die "catalog coverage test failed" }

  node tests/smoke.js
  if ($LASTEXITCODE -ne 0) { Die "smoke test failed" }

  node tests/ui-structure.js
  if ($LASTEXITCODE -ne 0) { Die "UI structure test failed" }

  # CSS variables: no self-references, every var used is defined, both themes
  # cover the same set, the [hidden] guard is in place, and no hard-coded
  # translucent white/black (that is how the dark-mode "invisible label" bug
  # got through - the old check only looked at hex literals, not rgba()).
  node tests/css-vars.js
  if ($LASTEXITCODE -ne 0) { Die "CSS variable check failed" }

  # Version and licence consistency: VERSION is the single source, the licence
  # shown in settings must be the same one in LICENSE.
  node tests/version-license.js
  if ($LASTEXITCODE -ne 0) { Die "version/licence check failed" }

  # The logging module is pure logic (no Tauri, no disk): exercise it directly
  # with a stub __TAURI__ so it runs in milliseconds. Catches things the
  # end-to-end log-file.js is too slow to iterate on - e.g. the breadcrumb
  # merge comparing "button: fit" against "button fit" (one string has a colon)
  # and so never matching, which quietly halved the useful crash-trail buffer.
  node tests/log-unit.js
  if ($LASTEXITCODE -ne 0) { Die "log unit test failed" }

  # Anchor format: the compact comment written into every exported .kts, plus
  # the control-code table that shrinks it. The table is append-only - if the
  # order ever changes, every previously exported file silently restores the
  # WRONG control, so this test failing means "append to codes.js", not "reorder".
  # It also pins the comment ratio at <=10%.
  node tests/anchor.js
  if ($LASTEXITCODE -ne 0) { Die "anchor format test failed" }

  node tests/run.js
  if ($LASTEXITCODE -ne 0) { Die "golden-file comparison failed" }

  # Cross-check every API call we emit against a real Mindustry jar.
  # Skips itself when tests/_api has not been generated (see tests/dump-api.ps1).
  node tests/verify-api.js
  if ($LASTEXITCODE -ne 0) { Die "API cross-check failed" }

  # The team-attribute dropdown must match Rules$TeamRule field-for-field.
  # A wrong field name or type only shows up as a Kotlin compile error in-game.
  node tests/team-fields.js
  if ($LASTEXITCODE -ne 0) { Die "team attribute field check failed" }

  Ok "all tests passed"
} else {
  Step 2 "Skipping tests"
}

# ---------- 3. Compile ----------
Step 3 "Compiling exe (offline; first build takes a few minutes)"

# Kill any leftover instance BEFORE building, not after.
#
# Both the target exe and the published root exe get launched by the live tests
# (`verify-embed.js` stats the target exe; live-ui/close-guard/log-file run the
# root one). If an earlier run left one alive, Windows holds the file locked and
# cargo fails with the very unhelpful:
#     error: failed to remove file `...\target\release\kts-builder.exe`
# Doing this after cargo is useless - the build has already failed by then.
# It also matters for the debugging ports used in step 6.
$stray = @(Get-Process -Name 'KTS-Plugin-Workshop', 'kts-builder' -ErrorAction SilentlyContinue)
if ($stray.Count -gt 0) {
  Warn "closing $($stray.Count) leftover instance(s) from an earlier run (they lock the build output)"
  $stray | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

Set-Location (Join-Path $root 'src\backend')

if ($Clean) { cargo clean; Ok "cleaned previous artifacts" }

cargo build --offline --release
if ($LASTEXITCODE -ne 0) { Die "cargo build failed" }

$exe = Join-Path $root 'src\backend\target\release\kts-builder.exe'
if (-not (Test-Path $exe)) { Die "artifact missing: $exe" }

$size = [math]::Round((Get-Item $exe).Length / 1MB, 2)
Set-Location $root
Ok "built: $exe ($size MB)"

# ---------- 4. Verify the frontend really is embedded ----------
Step 4 "Verifying embedded frontend assets"
if ($node) {
  node tests/verify-embed.js --profile release
  if ($LASTEXITCODE -ne 0) {
    Die "the exe's embedded frontend does not match src/frontend (probably built from stale code)"
  }
} else {
  Warn "skipped (node not available)"
}

# ---------- 5. Publish to the project root ----------
#
# The exe must sit at the project root, not in a subdirectory.
#
# If the user currently has the app open, the file is locked and a plain
# overwrite fails with "being used by another process". Windows does allow
# RENAMING a running exe, so in that case we move the old one aside (the running
# instance keeps working from the renamed file) and drop the new build in its
# place. The user just has to restart the app to pick up the new version.
Step 5 "Publishing to the project root"
$out = Join-Path $root 'KTS-Plugin-Workshop.exe'
if ($exe -ne $out) {
  try {
    Copy-Item $exe $out -Force -ErrorAction Stop
  } catch {
    Warn "the exe is in use (app is running) - moving it aside and retrying"
    $stale = Join-Path $root 'KTS-Plugin-Workshop.exe.old'
    try {
      if (Test-Path $stale) { Remove-Item $stale -Force -ErrorAction SilentlyContinue }
      Move-Item $out $stale -Force -ErrorAction Stop
      Copy-Item $exe $out -Force -ErrorAction Stop
      Ok "published; the previous build was moved to KTS-Plugin-Workshop.exe.old"
      Warn "restart the app to use the new build (the running copy is the old one)"
    } catch {
      Die "cannot replace the exe - please close the app and rebuild ($($_.Exception.Message))"
    }
  }
}

# Remove the old dist\ directory: the exe now lives at the root.
$dist = Join-Path $root 'dist'
if (Test-Path $dist) {
  Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
  Ok "removed the old dist\ directory"
}
Ok "KTS-Plugin-Workshop.exe (project root)"

# ---------- 6. Drive the real UI ----------
#
# Runs the freshly published exe and inspects its actual rendered DOM over the
# WebView2 DevTools protocol. This is the only way to verify the interface on
# this machine (no browser provider; screen capture grabs other windows).
# It uses a throwaway WebView2 profile, so the user's saved project is untouched.
if (-not $SkipTests -and $node) {
  Step 6 "Driving the real UI"

  # (Leftover instances were already cleaned up before the compile in step 3 -
  #  they lock the build output there. Nothing should be alive at this point.)

  node tests/live-ui.js
  if ($LASTEXITCODE -ne 0) { Die "live UI test failed" }

  # Window-close reminder, driven with a real WM_CLOSE (the same message the X
  # button sends). This is the only way to prove that prevent_close() is
  # actually followed up by confirm_close() - otherwise the window would be
  # impossible to close.
  node tests/close-guard.js
  if ($LASTEXITCODE -ne 0) { Die "close-guard test failed" }

  # Native dialogs must not freeze the main window. This guards a real incident:
  # the file-dialog commands used to be synchronous (run on Tauri's main thread,
  # which also pumps window messages) and internally did spawn(..).join(), so
  # opening a dialog hung the whole UI. The dialog owner was also taken from
  # GetForegroundWindow(), which returns whatever is foreground system-wide -
  # so the dialog could attach to another program's window and be invisible.
  # Uses SendMessageTimeout, the same mechanism Windows uses to decide that a
  # window is "not responding".
  node tests/dialog-freeze.js
  if ($LASTEXITCODE -ne 0) { Die "dialog-freeze test failed" }

  # The crash log is what the user sends back when something breaks. An IPC call
  # returning "ok" does not prove the file is useful, so this one actually makes
  # an error happen, then opens the log beside the exe and checks it contains a
  # timestamp, the version, and a real stack - and that a second error is
  # appended instead of overwriting the first.
  node tests/log-file.js
  if ($LASTEXITCODE -ne 0) { Die "log-file test failed" }

  Ok "live UI verified"
} else {
  Step 6 "Skipping live UI test"
}

# ---------- 7. NSIS installer (opt-in) ----------
#
# Kept behind -Installer because it needs cargo-tauri, which is not part of the
# Rust toolchain, and because the plain exe is what the day-to-day workflow
# uses. The NSIS toolchain lands in %LOCALAPPDATA%\tauri on first run; if the
# download stalls (TLS revocation checking failing, not the network), see the
# troubleshooting note in README.md.
if ($Installer) {
  Step 7 "Building NSIS installer"

  $cargoTauri = Join-Path $env:USERPROFILE '.cargo\bin\cargo-tauri.exe'
  $tauri = Get-Command cargo-tauri -ErrorAction SilentlyContinue
  if (-not $tauri -and (Test-Path $cargoTauri)) { $tauri = Get-Item $cargoTauri }

  if (-not $tauri) {
    Warn "cargo-tauri not found; skipping installer"
    Warn "install it with: cargo install tauri-cli"
  } else {
    Push-Location (Join-Path $root 'src\backend')
    try {
      & $tauri.Source bundle --bundles nsis
      if ($LASTEXITCODE -ne 0) { Die "installer build failed" }
    } finally {
      Pop-Location
    }

    $setup = Get-ChildItem (Join-Path $root 'src\backend\target\release\bundle\nsis') -Filter '*.exe' -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($setup) {
      $mb = [math]::Round($setup.Length / 1MB, 2)
      Ok "$($setup.Name)  ($mb MB)"
      if ($setup.Length -gt 100MB) { Warn "installer exceeds 100 MB" }
    } else {
      Warn "no installer produced"
    }
  }
}

# ---------- 8. Archive the release (-Release) ----------
#
# Layout the user asked for: every release lives under
#
#     F:\deepseek\mdt\ktsbb\<version>\
#         <version>.MD                          <- that version's notes
#         KTS-Plugin-Workshop.exe               <- portable build
#         KTS-Plugin-Workshop_<version>_x64-setup.exe   <- NSIS installer
#
# Old versions are never overwritten (the folder is per-version). The .MD is
# written by hand, so if it is missing we only warn - the binaries are still
# archived, and the notes can be dropped in afterwards.
if ($Release) {
  Step 8 "Archiving release to ktsbb"

  $version = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
  $bbRoot = Join-Path (Split-Path $root -Parent) 'ktsbb'
  $bbDir = Join-Path $bbRoot $version
  New-Item -ItemType Directory -Path $bbDir -Force | Out-Null

  Copy-Item (Join-Path $root 'KTS-Plugin-Workshop.exe') $bbDir -Force
  Ok "KTS-Plugin-Workshop.exe"

  $setup = Get-ChildItem (Join-Path $root 'src\backend\target\release\bundle\nsis') -Filter '*.exe' -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -like "*$version*" } |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($setup) {
    Copy-Item $setup.FullName $bbDir -Force
    Ok $setup.Name
  } else {
    Warn "no installer found for $version - run with -Installer"
  }

  $notes = Join-Path $bbDir "$version.MD"
  if (Test-Path $notes) {
    Ok "$version.MD"
  } else {
    Warn "$version.MD is missing from $bbDir"
    Warn "the notes file is written by hand; add it before handing this out"
  }

  Ok "release folder: $bbDir"
}

Write-Host "`nDone. Run KTS-Plugin-Workshop.exe to start." -ForegroundColor Green

# cargo writes progress to stderr; Windows PowerShell 5.1 records that as an
# error and would end this script non-zero even on success. Everything above
# completed, so exit cleanly.
exit 0
