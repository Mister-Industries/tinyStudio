import { PayloadAction, nanoid } from '@reduxjs/toolkit'
import { createAppSlice } from './createAppSlice'

export type NotificationTone = 'ok' | 'error' | 'warn' | 'info'

export type Notification = {
  id: string
  tone: NotificationTone
  title: string
  msg?: string
  code?: string
  at: number
}

export type NotificationsSliceState = {
  items: Notification[]
}

const MAX = 30

const initialState: NotificationsSliceState = {
  items: []
}

// A persistent notification history backing the status-bar bell. Toasts are
// transient (sonner), but every notification is also recorded here so the user
// can review what happened — see lib/notify.ts, which writes to both.
export const notificationsSlice = createAppSlice({
  name: 'notifications',
  initialState,
  reducers: (create) => ({
    addNotification: create.reducer(
      (state, { payload }: PayloadAction<{ tone: NotificationTone; title: string; msg?: string; code?: string }>) => {
        state.items.unshift({
          id: nanoid(),
          at: Date.now(),
          tone: payload.tone,
          title: payload.title,
          msg: payload.msg,
          code: payload.code
        })
        if (state.items.length > MAX) state.items.length = MAX
      }
    ),
    clearNotifications: create.reducer((state) => {
      state.items = []
    })
  }),
  selectors: {
    selectNotifications: (state) => state.items
  }
})

export const { addNotification, clearNotifications } = notificationsSlice.actions
export const { selectNotifications } = notificationsSlice.selectors
