<template>
  <q-list dense style="min-width: 220px">
    <q-item v-close-popup clickable @click="onTogglePin" @mouseenter="closeSubmenu">
      <q-item-section>{{
        pinned ? $t('pdfEditor.tabs.unpin') : $t('pdfEditor.tabs.pin')
      }}</q-item-section>
    </q-item>
    <q-item
      clickable
      @click="activeSubmenu = 'duplicate'"
      @mouseenter="scheduleOpenSubmenu('duplicate')"
      @mouseleave="cancelScheduledOpen"
    >
      <q-item-section>{{ $t('pdfEditor.tabs.duplicateTo') }}</q-item-section>
      <q-item-section side>
        <q-icon name="keyboard_arrow_right" />
      </q-item-section>
      <q-menu
        :model-value="activeSubmenu === 'duplicate'"
        anchor="top end"
        self="top start"
        @update:model-value="(v: boolean) => onSubmenuModelUpdate(v)"
      >
        <q-list dense style="min-width: 150px">
          <q-item
            v-for="side in otherSides"
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
    <q-item
      clickable
      @click="activeSubmenu = 'move'"
      @mouseenter="scheduleOpenSubmenu('move')"
      @mouseleave="cancelScheduledOpen"
    >
      <q-item-section>{{ $t('pdfEditor.tabs.moveTo') }}</q-item-section>
      <q-item-section side>
        <q-icon name="keyboard_arrow_right" />
      </q-item-section>
      <q-menu
        :model-value="activeSubmenu === 'move'"
        anchor="top end"
        self="top start"
        @update:model-value="(v: boolean) => onSubmenuModelUpdate(v)"
      >
        <q-list dense style="min-width: 150px">
          <q-item
            v-for="side in otherSides"
            :key="side"
            v-close-popup
            clickable
            @click="onMoveTo(side)"
          >
            <q-item-section>{{ paneLabel(side) }}</q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </q-item>
    <q-separator />
    <q-item v-close-popup clickable @click="onCopyRelativePath" @mouseenter="closeSubmenu">
      <q-item-section>{{ $t('explorer.copyRelativePath') }}</q-item-section>
    </q-item>
    <q-item v-close-popup clickable @click="onCopyAbsolutePath" @mouseenter="closeSubmenu">
      <q-item-section>{{ $t('explorer.copyAbsolutePath') }}</q-item-section>
    </q-item>
    <q-separator />
    <q-item
      v-close-popup
      clickable
      @click="emit('showRelationalSummary')"
      @mouseenter="closeSubmenu"
    >
      <q-item-section>{{ $t('pdfEditor.tabs.showRelationalSummary') }}</q-item-section>
    </q-item>
    <q-separator />
    <q-item v-close-popup clickable @click="onCloseOthers" @mouseenter="closeSubmenu">
      <q-item-section>{{ $t('pdfEditor.tabs.closeOthers') }}</q-item-section>
    </q-item>
    <q-item v-close-popup clickable @click="onCloseToRight" @mouseenter="closeSubmenu">
      <q-item-section>{{ $t('pdfEditor.tabs.closeToRight') }}</q-item-section>
    </q-item>
    <q-item v-close-popup clickable @click="onCloseSaved" @mouseenter="closeSubmenu">
      <q-item-section>{{ $t('pdfEditor.tabs.closeSaved') }}</q-item-section>
    </q-item>
    <q-item
      v-close-popup
      clickable
      class="text-negative"
      @click="emit('close')"
      @mouseenter="closeSubmenu"
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
import { useEditorStore, type LayoutSide, type TileMode } from 'src/stores/editorStore';
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

const ALL_SIDES: LayoutSide[] = ['ul', 'ur', 'll', 'lr'];
const PANE_LABEL_KEYS: Record<LayoutSide, string> = {
  ul: 'pdfEditor.tabs.paneNames.ul',
  ur: 'pdfEditor.tabs.paneNames.ur',
  ll: 'pdfEditor.tabs.paneNames.ll',
  lr: 'pdfEditor.tabs.paneNames.lr',
};

/**
 * 複製・移動先の選択肢は、現在のタイルモードで表示されているかどうかに関わらず常に
 * 自身以外の3ペイン全てを対象にする（表示されていないペインを選んだ場合は
 * `ensurePaneVisible`が必要なタイルモードへ自動的に切り替える）
 */
