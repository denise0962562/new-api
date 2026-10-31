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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  const [ruleSalesSearch, setRuleSalesSearch] = useState('')
  const [ruleSalesResults, setRuleSalesResults] = useState<any[]>([])
  const [selectedRuleSales, setSelectedRuleSales] = useState<any>(null)
  const [ruleGroup, setRuleGroup] = useState('')
  const [ruleRate, setRuleRate] = useState('1')
  const [ruleEnabled, setRuleEnabled] = useState(true)
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const [ruleFilter, setRuleFilter] = useState('')
  const [activeTab, setActiveTab] = useState('subordinates')
  const isRoot = authUser?.role === 100

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['affiliate-users', filter],
    queryFn: () => getAffiliateUsers(filter),
  })

  const { data: rulesData } = useQuery({ queryKey: ['affiliate-rules', authUser?.id], queryFn: async () => (await api.get('/api/user/affiliate/commission-rules', { params: isRoot ? { sales_id: authUser?.id } : undefined })).data })
  const { data: adminRulesData, refetch: refetchAdminRules } = useQuery({ queryKey: ['affiliate-rules-admin'], queryFn: async () => (await api.get('/api/user/affiliate/commission-rules')).data, enabled: isRoot })
  const { data: groupsResponse } = useQuery({ queryKey: ['affiliate-configurable-groups'], queryFn: async () => (await api.get('/api/group/')).data, enabled: isRoot })
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
    if (!Number.isFinite(rate) || rate < 0.1 || rate > 5 || !selectedRuleSales || !ruleGroup) { toast.error(t('Rate must be between 0.1% and 5%')); return }
    const res = await api.post('/api/user/affiliate/commission-rules', { sales_id: selectedRuleSales.id, group_name: ruleGroup, rate_bps: Math.round(rate * 100), enabled: ruleEnabled })
    if (res.data.success) { toast.success(t('Saved')); setRuleGroup(''); setEditingRuleId(null); setRuleEnabled(true); await Promise.all([refetchAdminRules(), refetch()]) } else toast.error(res.data.message || t('Save failed'))
  }
  const searchRuleSales = async () => {
    if (!ruleSalesSearch.trim()) { setRuleSalesResults([]); return }
    const res = await api.get('/api/user/affiliate/commission-rules/users', { params: { keyword: ruleSalesSearch.trim() } })
    setRuleSalesResults(res.data.data || [])
  }
  const beginEditRule = (rule: any) => {
    setEditingRuleId(rule.id); setSelectedRuleSales({ id: rule.sales_id, username: rule.sales_username, display_name: rule.sales_display_name }); setRuleSalesSearch(`${rule.sales_display_name || rule.sales_username} (#${rule.sales_id})`); setRuleGroup(rule.group_name); setRuleRate(String(rule.rate_bps / 100)); setRuleEnabled(rule.enabled)
  }
  const resetRuleForm = () => { setEditingRuleId(null); setSelectedRuleSales(null); setRuleSalesSearch(''); setRuleGroup(''); setRuleRate('1'); setRuleEnabled(true); setRuleSalesResults([]) }

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
          {isRoot && <Tabs value={activeTab} onValueChange={setActiveTab} className='mb-4'>
            <TabsList><TabsTrigger value='subordinates'>{t('Direct subordinates')}</TabsTrigger><TabsTrigger value='rules'>{t('Sales commission rules')}</TabsTrigger></TabsList>
          </Tabs>}
          {isRoot && activeTab === 'rules' && <div className='space-y-4'>
            <section className='space-y-3 rounded-md border p-4'>
              <div className='font-medium'>{editingRuleId ? t('Edit commission rule') : t('Add commission rule')}</div>
              <div className='grid gap-3 md:grid-cols-2'>
                <div className='space-y-2'>
                  <label className='text-sm font-medium'>{t('Sales user')}</label>
                  {selectedRuleSales ? <div className='flex items-center justify-between rounded-md border px-3 py-2 text-sm'><span>{selectedRuleSales.display_name || selectedRuleSales.username} · {selectedRuleSales.username} · #{selectedRuleSales.id}</span><Button size='sm' variant='ghost' onClick={() => { setSelectedRuleSales(null); setRuleSalesSearch('') }}>{t('Change')}</Button></div> : <>
                    <div className='flex gap-2'><Input value={ruleSalesSearch} onChange={(e) => setRuleSalesSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchRuleSales()} placeholder={t('Search any user by ID, username, or display name')} /><Button variant='outline' onClick={searchRuleSales}>{t('Search')}</Button></div>
                    {ruleSalesResults.length > 0 && <div className='max-h-48 overflow-auto rounded-md border'>{ruleSalesResults.map((u) => <button type='button' key={u.id} className='hover:bg-muted flex w-full items-center justify-between border-b p-2 text-left text-sm last:border-0' onClick={() => { setSelectedRuleSales(u); setRuleSalesSearch(`${u.display_name || u.username} (#${u.id})`); setRuleSalesResults([]) }}><span>{u.display_name || u.username} · {u.username} · #{u.id}</span><span className='text-muted-foreground'>{t('Role {{role}}', { role: u.role })}</span></button>)}</div>}
                  </>}
                </div>
                <div className='space-y-2'><label className='text-sm font-medium'>{t('Group')}</label><select className='border-input bg-background h-9 w-full rounded-md border px-3 text-sm' value={ruleGroup} onChange={(e) => setRuleGroup(e.target.value)}><option value=''>{t('Select a group')}</option>{(Array.isArray(groupsResponse?.data) ? groupsResponse.data : []).map((g: string) => <option key={g} value={g}>{g}</option>)}</select></div>
                <div className='space-y-2'><label className='text-sm font-medium'>{t('Commission rate (%)')}</label><Input type='number' min='0.1' max='5' step='0.1' value={ruleRate} onChange={(e) => setRuleRate(e.target.value)} /><p className='text-muted-foreground text-xs'>{t('Rate must be between 0.1% and 5%')}</p></div>
                <label className='flex items-center gap-2 self-center text-sm'><input type='checkbox' checked={ruleEnabled} onChange={(e) => setRuleEnabled(e.target.checked)} />{t('Enabled')}</label>
              </div>
              <div className='flex gap-2'><Button onClick={saveRule}>{editingRuleId ? t('Save changes') : t('Save rule')}</Button>{editingRuleId && <Button variant='outline' onClick={resetRuleForm}>{t('Cancel')}</Button>}</div>
            </section>
            <section className='space-y-3 rounded-md border p-4'>
              <div className='flex flex-wrap items-center justify-between gap-2'><h3 className='font-medium'>{t('Configured commission rules')}</h3><Input className='max-w-xs' value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)} placeholder={t('Search sales or group')} /></div>
              <div className='overflow-auto'><table className='w-full min-w-[720px] text-sm'><thead><tr className='border-b text-left'><th className='p-2'>{t('Sales user')}</th><th>{t('Group')}</th><th>{t('Commission rate')}</th><th>{t('Status')}</th><th>{t('Updated at')}</th><th>{t('Actions')}</th></tr></thead><tbody>{(adminRulesData?.data || []).filter((r: any) => `${r.sales_username} ${r.sales_display_name} ${r.sales_id} ${r.group_name}`.toLowerCase().includes(ruleFilter.toLowerCase())).map((r: any) => <tr key={r.id} className='border-b'><td className='p-2'>{r.sales_display_name || r.sales_username} · {r.sales_username} · #{r.sales_id}</td><td>{r.group_name}</td><td>{(r.rate_bps / 100).toFixed(2)}%</td><td>{r.enabled ? t('Enabled') : t('Disabled')}</td><td>{r.updated_at ? new Date(r.updated_at * 1000).toLocaleString() : '-'}</td><td><Button size='sm' variant='outline' onClick={() => beginEditRule(r)}>{t('Edit')}</Button></td></tr>)}{(adminRulesData?.data || []).length === 0 && <tr><td colSpan={6} className='text-muted-foreground p-6 text-center'>{t('No commission rules')}</td></tr>}</tbody></table></div>
              <p className='text-muted-foreground text-xs'>{t('Rule changes only apply to new settlement applications.')}</p>
            </section>
          </div>}
          {(!isRoot || activeTab === 'subordinates') && <>
          {!isRoot && <section className='mb-4 rounded-md border p-4'><h3 className='mb-2 font-medium'>{t('My commission rates')}</h3>{(rulesData?.data || []).length ? <div className='flex flex-wrap gap-2'>{(rulesData?.data || []).filter((r: any) => r.enabled).map((r: any) => <div key={r.id} className='rounded-md bg-muted px-3 py-2 text-sm'><span className='font-medium'>{r.group_name}</span><span className='ml-2'>{(r.rate_bps / 100).toFixed(2)}%</span></div>)}</div> : <p className='text-muted-foreground text-sm'>{t('No commission rules are configured for you. Please contact the root administrator.')}</p>}<p className='text-muted-foreground mt-2 text-xs'>{t('Only configured active groups are included in settlement applications.')}</p></section>}
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
          </>}
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
