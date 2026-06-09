<#
.SYNOPSIS
  Pre-render every voiceover line the game speaks into self-hosted WAV clips,
  so the announcer sounds identical on every platform instead of using whatever
  Web Speech voice the OS happens to ship.

.DESCRIPTION
  Drives Windows SAPI (System.Speech) with SSML so we can pin one voice + a
  bright announcer pitch. The phrase list MIRRORS the say(...) call sites in
  play.js -- if you add/rename a spoken line there, update the tables below and
  re-run. Output: audio/vo/<slug>.wav + audio/vo/manifest.json (the list of
  slugs play.js will trust). Phrases not in the manifest fall back to live
  Web Speech in the browser.

  Slug algorithm MUST stay byte-identical to voSlug() in play.js:
    lowercase -> every run of non [a-z0-9] becomes "-" -> trim leading/trailing "-"

.PARAMETER VoiceName
  SAPI voice to render. Default "Microsoft Hazel Desktop" (en-GB female) -- the
  voice the browser picks on this machine. Run with -ListVoices to see options.

.PARAMETER WaveCap
  Highest wave number to pre-render ("Wave N ..." lines). Numbers above this cap
  fall back to Web Speech in-game. Each wave number = 20 clips, so keep modest.

.PARAMETER Pitch
  SSML relative pitch, e.g. "+20%". Approximates the in-game bright pitch (1.45).

.PARAMETER Rate
  SSML relative rate, e.g. "+0%". In-game rate is ~0.97 (near normal).

.EXAMPLE
  pwsh scripts/gen-voiceovers.ps1
.EXAMPLE
  pwsh scripts/gen-voiceovers.ps1 -ListVoices
.EXAMPLE
  pwsh scripts/gen-voiceovers.ps1 -VoiceName "Microsoft Susan" -WaveCap 30
