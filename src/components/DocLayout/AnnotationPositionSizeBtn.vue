<template>
  <q-btn v-if="target" dense flat :ripple="false" class="style-icon-btn" icon="crop_free">
    <q-menu anchor="bottom left" self="top left">
      <div class="position-size-menu q-pa-sm">
        <div class="position-size-row">
          <span class="position-size-label">{{ t('pdfEditor.tools.positionSize.x') }}</span>
          <q-input
            :model-value="x"
            type="number"
            dense
            outlined
            class="position-size-input"
            @update:model-value="(v) => (x = Number(v))"
          />
          <span class="position-size-label">{{ t('pdfEditor.tools.positionSize.y') }}</span>
          <q-input
            :model-value="y"
            type="number"
            dense
            outlined
            class="position-size-input"
            @update:model-value="(v) => (y = Number(v))"
          />
        </div>
        <div class="position-size-row">
          <span class="position-size-label">{{ t('pdfEditor.tools.positionSize.width') }}</span>
          <q-input
            :model-value="size.width"
            type="number"
            dense
            outlined
            class="position-size-input"
            @update:model-value="(v) => setSize(Number(v), size.height)"
          />
          <span class="position-size-label">{{ t('pdfEditor.tools.positionSize.height') }}</span>
          <q-input
            :model-value="size.height"
            type="number"
            dense
            outlined
            class="position-size-input"
            @update:model-value="(v) => setSize(size.width, Number(v))"
          />
        </div>
      </div>
    </q-menu>
    <q-tooltip anchor="top middle" self="bottom middle">
      {{ t('pdfEditor.tools.positionSize.title') }}
    </q-tooltip>
  </q-btn>
</template>

<script setup lang="ts">
/**
 * 選択中アノテーションの位置・サイズを数値で直接指定する操作盤
 *
 * 位置（x/y）は種別ごとに意味が異なる（box/textは左上、circleは中心、
 * line/arrow/polyline/polygonは始端頂点）が、いずれもAnnotationStyle.x/yそのものであるため
 * 共通に扱える。サイズ（全体幅・高さ）は種別ごとに実体フィールドが異なるため、
 * `ANNOTATION_GEOMETRY[type].getSize/resizeTo`を介して変換する。単一選択時のみ表示する
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import dayjs from 'dayjs';
import { useEditorStore } from 'src/stores/editorStore';
import { useAnnotationHistory } from './composables/useAnnotationHistory';
import { ANNOTATION_GEOMETRY } from 'src/services/document/annotationGeometry';
import type { AnnotationStyle } from 'src/models/document/pdf';

const { t } = useI18n();
const editorStore = useEditorStore();
const history = useAnnotationHistory();

/** 単一選択時のみ対象とする（複数選択時は各注釈で位置・サイズの意味がずれるため対象外） */
const target = computed<AnnotationStyle | undefined>(() => {
  const annots = editorStore.activeSelection?.annotations;
  return annots?.length === 1 ? annots[0] : undefined;
});

async function applyPatch(patch: Partial<AnnotationStyle>): Promise<void> {
  const annot = target.value;
  const file = editorStore.activeSelection?.file;
  if (!annot || !file) return;
  await history.registerWithHistory(file, annot, {
    ...annot,
    ...patch,
    updatedAt: dayjs().toISOString(),
  } as AnnotationStyle);
}

const x = computed<number>({
  get: () => target.value?.x ?? 0,
  set: (v) => {
    if (Number.isNaN(v)) return;
    void applyPatch({ x: v });
  },
});

const y = computed<number>({
  get: () => target.value?.y ?? 0,
  set: (v) => {
    if (Number.isNaN(v)) return;
    void applyPatch({ y: v });
  },
});

const size = computed<{ width: number; height: number }>(() => {
  const annot = target.value;
  if (!annot) return { width: 0, height: 0 };
  return ANNOTATION_GEOMETRY[annot.type].getSize(annot);
});

function setSize(width: number, height: number) {
  const annot = target.value;
  if (!annot || Number.isNaN(width) || Number.isNaN(height)) return;
  void applyPatch(ANNOTATION_GEOMETRY[annot.type].resizeTo(annot, width, height));
}
</script>

<style scoped lang="scss">
.style-icon-btn {
  min-height: 24px;
  min-width: 28px;
  padding: 0 0.3rem;
}

.position-size-menu {
  width: 220px;
}

.position-size-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;

  & + .position-size-row {
    margin-top: 0.4rem;
  }
}

.position-size-label {
  font-size: 0.75rem;
  color: $grey-7;
  white-space: nowrap;
}

.position-size-input {
  width: 70px;
}

.body--dark .position-size-label {
  color: $grey-4;
}
</style>
