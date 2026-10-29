import fs from 'node:fs/promises';

// Capture the actual Electron compositor output. Chromium's CDP screenshot
// occasionally stalls on an idle desktop surface after hiding the 3D iframe.
// This changes only how evidence is captured, never the UI or test assertions.
export async function captureElectron(app, file) {
  let timer;
  try {
    const result = await Promise.race([
      app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed());
        if (!window) throw new Error('没有可截图的桌面窗口');
        const frame = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        if (frame.isEmpty()) throw new Error('桌面截图为空');
        return { png: frame.toPNG().toString('base64'), size: frame.getSize() };
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('桌面原生截图超过 20 秒')), 20000); }),
    ]);
    if (result.size.width < 100 || result.size.height < 100) throw new Error('桌面截图尺寸异常');
    await fs.writeFile(file, Buffer.from(result.png, 'base64'));
    return result.size;
  } finally { clearTimeout(timer); }
}
