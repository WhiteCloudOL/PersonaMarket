[CmdletBinding()]
param([switch]$Check)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw '此脚本仅用于 Windows 的 NTFS 权限，Linux/macOS 使用文件属主与 0600/0700 权限'
}

$workspaceDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($identity, 'S-1-5-18', 'S-1-5-32-544')
$targets = @('.env', 'data') | ForEach-Object {
    $item = Get-Item -LiteralPath (Join-Path $workspaceDirectory $_) -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw '凭据和数据入口不能是链接，请先核对实际目录'
    }
    if (-not $item.FullName.StartsWith($workspaceDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw '凭据或数据目录越过仓库边界'
    }
    $item
}

foreach ($item in $targets) {
    if (-not $Check) {
        $rights = if ($item.PSIsContainer) { '(OI)(CI)F' } else { 'F' }
        $grants = $allowed | ForEach-Object { "*${_}:$rights" }
        & icacls.exe $item.FullName /inheritance:r /grant:r @grants /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { throw '无法设置本机私有权限，请检查目录属主与当前账号权限' }
    }
    $acl = Get-Acl -LiteralPath $item.FullName
    if (-not $acl.AreAccessRulesProtected) { throw "$($item.Name) 仍继承父目录权限" }
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin $allowed) {
            throw "$($item.Name) 包含额外允许项，请核对该目录的显式 ACL"
        }
    }
}
Write-Output 'Windows .env 与 data 入口权限通过，仅当前账号、SYSTEM 和本机管理员组可访问'
