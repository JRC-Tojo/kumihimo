<template>
  <q-dialog ref="dialogRef" persistent @hide="onDialogHide">
    <q-card style="min-width: 360px">
      <q-card-section>
        <div class="text-h6">{{ title }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="q-mb-sm">{{ message }}</div>
        <q-linear-progress
          v-if="total > 0"
          :value="completed / total"
          color="primary"
          size="10px"
          rounded
        />
        <q-linear-progress v-else indeterminate color="primary" size="10px" rounded />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { useDialogPluginComponent } from 'quasar';

interface Prop {
  title: string;
  message?: string;
  completed?: number;
  total?: number;
}
withDefaults(defineProps<Prop>(), {
  message: '',
  completed: 0,
  total: 0,
});

defineEmits([...useDialogPluginComponent.emits]);
const { dialogRef, onDialogHide } = useDialogPluginComponent();
</script>
