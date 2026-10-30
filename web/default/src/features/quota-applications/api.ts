/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/api'

import type {
  CreateQuotaApplicationPayload,
  QuotaApplication,
  QuotaApplicationList,
  QuotaApplicationTarget,
  QuotaApplicationSummary,
} from './types'

export async function listQuotaApplications(params: {
  status?: string
  keyword?: string
  page?: number
  pageSize?: number
}): Promise<QuotaApplicationList> {
  const res = await api.get('/api/quota-applications', {
    params: {
      status: params.status || undefined,
      keyword: params.keyword || undefined,
      p: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    },
  })
  return res.data.data
}

export async function getQuotaApplicationSummary(params: {
  from: number
  to: number
  applicantId?: number
}): Promise<QuotaApplicationSummary> {
  const res = await api.get('/api/quota-applications/summary', {
    params: {
      from: params.from,
      to: params.to,
      applicant_id: params.applicantId || undefined,
    },
  })
  return res.data.data
}

export async function searchQuotaApplicationTargets(
  keyword: string
): Promise<QuotaApplicationTarget[]> {
  const res = await api.get('/api/quota-applications/users/search', {
    params: { keyword },
  })
  return Array.isArray(res.data.data) ? res.data.data : []
}

export async function createQuotaApplication(
  payload: CreateQuotaApplicationPayload
) {
  return (await api.post('/api/quota-applications', payload)).data
}

export async function presignQuotaApplicationAttachment(file: File) {
  const res = await api.post('/api/quota-applications/attachments/presign', { file_name: file.name, content_type: file.type })
  return res.data.data as { object_key: string; upload_url: string; public_url: string }
}

export async function uploadQuotaApplicationAttachment(file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post('/api/quota-applications/attachments/upload', form)
  if (!res.data?.success || !res.data?.data) {
    throw new Error(res.data?.message || 'Attachment upload failed')
  }
  return res.data.data as { object_key: string; file_name: string; content_type: string; file_size: number; public_url: string }
}

export async function reviewQuotaApplication(
  id: number,
  approved: boolean,
  comment: string
): Promise<{ success: boolean; message?: string; data?: QuotaApplication }> {
  return (
    await api.post(`/api/quota-applications/${id}/review`, {
      approved,
      comment,
    })
  ).data
}
