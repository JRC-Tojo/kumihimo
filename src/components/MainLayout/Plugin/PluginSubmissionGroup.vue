<template>
  <q-expansion-item dense-toggle class="plugin-submission-group" header-class="q-pa-sm">
    <template #header>
      <q-item-section>
        <q-item-label>
          {{ pluginName }}
          <span class="text-caption text-grey-6">v{{ displayVersion }}</span>
          <q-badge v-if="headerStatus" :color="headerStatusColor" class="q-ml-sm">
            {{ headerStatusLabel }}
          </q-badge>
        </q-item-label>
        <q-item-label v-if="activeSubmit?.status === 'ci_failed'" caption class="text-negative">
          {{ $t('plugins.submission.ciFailedHint') }}
        </q-item-label>
      </q-item-section>
      <q-item-section side>
        <div class="row q-gutter-xs items-center" @click.stop>
          <q-btn
            v-if="activeUnpublish"
            dense
            flat
            color="negative"
            :label="$t('plugins.actions.withdraw')"
            @click="emit('withdraw', activeUnpublish.prNumber)"
          />
          <q-btn
            v-else-if="activeSubmit"
            dense
            flat
            color="negative"
            :label="$t('plugins.actions.withdraw')"
            @click="emit('withdraw', activeSubmit.prNumber)"
          />
          <q-btn
            v-else-if="isCurrentlyPublished"
            dense
            flat
            color="negative"
            :label="$t('plugins.actions.unpublish')"
            @click="emit('unpublish', pluginId)"
          />
        </div>
      </q-item-section>
    </template>

    <q-list separator class="q-pl-md">
      <PluginSubmissionItem
        v-for="submission in submissions"
        :key="submission.prNumber"
        :submission="submission"
      />
    </q-list>
  </q-expansion-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PluginSubmission } from 'src/models/plugin/submission';
import type { PluginID } from 'src/models/plugin/manifest';
import PluginSubmissionItem from './PluginSubmissionItem.vue';
import {
  displayStatus,
  statusLabelKey,
  statusColor as resolveStatusColor,
} from './submissionDisplay';

/**
 * 同一プラグイン（manifest.id）の申請履歴をまとめて表示するグループ。
 * submit/unpublishの操作ボタンはここに集約し、個々の履歴行（PluginSubmissionItem）は
 * 表示専用にする
 */
interface Prop {
  pluginName: string;
  // submittedAt降順ソート済み（呼び出し側で保証する）
  submissions: PluginSubmission[];
}
const prop = defineProps<Prop>();

const emit = defineEmits<{
  withdraw: [prNumber: number];
  unpublish: [pluginId: PluginID];
}>();

const { t: $t } = useI18n();

const pluginId = computed(() => prop.submissions[0]!.manifest.id);

function isTerminal(s: PluginSubmission): boolean {
  return s.status === 'published' || s.status === 'withdrawn';
}

const latestSubmit = computed(() => prop.submissions.find((s) => s.kind === 'submit'));
const latestUnpublish = computed(() => prop.submissions.find((s) => s.kind === 'unpublish'));

// 進行中（終端状態でない）の取り下げ申請。存在する間は新規申請ができない
const activeUnpublish = computed(() => {
  const s = latestUnpublish.value;
  return s && !isTerminal(s) ? s : undefined;
});
// 進行中（終端状態でない）の申請。存在する間は取り下げ申請ができない
const activeSubmit = computed(() => {
  const s = latestSubmit.value;
  return s && !isTerminal(s) ? s : undefined;
});

// マージ済み（実際にストアへ反映済み）のsubmit/unpublishのうち最新のもの
const lastMergedSubmit = computed(() =>
  prop.submissions.find((s) => s.kind === 'submit' && s.status === 'published'),
);
const lastMergedUnpublish = computed(() =>
  prop.submissions.find((s) => s.kind === 'unpublish' && s.status === 'published'),
);

/**
 * このプラグインが現在ストアに公開中かどうか。`submit`のマージと`unpublish`のマージは
 * どちらも「そのPRがmergedになった」という同じ事実を意味するため、どちらか一方の
 * 存在だけでは判定できない。**より新しくマージされた方**が現在の状態を表す
 * （例: 公開→取り下げ→再公開、のように何度でも往復しうるため）
 */
const isCurrentlyPublished = computed(() => {
  const submitTime = lastMergedSubmit.value?.updatedAt.getTime() ?? -1;
  const unpublishTime = lastMergedUnpublish.value?.updatedAt.getTime() ?? -1;
  return submitTime > unpublishTime;
});

const displayVersion = computed(
  () => (latestSubmit.value ?? prop.submissions[0])?.manifest.version ?? '',
);

// ヘッダーバッジに表示する対象の申請。進行中のものがあればそれを優先し、
// 無ければ「現在の公開状態」を表す側（isCurrentlyPublishedの判定に使った方）を表示する
const headerTarget = computed(() => {
  if (activeUnpublish.value) return activeUnpublish.value;
  if (activeSubmit.value) return activeSubmit.value;
  return isCurrentlyPublished.value
    ? lastMergedSubmit.value
    : (lastMergedUnpublish.value ?? latestSubmit.value);
});
const headerStatus = computed(() =>
  headerTarget.value ? displayStatus(headerTarget.value) : undefined,
);
const headerStatusLabel = computed(() =>
  headerStatus.value ? $t(statusLabelKey(headerStatus.value)) : '',
);
const headerStatusColor = computed(() =>
  headerStatus.value ? resolveStatusColor(headerStatus.value) : 'grey',
);
</script>
