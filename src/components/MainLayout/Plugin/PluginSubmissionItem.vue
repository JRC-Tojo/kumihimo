<template>
  <q-item class="plugin-submission-item">
    <q-item-section>
      <q-item-label>
        {{ submission.manifest.name }}
        <span class="text-caption text-grey-6">v{{ submission.manifest.version }}</span>
      </q-item-label>
      <q-item-label caption>
        <q-badge :color="statusColor">{{ statusLabel }}</q-badge>
        <a :href="submission.prUrl" target="_blank" rel="noopener" class="q-ml-sm">
          #{{ submission.prNumber }}
        </a>
      </q-item-label>
      <q-expansion-item
        v-if="submission.checks.length > 0"
        dense
        :label="$t('plugins.submission.ciLogTitle')"
        class="q-mt-xs"
      >
        <q-list dense>
          <q-item v-for="check in submission.checks" :key="check.name" dense>
            <q-item-section>{{ check.name }}</q-item-section>
            <q-item-section side>{{ check.conclusion ?? '…' }}</q-item-section>
          </q-item>
        </q-list>
      </q-expansion-item>
    </q-item-section>

    <q-item-section side>
      <div class="column q-gutter-xs items-end">
        <q-btn
          v-if="submission.status === 'ci_passed'"
          dense
          flat
          color="primary"
          :label="$t('plugins.actions.publish')"
          @click="emit('publish')"
        />
        <q-btn
          v-if="submission.status === 'published'"
          dense
          flat
          color="negative"
          :label="$t('plugins.actions.unpublish')"
          @click="emit('unpublish')"
        />
      </div>
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
  unpublish: [];
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
