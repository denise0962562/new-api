import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'

type Config = {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  public_base_url: string
  access_key_id: string
  access_key_secret: string
}
const empty: Config = {
  enabled: false,
  endpoint: '',
  region: 'auto',
  bucket: '',
  public_base_url: '',
  access_key_id: '',
  access_key_secret: '',
}

export function R2StorageSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<Config>(empty)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api
      .get('/api/quota-applications/r2/config')
      .then((res) => {
        const data = res.data.data
        setConfig((value) => ({
          ...value,
          enabled: Boolean(data.enabled),
          endpoint: data.endpoint || '',
          region: data.region || 'auto',
          bucket: data.bucket || '',
          public_base_url: data.public_base_url || '',
          // The API intentionally returns only whether credentials exist.
          // Empty fields make the backend preserve the stored credentials.
          access_key_id: '',
          access_key_secret: '',
        }))
      })
      .catch(() => toast.error(t('Failed to load R2 settings')))
  }, [t])
  const update = (key: keyof Config, value: string | boolean) =>
    setConfig((current) => ({ ...current, [key]: value }))
  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/quota-applications/r2/config', config)
      toast.success(t('R2 settings saved'))
      setConfig((value) => ({ ...value, access_key_secret: '' }))
    } catch {
      toast.error(t('Failed to save R2 settings'))
    } finally {
      setSaving(false)
    }
  }
  const labels: Record<keyof Config, string> = {
    enabled: t('Enable R2 uploads'),
    endpoint: t('R2 endpoint'),
    region: t('R2 region'),
    bucket: t('R2 bucket'),
    public_base_url: t('R2 public base URL'),
    access_key_id: t('R2 access key ID'),
    access_key_secret: t('R2 access key secret'),
  }
  return (
    <div className='space-y-5 rounded-lg border p-5'>
      <div>
        <h3 className='font-medium'>{t('R2 attachment storage')}</h3>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Used for quota application screenshots. Credentials are never displayed after saving.'
          )}
        </p>
      </div>
      <div className='flex items-center justify-between rounded-md border p-3'>
        <Label>{t('Enable R2 uploads')}</Label>
        <Switch
          checked={config.enabled}
          onCheckedChange={(value) => update('enabled', value)}
        />
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        {(
          [
            'endpoint',
            'region',
            'bucket',
            'public_base_url',
            'access_key_id',
            'access_key_secret',
          ] as const
        ).map((key) => (
          <div key={key} className='space-y-2'>
            <Label>{labels[key]}</Label>
            <Input
              type={key === 'access_key_secret' ? 'password' : 'text'}
              value={config[key]}
              onChange={(event) => update(key, event.target.value)}
              placeholder={
                key === 'access_key_secret'
                  ? t('Leave empty to keep current secret')
                  : ''
              }
            />
          </div>
        ))}
      </div>
      <Button onClick={save} disabled={saving}>
        {saving ? t('Saving...') : t('Save R2 settings')}
      </Button>
    </div>
  )
}
