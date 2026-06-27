import { toast } from 'sonner'
import { store } from '@renderer/redux/store'
import { addNotification, type NotificationTone } from '@renderer/redux/notificationsSlice'

/**
 * notify — the single entry point for user-facing notifications.
 *
 * Each call shows a transient toast (sonner, bottom-right) AND records the
 * notification to the persistent history that backs the status-bar bell. It is
 * a drop-in for sonner's `toast` for the methods we use, so call sites can
 * `import { notify as toast }` with no other change.
 */
type Opts = { description?: string }

function record(tone: NotificationTone, title: string, opts?: Opts): void {
  store.dispatch(addNotification({ tone, title, msg: opts?.description }))
}

export const notify = {
  success(title: string, opts?: Opts): void {
    record('ok', title, opts)
    toast.success(title, opts)
  },
  error(title: string, opts?: Opts): void {
    record('error', title, opts)
    toast.error(title, opts)
  },
  warning(title: string, opts?: Opts): void {
    record('warn', title, opts)
    toast.warning(title, opts)
  },
  info(title: string, opts?: Opts): void {
    record('info', title, opts)
    toast.info(title, opts)
  }
}
