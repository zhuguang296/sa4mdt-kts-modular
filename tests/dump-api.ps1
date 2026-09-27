# Regenerate tests/_api/*.txt from a real Mindustry jar using javap.
#
# Why: the plugin builder emits Kotlin that calls Mindustry/Arc APIs. Guessing a
# signature (e.g. assuming Tile.x is Int when it is actually Short, or assuming
# Team.players exists when it does not) produces code that silently fails to
# compile in-game. tests/_verify-api.mjs greps these javap dumps to prove every
# call we emit really exists with the argument types we assume.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests/dump-api.ps1 [-Jar <path>]
#
# The jar is NOT committed: it is a third-party 23 MB server build. If it is
# missing the API test simply skips, so the normal build stays green.

param(
    [string]$Jar = ''
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here '_api'

# Locate a Mindustry server jar if one was not given explicitly.
if (-not $Jar) {
    $cands = @()
    $cands += Get-ChildItem -Path (Join-Path $env:USERPROFILE 'Downloads') -Filter '*.jar' -ErrorAction SilentlyContinue
    $cands += Get-ChildItem -Path (Join-Path $env:USERPROFILE 'Downloads') -Filter '*.jar' -Recurse -ErrorAction SilentlyContinue
    foreach ($c in $cands) {
        # The game jar is the big one; the ScriptAgent extension is ~650 KB.
        if ($c.Length -gt 5MB) { $Jar = $c.FullName; break }
    }
}

if (-not $Jar -or -not (Test-Path $Jar)) {
    Write-Host "no Mindustry jar found, skipping API dump."
    Write-Host "pass -Jar <path>, or drop a server jar into Downloads."
    exit 0
}

# Locate javap.
$javap = $null
$preferred = @(
    'C:\Program Files\Java\jdk-25.0.4.1\bin\javap.exe',
    'C:\Program Files\Java\latest\bin\javap.exe'
)
foreach ($c in $preferred) {
    if (Test-Path $c) { $javap = $c; break }
}
if (-not $javap) {
    $cmd = Get-Command javap -ErrorAction SilentlyContinue
    if ($cmd) { $javap = $cmd.Source }
}
if (-not $javap) {
    $found = Get-ChildItem 'C:\Program Files\Java' -Filter 'javap.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $javap = $found.FullName }
}
if (-not $javap) {
    Write-Host "no javap found, skipping API dump (needs a JDK, not a JRE)."
    exit 0
}

New-Item -ItemType Directory -Force -Path $out | Out-Null

# Every class the generator is allowed to reference, plus the interfaces it
# inherits members from (kill() lives on Healthc, tileX() on Posc, ...).
$classes = @(
    'mindustry.gen.Unit',
    'mindustry.gen.Player',
    'mindustry.gen.Building',
    'mindustry.gen.Call',
    'mindustry.gen.Groups',
    'mindustry.gen.Iconc',
    'mindustry.gen.Healthc',
    'mindustry.gen.Posc',
    'mindustry.gen.Syncc',
    'mindustry.gen.Unitc',
    'mindustry.gen.Teamc',
    'mindustry.world.Tile',
    'mindustry.world.Block',
    'mindustry.world.modules.ItemModule',
    'mindustry.world.blocks.storage.CoreBlock$CoreBuild',
    'mindustry.game.Team',
    'mindustry.game.Teams$TeamData',
    'mindustry.entities.Units',
    'mindustry.entities.EntityGroup',
    'mindustry.type.Item',
    'mindustry.type.UnitType',
    'arc.math.geom.Geometry',
    'arc.math.Mathf',
    'arc.util.Time',
    'arc.util.Interval',
    'arc.func.Boolf',
    'arc.func.Cons'
)

$n = 0
foreach ($c in $classes) {
    # javap writes the class dump to stdout; -cp points at the jar so it can
    # resolve supertypes. 2>&1 keeps the "class not found" text visible.
    $text = & $javap -cp $Jar $c 2>&1
    $text | Out-File -Encoding utf8 (Join-Path $out ($c + '.txt'))
    $n++
}

Write-Host "dumped $n class signatures -> $out"
Write-Host "jar: $Jar"
Write-Host "javap: $javap"
exit 0
