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
export type QuotaApplicationStatus = 'pending' | 'approved' | 'rejected'

export interface QuotaApplication {
  id: number
  applicant_id: number
  applicant_username: string
  target_user_id: number
  target_username: string
  target_display_name: string
  quota_amount: number
  invoice_amount_cents: number
  application_info: string
  status: QuotaApplicationStatus
  reviewed_by: number
  reviewer_username: string
  review_comment: string
  quota_before: number
  quota_after: number
  created_at: number
  reviewed_at: number
  updated_at: number
  attachments?: QuotaApplicationAttachment[]
}

export interface QuotaApplicationAttachment { id: number; object_key: string; file_name: string; content_type: string; file_size: number; public_url?: string }

export interface QuotaApplicationTarget {
  id: number
  username: string
  display_name: string
  quota: number
}

export interface QuotaApplicationList {
  items: QuotaApplication[]
  total: number
  page: number
  page_size: number
}

export interface QuotaApplicationSalesSummary {
  applicant_id: number
  applicant_username: string
  quota_amount: number
  application_count: number
  customer_count: number
}

export interface QuotaApplicationSummary {
  quota_amount: number
  application_count: number
  customer_count: number
  pending_quota: number
  pending_count: number
  rejected_quota: number
  rejected_count: number
  sales: QuotaApplicationSalesSummary[]
  applications: QuotaApplication[]
}

export interface CreateQuotaApplicationPayload {
  target_user_id: number
  quota_amount: number
  invoice_amount_cents: number
  application_info: string
  attachments?: Omit<QuotaApplicationAttachment, 'id'>[]
}
