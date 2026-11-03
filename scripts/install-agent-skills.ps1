$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '请先安装 Node.js 26 LTS。'
}
& node (Join-Path $PSScriptRoot 'install-agent-skills.mjs')
if ($LASTEXITCODE -ne 0) {
    throw '项目级 Skill 安装或校验失败，请查看上方错误。'
}
