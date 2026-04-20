$ErrorActionPreference = "Stop"
$Port = if ($env:PORT) { [int]$env:PORT } else { 8787 }
$Public = Join-Path $PSScriptRoot "public"
$Upstream = "https://linxicon.com"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try {
  $listener.Prefixes.Add("http://localhost:$Port/")
} catch {
  Write-Warning "Could not add http://localhost:$Port/ (try: netsh http add urlacl url=http://localhost:$Port/ user=Everyone). Using 127.0.0.1 only."
}
$listener.Start()
Write-Host "Linxicon solver: http://127.0.0.1:$Port/ or http://localhost:$Port/  (Ctrl+C to stop)"

function Send-Text([System.Net.HttpListenerResponse]$res, [int]$code, [string]$body, [string]$ctype) {
  $res.StatusCode = $code
  $res.ContentType = $ctype
  $res.AddHeader("Access-Control-Allow-Origin", "*")
  $buf = [System.Text.Encoding]::UTF8.GetBytes($body)
  $res.ContentLength64 = $buf.Length
  $res.OutputStream.Write($buf, 0, $buf.Length)
  $res.Close()
}

function Send-Bytes([System.Net.HttpListenerResponse]$res, [int]$code, [byte[]]$buf, [string]$ctype) {
  $res.StatusCode = $code
  $res.ContentType = $ctype
  $res.AddHeader("Access-Control-Allow-Origin", "*")
  $res.ContentLength64 = $buf.Length
  $res.OutputStream.Write($buf, 0, $buf.Length)
  $res.Close()
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $path = $req.Url.AbsolutePath

    if ($path.StartsWith("/api/dictionary") -and $req.HttpMethod -eq "GET") {
      $target = "$Upstream$path$($req.Url.Query)"
      $r = Invoke-WebRequest -Uri $target -Method GET -UseBasicParsing -UserAgent "linxicon-solver-proxy/1"
      $ct = $r.Headers["Content-Type"]; if (-not $ct) { $ct = "text/plain" }
      Send-Text $res $r.StatusCode $r.Content $ct
      continue
    }

    if ($path -eq "/api/updateSemantics" -and $req.HttpMethod -eq "POST") {
      $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
      $body = $reader.ReadToEnd()
      $reader.Close()
      $target = "$Upstream/api/updateSemantics"
      $r = Invoke-WebRequest -Uri $target -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -UserAgent "linxicon-solver-proxy/1"
      $ct = $r.Headers["Content-Type"]; if (-not $ct) { $ct = "application/json" }
      Send-Text $res $r.StatusCode $r.Content $ct
      continue
    }

    if ($req.HttpMethod -ne "GET" -and $req.HttpMethod -ne "HEAD") {
      Send-Text $res 405 "Method not allowed" "text/plain"
      continue
    }

    $rel = if ($path -eq "/" -or $path -eq "") { "index.html" } else { $path.TrimStart("/") }
    $rel = $rel -replace "/", [IO.Path]::DirectorySeparatorChar
    $full = [IO.Path]::GetFullPath((Join-Path $Public $rel))
    $rootFull = [IO.Path]::GetFullPath($Public)
    if (-not $full.StartsWith($rootFull)) {
      Send-Text $res 403 "Forbidden" "text/plain"
      continue
    }

    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      Send-Text $res 404 "Not found" "text/plain"
      continue
    }

    $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
    $mime = switch ($ext) {
      ".html" { "text/html; charset=utf-8" }
      ".js" { "text/javascript; charset=utf-8" }
      ".json" { "application/json; charset=utf-8" }
      ".css" { "text/css; charset=utf-8" }
      ".svg" { "image/svg+xml" }
      default { "application/octet-stream" }
    }
    $bytes = [IO.File]::ReadAllBytes($full)
    if ($req.HttpMethod -eq "HEAD") {
      $res.StatusCode = 200
      $res.ContentType = $mime
      $res.AddHeader("Access-Control-Allow-Origin", "*")
      $res.ContentLength64 = $bytes.Length
      $res.Close()
    } else {
      Send-Bytes $res 200 $bytes $mime
    }
  } catch {
    try {
      Send-Text $res 500 ($_.Exception.Message) "text/plain"
    } catch { }
  }
}
