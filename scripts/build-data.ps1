$ErrorActionPreference = "Stop"
$proj = Split-Path $PSScriptRoot -Parent
$root = Join-Path $proj "public\data"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$home = curl.exe -sL "https://linxicon.com/game/797" -A "Mozilla/5.0"
if ($home -notmatch '/_frsh/js/([^/]+)/island-guesser\.js') { throw "Could not find island-guesser.js path" }
$hash = $Matches[1]
$path = "https://linxicon.com/_frsh/js/$hash/island-guesser.js"
$tmp = Join-Path $root "_guesser.js"
curl.exe -sL $path -A "Mozilla/5.0" -o $tmp
$g = Get-Content $tmp -Raw
if ($g -notmatch 'var L=(\[[\s\S]*?\]);var K=') { throw "Could not parse word list L" }
$words = $Matches[1] | ConvertFrom-Json
$norm = @($words | ForEach-Object { $_.Trim().ToLower() } | Sort-Object -Unique)
$mK = [regex]::Match($g, 'var K=new Set\((\[[\s\S]*?\])\),Q=')
$mQ = [regex]::Match($g, ',Q=(\[[\s\S]*?\]);function V')
$exact = @($mK.Groups[1].Value | ConvertFrom-Json | ForEach-Object { $_.ToLower() })
$substr = @($mQ.Groups[1].Value | ConvertFrom-Json | ForEach-Object { $_.ToLower() })
@{ meta = @{ source = $path; extractedAt = (Get-Date).ToString("o"); wordCount = $norm.Count }; words = $norm } |
  ConvertTo-Json -Depth 5 -Compress |
  Set-Content -Encoding utf8 (Join-Path $root "linxicon-words.json")
@{ meta = @{ source = $path }; exact = $exact; substring = $substr } |
  ConvertTo-Json -Depth 5 -Compress |
  Set-Content -Encoding utf8 (Join-Path $root "linxicon-blocklist.json")
Remove-Item $tmp -Force
Write-Host "Wrote $($norm.Count) words to public/data/linxicon-words.json"
