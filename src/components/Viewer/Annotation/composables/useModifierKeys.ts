/**
 * Shift/Ctrlキーの押下状態を共有するコンポーザブル
 *
 * Konvaの`dragBoundFunc`はドラッグ中に連続実行されるが、ネイティブのマウス/キーボード
 * イベントを直接受け取れないため、window全体のkeydown/keyupを1度だけ購読して
 * モジュールレベルのRefで押下状態を保持し、いつでも現在値を読めるようにする。
 */

import { ref } from 'vue';

const shiftKey = ref(false);
const ctrlKey = ref(false);

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Shift') shiftKey.value = true;
  if (e.key === 'Control') ctrlKey.value = true;
}

function handleKeyUp(e: KeyboardEvent) {
  if (e.key === 'Shift') shiftKey.value = false;
  if (e.key === 'Control') ctrlKey.value = false;
}

function handleBlur() {
  // ウィンドウがフォーカスを失った際、キーを離したイベントを取得できずに
  // 押下状態が残り続けてしまう（stuck key）のを防ぐ
  shiftKey.value = false;
  ctrlKey.value = false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);
}

export function useModifierKeys() {
  return { shiftKey, ctrlKey };
}
