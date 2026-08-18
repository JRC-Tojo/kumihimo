import { register } from 'register-service-worker';
import { Notify } from 'quasar';

import { globalI18n } from 'src/boot/i18n';

// The ready(), registered(), cached(), updatefound() and updated()
// events passes a ServiceWorkerRegistration instance in their arguments.
// ServiceWorkerRegistration: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration

/** 定期的な更新チェックの間隔（30分） */
const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 30;

/** controllerchangeによる二重リロードを防ぐためのフラグ */
let reloading = false;

/**
 * ユーザーが更新通知のボタンを押したかどうか。
 * 初回インストール時もclientsClaim()によりcontrollerchangeが発生するため、
 * ユーザーが更新を承認した場合のみリロードするよう区別する
 */
let updateAccepted = false;

if ('serviceWorker' in navigator) {
  // 新しいService Workerが有効化されてページの制御を引き継いだら、
  // ユーザーが更新を承認していた場合に限り一度だけリロードして新しいコードを反映する
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateAccepted || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

register(process.env.SERVICE_WORKER_FILE, {
  // The registrationOptions object will be passed as the second argument
  // to ServiceWorkerContainer.register()
  // https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register#Parameter

  // registrationOptions: { scope: './' },

  ready(/* registration */) {
    // console.log('Service worker is active.')
  },

  registered(registration) {
    // タブを開きっぱなしにするユースケースを想定し、能動的に更新を検知する
    setInterval(() => {
      void registration.update().catch(() => undefined);
    }, UPDATE_CHECK_INTERVAL_MS);
  },

  cached(/* registration */) {
    // console.log('Content has been cached for offline use.')
  },

  updatefound(/* registration */) {
    // console.log('New content is downloading.')
  },

  updated(registration) {
    // 新しいService Workerがwaiting状態で待機している旨をユーザーへ通知する。
    // 作業を妨げないよう自動では消えない非ブロッキング通知にし、
    // ボタン押下時のみSKIP_WAITINGを送って更新を確定させる
    if (!registration.waiting) return;

    const { t } = globalI18n;
    Notify.create({
      type: 'info',
      message: t('pwa.updateAvailable'),
      timeout: 0,
      actions: [
        {
          label: t('pwa.reload'),
          color: 'white',
          handler: () => {
            updateAccepted = true;
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
          },
        },
      ],
    });
  },

  offline() {
    // console.log('No internet connection found. App is running in offline mode.')
  },

  error(/* err */) {
    // console.error('Error during service worker registration:', err)
  },
});
