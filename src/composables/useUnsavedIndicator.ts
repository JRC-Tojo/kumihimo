/**
 * 指定したファイルに未保存の変更があるかどうかをリアクティブに取得するcomposable
 */
import { onUnmounted, ref, watch, type Ref } from 'vue';
import type { ContainerElementFile } from 'src/models/container';
import { useBackendApi } from 'src/apis/backendApi';

export function useUnsavedIndicator(file: Ref<ContainerElementFile>) {
  const api = useBackendApi();
  const hasUnsavedChanges = ref(false);
  let unsubscribe: (() => void) | undefined;

  function subscribe() {
    unsubscribe?.();
    hasUnsavedChanges.value = false;

    const observed = api.observedHasUnsavedChangesByFile(file.value);
    if (!observed.ok) return;

    const subscription = observed.data.subscribe((value) => {
      hasUnsavedChanges.value = value;
    });
    unsubscribe = () => subscription.unsubscribe();
  }

  subscribe();
  watch(() => `${file.value.containerID}|${file.value.path}`, subscribe);
  onUnmounted(() => unsubscribe?.());

  return { hasUnsavedChanges };
}
