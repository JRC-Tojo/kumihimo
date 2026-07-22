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
          :label="$t('plugins.actions.requestPublish')"
          @click="emit('requestPublish')"
        />
        <q-btn
          v-if="submission.status === 'ci_passed' || submission.status === 'awaiting_merge'"
          dense
          flat
          color="primary"
          :label="$t('plugins.actions.publish')"
          @click="emit('publish')"
        />
        <q-btn
          v-if="isWithdrawable"
          dense
          flat
          color="negative"
          :label="$t('plugins.actions.withdraw')"
          @click="emit('withdraw')"
        />
        <q-btn
          v-if="submission.status === 'published'"
          dense
          flat
          color="negative"
          :label="$t('plugins.actions.unpublish')"
          @click="emit('unpublish')"
        />
        <q-btn
          v-if="isDismissible"
          dense
          flat
          round
          icon="close"
          size="sm"
          color="grey"
          @click="emit('dismiss')"
        >
          <q-tooltip>{{ $t('plugins.actions.dismissSubmission') }}</q-tooltip>
        </q-btn>
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
  withdraw: [];
  dismiss: [];
  requestPublish: [];
}>();

const { t: $t } = useI18n();

// マージ・取り下げのいずれもされていない申請のみ、取り下げボタンを表示する
const isWithdrawable = computed(
  () =>
    prop.submission.status === 'pending' ||
    prop.submission.status === 'ci_passed' ||
    prop.submission.status === 'awaiting_merge' ||
    prop.submission.status === 'ci_failed',
);

// 取り下げ済み（＝これ以上操作の要らない申請）のみ、一覧からの削除ボタンを表示する
const isDismissible = computed(() => prop.submission.status === 'withdrawn');

const statusLabel = computed(() => {
  switch (prop.submission.status) {
    case 'pending':
      return $t('plugins.submission.status.pending');
    case 'ci_passed':
      return $t('plugins.submission.status.ciPassed');
    case 'awaiting_merge':
      return $t('plugins.submission.status.awaitingMerge');
    case 'ci_failed':
      return $t('plugins.submission.status.ciFailed');
    case 'published':
      return $t('plugins.submission.status.published');
    case 'withdrawn':
      return $t('plugins.submission.status.withdrawn');
    default:
      return '';
  }
});

const statusColor = computed(() => {
  switch (prop.submission.status) {
    case 'pending':
      return 'grey';
    case 'ci_passed':
      return 'positive';
    case 'awaiting_merge':
      return 'orange';
    case 'ci_failed':
      return 'negative';
    case 'published':
      return 'primary';
    case 'withdrawn':
      return 'grey';
    default:
      return 'grey';
  }
});
</script>