#>
[CmdletBinding()]
param(
  [string]$VoiceName = "Microsoft Hazel Desktop",
  [int]$WaveCap = 25,
  [int]$NumberBank = 99,   # render numbers 0..N so play.js can stitch unbounded "Wave N" / "level N" lines
  # Base voice is intentionally mid-bright + slow; play.js's voice chain adds the warmth,
  # detuned digital double, reverb + tremolo that make it read "digital sultry".
  [string]$Pitch = "+8%",
  [string]$Rate  = "-20%",
  [switch]$ListVoices,
  [switch]$Force   # re-render even if the WAV already exists
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

if ($ListVoices) {
  (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() |
    ForEach-Object { $_.VoiceInfo } |
    Select-Object Name, Culture, Gender, Age | Format-Table -AutoSize
  return
}

# ---- output dir (repo-root/audio/vo) ----
$root   = Split-Path -Parent $PSScriptRoot   # scripts/ -> repo root
$outDir = Join-Path $root "audio/vo"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# ---- slug: keep identical to voSlug() in play.js ----
function Get-Slug([string]$text) {
  $s = $text.ToLowerInvariant()
  $s = [regex]::Replace($s, '[^a-z0-9]+', '-')
  $s = $s.Trim('-')
  return $s
}

# ---- phrase tables (mirror play.js) ----
$personas = @("Chasers","Ambushers","Erratics","Shy Ones","Scatterers","The Hive")  # PERSONA_NAME values
$weapons  = @("Dart","Spread","Rapid","Seeker","Ricochet","Missile","Wave")         # WEAPONS[k].name
$buffs    = @("Shield","Frenzy","Power","Bounce","Freeze","Heal","Level Up","Overdrive","Blade","Dual wield","Star bomb","Repel") # BUFF_NAME values
$levels   = @("Awakening","The Timid","Drift","The Ambush","Static","Hive mind","The Warden","Confluence")                         # L.say || L.name
$fixed    = @(
  "Bullet hell","Classic","Freedom","Caught",
  "Critical","Energy critical","Warning, low energy",                                   # low-life lines
  "Eliminated","Game over","Destroyed","Signal lost","System failure","Connection terminated", # death lines
  "Warning","Danger","Incoming","Threat detected","Alert","Hostile inbound"             # threat lines
)
$weaponMaxLvl = 10  # WEAPON_MAXLVL

# build the full ordered, de-duplicated phrase list
$phrases = [System.Collections.Generic.List[string]]::new()
$seen    = [System.Collections.Generic.HashSet[string]]::new()
function Add-Phrase([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return }
  if ($seen.Add($p)) { $phrases.Add($p) }
}

$fixed   | ForEach-Object { Add-Phrase $_ }
$buffs   | ForEach-Object { Add-Phrase $_ }
$weapons | ForEach-Object { Add-Phrase $_ }
$levels  | ForEach-Object { Add-Phrase $_ }

# "<weapon>, level <n>"  (play.js:809, 1432)
foreach ($w in $weapons) {
  for ($l = 1; $l -le $weaponMaxLvl; $l++) { Add-Phrase "$w, level $l" }
}

# wave announces (play.js:981-984)
for ($n = 1; $n -le $WaveCap; $n++) {
  Add-Phrase "Wave $n"                       # plain wave (no descriptor)
  Add-Phrase "Wave $n. Mixed"                # mixed wave
  Add-Phrase "Wave $n. Power cache"          # special wave
  foreach ($p in $personas) {
    Add-Phrase "Wave $n. $p"                 # themed wave
    Add-Phrase "Wave $n. BOSS, $p"           # boss wave
    Add-Phrase "Wave $n. SHOOTER BOSS, $p"   # shooter-boss wave
  }
}

# Clip bank for play.js's composer (composeClips/playSeq) — lets it stitch any numbered
# line beyond the whole-phrase clips above (waves > WaveCap, weapon level > 10, which is
# uncapped). "Wave" + weapon names already exist above; add the missing standalone parts.
0..$NumberBank | ForEach-Object { Add-Phrase "$_" }   # numbers, spoken as cardinals (12 -> "twelve")
Add-Phrase "level"
Add-Phrase "Mixed"
Add-Phrase "Power cache"
Add-Phrase "Boss"
Add-Phrase "Shooter boss"
$personas | ForEach-Object { Add-Phrase $_ }          # personas standalone (for the boss/themed tail)

# ---- synth setup ----
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $synth.SelectVoice($VoiceName) }
catch {
  Write-Warning "Voice '$VoiceName' not found; falling back to first en-GB female."
  $fallback = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } |
    Where-Object { $_.Culture.Name -eq "en-GB" -and $_.Gender -eq "Female" } |
    Select-Object -First 1
  if (-not $fallback) { throw "No en-GB female voice installed. Run -ListVoices." }
  $VoiceName = $fallback.Name
  $synth.SelectVoice($VoiceName)
}
Write-Host "Voice: $VoiceName  |  pitch $Pitch  rate $Rate  |  waves 1..$WaveCap" -ForegroundColor Cyan
Write-Host "Rendering $($phrases.Count) clips -> $outDir" -ForegroundColor Cyan

# 16 kHz / 16-bit / mono PCM -- plenty for speech, keeps the repo small
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, `
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, `
  [System.Speech.AudioFormat.AudioChannel]::Mono)

function Esc([string]$t) {
  $t.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;').Replace("'",'&apos;')
}

$manifest = [System.Collections.Generic.List[string]]::new()
$made = 0; $skipped = 0; $i = 0
foreach ($text in $phrases) {
  $i++
  $slug = Get-Slug $text
  $manifest.Add($slug)
  $path = Join-Path $outDir "$slug.wav"
  if ((Test-Path $path) -and -not $Force) { $skipped++; continue }

  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-GB'>" +
          "<prosody pitch='$Pitch' rate='$Rate'>$(Esc $text)</prosody></speak>"
  $synth.SetOutputToWaveFile($path, $fmt)
  $synth.SpeakSsml($ssml)
  $synth.SetOutputToNull()
  $made++
  if ($i % 50 -eq 0) { Write-Host ("  {0}/{1}" -f $i, $phrases.Count) }
}
$synth.Dispose()

# ---- manifest: sorted unique slug list play.js fetches once ----
$manifestPath = Join-Path $outDir "manifest.json"
($manifest | Sort-Object -Unique) | ConvertTo-Json -Compress | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host ""
Write-Host "Done. rendered=$made skipped=$skipped total=$($phrases.Count)" -ForegroundColor Green
Write-Host "Manifest: $manifestPath" -ForegroundColor Green
$bytes = (Get-ChildItem $outDir -Filter *.wav | Measure-Object Length -Sum).Sum
Write-Host ("Audio size: {0:N1} MB across {1} files" -f ($bytes/1MB), (Get-ChildItem $outDir -Filter *.wav).Count)
