param(
    [Parameter(Mandatory = $true)][string]$ArtifactDirectory
)

$ErrorActionPreference = 'Stop'
$artifact = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $artifact 'build-manifest.json') -Raw | ConvertFrom-Json
$installer = Join-Path $artifact $manifest.installer.name
$installDir = Join-Path $env:RUNNER_TEMP ('Bento64-install-' + [guid]::NewGuid().ToString('N'))
$logPath = Join-Path $artifact 'windows-install.log'
$reportPath = Join-Path $artifact 'windows-install-check.json'
$app = $null
$failure = $null
$report = [ordered]@{
    passed = $false
    version = $manifest.version
    install_directory = $installDir
    environment = [Environment]::OSVersion.VersionString
    installer_exit_code = $null
    installed_program_verified = $false
    startup_survived_8_seconds = $false
    main_window_observed = $false
    uninstall_verified = $false
    limitation = 'GitHub Windows runner smoke test; not a Windows 10 standard-user GUI or offline-first-install certification.'
}

function Write-CheckLog([string]$Message) {
    $line = '[' + [DateTime]::UtcNow.ToString('o') + '] ' + $Message
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
}

function Wait-OwnProcess($Process, [int]$Seconds, [string]$Description) {
    $null = $Process.Handle
    if (-not $Process.WaitForExit($Seconds * 1000)) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        throw "$Description timed out after $Seconds seconds"
    }
    $Process.Refresh()
    return $Process.ExitCode
}

try {
    if (Test-Path -LiteralPath $installDir) { throw 'Refusing to reuse an existing installation directory' }
    Write-CheckLog "Installing into a new writable directory: $installDir"
    # NSIS requires /D= to be the final argument. The isolated runner path has no spaces.
    if ($installDir.Contains(' ')) { throw 'The smoke-test directory must not contain spaces' }
    $install = Start-Process -FilePath $installer -ArgumentList "/S /D=$installDir" -PassThru
    $exitCode = Wait-OwnProcess $install 360 'Installer'
    $report.installer_exit_code = $exitCode
    Write-CheckLog "Installer exit code: $exitCode"
    if ($exitCode -notin @(0, 3010)) { throw "Installer failed with exit code $exitCode" }
    $program = Join-Path $installDir ([string]$manifest.binary_name + '.exe')
    $uninstaller = Join-Path $installDir 'uninstall.exe'
    foreach ($path in @($program, $uninstaller, (Join-Path $installDir 'THIRD_PARTY_NOTICES.txt'))) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Expected installed file is missing: $path" }
    }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($program)
    if ($version.ProductName -ne 'Bento64') { throw 'Installed product name is incorrect' }
    if (-not $version.ProductVersion.StartsWith([string]$manifest.version)) { throw 'Installed version is incorrect' }
    $report.installed_program_verified = $true
    Write-CheckLog 'Launching the installed application.'
    $app = Start-Process -FilePath $program -PassThru
    if ($app.WaitForExit(8000)) { throw "Installed application exited early: $($app.ExitCode)" }
    $app.Refresh()
    $report.startup_survived_8_seconds = $true
    $report.main_window_observed = ($app.MainWindowHandle -ne [IntPtr]::Zero)
    Write-CheckLog "Application stayed running; main window observed: $($report.main_window_observed)"
    Stop-Process -Id $app.Id -Force
    $app.WaitForExit(10000) | Out-Null
    $app = $null
    Write-CheckLog 'Running the uninstaller.'
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru
    $uninstallCode = Wait-OwnProcess $uninstall 90 'Uninstaller'
    Write-CheckLog "Uninstaller launcher exit code: $uninstallCode"
    if ($uninstallCode -notin @(0, 3010)) { throw "Uninstaller failed with exit code $uninstallCode" }
    # NSIS may hand off to a temporary copy of the uninstaller.
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ((Test-Path -LiteralPath $program) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 300
    }
    if (Test-Path -LiteralPath $program) { throw 'Uninstallation left the application executable behind' }
    if (Test-Path -LiteralPath (Join-Path $installDir 'THIRD_PARTY_NOTICES.txt')) { throw 'Uninstallation left the installed resource behind' }
    $report.uninstall_verified = $true
    $report.passed = $true
    Write-CheckLog 'Windows install/startup/uninstall smoke test passed.'
}
catch {
    $failure = $_
    $report.error = $_.Exception.Message
    Write-CheckLog ("FAILED: " + $_.Exception.Message)
}
finally {
    if ($null -ne $app -and -not $app.HasExited) {
        Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
}
if ($null -ne $failure) { throw $failure }
