async (page) => {
  const checks = [];
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:1420/')) {
      externalRequests.push(request.url());
    }
  });
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const input = page.getByRole('textbox', { name: '输入内容', exact: true });
  const output = page.getByRole('textbox', { name: '转换结果', exact: true });
  const encode = page.getByRole('button', { name: '编码为 Base64', exact: true });
  const decode = page.getByRole('button', { name: '解码 Base64', exact: true });
  const waitDone = () => page.waitForFunction(() =>
    /完成|无效|无法表示|不正确/.test(document.querySelector('#status-message').textContent)
    && !document.querySelector('#encode-button').disabled);

  await page.getByRole('tab', { name: '文本转换' }).click();
  await input.fill('你好，世界！\nHello, Base64.');
  await encode.click(); await waitDone();
  await page.getByRole('button', { name: '结果移到输入' }).click();
  await decode.click(); await waitDone();
  assert(await output.inputValue() === '你好，世界！\nHello, Base64.', 'GUI UTF-8 round trip preserves line breaks');

  await page.getByRole('combobox', { name: '字符集', exact: true }).selectOption('gbk');
  await input.fill('你好'); await encode.click(); await waitDone();
  assert(await output.inputValue() === 'xOO6ww==', 'GUI GBK matches known GB2312 output');
  await input.fill('你好😀'); await encode.click(); await waitDone();
  assert((await page.getByRole('status').textContent()).includes('无法表示'), 'GUI rejects unsupported GBK characters');
  assert(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), 'GUI clears stale result after error');

  await page.getByRole('combobox', { name: '字符集', exact: true }).selectOption('utf-8');
  await input.fill(' \n'); await encode.click(); await waitDone();
  assert(await output.inputValue() === 'IAo=', 'GUI encodes whitespace-only text without dropping it');
  await input.fill('not-base64!'); await decode.click(); await waitDone();
  assert((await page.getByRole('status').textContent()).includes('无效'), 'GUI explains invalid Base64');
  await page.getByRole('checkbox', { name: '十六进制输入 / 输出' }).check();
  await input.fill('E4 BD A0 E5 A5 BD'); await encode.click(); await waitDone();
  assert(await output.inputValue() === '5L2g5aW9', 'GUI hexadecimal encoding');
  await page.getByRole('checkbox', { name: '十六进制输入 / 输出' }).uncheck();

  await page.getByRole('tab', { name: '文件与图片' }).click();
  await page.locator('#file-picker').setInputFiles('src-tauri/icons/128x128.png');
  await encode.click(); await waitDone();
  const encodedFile = await output.inputValue();
  assert(encodedFile.startsWith('data:image/png;base64,'), 'GUI file encoding creates a Data URI');
  await page.getByRole('combobox', { name: 'Base64 格式', exact: true }).selectOption('url');
  assert(!await page.getByRole('checkbox', { name: '包含 Data URI 前缀' }).isChecked(), 'GUI switches off Data URI for Base64URL');
  await encode.click(); await waitDone();
  assert(/^[A-Za-z0-9_-]+=*$/.test(await output.inputValue()), 'GUI encodes files as plain Base64URL');
  await page.getByRole('checkbox', { name: '包含 Data URI 前缀' }).check();
  await encode.click(); await waitDone();
  assert(await output.inputValue() === encodedFile, 'GUI Data URI uses standard alphabet and padding');
  const encodedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await (await encodedDownload).saveAs('output/playwright/encoded-image.base64');
  checks.push('GUI saves encoded file');

  await page.context().setOffline(true);
  await page.getByRole('button', { name: '移除文件', exact: true }).click();
  await input.fill(encodedFile); await decode.click(); await waitDone();
  await page.getByRole('img', { name: '解码图片预览' }).waitFor({ state: 'visible' });
  assert(await page.getByRole('img', { name: '解码图片预览' }).evaluate((image) => image.complete && image.naturalWidth === 128), 'GUI previews decoded image while offline');
  const binaryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  await (await binaryDownload).saveAs('output/playwright/decoded-roundtrip.png');
  checks.push('GUI saves decoded binary while offline');
  await page.screenshot({ path: 'output/playwright/file-offline.png', scale: 'css' });

  await page.getByRole('tab', { name: '文本转换' }).click();
  await input.fill('断网也可以转换');
  await page.keyboard.press('Meta+Enter'); await waitDone();
  await page.getByRole('button', { name: '结果移到输入' }).click();
  await decode.click(); await waitDone();
  assert(await output.inputValue() === '断网也可以转换', 'GUI keyboard conversion and decoding work offline');
  await page.getByRole('button', { name: '使用帮助' }).click();
  assert(await page.getByRole('dialog').isVisible(), 'GUI help opens offline');
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'GUI fits a narrow viewport without horizontal overflow');
  await page.screenshot({ path: 'output/playwright/narrow.png', fullPage: true, scale: 'css' });
  await page.setViewportSize({ width: 1120, height: 790 });
  await page.context().setOffline(false);
  assert(errors.length === 0, 'GUI has no uncaught JavaScript errors');
  assert(externalRequests.length === 0, 'GUI makes no external HTTP requests during conversion');
  return { passed: checks.length, checks, errors, externalRequests };
}
