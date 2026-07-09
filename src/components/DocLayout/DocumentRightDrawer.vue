<template>
  <div v-show="drawerOpen" class="document-right-drawer">
    <!-- アノテーション選択時の詳細 -->
    <div v-if="selectedAnnots.length > 0" class="drawer-section q-pa-md">
      <h6 class="q-my-none q-mb-md">{{ $t('pdfEditor.rightDrawer.annotation.title') }}</h6>
      <div class="annotation-properties">
        <!-- アノテーション型 -->
        <div class="property-group q-mb-md">
          <label class="property-label">{{ $t('pdfEditor.rightDrawer.annotation.type') }}</label>
          <div class="property-value">{{ selectedAnnotationType }}</div>
        </div>

        <!-- 色選択 -->
        <div class="property-group q-mb-md">
          <label class="property-label">{{ $t('pdfEditor.rightDrawer.annotation.color') }}</label>
          <div class="color-picker">
            <input
              v-model="annotationColor"
              type="color"
              class="color-input"
              @change="updateAnnotationColor"
              disabled
            />
            <span class="color-value">{{ annotationColor }}</span>
          </div>
        </div>

        <!-- 線の太さ -->
        <div class="property-group q-mb-md">
          <label class="property-label">{{ $t('pdfEditor.rightDrawer.annotation.stroke') }}</label>
          <div class="slider-container">
            <q-slider
              v-model="annotationStrokeWidth"
              :min="1"
              :max="10"
              :step="0.5"
              label
              @update:model-value="updateAnnotationStrokeWidth"
              disable
            />
          </div>
        </div>

        <!-- 透明度 -->
        <div class="property-group q-mb-md">
          <label class="property-label">{{ $t('pdfEditor.rightDrawer.annotation.opacity') }}</label>
          <div class="slider-container">
            <q-slider
              v-model="annotationOpacity"
              :min="0"
              :max="1"
              :step="0.1"
              label
              @update:model-value="updateAnnotationOpacity"
              disable
            />
          </div>
        </div>

        <!-- 関係性設定 -->
        <q-separator class="q-my-md" />
        <div class="property-group q-mb-md">
          <label class="property-label">{{
            $t('pdfEditor.rightDrawer.annotation.relations')
          }}</label>
          <q-btn
            outline
            color="primary"
            icon="link"
            :label="$t('pdfEditor.rightDrawer.annotation.addRelation')"
            size="sm"
          />
        </div>

        <!-- 削除ボタン -->
        <q-separator class="q-my-md" />
        <q-btn
          outline
          color="negative"
          icon="delete"
          :label="$t('pdfEditor.rightDrawer.annotation.delete')"
          @click="deleteAnnot"
          class="full-width"
        />
      </div>
    </div>

    <!-- アノテーション未選択時 -->
    <div v-else class="drawer-empty q-pa-md">
      <q-icon name="info" size="2rem" color="grey-5" />
      <p class="q-mt-md text-grey-6">{{ $t('pdfEditor.rightDrawer.annotation.notSelected') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBackendApi } from 'src/apis/backendApi';
import type { AnnotationStyle } from 'src/models/document/pdf';
import { computed, ref } from 'vue';

interface Prop {
  selectedAnnots: AnnotationStyle[]
}
const prop = defineProps<Prop>()

const api = useBackendApi()

const drawerOpen = defineModel<boolean>('drawerOpen', { required: true });

// アノテーションのプロパティ（初期値は単一選択の場合はプロパティを反映し、その他はundefinedを与える）
const getDefault = <K extends keyof AnnotationStyle>(styleKey: K): AnnotationStyle[K] | undefined => {
  if (prop.selectedAnnots.length === 1) {
    return prop.selectedAnnots[0]?.[styleKey]
  } else {
    return undefined
  }
}
const annotationColor = ref(getDefault('color'));
const annotationStrokeWidth = ref(getDefault('strokeWidth'));
const annotationOpacity = ref(getDefault('opacity'));
const selectedAnnotationType = computed(() => getDefault('type'));

/**
 * アノテーションの色を更新
 */
const updateAnnotationColor = () => {
  // TODO: バックエンドに反映
};

/**
 * アノテーションの線の太さを更新
 */
const updateAnnotationStrokeWidth = () => {
  // TODO: バックエンドに反映
};

/**
 * アノテーションの透明度を更新
 */
const updateAnnotationOpacity = () => {
  // TODO: バックエンドに反映
};

/**
 * アノテーションを削除
 */
const deleteAnnot = async () => {
  const removeRes = await Promise.all(prop.selectedAnnots.map(annot => api.removeAnnotation(annot.id)))
  // TODO: エラーハンドリング
 removeRes.forEach(res =>{ if (!res.ok) console.error(res.error)})
}
</script>

<style scoped lang="scss">
.document-right-drawer {
  width: 300px;
  height: 100%;
  background: white;
  border-left: 1px solid $grey-3;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  flex-shrink: 0;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: $grey-2;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-4;
    border-radius: 3px;

    &:hover {
      background: $grey-5;
    }
  }

  .drawer-section {
    h6 {
      font-weight: 600;
      font-size: 0.95rem;
      color: $primary;
    }
  }

  .annotation-properties {
    .property-group {
      .property-label {
        display: block;
        font-size: 0.85rem;
        font-weight: 500;
        color: $grey-8;
        margin-bottom: 0.5rem;
      }

      .property-value {
        padding: 0.75rem;
        background-color: $grey-2;
        border-radius: 6px;
        font-size: 0.9rem;
        color: $grey-7;
        border-left: 3px solid $primary;
      }
    }

    .color-picker {
      display: flex;
      align-items: center;
      gap: 0.75rem;

      .color-input {
        width: 50px;
        height: 40px;
        border: 1px solid $grey-4;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;

        &:hover {
          border-color: $primary;
          box-shadow: 0 0 0 2px rgba($primary, 0.1);
        }
      }

      .color-value {
        font-size: 0.9rem;
        font-family: monospace;
        color: $grey-7;
        font-weight: 500;
      }
    }

    .slider-container {
      padding: 0.5rem 0;

      :deep(.q-slider) {
        .q-slider__track-container {
          margin: 0.75rem 0;
        }
      }
    }
  }

  .drawer-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    text-align: center;
    color: $grey-5;
  }
}

.body--dark .document-right-drawer {
  background: $dark;
  border-left-color: $grey-8;

  &::-webkit-scrollbar-track {
    background: $grey-8;
  }

  &::-webkit-scrollbar-thumb {
    background: $grey-7;

    &:hover {
      background: $grey-6;
    }
  }

  .drawer-section {
    h6 {
      color: $primary;
    }
  }

  .annotation-properties {
    .property-group {
      .property-label {
        color: $grey-3;
      }

      .property-value {
        background-color: $grey-8;
        color: $grey-4;
        border-left-color: $primary;
      }
    }

    .color-picker {
      .color-input {
        border-color: $grey-7;
        background-color: $grey-8;

        &:hover {
          border-color: $primary;
          box-shadow: 0 0 0 2px rgba($primary, 0.2);
        }
      }

      .color-value {
        color: $grey-4;
      }
    }
  }

  .drawer-empty {
    color: $grey-7;
  }
}
</style>
