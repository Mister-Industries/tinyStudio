// The project-level dialogs (Create / Open), mounted once at the app root and
// driven by editorSlice.projectDialog, so the start screen and the Files panel
// open the same ones. (Save to computer has no dialog: it goes straight to the
// folder picker — see saveProjectToComputer.)

import {
  closeProjectDialog,
  selectProjectDialog,
  useAppDispatch,
  useAppSelector
} from '@renderer/redux'
import { CreateProjectDialog } from './FileExplorer/CreateProjectDialog'
import { OpenProjectDialog } from './OpenProjectDialog'

export function ProjectDialogs(): React.JSX.Element {
  const dialog = useAppSelector(selectProjectDialog)
  const dispatch = useAppDispatch()
  const onOpenChange = (open: boolean): void => {
    if (!open) dispatch(closeProjectDialog())
  }

  return (
    <>
      <CreateProjectDialog open={dialog === 'create'} onOpenChange={onOpenChange} />
      <OpenProjectDialog open={dialog === 'open'} onOpenChange={onOpenChange} />
    </>
  )
}
