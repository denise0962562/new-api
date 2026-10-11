import { useQuery } from '@tanstack/react-query'
import { Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { formatTimestampToDate } from '@/lib/format'

import { getChannelTaskHealth, resetChannelTaskHealth } from '../../api'
import { channelsQueryKeys } from '../../lib'
import { useChannels } from '../channels-provider'

type TaskHealthDialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

export function TaskHealthDialog({ open, onOpenChange }: TaskHealthDialogProps) {
  const { t } = useTranslation()
  const { currentRow } = useChannels()
  const channelId = currentRow?.id || 0
  const { data, isLoading, refetch } = useQuery({
    queryKey: [...channelsQueryKeys.detail(channelId), 'task-health'],
    queryFn: () => getChannelTaskHealth(channelId),
    enabled: open && channelId > 0,
  })

  const handleReset = async (modelName: string) => {
    try {
      const result = await resetChannelTaskHealth(channelId, modelName)
      if (!result.success) throw new Error(result.message || t('Operation failed'))
      toast.success(t('Reset successfully'))
      await refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Operation failed'))
    }
  }

  if (!currentRow) return null
  const items = data?.data?.items || []
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Task Failure Details')}
      description={currentRow.name}
      contentHeight='min(70vh, 640px)'
      bodyClassName='overflow-y-auto'
      footer={
        <Button variant='outline' onClick={() => onOpenChange(false)}>
          {t('Close')}
        </Button>
      }
    >
      {isLoading ? (
        <div className='flex justify-center py-8'><Loader2 className='size-5 animate-spin' /></div>
      ) : items.length === 0 ? (
        <div className='text-muted-foreground py-8 text-center'>{t('No models')}</div>
      ) : (
        <div className='space-y-2'>
          {items.map((item) => (
            <div key={item.model_name} className='flex items-center justify-between gap-3 rounded-md border p-3'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>{item.model_name}</div>
                <div className='text-muted-foreground text-xs'>
                  {item.last_failure_at ? formatTimestampToDate(item.last_failure_at) : t('No failures')}
                </div>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                <span className={item.consecutive_failures > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}>
                  {item.consecutive_failures}
                </span>
                <Button variant='ghost' size='icon-sm' onClick={() => handleReset(item.model_name)} title={t('Reset')}>
                  <RotateCcw className='size-4' />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}
