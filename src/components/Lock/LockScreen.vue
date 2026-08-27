<template>
  <div class="fullscreen flex flex-center">
    <q-card style="min-width: 320px">
      <q-card-section>
        <div class="text-h6">{{ $t('lock.title') }}</div>
        <p class="text-caption">{{ $t('lock.description') }}</p>
      </q-card-section>

      <q-card-section>
        <q-form @submit.prevent="onSubmit">
          <q-input
            v-model="password"
            type="password"
            autofocus
            :error="showError"
            :error-message="$t('lock.verifyFailed')"
            :label="$t('lock.passwordLabel')"
          />
          <q-btn
            class="q-mt-md full-width"
            color="primary"
            type="submit"
            :loading="isBusy"
            :label="$t('lock.unlock')"
          />
        </q-form>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBackendApi } from 'src/apis/backendApi';

const emit = defineEmits<{ unlocked: [] }>();

const { t: $t } = useI18n();
const api = useBackendApi();

const password = ref('');
const isBusy = ref(false);
const showError = ref(false);

/**
 * 入力されたパスワードを検証し、一致していれば解除イベントを発火する
 */
async function onSubmit() {
  isBusy.value = true;
  showError.value = false;
  try {
    const res = await api.verifyLockPassword(password.value);
    if (res.ok && res.data) {
      emit('unlocked');
    } else {
      showError.value = true;
    }
  } finally {
    isBusy.value = false;
  }
}
</script>
