/**
 * VerifyButton and UploadButton - Arduino compilation and upload controls
 */

import { Button } from '@renderer/components/ui/Button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/Tooltip'
import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { useAppSelector } from '@renderer/redux'
import { AlertCircle, Check, Loader2, Upload } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'

export interface VerifyButtonProps {
  /** Custom className for styling */
  className?: string
  /** Button variant */
  variant?: 'default' | 'muted' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon'
  /** Whether to show icon */
  showIcon?: boolean
}

export interface UploadButtonProps extends VerifyButtonProps {
  /** Whether to compile before upload */
  compileFirst?: boolean
}

/**
 * Verify (compile) button for Arduino sketches
 */
export function VerifyButton({
  className,
  variant = 'outline',
  size = 'default',
  showIcon = true
}: VerifyButtonProps): React.JSX.Element {
  const { compileSketch, isCompiling, selectedBoard, isAgentConnected } = useArduinoContext()

  const workspace = useAppSelector((state) => state.file.workspace)

  const handleVerify = async (): Promise<void> => {
    if (!selectedBoard) {
      toast.error('No board selected', {
        description: 'Please select an Arduino board before compiling'
      })
      return
    }

    if (!isAgentConnected) {
      toast.error('Arduino CLI not available', {
        description: 'Please ensure arduino-cli is installed and available'
      })
      return
    }

    if (!workspace) {
      toast.error('No workspace open', {
        description: 'Please open a workspace containing Arduino files first'
      })
      return
    }

    try {
      await compileSketch(workspace.path, selectedBoard.config)
    } catch (error) {
      console.error('Compilation error:', error)
      toast.error('Compilation failed', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  const isDisabled = isCompiling || !selectedBoard || !isAgentConnected || !workspace
  // console.log('VerifyButton isDisabled conditions:', {
  //   isCompiling,
  //   selectedBoard: !selectedBoard,
  //   isAgentConnected: !isAgentConnected,
  //   openFilesLength: openFiles.length === 0,
  //   isDisabled
  // })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          onClick={handleVerify}
          disabled={isDisabled}
          className={className}
        >
          {showIcon && (
            <>
              {isCompiling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </>
          )}
          {isCompiling ? 'Compiling...' : 'Verify'}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isCompiling
          ? 'Compilation in progress...'
          : !selectedBoard
            ? 'Select a board first'
            : !isAgentConnected
              ? 'Arduino Agent not connected'
              : !workspace
                ? 'Open a workspace with Arduino files first'
                : 'Compile the current sketch'}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Upload button for Arduino sketches
 */
export function UploadButton({
  className,
  variant = 'outline',
  size = 'default',
  showIcon = true,
  compileFirst = true
}: UploadButtonProps): React.JSX.Element {
  const {
    compileAndUpload,
    uploadSketch,
    isCompiling,
    isUploading,
    selectedBoard,
    isAgentConnected,
    uploadProgress
  } = useArduinoContext()

  const workspace = useAppSelector((state) => state.file.workspace)

  const handleUpload = async (): Promise<void> => {
    if (!selectedBoard) {
      toast.error('No board selected', {
        description: 'Please select an Arduino board before uploading'
      })
      return
    }

    if (!isAgentConnected) {
      toast.error('Arduino CLI not available', {
        description: 'Please ensure arduino-cli is installed and available'
      })
      return
    }

    if (!workspace) {
      toast.error('No workspace open', {
        description: 'Please open a workspace containing Arduino files first'
      })
      return
    }

    try {
      if (compileFirst) {
        await compileAndUpload(workspace.path, selectedBoard.port, selectedBoard.config)
      } else {
        await uploadSketch(selectedBoard.port, selectedBoard.config, workspace.path)
      }
    } catch (error) {
      console.error('Upload error:', error)
      toast.error('Upload failed', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  const isDisabled = isCompiling || isUploading || !selectedBoard || !isAgentConnected || !workspace
  const isLoading = isCompiling || isUploading

  const getButtonText = (): string => {
    if (isCompiling) return 'Compiling...'
    if (isUploading) {
      if (uploadProgress) {
        return `Uploading ${uploadProgress.percentage}%`
      }
      return 'Uploading...'
    }
    return 'Upload'
  }

  const getTooltipText = (): string => {
    if (isLoading) return getButtonText()
    if (!selectedBoard) return 'Select a board first'
    if (!isAgentConnected) return 'Arduino Agent not connected'
    if (!workspace) return 'Open a workspace with Arduino files first'
    return compileFirst ? 'Compile and upload to board' : 'Upload to board'
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          onClick={handleUpload}
          disabled={isDisabled}
          className={className}
        >
          {showIcon && (
            <>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </>
          )}
          {getButtonText()}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{getTooltipText()}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Combined Verify and Upload button group
 */
export function ArduinoControls({ className }: { className?: string }): React.JSX.Element {
  const { selectedBoard, isAgentConnected } = useArduinoContext()

  if (!isAgentConnected) {
    return (
      <div className={`flex items-center gap-2 ${className || ''}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="muted" disabled className="opacity-50">
              <AlertCircle className="h-4 w-4" />
              CLI Offline
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Arduino CLI is not available</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2 ${className || ''}`}>
      <VerifyButton />
      <UploadButton />
      {!selectedBoard && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-xs text-muted-foreground">Select board →</div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Please select an Arduino board to enable compilation and upload
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
