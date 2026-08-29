# Kramm Bybit Monitor - local hourly runner.
#
# Registered in Windows Task Scheduler (task "KrammBybitMonitor", hourly at :05).
# Steps: git pull -> python scripts/evaluate.py -> send alert emails via Gmail
# SMTP (only if env var KRAMM_GMAIL_APP_PW is set) -> commit + push docs/.
#
# The cloud routine can't do this: Anthropic's cloud egress IPs are geo-blocked
# by both Binance and Bybit. This machine (Uruguay) reaches them fine.

$repo     = "C:\Users\Max\Desktop\PROJECTS\kramm_binan_op"
$python   = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
$git      = "C:\Program Files\Git\cmd\git.exe"
$logFile  = Join-Path $repo "run.log"
$mailAddr = "maxizeil1996@gmail.com"

function Log($msg) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Output $line
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $GitArgs)
    # Coerce every line (git writes progress/info to stderr) to a plain string so
    # PowerShell doesn't render stderr as noisy NativeCommandError records.
    $out = & $git @GitArgs 2>&1 | ForEach-Object { "$_" } | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out.Trim() }
}

# Trim the log if it gets large.
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) {
    (Get-Content $logFile -Tail 500) | Set-Content $logFile -Encoding utf8
}

try {
    Set-Location $repo

    # Sync dashboard data with remote; non-fatal on failure.
    $pull = Invoke-Git pull --ff-only
    Log "git pull (exit $($pull.Code)): $($pull.Out)"

    # 1. Run the evaluator.
    $evalOut  = & $python (Join-Path $repo "scripts\evaluate.py") 2>&1 | Out-String
    $evalExit = $LASTEXITCODE
    Log "evaluate.py (exit $evalExit): $($evalOut.Trim())"
    if ($evalExit -ne 0) { Log "ABORT: evaluator failed - no email, no commit."; exit 1 }

    # 2. Send any pending alert emails.
    $pendPath = Join-Path $repo "docs\data\pending_emails.json"
    $pendRaw  = (Get-Content $pendPath -Raw).Trim()
    $pending  = if ($pendRaw -and $pendRaw -ne "[]") { @($pendRaw | ConvertFrom-Json) } else { @() }
    if ($pending.Count -gt 0) {
        $appPw = [Environment]::GetEnvironmentVariable("KRAMM_GMAIL_APP_PW", "User")
        if ([string]::IsNullOrWhiteSpace($appPw)) {
            $appPw = $env:KRAMM_GMAIL_APP_PW
        }
        if ([string]::IsNullOrWhiteSpace($appPw)) {
            Log "WARN: $($pending.Count) pending email(s) but KRAMM_GMAIL_APP_PW is not set - skipping send, clearing queue."
        } else {
            $sec  = ConvertTo-SecureString $appPw -AsPlainText -Force
            $cred = New-Object System.Management.Automation.PSCredential($mailAddr, $sec)
            foreach ($m in $pending) {
                Send-MailMessage -SmtpServer "smtp.gmail.com" -Port 587 -UseSsl `
                    -Credential $cred -From $mailAddr -To $mailAddr `
                    -Subject $m.subject -Body $m.body -Encoding UTF8
                Log "email sent: $($m.subject)"
            }
        }
        Set-Content -Path $pendPath -Value "[]" -NoNewline -Encoding utf8
    }

    # 3. Commit + push dashboard data if it changed.
    $status = Invoke-Git status --porcelain docs
    if ($status.Out) {
        Invoke-Git add docs | Out-Null
        $stamp  = "hourly: {0:yyyy-MM-ddTHH:mm:ssZ}" -f (Get-Date).ToUniversalTime()
        $commit = Invoke-Git -c user.name=Max -c "user.email=$mailAddr" commit -m $stamp
        Log "git commit (exit $($commit.Code)): $($commit.Out)"
        $push = Invoke-Git push origin main
        Log "git push (exit $($push.Code)): $($push.Out)"
        if ($push.Code -ne 0) { exit 1 }
    } else {
        Log "no docs changes to commit"
    }

    Log "run OK"
}
catch {
    Log "ERROR: $($_.Exception.Message)"
    exit 1
}
