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
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<AffiliateDialog>(null)
  const [amount, setAmount] = useState('')
  const [groups, setGroups] = useState<string[]>([])
  const [availableGroups, setAvailableGroups] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['affiliate-users', filter],
    queryFn: () => getAffiliateUsers(filter),
  })

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
