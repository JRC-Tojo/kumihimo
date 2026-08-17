<template>
  <TabItem
    icon="description"
    :title="title"
    :active="active"
    :has-unsaved-changes="hasUnsavedChanges"
    :pinned="pinned"
    @select="emit('select')"
    @close="emit('close')"
    @unpin="editorStore.unPinTab(prop.file, prop.layoutSide)"
  >
    <template #menu>
      <TabContextMenu
        :file="prop.file"
        :layout-side="prop.layoutSide"
        @close="emit('close')"
        @show-relational-summary="emit('showRelationalSummary')"
      />
    </template>
  </TabItem>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ContainerElementFile } from 'src/models/container';
import { Path } from 'src/utils/binary/path';
import { useUnsavedIndicator } from 'src/composables/useUnsavedIndicator';
import { useEditorStore, type LayoutSide } from 'src/stores/editorStore';
import TabItem from './TabItem.vue';
import TabContextMenu from './TabContextMenu.vue';

interface Prop {
  file: ContainerElementFile;
  layoutSide: LayoutSide;
  active: boolean;
}
const prop = defineProps<Prop>();
const emit = defineEmits<{ select: []; close: []; showRelationalSummary: [] }>();

const editorStore = useEditorStore();
const title = computed(() => new Path(prop.file.path).basename());
const pinned = computed(() => editorStore.isTabPinned(prop.file, prop.layoutSide));
const { hasUnsavedChanges } = useUnsavedIndicator(computed(() => prop.file));
</script>
