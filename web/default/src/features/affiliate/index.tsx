/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { formatQuota } from '@/lib/format'

type AffiliateUser = {
  id: number
  username: string
  status: number
  role: number
  quota: number
  used_quota: number
  group: string
  aff_count: number
  aff_history_quota: number
  created_at: number
  last_login_at: number
}

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

export function Affiliate() {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState('')
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['affiliate-users', filter],
    queryFn: () => getAffiliateUsers(filter),
  })

  const showConsumption = async (user: AffiliateUser) => {
    const res = await api.get(
      `/api/user/affiliate/users/${user.id}/consumption`
    )
    if (res.data.success) {
      const value = res.data.data
      toast.info(
        `Consumption: ${formatQuota(value.used_quota)} / ${formatQuota(value.total_quota)}`
      )
    } else toast.error(res.data.message || t('Failed to load consumption'))
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('My direct subordinates')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mb-4 flex gap-2'>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('Search username')}
          />
          <Button onClick={() => setFilter(keyword)}>{t('Search')}</Button>
        </div>
        <div className='overflow-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b text-left'>
                <th className='p-3'>{t('Username')}</th>
                <th>{t('Status')}</th>
                <th>{t('Quota')}</th>
                <th>Consumption</th>
                <th>{t('Group')}</th>
                <th>{t('Role')}</th>
                <th>{t('Created at')}</th>
                <th>{t('Last login')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className='p-3' colSpan={8}>
                    {t('Loading...')}
                  </td>
                </tr>
              ) : (
                (data?.data?.items || []).map((user) => (
                  <tr key={user.id} className='border-b'>
                    <td className='p-3'>{user.username}</td>
                    <td>{user.status === 1 ? t('Enabled') : t('Disabled')}</td>
                    <td>{formatQuota(user.quota)}</td>
                    <td>
                      <Button
                        variant='link'
                        onClick={() => showConsumption(user)}
                      >
                        {formatQuota(user.used_quota)}
                      </Button>
                    </td>
                    <td>{user.group}</td>
                    <td>{user.role}</td>
                    <td>{new Date(user.created_at * 1000).toLocaleString()}</td>
                    <td>
                      {user.last_login_at
                        ? new Date(user.last_login_at * 1000).toLocaleString()
                        : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Button className='mt-4' variant='outline' onClick={() => refetch()}>
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
