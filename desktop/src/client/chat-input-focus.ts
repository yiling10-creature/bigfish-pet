/** Activate native input only after the editable element has its final layout. */
export async function focusChatInput(input: HTMLTextAreaElement, activate: () => Promise<boolean>, current: () => boolean): Promise<boolean> {
  const view = input.ownerDocument.defaultView;
  if (!view) return false;
  const paint = () => new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()));
  const valid = () => current() && input.isConnected && !input.readOnly;
  await paint();
  if (!valid()) return false;
  input.getBoundingClientRect();
  if (!await activate()) throw new Error('键盘输入暂时无法启用，请重试。');
  await paint();
  if (!valid()) return false;
  input.focus({ preventScroll: true });
  const end = input.value.length;
  input.setSelectionRange(end, end);
  return input.ownerDocument.activeElement === input;
}
