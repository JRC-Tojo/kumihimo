<template>
  <q-item class="plugin-submission-item">
    <q-item-section>
      <q-item-label>
        {{ submission.manifest.name }}
        <span class="text-caption text-grey-6">v{{ submission.manifest.version }}</span>
      </q-item-label>
      <q-item-label caption>
        <q-badge :color="statusColor">{{ statusLabel }}</q-badge>
      </q-item-label>
      <q-expansion-item
        v-if="submission.ciLog"
        dense
        :label="$t('plugins.submission.ciLogTitle')"
        class="q-mt-xs"
      >
        <pre class="ci-log">{{ submission.ciLog }}</pre>
      </q-expansion-item>
    </q-item-section>

    <q-item-section side>
      <q-btn
        v-if="submission.status === 'ci_passed'"
        dense
        flat
        color="primary"
        :label="$t('plugins.actions.publish')"
        @click="emit('publish')"
      />
    </q-item-section>
  </q-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PluginSubmission } from 'src/models/plugin/submission';

interface Prop {
  submission: PluginSubmission;
}
const prop = defineProps<Prop>();

const emit = defineEmits<{
  publish: [];
}>();

const { t: $t } = useI18n();

const statusLabel = computed(() => {
  switch (prop.submission.status) {
    case 'pending':
      return $t('plugins.submission.status.pending');
    case 'ci_passed':
      return $t('plugins.submission.status.ciPassed');
    case 'ci_failed':
      return $t('plugins.submission.status.ciFailed');
    case 'published':
      return $t('plugins.submission.status.published');
  }
});

const statusColor = computed(() => {
  switch (prop.submission.status) {
    case 'pending':
      return 'grey';
    case 'ci_passed':
      return 'positive';
    case 'ci_failed':
      return 'negative';
    case 'published':
      return 'primary';
  }
});
</script>

<style scoped lang="scss">
.ci-log {
  white-space: pre-wrap;
  font-size: 0.75rem;
  background: $grey-2;
  padding: 8px;
  border-radius: 4px;
}

.body--dark .ci-log {
  background: $grey-9;
}
</style>
