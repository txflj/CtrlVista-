# 控小助 · 收敛环

本组资源来自用户指定的 `output/design/logo-welcome-01/` 设计交付，由“logo设计”会话为控小助设计。3.0.0 按用户要求采用该方案。

- `mark.svg`：原交付矢量稿，保持反馈回环、阻尼波形、蓝色端点和配色不变。
- `icon-512.png`：原交付的 512 × 512 PNG，透明边角。
- `app.ico`：从该 PNG 生成的 Windows 多尺寸容器，包含 16、20、24、32、40、48、64、128、256 像素。没有重新生成或改变标志造型。

更新 ICO：`python scripts/build-brand-icons.py`（仅开发时需要 Pillow）。正式运行和打包均不需要 Python。

Windows 打包时，`scripts/windows-icon.ps1` 使用系统资源 API 将同一 ICO 写入新 EXE 并逐尺寸核对嵌入字节；原 Electron 运行库不修改。安装器、窗口和桌面快捷方式使用同一图标。已完成验证的历史发行目录禁止再次改写图标。
