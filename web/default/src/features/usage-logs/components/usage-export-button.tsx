import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, getSelf } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

export function UsageExportButton() {
  const cachedEnabled = useAuthStore(
    (s) => s.auth.user?.usage_export_enabled === true
  )
  const [enabled, setEnabled] = useState(cachedEnabled)
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [models, setModels] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let active = true
    getSelf()
      .then((res) => {
        if (active && res.success && res.data) {
          setEnabled(res.data.usage_export_enabled === true)
          useAuthStore.getState().auth.setUser(res.data)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!taskId || taskStatus === 'succeeded' || taskStatus === 'failed') return
    const timer = window.setInterval(async () => {
      try {
        const response = await api.get(`/api/usage-export/${taskId}?status=1`)
        const status = response.data?.data?.status as string | undefined
        if (status) setTaskStatus(status)
      } catch {
        setTaskStatus('failed')
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [taskId, taskStatus])

  if (!enabled) return null

  const submit = async () => {
    const startTimestamp = Math.floor(new Date(start).getTime() / 1000)
    const endTimestamp = Math.floor(new Date(end).getTime() / 1000)
    if (!startTimestamp || !endTimestamp) {
      toast.error('请选择开始时间和结束时间')
      return
    }
    if (endTimestamp < startTimestamp) {
      toast.error('结束时间不能早于开始时间')
      return
    }
    if (endTimestamp - startTimestamp > 31 * 86400) {
      toast.error('导出时间范围不能超过 31 天')
      return
    }
    setSubmitting(true)
    try {
      const response = await api.post(
        `/api/usage-export/?start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&models=${encodeURIComponent(models)}`
      )
      const createdTaskId = response.data?.data?.task_id as string | undefined
      if (!createdTaskId) throw new Error('missing task id')
      setTaskId(createdTaskId)
      setTaskStatus('pending')
      setOpen(false)
      toast.success('导出任务已创建，完成后可下载 CSV 文件')
    } catch {
      toast.error('创建导出任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  const download = async () => {
    if (!taskId || downloading) return
    setDownloading(true)
    try {
      const response = await api.get(`/api/usage-export/${taskId}`, {
        responseType: 'blob',
      })
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `usage-export-${taskId}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('下载导出文件失败')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className='flex items-center gap-2'>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Download className='mr-1 size-4' />
        导出消费记录
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>导出消费记录</DialogTitle>
            <DialogDescription>
              只导出最终成功的消费记录。时间范围最长 31 天，每日最多导出 5 次。
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-2'>
            <div className='grid gap-2'>
              <label className='text-sm font-medium'>开始时间</label>
              <Input type='datetime-local' value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className='grid gap-2'>
              <label className='text-sm font-medium'>结束时间</label>
              <Input type='datetime-local' value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className='grid gap-2'>
              <label className='text-sm font-medium'>模型（可选）</label>
              <Input placeholder='留空表示所有模型；多个模型用英文逗号分隔' value={models} onChange={(e) => setModels(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? '创建中…' : '开始导出'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {taskId && (
        <div className='text-muted-foreground flex items-center gap-2 text-xs'>
          {taskStatus === 'succeeded' ? (
            <Button size='sm' variant='secondary' onClick={download} disabled={downloading}>
              <Download className='mr-1 size-3.5' />{downloading ? '下载中…' : '下载 CSV'}
            </Button>
          ) : taskStatus === 'failed' ? (
            <span className='text-destructive'>导出失败</span>
          ) : (
            <span>正在生成导出文件…</span>
          )}
        </div>
      )}
    </div>
  )
}
