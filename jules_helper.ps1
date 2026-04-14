<#
.SYNOPSIS
    Professional Helper Script for Jules AI Agent (Windows).
    This script provides a clean interface for the localized Jules CLI.

.DESCRIPTION
    Bypasses restricted execution policies to call the local 'jules' package.
    Provides standard functions for session management.

.EXAMPLE
    ./jules_helper.ps1 -Login
    ./jules_helper.ps1 -ListSessions
#>

param (
    [Parameter(Mandatory=$false)][switch]$Login,
    [Parameter(Mandatory=$false)][switch]$Logout,
    [Parameter(Mandatory=$false)][switch]$ListSessions,
    [Parameter(Mandatory=$false)][switch]$ListRepos,
    [Parameter(Mandatory=$false)][string]$NewTask,
    [Parameter(Mandatory=$false)][string]$Pull,
    [Parameter(Mandatory=$false)][switch]$TUI,
    [Parameter(Mandatory=$false)][switch]$Help
)

# Function to run npx jules with bypass
function Run-Jules {
    param([string]$Arguments)
    $cmd = "npx jules $Arguments"
    Write-Host "Executing: $cmd" -ForegroundColor Cyan
    powershell -ExecutionPolicy Bypass -Command $cmd
}

# Main Logic
if ($Help) {
    Write-Host "Jules Assistant CLI Helper" -ForegroundColor Green
    Write-Host "---------------------------"
    Write-Host "-Login          : Authenticate with Google"
    Write-Host "-Logout         : Sign out"
    Write-Host "-ListSessions   : Show all active/past sessions"
    Write-Host "-ListRepos      : Show connected repositories"
    Write-Host "-NewTask 'msg'  : Start a new session in current dir"
    Write-Host "-Pull 'id'      : Download results from a session"
    Write-Host "-TUI            : Launch the Interactive Dashboard"
    exit
}

if ($Login) { Run-Jules "login" }
elseif ($Logout) { Run-Jules "logout" }
elseif ($ListSessions) { Run-Jules "remote list --session" }
elseif ($ListRepos) { Run-Jules "remote list --repo" }
elseif ($NewTask) { Run-Jules "remote new --repo . --session ""$NewTask""" }
elseif ($Pull) { Run-Jules "remote pull --session $Pull" }
elseif ($TUI) { Run-Jules "" }
else { 
    Write-Host "No command specified. Use -Help for options or -TUI for the dashboard." -ForegroundColor Yellow
}
