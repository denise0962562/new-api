/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserConsumptionDialog } from '@/features/users/components/user-consumption-dialog'
import type { User } from '@/features/users/types'
import { api } from '@/lib/api'
import { formatQuota, parseQuotaFromDollars } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

type AffiliateUser = {
  id: number
  username: string
  display_name: string
  status: number
  role: number
  quota: number
  used_quota: number
  group: string
  inviter_id: number
  aff_count: number
  aff_history_quota: number
  created_at: number
  last_login_at: number
}

type AffiliateDialog =
  | { type: 'consumption'; user: AffiliateUser }
  | { type: 'transfer'; user: AffiliateUser }
  | { type: 'groups'; user: AffiliateUser }
  | { type: 'settlement'; user: AffiliateUser }
  | null

async function getAffiliateUsers(keyword: string) {
  const res = await api.get('/api/user/affiliate/users', {
    params: { p: 1, page_size: 100, keyword },
  })
  return res.data as {
    success: boolean
    data?: { items: AffiliateUser[] }
    message?: string
  }
}

const toUser = (user: AffiliateUser): User => ({
  ...user,
  request_count: 0,
})

export function Affiliate() {
  const { t } = useTranslation()
  const authUser = useAuthStore((s) => s.auth.user)
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<AffiliateDialog>(null)
  const [amount, setAmount] = useState('')
  const [groups, setGroups] = useState<string[]>([])
  const [availableGroups, setAvailableGroups] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [settlementEnd, setSettlementEnd] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10))
  const [settlementPreview, setSettlementPreview] = useState<any>(null)
  const [settlementRemark, setSettlementRemark] = useState(() => localStorage.getItem('affiliate.settlement.remark') || '')
  const [settlementAttachments, setSettlementAttachments] = useState<string[]>([])
  const [ruleSalesId, setRuleSalesId] = useState('')
  const [ruleGroup, setRuleGroup] = useState('')
  const [ruleRate, setRuleRate] = useState('1')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['affiliate-users', filter],
    queryFn: () => getAffiliateUsers(filter),
  })

  const { data: rulesData } = useQuery({ queryKey: ['affiliate-rules'], queryFn: async () => (await api.get('/api/user/affiliate/commission-rules')).data })
  const { data: settlementsData, refetch: refetchSettlements } = useQuery({ queryKey: ['affiliate-settlements'], queryFn: async () => (await api.get('/api/user/affiliate/settlements')).data })
  const loadSettlementPreview = async (user: AffiliateUser, endDate: string) => {
    const end = Math.floor(new Date(`${endDate}T23:59:59`).getTime() / 1000) + 1
    const res = await api.get(`/api/user/affiliate/users/${user.id}/settlement-preview`, { params: { end_at: end } })
    if (res.data.success) setSettlementPreview(res.data.data)
  }
  const submitSettlement = async () => {
    if (dialog?.type !== 'settlement' || !settlementPreview?.items?.length) return
    setSubmitting(true)
    try {
      const res = await api.post('/api/user/affiliate/settlements', { target_user_id: dialog.user.id, start_at: settlementPreview.start_at, end_at: settlementPreview.end_at, total_quota: settlementPreview.total_quota, total_commission: settlementPreview.total_commission, items: settlementPreview.items, remark: settlementRemark, attachment_keys: settlementAttachments })
      if (!res.data.success) { toast.error(res.data.message || t('Submission failed')); return }
      localStorage.setItem('affiliate.settlement.remark', settlementRemark)
      toast.success(t('Settlement application submitted')); setDialog(null); setSettlementPreview(null); setSettlementAttachments([])
    } finally { setSubmitting(false) }
  }
  const saveRule = async () => {
    const rate = Number(ruleRate)
    if (!Number.isFinite(rate) || rate < 0.1 || rate > 5 || !ruleSalesId || !ruleGroup) { toast.error(t('Rate must be between 0.1% and 5%')); return }
    const res = await api.post('/api/user/affiliate/commission-rules', { sales_id: Number(ruleSalesId), group_name: ruleGroup, rate_bps: Math.round(rate * 100) })
    if (res.data.success) { toast.success(t('Saved')); setRuleGroup(''); await refetch() } else toast.error(res.data.message || t('Save failed'))
  }

  const loadConsumption = useCallback(
    async (startTimestamp: number, endTimestamp: number) => {
      if (!dialog?.user) {
        return { success: true, data: [] }
      }
      const res = await api.get(
        `/api/user/affiliate/users/${dialog.user.id}/consumption-data`,
        {
          params: {
            start_timestamp: startTimestamp,
            end_timestamp: endTimestamp,
          },
        }
      )
      return res.data
    },
    [dialog]
  )

  const openGroups = async (user: AffiliateUser) => {
    const res = await api.get('/api/user/affiliate/groups')
    if (!res.data.success) {
      toast.error(res.data.message || t('Failed to load groups'))
      return
    }
    setAvailableGroups(res.data.data || [])
    setGroups([])
    setDialog({ type: 'groups', user })
  }

  const transferQuota = async () => {
    if (dialog?.type !== 'transfer') return
    const quota = parseQuotaFromDollars(Number(amount))
    if (!Number.isFinite(quota) || quota <= 0) {
      toast.error(t('Transfer amount must be greater than 0'))
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post(
        `/api/user/affiliate/users/${dialog.user.id}/transfer-quota`,
        { quota }
      )
      if (!res.data.success) {
        toast.error(res.data.message || t('Transfer failed'))
        return
      }
      toast.success(t('Quota transferred successfully'))
      setDialog(null)
      setAmount('')
      await refetch()
    } finally {
      setSubmitting(false)
    }
  }

  const addGroups = async () => {
    if (dialog?.type !== 'groups' || groups.length === 0) return
    setSubmitting(true)
    try {
      const res = await api.post(
        `/api/user/affiliate/users/${dialog.user.id}/groups`,
        { groups }
      )
      if (!res.data.success) {
        toast.error(res.data.message || t('Failed to add groups'))
        return
      }
      toast.success(t('Groups added successfully'))
      setDialog(null)
      setGroups([])
      await refetch()
    } finally {
      setSubmitting(false)
    }
  }

  const users = data?.data?.items || []
  let tableBody = users.map((user) => (
    <tr key={user.id} className='border-b align-middle'>
      <td className='p-3 font-medium'>{user.username}</td>
      <td>{user.status === 1 ? t('Enabled') : t('Disabled')}</td>
      <td>{formatQuota(user.quota)}</td>
      <td>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setDialog({ type: 'consumption', user })}
        >
          {formatQuota(user.used_quota)}
          <BarChart3 className='ml-2 size-4' />
        </Button>
      </td>
      <td className='max-w-64 break-words'>{user.group}</td>
      <td>{user.role}</td>
      <td>{t('{{count}} invited', { count: user.aff_count })}</td>
      <td>{new Date(user.created_at * 1000).toLocaleString()}</td>
      <td>
        {user.last_login_at
          ? new Date(user.last_login_at * 1000).toLocaleString()
          : '-'}
      </td>
      <td>
        <div className='flex gap-1'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              setAmount('')
              setDialog({ type: 'transfer', user })
            }}
          >
            {t('Transfer quota')}
          </Button>
          <Button size='sm' variant='outline' onClick={() => openGroups(user)}>
            {t('Add groups')}
          </Button>
          <Button size='sm' variant='outline' onClick={() => { setSettlementPreview(null); setSettlementAttachments([]); setDialog({ type: 'settlement', user }); loadSettlementPreview(user, settlementEnd) }}>
            {t('Apply settlement')}
          </Button>
        </div>
      </td>
    </tr>
  ))
  if (isLoading) {
    tableBody = [
      <tr key='loading'>
        <td className='p-3' colSpan={10}>
          {t('Loading...')}
        </td>
      </tr>,
    ]
  } else if (users.length === 0) {
    tableBody = [
      <tr key='empty'>
        <td className='text-muted-foreground p-8 text-center' colSpan={10}>
          {t('No direct subordinates')}
        </td>
      </tr>,
    ]
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('My direct subordinates')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          {authUser?.role === 100 && <div className='mb-4 rounded-md border p-3'><div className='mb-2 font-medium'>{t('Sales commission rules')}</div><div className='flex flex-wrap gap-2'><Input className='w-28' placeholder={t('Sales ID')} value={ruleSalesId} onChange={(e) => setRuleSalesId(e.target.value)} /><Input className='w-36' placeholder={t('Group')} value={ruleGroup} onChange={(e) => setRuleGroup(e.target.value)} /><Input className='w-28' type='number' min='0.1' max='5' step='0.1' placeholder='%' value={ruleRate} onChange={(e) => setRuleRate(e.target.value)} /><Button onClick={saveRule}>{t('Save rule')}</Button></div>{(rulesData?.data || []).map((r: any) => <div key={r.id} className='text-muted-foreground mt-2 text-xs'>{r.sales_id} · {r.group_name} · {r.rate_bps / 100}%</div>)}</div>}
          <div className='mb-4 flex gap-2'>
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setFilter(keyword)
              }}
              placeholder={t('Search username')}
            />
            <Button onClick={() => setFilter(keyword)}>{t('Search')}</Button>
          </div>
          <div className='mb-4 rounded-md border p-3'><div className='mb-2 font-medium'>{t('Settlement applications')}</div>{(settlementsData?.data || []).length === 0 ? <div className='text-muted-foreground text-sm'>{t('No settlement applications')}</div> : <div className='space-y-1 text-sm'>{(settlementsData?.data || []).map((a: any) => <div key={a.id} className='flex flex-wrap items-center justify-between gap-2 border-b py-2'><span>#{a.id} · {a.target_user_id}</span><span>{formatQuota(a.total_commission)} · {t(`Settlement ${a.status}`)}</span>{authUser?.role === 100 && a.status === 'pending' && <span className='flex gap-1'><Button size='sm' onClick={async () => { await api.post(`/api/user/affiliate/settlements/${a.id}/review`, { approved: true }); refetchSettlements() }}>{t('Approve')}</Button><Button size='sm' variant='outline' onClick={async () => { await api.post(`/api/user/affiliate/settlements/${a.id}/review`, { approved: false }); refetchSettlements() }}>{t('Reject')}</Button></span>}{authUser?.role === 100 && a.status === 'approved' && <Button size='sm' onClick={async () => { await api.post(`/api/user/affiliate/settlements/${a.id}/review`, { paid: true }); refetchSettlements() }}>{t('Mark as paid')}</Button>}</div>)}</div>}</div>
          <div className='overflow-auto rounded-md border'>
            <table className='w-full min-w-[1100px] text-sm'>
              <thead>
                <tr className='border-b text-left'>
                  <th className='p-3'>{t('Username')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Quota')}</th>
                  <th>{t('Consumption')}</th>
                  <th>{t('Group')}</th>
                  <th>{t('Role')}</th>
                  <th>{t('Invitation information')}</th>
                  <th>{t('Created at')}</th>
                  <th>{t('Last login')}</th>
                  <th>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>{tableBody}</tbody>
            </table>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      {dialog?.type === 'consumption' && (
        <UserConsumptionDialog
          user={toUser(dialog.user)}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          loadConsumption={loadConsumption}
        />
      )}

      <Dialog
        open={dialog?.type === 'transfer'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('Transfer quota')}
        description={dialog?.user.username}
        footer={
          <Button onClick={transferQuota} disabled={submitting || !amount}>
            {t('Confirm transfer')}
          </Button>
        }
      >
        <div className='space-y-2'>
          <label className='text-sm font-medium'>{t('Transfer amount')}</label>
          <Input
            type='number'
            min='0'
            step='0.000001'
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={t('Enter transfer amount')}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'The amount is deducted from your balance and credited to the subordinate.'
            )}
          </p>
        </div>
      </Dialog>

      <Dialog open={dialog?.type === 'settlement'} onOpenChange={(open) => !open && setDialog(null)} title={t('Apply settlement')} description={dialog?.user.username} contentClassName='sm:max-w-3xl' footer={<Button onClick={submitSettlement} disabled={submitting || !settlementPreview?.items?.length}>{t('Submit settlement')}</Button>}>
        <div className='space-y-4'>
          <div><label className='text-sm font-medium'>{t('Settlement end date')}</label><Input type='date' max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)} value={settlementEnd} onChange={(e) => { setSettlementEnd(e.target.value); if (dialog?.type === 'settlement') loadSettlementPreview(dialog.user, e.target.value) }} /></div>
          {settlementPreview?.items?.length ? <div className='rounded border p-3'><div className='mb-2 text-sm font-medium'>{t('Eligible group consumption')}</div>{settlementPreview.items.map((item: any) => <div key={item.group_name} className='flex justify-between border-b py-2 text-sm'><span>{item.group_name} · {item.rate_bps / 100}%</span><span>{formatQuota(item.quota)} → {formatQuota(item.commission)}</span></div>)}<div className='pt-2 text-right font-semibold'>{t('Total')}: {formatQuota(settlementPreview.total_commission)}</div></div> : <p className='text-muted-foreground text-sm'>{t('No eligible consumption')}</p>}
          <div><label className='text-sm font-medium'>{t('Calculation remark')}</label><textarea className='border-input bg-background min-h-24 w-full rounded-md border p-2 text-sm' value={settlementRemark} onChange={(e) => setSettlementRemark(e.target.value)} placeholder={t('Enter calculation remark')} /></div>
          <div><label className='text-sm font-medium'>{t('Payment method image')}</label><Input type='file' accept='image/*' multiple onChange={async (e) => { const files = Array.from(e.target.files || []).slice(0, 3); const keys: string[] = []; for (const file of files) { if (file.size > 10 * 1024 * 1024) { toast.error(t('Attachment exceeds 10 MB')); continue }; const body = new FormData(); body.append('file', file); const res = await api.post('/api/user/affiliate/settlement-attachments/upload', body, { headers: { 'Content-Type': 'multipart/form-data' } }); if (res.data.success) keys.push(res.data.data.object_key) }; setSettlementAttachments(keys) }} /><div className='text-muted-foreground text-xs'>{t('Optional, up to 3 images, 10 MB each')}</div></div>
        </div>
      </Dialog>

      <Dialog
        open={dialog?.type === 'groups'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('Add groups')}
        description={dialog?.user.username}
        footer={
          <Button
            onClick={addGroups}
            disabled={submitting || groups.length === 0}
          >
            {t('Confirm add')}
          </Button>
        }
      >
        <MultiSelect
          options={availableGroups.map((group) => ({
            label: group,
            value: group,
          }))}
          selected={groups}
          onChange={setGroups}
          placeholder={t('Select groups')}
          emptyText={t('No group found.')}
          maxVisibleChips={4}
        />
        <p className='text-muted-foreground mt-2 text-xs'>
          {t(
            'Only groups available to you can be added. Existing groups will not be removed.'
          )}
        </p>
      </Dialog>
    </>
  )
}
