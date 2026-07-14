<template>
  <TabItem
    icon="description"
    :title="title"
    :active="active"
    :has-unsaved-changes="hasUnsavedChanges"
    @select="emit('select')"
    @close="emit('close')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ContainerElementFile } from 'src/models/container';
import { Path } from 'src/utils/binary/path';
import { useUnsavedIndicator } from 'src/composables/useUnsavedIndicator';
import TabItem from './TabItem.vue';

interface Prop {
  file: ContainerElementFile;
  active: boolean;
}
const prop = defineProps<Prop>();
const emit = defineEmits<{ select: []; close: [] }>();

const title = computed(() => new Path(prop.file.path).basename());
const { hasUnsavedChanges } = useUnsavedIndicator(computed(() => prop.file));
</script>
