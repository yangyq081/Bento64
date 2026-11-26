async (page) => {
  const checks = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const assert = (value, label) => {
    if (!value) throw new Error(label);
    checks.push(label);
  };
  await page.context().grantPermissions(['clipboard-write'], { origin: 'http://127.0.0.1:1420' });
  await page.goto('http://127.0.0.1:1420/');
  await page.setViewportSize({ width: 1120, height: 790 });
  const settleFeedback = () => page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.allSettled(finite.map((animation) => animation.finished));
  });
  await page.mouse.move(1095, 115);
  await settleFeedback();
  await page.screenshot({ path: 'output/design-morandi/interactive-empty.png', scale: 'css' });
  const privacyTitle = page.getByRole('heading', { name: '本地编码', exact: true });
  const privacyTooltip = page.getByRole('tooltip', { includeHidden: true });
  assert(!await privacyTooltip.isVisible(), 'Privacy text is hidden until the app title is hovered or focused');
  await privacyTitle.hover();
  await privacyTooltip.waitFor({ state: 'visible' });
  assert(await privacyTooltip.textContent() === '本机处理，不上传', 'Hovering the title reveals the local privacy tooltip');
  await page.mouse.move(1095, 115);
  await privacyTitle.focus();
  assert(await privacyTooltip.isVisible(), 'Keyboard focus also reveals the privacy tooltip');
  await privacyTitle.press('Escape');
  await privacyTooltip.waitFor({ state: 'hidden' });
  checks.push('Escape dismisses the privacy tooltip');
  const input = page.getByRole('textbox', { name: '输入内容', exact: true });
  const sample = '你好，世界！\nHello, Base64.';
  await input.fill(sample);
  assert(await page.locator('#count-value').textContent() === String(sample.length), 'Character count updates to the actual input length');
  assert(await page.locator('.input-shortcut').evaluate((element) => getComputedStyle(element).visibility === 'visible'), 'Input focus reveals the shortcut hint');
  await page.getByRole('button', { name: '编码为 Base64', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#output-state-light').classList.contains('success'));
  assert(await page.getByRole('button', { name: '结果移到输入', exact: true }).isEnabled(), 'Result-to-input becomes available after conversion');
  assert(await page.locator('#swap-button').evaluate((element) => element.classList.contains('swap-ready')), 'Ready result-to-input action receives its active emphasis');
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await page.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert(await page.locator('#copy-button svg').isVisible(), 'Copy success shows text and a checkmark');
  await settleFeedback();
  await page.screenshot({ path: 'output/design-morandi/interactive-copy.png', scale: 'css' });
  await page.getByRole('button', { name: '复制', exact: true }).waitFor({ timeout: 4000 });
  checks.push('Copy label returns after its 1.5-second feedback interval');

  const resizer = page.getByRole('separator', { name: '调整输入与结果区域宽度' });
  const box = await resizer.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const widths = await page.evaluate(() => ({
    input: document.querySelector('.input-pane').getBoundingClientRect().width,
    output: document.querySelector('.output-pane').getBoundingClientRect().width,
  }));
  assert(widths.input > widths.output + 100, 'Pointer dragging changes the real panel widths');
  assert(!await page.locator('#app').evaluate((element) => element.classList.contains('is-resizing')), 'Resizing ends cleanly after pointer release');
  await input.focus();
  await settleFeedback();
  await page.screenshot({ path: 'output/design-morandi/interactive-resize.png', scale: 'css' });
  await resizer.dblclick();
  assert(await resizer.getAttribute('aria-valuenow') === '50', 'Double-click resets equal panel widths');
  await resizer.press('ArrowLeft');
  assert(Number(await resizer.getAttribute('aria-valuenow')) < 50, 'Keyboard arrows can also adjust the separator');
  await resizer.press('Enter');

  const dragFile = async (phase) => page.evaluate(async (phase) => {
    const content = await fetch('/icon.svg').then((response) => response.text());
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], 'logo.svg', { type: 'image/svg+xml' }));
    window.dispatchEvent(new DragEvent(phase, { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, phase);
  await dragFile('dragenter');
  assert(await page.locator('#page-drop-notice').isVisible(), 'Dragging a file anywhere on the page shows its local-drop hint');
  await dragFile('drop');
  assert(await page.getByRole('tab', { name: '文件与图片' }).getAttribute('aria-selected') === 'true', 'Dropping an image from text mode selects the file workflow');
  assert(await page.locator('#file-title').textContent() === 'logo.svg', 'A page-level drop imports the file');
  assert(!await page.locator('#page-drop-notice').isVisible(), 'Drop glow and hint clear after release');
  await dragFile('dragenter');
  assert(await page.locator('#drop-zone').evaluate((element) => element.classList.contains('dragging')), 'File-mode drop target also receives the drag highlight');
  await settleFeedback();
  await page.screenshot({ path: 'output/design-morandi/interactive-drop-glow.png', scale: 'css' });
  await dragFile('drop');
  await page.getByRole('tab', { name: '文本转换' }).click();
  await input.fill('not-base64!');
  await page.getByRole('button', { name: '解码 Base64', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#output-state-light').classList.contains('error'));
  checks.push('Invalid conversion uses the red result-status indicator');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.base64BrandMotion.play());
  assert(!await page.evaluate(() => window.base64BrandMotion.running), 'Reduced-motion preference skips the startup animation');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('http://127.0.0.1:1420/');
  assert(errors.length === 0, 'New interactions produce no uncaught JavaScript errors');
  return { passed: checks.length, checks, errors };
}