const otherSides = computed<LayoutSide[]>(() =>
  ALL_SIDES.filter((side) => side !== prop.layoutSide),
);

function paneLabel(side: LayoutSide): string {
  return $t(PANE_LABEL_KEYS[side]);
}

// タイルモードの「広さ」の順序（single ⊂ dubble ⊂ grid、gridが常に全ペインを表示する）
const TILE_MODE_RANK: Record<TileMode, number> = { single: 0, dubble: 1, grid: 2 };
// 指定ペインを表示するために最低限必要なタイルモード
const REQUIRED_TILE_MODE_FOR_SIDE: Record<LayoutSide, TileMode> = {
  ul: 'single',
  ur: 'dubble',
  ll: 'grid',
  lr: 'grid',
};

/**
 * 指定ペインが現在のタイルモードで表示されていなければ、表示されるタイルモードへ切り替える
 *
 * 既に十分広いタイルモードであれば縮小はしない（例: grid表示中に'ur'を指定してもdubbleへ
 * 縮めたりはしない）。呼び出し元（複製・移動元）のペインは、右クリックメニューを開けている
 * 時点で必ず現在のタイルモードで表示済みのため、切り替え後も表示され続けることが保証される
 * （singleはul、dubbleはul・urを常に含み、gridは常に全ペインを含む）
 */
function ensurePaneVisible(targetSide: LayoutSide) {
  const required = REQUIRED_TILE_MODE_FOR_SIDE[targetSide];
  if (TILE_MODE_RANK[required] > TILE_MODE_RANK[editorStore.tileMode]) {
    editorStore.tileMode = required;
  }
}

// 「別のペインに複製」「別のペインに移動」のサブメニュー。AnnotationContextMenu.vueと同じ
// パターンで、単純に<q-menu>を親項目の子として置くだけではクリック・ホバーいずれでも
// 開かないため、開閉状態を明示的に持ち`model-value`で制御する。素早く通り過ぎただけで
// 開いてしまわないよう、ホバーはやや長めの遅延を経てから開く（クリックは即座に開く）
type SubmenuKey = 'duplicate' | 'move';
const HOVER_OPEN_DELAY_MS = 400;
const activeSubmenu = ref<SubmenuKey | null>(null);
let hoverOpenTimer: ReturnType<typeof setTimeout> | undefined;

function clearHoverOpenTimer() {
  if (hoverOpenTimer !== undefined) {
    clearTimeout(hoverOpenTimer);
    hoverOpenTimer = undefined;
  }
}

function scheduleOpenSubmenu(key: SubmenuKey) {
  clearHoverOpenTimer();
  if (activeSubmenu.value === key) return;
  if (activeSubmenu.value !== null) activeSubmenu.value = null;
  hoverOpenTimer = setTimeout(() => {
    activeSubmenu.value = key;
  }, HOVER_OPEN_DELAY_MS);
}

function cancelScheduledOpen() {
  clearHoverOpenTimer();
}

/** サブメニューを持たない項目にマウスが乗った時、開いているサブメニューを即座に閉じる */
function closeSubmenu() {
  clearHoverOpenTimer();
  activeSubmenu.value = null;
}

/** サブメニュー自体が外側クリック等で閉じられた場合にも状態を同期する */
function onSubmenuModelUpdate(isOpen: boolean) {
  if (!isOpen) activeSubmenu.value = null;
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
  ensurePaneVisible(targetSide);
  editorStore.openTabAt(prop.file, targetSide);
}

/**
 * このタブを別ペインへ移動する
 *
 * 先に移動先へ開いてから元のペインを閉じる（`closeTab`はどのペインにも開かれていない
 * タブのUndo/Redo履歴を破棄するため、順序を逆にすると移動の一瞬だけ「どこにも開かれていない」
 * 状態になり履歴が失われてしまう）。ピン留めされていても移動は明示的な操作として優先する
 */
function onMoveTo(targetSide: LayoutSide) {
  ensurePaneVisible(targetSide);
  editorStore.openTabAt(prop.file, targetSide);
  editorStore.closeTab(prop.file, prop.layoutSide, true);
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
