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
  </q-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PluginSubmission } from 'src/models/plugin/submission';
import { displayStatus, statusLabelKey, statusColor as resolveStatusColor } from './submissionDisplay';

// このコンポーネントは1件の申請（PR）の履歴行としての表示専用（操作ボタンは
// PluginSubmissionGroup.vue側に集約されている。dismissのみ個々のPRに対する操作のため
// ここに残す）
interface Prop {
  submission: PluginSubmission;
}
const prop = defineProps<Prop>();

const { t: $t } = useI18n();

const statusLabel = computed(() => $t(statusLabelKey(displayStatus(prop.submission))));
const statusColor = computed(() => resolveStatusColor(displayStatus(prop.submission)));
</script>
