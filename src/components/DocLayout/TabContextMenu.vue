<template>
  <q-list dense style="min-width: 220px">
    <q-item v-close-popup clickable @click="onTogglePin" @mouseenter="closeDuplicateSubmenu">
      <q-item-section>{{
        pinned ? $t('pdfEditor.tabs.unpin') : $t('pdfEditor.tabs.pin')
      }}</q-item-section>
    </q-item>
    <q-item
      clickable
      @click="duplicateSubmenuOpen = true"
      @mouseenter="scheduleOpenDuplicateSubmenu"
      @mouseleave="cancelScheduledOpen"
    >
      <q-item-section>{{ $t('pdfEditor.tabs.duplicateTo') }}</q-item-section>
      <q-item-section side>
        <q-icon name="keyboard_arrow_right" />
      </q-item-section>
      <q-menu
        :model-value="duplicateSubmenuOpen"
        anchor="top end"
        self="top start"
        @update:model-value="(v: boolean) => (duplicateSubmenuOpen = v)"
      >
        <q-list dense style="min-width: 150px">
          <q-item
            v-for="side in otherVisibleSides"
            :key="side"
            v-close-popup
            clickable
            @click="onDuplicateTo(side)"
          >
            <q-item-section>{{ paneLabel(side) }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </q-item>
    <q-separator />
    <q-item v-close-popup clickable @click="onCopyRelativePath" @mouseenter="closeDuplicateSubmenu">
      <q-item-section>{{ $t('explorer.copyRelativePath') }}</q-item-section>
    </q-item>
    <q-item v-close-popup clickable @click="onCopyAbsolutePath" @mouseenter="closeDuplicateSubmenu">
      <q-item-section>{{ $t('explorer.copyAbsolutePath') }}</q-item-section>
    </q-item>
    <q-separator />
    <q-item
      v-close-popup
      clickable
      @click="emit('showRelationalSummary')"
      @mouseenter="closeDuplicateSubmenu"
    >
      <q-item-section>{{ $t('pdfEditor.tabs.showRelationalSummary') }}</q-item-section>
    </q-item>
    <q-separator />
    <q-item v-close-popup clickable @click="onCloseOthers" @mouseenter="closeDuplicateSubmenu">
      <q-item-section>{{ $t('pdfEditor.tabs.closeOthers') }}</q-item-section>
    </q-item>
    <q-item v-close-popup clickable @click="onCloseToRight" @mouseenter="closeDuplicateSubmenu">
      <q-item-section>{{ $t('pdfEditor.tabs.closeToRight') }}</q-item-section>
    </q-item>
    <q-item v-close-popup clickable @click="onCloseSaved" @mouseenter="closeDuplicateSubmenu">
      <q-item-section>{{ $t('pdfEditor.tabs.closeSaved') }}</q-item-section>
    </q-item>
    <q-item
      v-close-popup
      clickable
      class="text-negative"
      @click="emit('close')"
      @mouseenter="closeDuplicateSubmenu"
    >
      <q-item-section>{{ $t('pdfEditor.tabs.close') }}</q-item-section>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useQuasar } from 'quasar';
import type { ContainerElementFile } from 'src/models/container';
import { useEditorStore, type LayoutSide } from 'src/stores/editorStore';
import { useBackendApi } from 'src/apis/backendApi';
import { Path } from 'src/utils/binary/path';
import { useTabCloseActions } from './composables/useTabCloseActions';

interface Prop {
  file: ContainerElementFile;
  layoutSide: LayoutSide;
}
const prop = defineProps<Prop>();
const emit = defineEmits<{ close: []; showRelationalSummary: [] }>();

const { t: $t } = useI18n();
const $q = useQuasar();
const api = useBackendApi();
const editorStore = useEditorStore();
const { closeOtherTabs, closeTabsToRight, closeSavedTabs } = useTabCloseActions();

const pinned = computed(() => editorStore.isTabPinned(prop.file, prop.layoutSide));

const SIDES_BY_TILE_MODE: Record<string, LayoutSide[]> = {
  single: ['ul'],
  dubble: ['ul', 'ur'],
  grid: ['ul', 'ur', 'll', 'lr'],
};
const PANE_LABEL_KEYS: Record<LayoutSide, string> = {
  ul: 'pdfEditor.tabs.paneNames.ul',
  ur: 'pdfEditor.tabs.paneNames.ur',
  ll: 'pdfEditor.tabs.paneNames.ll',
  lr: 'pdfEditor.tabs.paneNames.lr',
};

/** 現在のタイルモードで実際に表示されている、自身以外のペイン一覧 */
const otherVisibleSides = computed<LayoutSide[]>(() =>
  (SIDES_BY_TILE_MODE[editorStore.tileMode] ?? ['ul']).filter((side) => side !== prop.layoutSide),
);

function paneLabel(side: LayoutSide): string {
  return $t(PANE_LABEL_KEYS[side]);
}

// 「別のペインに複製」のサブメニュー。AnnotationContextMenu.vueと同じパターンで、単純に
// <q-menu>を親項目の子として置くだけではクリック・ホバーいずれでも開かないため、
// 開閉状態を明示的に持ち`model-value`で制御する。素早く通り過ぎただけで開いてしまわない
// よう、ホバーはやや長めの遅延を経てから開く（クリックは即座に開く）
const DUPLICATE_SUBMENU_HOVER_DELAY_MS = 400;
const duplicateSubmenuOpen = ref(false);
let hoverOpenTimer: ReturnType<typeof setTimeout> | undefined;

function clearHoverOpenTimer() {
  if (hoverOpenTimer !== undefined) {
    clearTimeout(hoverOpenTimer);
    hoverOpenTimer = undefined;
  }
}

function scheduleOpenDuplicateSubmenu() {
  clearHoverOpenTimer();
  if (duplicateSubmenuOpen.value) return;
  hoverOpenTimer = setTimeout(() => {
    duplicateSubmenuOpen.value = true;
  }, DUPLICATE_SUBMENU_HOVER_DELAY_MS);
}

function cancelScheduledOpen() {
  clearHoverOpenTimer();
}

/** サブメニューを持たない項目にマウスが乗った時、開いているサブメニューを即座に閉じる */
function closeDuplicateSubmenu() {
  clearHoverOpenTimer();
  duplicateSubmenuOpen.value = false;
}

onBeforeUnmount(clearHoverOpenTimer);

function onTogglePin() {
  if (pinned.value) {
    editorStore.unPinTab(prop.file, prop.layoutSide);
  } else {
    editorStore.pinTab(prop.file, prop.layoutSide);
  }
}

/** 自身と同じタブを別ペインに複製する（既に開いていれば選択するだけ、無ければ新規に開く） */
function onDuplicateTo(targetSide: LayoutSide) {
  editorStore.openTabAt(prop.file, targetSide);
}

/** 相対パスをクリップボードへコピーする */
async function onCopyRelativePath() {
  await navigator.clipboard.writeText(new Path(prop.file.path).path);
  $q.notify({ type: 'positive', message: $t('explorer.pathCopied') });
}

/** コンテナ基準の絶対パスをクリップボードへコピーする */
async function onCopyAbsolutePath() {
  const containersRes = await api.getAllContainers();
  const container = containersRes.ok
    ? containersRes.data.find((c) => c.id === prop.file.containerID)
    : undefined;
  const containerPath = container?.name ?? '.';
  const absolutePath = new Path(containerPath).child(prop.file.path).path;
  await navigator.clipboard.writeText(absolutePath);
  $q.notify({ type: 'positive', message: $t('explorer.pathCopied') });
}

function onCloseOthers() {
  void closeOtherTabs(prop.layoutSide, prop.file);
}

function onCloseToRight() {
  void closeTabsToRight(prop.layoutSide, prop.file);
}

function onCloseSaved() {
  void closeSavedTabs(prop.layoutSide);
}
</script>
