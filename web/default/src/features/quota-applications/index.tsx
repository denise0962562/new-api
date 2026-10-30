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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  BarChart3,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import {
  formatQuota,
  formatTimestamp,
  parseQuotaFromDollars,
} from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  createQuotaApplication,
  uploadQuotaApplicationAttachment,
  getQuotaApplicationSummary,
  listQuotaApplications,
  reviewQuotaApplication,
  updateQuotaApplicationAccounting,
  searchQuotaApplicationTargets,
} from './api'
import type {
  QuotaApplication,
  QuotaApplicationStatus,
  QuotaApplicationTarget,
} from './types'

function getReconciliationRange(granularity: string, value: string) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date()
  let start = new Date(date)
  let end = new Date(date)
  if (granularity === 'month') {
    start = new Date(date.getFullYear(), date.getMonth(), 1)
    end = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  } else if (granularity === 'week') {
    const day = date.getDay() || 7
    start = new Date(date)
    start.setDate(date.getDate() - day + 1)
    end = new Date(start)
    end.setDate(start.getDate() + 7)
  } else {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    end = new Date(start)
    end.setDate(start.getDate() + 1)
  }
  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  }
}

function getLocalDateInputValue() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function ReconciliationView(props: { isRoot: boolean }) {
  const { t } = useTranslation()
  const [granularity, setGranularity] = useState('day')
  const [date, setDate] = useState(getLocalDateInputValue)
  const [applicantId, setApplicantId] = useState<number | undefined>()
  const range = getReconciliationRange(granularity, date)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['quota-application-summary', range.from, range.to, applicantId],
    queryFn: () => getQuotaApplicationSummary({ ...range, applicantId }),
  })
  const summary = data
    ? {
        ...data,
        // Older API responses may serialize empty slices as null.
        sales: Array.isArray(data.sales) ? data.sales : [],
        applications: Array.isArray(data.applications) ? data.applications : [],
      }
    : {
        quota_amount: 0,
        application_count: 0,
        customer_count: 0,
        pending_quota: 0,
        pending_count: 0,
        rejected_quota: 0,
        rejected_count: 0,
        sales: [],
        applications: [],
        invoice_amount_cents: 0,
        paid_quota: 0,
        unpaid_quota: 0,
        unpaid_count: 0,
        test_quota: 0,
        test_count: 0,
      }
  const selectedSales = props.isRoot ? summary.sales : []
  return (
    <div className='space-y-4'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
        <Select
          value={granularity}
          onValueChange={(value) => value && setGranularity(value)}
        >
          <SelectTrigger className='w-full sm:w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='day'>{t('Daily')}</SelectItem>
            <SelectItem value='week'>{t('Weekly')}</SelectItem>
            <SelectItem value='month'>{t('Monthly')}</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type='date'
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className='w-full sm:w-48'
        />
        {props.isRoot && (
          <Select
            value={applicantId ? String(applicantId) : 'all'}
            onValueChange={(value) =>
              setApplicantId(
                value && value !== 'all' ? Number(value) : undefined
              )
            }
          >
            <SelectTrigger className='w-full sm:w-56'>
              <SelectValue placeholder={t('All sales')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('All sales')}</SelectItem>
              {selectedSales.map((sale) => (
                <SelectItem
                  key={sale.applicant_id}
                  value={String(sale.applicant_id)}
                >
                  {sale.applicant_username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {isError && (
        <p className='text-destructive text-sm'>
          {t('Failed to load reconciliation')}
        </p>
      )}
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
        {[
          [t('Credited quota'), formatQuota(summary.quota_amount)],
          [t('Customers'), summary.customer_count],
          [t('Applications'), summary.application_count],
          [t('Pending quota'), formatQuota(summary.pending_quota)],
          [t('Rejected quota'), formatQuota(summary.rejected_quota)],
          [t('Paid quota'), formatQuota(summary.paid_quota)],
          [t('Unpaid quota'), formatQuota(summary.unpaid_quota)],
          [
            t('Invoice amount (CNY)'),
            `CNY ${(summary.invoice_amount_cents / 100).toFixed(2)}`,
          ],
          [t('Test quota'), formatQuota(summary.test_quota)],
        ].map(([label, value]) => (
          <div key={String(label)} className='rounded-lg border p-4'>
            <p className='text-muted-foreground text-xs'>{label}</p>
            <p className='mt-2 text-xl font-semibold'>
              {isLoading ? '—' : value}
            </p>
          </div>
        ))}
      </div>
      {props.isRoot && !applicantId && summary.sales.length > 0 && (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Sales administrator')}</TableHead>
                <TableHead>{t('Credited quota')}</TableHead>
                <TableHead>{t('Customers')}</TableHead>
                <TableHead>{t('Applications')}</TableHead>
                <TableHead>{t('Paid quota')}</TableHead>
                <TableHead>{t('Unpaid quota')}</TableHead>
                <TableHead>{t('Invoice amount (CNY)')}</TableHead>
                <TableHead>{t('Test quota')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.sales.map((sale) => (
                <TableRow key={sale.applicant_id}>
                  <TableCell>{sale.applicant_username}</TableCell>
                  <TableCell>{formatQuota(sale.quota_amount)}</TableCell>
                  <TableCell>{sale.customer_count}</TableCell>
                  <TableCell>{sale.application_count}</TableCell>
                  <TableCell>{formatQuota(sale.paid_quota)}</TableCell>
                  <TableCell>{formatQuota(sale.unpaid_quota)}</TableCell>
                  <TableCell>
                    CNY {(sale.invoice_amount_cents / 100).toFixed(2)}
                  </TableCell>
                  <TableCell>{formatQuota(sale.test_quota)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className='rounded-md border'>
        <Table className='min-w-[850px]'>
          <TableHeader>
            <TableRow>
              <TableHead>
                {props.isRoot ? t('Sales administrator') : t('Target user')}
              </TableHead>
              {props.isRoot && <TableHead>{t('Target user')}</TableHead>}
              <TableHead>{t('Credit amount')}</TableHead>
              <TableHead>{t('Payment status')}</TableHead>
              <TableHead>{t('Invoice amount (CNY)')}</TableHead>
              <TableHead>{t('Amount type')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead>{t('Submitted at')}</TableHead>
              <TableHead>{t('Reviewed at')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.applications.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={props.isRoot ? 6 : 5}
                  className='text-muted-foreground h-24 text-center'
                >
                  {isLoading ? t('Loading...') : t('No applications')}
                </TableCell>
              </TableRow>
            ) : (
              summary.applications.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {props.isRoot
                      ? item.applicant_username
                      : item.target_username}
                  </TableCell>
                  {props.isRoot && (
                    <TableCell>{item.target_username}</TableCell>
                  )}
                  <TableCell className='font-medium'>
                    {formatQuota(item.quota_amount)}
                  </TableCell>
                  <TableCell>
                    {t(item.payment_status === 'paid' ? 'Paid' : 'Unpaid')}
                  </TableCell>
                  <TableCell>
                    {item.invoice_required || item.invoice_amount_cents > 0
                      ? `CNY ${(item.invoice_amount_cents / 100).toFixed(2)}`
                      : t('No invoice required')}
                  </TableCell>
                  <TableCell>
                    {item.is_test_amount
                      ? t('Test amount')
                      : t('Formal amount')}
                  </TableCell>
                  <TableCell>
                    <ApplicationStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell>{formatTimestamp(item.created_at)}</TableCell>
                  <TableCell>
                    {item.reviewed_at ? formatTimestamp(item.reviewed_at) : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

const statusLabels: Record<QuotaApplicationStatus, string> = {
  pending: 'Pending review',
  approved: 'Credited',
  rejected: 'Rejected',
}

function ApplicationStatusBadge(props: { status: QuotaApplicationStatus }) {
  const { t } = useTranslation()
  let variant: 'default' | 'destructive' | 'secondary' = 'secondary'
  if (props.status === 'approved') variant = 'default'
  if (props.status === 'rejected') variant = 'destructive'
  return <Badge variant={variant}>{t(statusLabels[props.status])}</Badge>
}

function ApplicationDetails(props: {
  application: QuotaApplication | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const item = props.application
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={t('Quota application details')}
      contentHeight='auto'
      footer={
        <Button variant='outline' onClick={props.onClose}>
          {t('Close')}
        </Button>
      }
    >
      {item && (
        <div className='space-y-5 text-sm'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div>
              <p className='text-muted-foreground'>{t('Application ID')}</p>
              <p className='font-medium'>#{item.id}</p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('Status')}</p>
              <ApplicationStatusBadge status={item.status} />
            </div>
            <div>
              <p className='text-muted-foreground'>{t('Applicant')}</p>
              <p className='font-medium'>{item.applicant_username}</p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('Target user')}</p>
              <p className='font-medium'>{item.target_username}</p>
              <p className='text-muted-foreground'>
                {item.target_display_name && `${item.target_display_name} · `}
                ID {item.target_user_id}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('Credit amount')}</p>
              <p className='font-medium'>{formatQuota(item.quota_amount)}</p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('Payment status')}</p>
              <p className='font-medium'>
                {t(item.payment_status === 'paid' ? 'Paid' : 'Unpaid')}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground'>
                {t('Invoice amount (CNY)')}
              </p>
              <p className='font-medium'>
                {item.invoice_required || item.invoice_amount_cents > 0
                  ? `CNY ${(item.invoice_amount_cents / 100).toFixed(2)}`
                  : t('No invoice required')}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('Amount type')}</p>
              <p className='font-medium'>
                {item.is_test_amount ? t('Test amount') : t('Formal amount')}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('Submitted at')}</p>
              <p className='font-medium'>{formatTimestamp(item.created_at)}</p>
            </div>
          </div>
          <div>
            <p className='text-muted-foreground mb-1'>
              {t('Application information')}
            </p>
            <p className='bg-muted/50 rounded-md border p-3 whitespace-pre-wrap'>
              {item.application_info}
            </p>
          </div>
          {item.attachments && item.attachments.length > 0 && (
            <div>
              <p className='text-muted-foreground mb-2'>
                {t('Supporting screenshots')}
              </p>
              <div className='grid grid-cols-3 gap-2'>
                {item.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.public_url || '#'}
                    target='_blank'
                    rel='noreferrer'
                    className='bg-muted block overflow-hidden rounded-md border'
                  >
                    <img
                      src={attachment.public_url}
                      alt={attachment.file_name}
                      className='h-28 w-full object-cover'
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
          {item.status !== 'pending' && (
            <div className='border-t pt-4'>
              <p className='font-medium'>{t('Review result')}</p>
              <p className='text-muted-foreground mt-1'>
                {item.reviewer_username || `ID ${item.reviewed_by}`} ·{' '}
                {formatTimestamp(item.reviewed_at)}
              </p>
              {item.review_comment && (
                <p className='mt-2 whitespace-pre-wrap'>
                  {item.review_comment}
                </p>
              )}
              {item.status === 'approved' && (
                <p className='mt-2'>
                  {formatQuota(item.quota_before)} →{' '}
                  {formatQuota(item.quota_after)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

function CreateApplicationDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selectedUser, setSelectedUser] =
    useState<QuotaApplicationTarget | null>(null)
  const [amount, setAmount] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid'>(
    'unpaid'
  )
  const [isTestAmount, setIsTestAmount] = useState(false)
  const [invoiceRequired, setInvoiceRequired] = useState(false)
  const [applicationInfo, setApplicationInfo] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const { data: targets = [], isFetching } = useQuery({
    queryKey: ['quota-application-targets', keyword],
    queryFn: () => searchQuotaApplicationTargets(keyword),
    enabled: props.open && keyword.length > 0,
  })

  const reset = () => {
    setKeywordInput('')
    setKeyword('')
    setSelectedUser(null)
    setAmount('')
    setInvoiceAmount('')
    setPaymentStatus('unpaid')
    setIsTestAmount(false)
    setInvoiceRequired(false)
    setApplicationInfo('')
    setAttachments([])
  }
  const close = () => {
    reset()
    props.onOpenChange(false)
  }
  const submit = async () => {
    const quotaAmount = parseQuotaFromDollars(Number(amount))
    const invoiceAmountCents = Math.round(Number(invoiceAmount) * 100)
    if (!selectedUser) {
      toast.error(t('Select a target user'))
      return
    }
    if (quotaAmount <= 0) {
      toast.error(t('Enter a valid credit amount'))
      return
    }
    if (invoiceRequired && invoiceAmountCents <= 0) {
      toast.error(t('Enter a valid invoice amount'))
      return
    }
    if (!applicationInfo.trim()) {
      toast.error(t('Application information is required'))
      return
    }
    setSubmitting(true)
    try {
      const uploaded = []
      for (const file of attachments) {
        uploaded.push(await uploadQuotaApplicationAttachment(file))
      }
      const result = await createQuotaApplication({
        target_user_id: selectedUser.id,
        quota_amount: quotaAmount,
        invoice_amount_cents: invoiceAmountCents,
        payment_status: paymentStatus,
        is_test_amount: isTestAmount,
        invoice_required: invoiceRequired,
        application_info: applicationInfo.trim(),
        attachments: uploaded,
      })
      if (result.success) {
        toast.success(t('Quota application submitted'))
        close()
        props.onCreated()
      } else {
        toast.error(result.message || t('Failed to submit quota application'))
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Failed to submit quota application')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
      title={t('New quota application')}
      description={t('Submit a credit request for an enabled normal user.')}
      contentHeight='min(620px, calc(100vh - 14rem))'
      footer={
        <>
          <Button variant='outline' onClick={close}>
            {t('Cancel')}
          </Button>
          <Button disabled={submitting} onClick={submit}>
            {submitting ? t('Submitting...') : t('Submit application')}
          </Button>
        </>
      }
    >
      <div className='space-y-5'>
        <div className='space-y-2'>
          <Label>{t('Target user')}</Label>
          <div className='flex gap-2'>
            <Input
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setKeyword(keywordInput.trim())
              }}
              placeholder={t('Search by username, display name, or user ID')}
            />
            <Button
              type='button'
              variant='outline'
              size='icon'
              title={t('Search')}
              onClick={() => setKeyword(keywordInput.trim())}
            >
              <Search />
            </Button>
          </div>
          {selectedUser ? (
            <div className='flex items-center justify-between rounded-md border p-3'>
              <div>
                <p className='font-medium'>{selectedUser.username}</p>
                <p className='text-muted-foreground text-xs'>
                  {selectedUser.display_name &&
                    `${selectedUser.display_name} · `}
                  ID {selectedUser.id} · {formatQuota(selectedUser.quota)}
                </p>
              </div>
              <Button
                variant='ghost'
                size='icon'
                title={t('Clear selection')}
                onClick={() => setSelectedUser(null)}
              >
                <X />
              </Button>
            </div>
          ) : null}
          {!selectedUser && keyword ? (
            <div className='max-h-44 overflow-y-auto rounded-md border'>
              {isFetching && (
                <p className='text-muted-foreground p-3 text-sm'>
                  {t('Searching...')}
                </p>
              )}
              {!isFetching && targets.length === 0 && (
                <p className='text-muted-foreground p-3 text-sm'>
                  {t('No users found')}
                </p>
              )}
              {targets.map((target) => (
                <button
                  key={target.id}
                  type='button'
                  className='hover:bg-muted flex w-full items-center justify-between border-b p-3 text-left last:border-b-0'
                  onClick={() => setSelectedUser(target)}
                >
                  <span>
                    <span className='block font-medium'>{target.username}</span>
                    <span className='text-muted-foreground text-xs'>
                      {target.display_name && `${target.display_name} · `}
                      ID {target.id}
                    </span>
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {formatQuota(target.quota)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className='grid gap-4 sm:grid-cols-3'>
          <div className='space-y-2'>
            <Label>{t('Payment status')}</Label>
            <Select
              value={paymentStatus}
              onValueChange={(value) =>
                value && setPaymentStatus(value as 'paid' | 'unpaid')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='unpaid'>{t('Unpaid')}</SelectItem>
                <SelectItem value='paid'>{t('Paid')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <Label>{t('Invoice requirement')}</Label>
            <Select
              value={invoiceRequired ? 'yes' : 'no'}
              onValueChange={(value) => setInvoiceRequired(value === 'yes')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='no'>{t('No invoice required')}</SelectItem>
                <SelectItem value='yes'>{t('Invoice required')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center justify-between rounded-md border p-3'>
            <Label>{t('Test amount')}</Label>
            <Switch checked={isTestAmount} onCheckedChange={setIsTestAmount} />
          </div>
        </div>

        <div className='space-y-2'>
          <Label>{t('Supporting screenshots (optional)')}</Label>
          <Input
            type='file'
            accept='image/*'
            multiple
            onChange={(event) => {
              const selected = [...(event.target.files ?? [])]
              if (
                selected.length > 3 ||
                selected.some((file) => file.size > 10 * 1024 * 1024)
              ) {
                toast.error(
                  t('Select up to 3 images, each no larger than 10 MB')
                )
                return
              }
              setAttachments(selected)
            }}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Upload 0 to 3 payment or invoice screenshots. Each image must be no larger than 10 MB.'
            )}
          </p>
          {attachments.length > 0 && (
            <div className='text-muted-foreground text-xs'>
              {attachments
                .map(
                  (file) =>
                    `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`
                )
                .join('、')}
            </div>
          )}
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label>
              {t('Credit amount')} ({currencyLabel})
            </Label>
            <Input
              type='number'
              min={currencyMeta.kind === 'tokens' ? 1 : 0.000001}
              step={currencyMeta.kind === 'tokens' ? 1 : 0.000001}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>{t('Invoice amount (CNY)')}</Label>
            <Input
              type='number'
              min={0}
              step={0.01}
              value={invoiceAmount}
              disabled={!invoiceRequired}
              onChange={(event) => setInvoiceAmount(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Enter the amount that should be invoiced to the customer.')}
            </p>
          </div>
        </div>

        <div className='space-y-2'>
          <Label>{t('Application information')}</Label>
          <Textarea
            rows={6}
            maxLength={2000}
            value={applicationInfo}
            onChange={(event) => setApplicationInfo(event.target.value)}
            placeholder={t(
              'Enter company, payment, contact, and other relevant information'
            )}
          />
          <p className='text-muted-foreground text-right text-xs'>
            {applicationInfo.length}/2000
          </p>
        </div>
      </div>
    </Dialog>
  )
}

export function QuotaApplications() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const isRoot = user?.role === ROLE.SUPER_ADMIN
  const [view, setView] = useState<'applications' | 'reconciliation'>(
    'applications'
  )
  const [status, setStatus] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [testFilter, setTestFilter] = useState('all')
  const [invoiceFilter, setInvoiceFilter] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [details, setDetails] = useState<QuotaApplication | null>(null)
  const [reviewing, setReviewing] = useState<QuotaApplication | null>(null)
  const [approved, setApproved] = useState(true)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewPaymentStatus, setReviewPaymentStatus] = useState<
    'paid' | 'unpaid'
  >('unpaid')
  const [reviewTestAmount, setReviewTestAmount] = useState(false)
  const [reviewInvoiceRequired, setReviewInvoiceRequired] = useState(false)
  const [reviewInvoiceAmount, setReviewInvoiceAmount] = useState('')
  const [reviewingBusy, setReviewingBusy] = useState(false)
  const [accountingEdit, setAccountingEdit] = useState<QuotaApplication | null>(
    null
  )
  const pageSize = 20
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      'quota-applications',
      status,
      paymentFilter,
      testFilter,
      invoiceFilter,
      keyword,
      page,
    ],
    queryFn: () =>
      listQuotaApplications({
        status: status === 'all' ? '' : status,
        paymentStatus: paymentFilter === 'all' ? '' : paymentFilter,
        testAmount: testFilter === 'all' ? '' : testFilter,
        invoiceRequired: invoiceFilter === 'all' ? '' : invoiceFilter,
        keyword,
        page,
        pageSize,
      }),
  })
  const items = data?.items ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))
  let emptyMessage = t('No quota applications')
  if (isLoading) emptyMessage = t('Loading...')
  if (isError) emptyMessage = t('Failed to load quota applications')
  let reviewButtonLabel = approved ? t('Approve and credit') : t('Reject')
  if (reviewingBusy) reviewButtonLabel = t('Processing...')
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['quota-applications'] })

  const openReview = (item: QuotaApplication, shouldApprove: boolean) => {
    setReviewing(item)
    setApproved(shouldApprove)
    setReviewComment('')
    setReviewPaymentStatus(item.payment_status || 'unpaid')
    setReviewTestAmount(Boolean(item.is_test_amount))
    setReviewInvoiceRequired(
      Boolean(item.invoice_required || item.invoice_amount_cents > 0)
    )
    setReviewInvoiceAmount(((item.invoice_amount_cents || 0) / 100).toFixed(2))
  }
  const openAccountingEdit = (item: QuotaApplication) => {
    setAccountingEdit(item)
    setReviewPaymentStatus(item.payment_status || 'unpaid')
    setReviewTestAmount(Boolean(item.is_test_amount))
    setReviewInvoiceRequired(
      Boolean(item.invoice_required || item.invoice_amount_cents > 0)
    )
    setReviewInvoiceAmount(((item.invoice_amount_cents || 0) / 100).toFixed(2))
  }
  const submitAccountingEdit = async () => {
    if (!accountingEdit) return
    setReviewingBusy(true)
    try {
      const result = await updateQuotaApplicationAccounting(accountingEdit.id, {
        payment_status: reviewPaymentStatus,
        is_test_amount: reviewTestAmount,
        invoice_required: reviewInvoiceRequired,
        invoice_amount_cents: Math.round(
          Number(reviewInvoiceAmount || 0) * 100
        ),
      })
      if (result.success) {
        toast.success(t('Accounting information updated'))
        setAccountingEdit(null)
        refresh()
      } else {
        toast.error(
          result.message || t('Failed to update accounting information')
        )
      }
    } finally {
      setReviewingBusy(false)
    }
  }
  const submitReview = async () => {
    if (!reviewing) return
    if (!approved && !reviewComment.trim()) {
      toast.error(t('Rejection reason is required'))
      return
    }
    setReviewingBusy(true)
    try {
      const result = await reviewQuotaApplication(
        reviewing.id,
        approved,
        reviewComment.trim(),
        {
          payment_status: reviewPaymentStatus,
          is_test_amount: reviewTestAmount,
          invoice_required: reviewInvoiceRequired,
          invoice_amount_cents: Math.round(
            Number(reviewInvoiceAmount || 0) * 100
          ),
        }
      )
      if (result.success) {
        toast.success(
          approved
            ? t('Quota credited successfully')
            : t('Quota application rejected')
        )
        setReviewing(null)
        refresh()
      } else {
        toast.error(result.message || t('Failed to review quota application'))
      }
    } finally {
      setReviewingBusy(false)
    }
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Quota Applications')}
      </SectionPageLayout.Title>
      {!isRoot && (
        <SectionPageLayout.Actions>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            {t('New application')}
          </Button>
        </SectionPageLayout.Actions>
      )}
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <div className='flex gap-2 border-b pb-2'>
            <Button
              variant={view === 'applications' ? 'default' : 'ghost'}
              onClick={() => setView('applications')}
            >
              {t('Applications')}
            </Button>
            <Button
              variant={view === 'reconciliation' ? 'default' : 'ghost'}
              onClick={() => setView('reconciliation')}
            >
              <BarChart3 />
              {isRoot ? t('Team reconciliation') : t('My reconciliation')}
            </Button>
          </div>
          {view === 'reconciliation' ? (
            <ReconciliationView isRoot={isRoot} />
          ) : (
            <>
              <div className='flex flex-col gap-2 sm:flex-row'>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    if (!value) return
                    setStatus(value)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className='w-full sm:w-52'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>{t('All statuses')}</SelectItem>
                    <SelectItem value='pending'>
                      {t('Pending review')}
                    </SelectItem>
                    <SelectItem value='approved'>{t('Credited')}</SelectItem>
                    <SelectItem value='rejected'>{t('Rejected')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={paymentFilter}
                  onValueChange={(value) => {
                    if (value) {
                      setPaymentFilter(value)
                      setPage(1)
                    }
                  }}
                >
                  <SelectTrigger className='w-full sm:w-36'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>
                      {t('All payment statuses')}
                    </SelectItem>
                    <SelectItem value='paid'>{t('Paid')}</SelectItem>
                    <SelectItem value='unpaid'>{t('Unpaid')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={testFilter}
                  onValueChange={(value) => {
                    if (value) {
                      setTestFilter(value)
                      setPage(1)
                    }
                  }}
                >
                  <SelectTrigger className='w-full sm:w-36'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>{t('All amount types')}</SelectItem>
                    <SelectItem value='false'>{t('Formal amount')}</SelectItem>
                    <SelectItem value='true'>{t('Test amount')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={invoiceFilter}
                  onValueChange={(value) => {
                    if (value) {
                      setInvoiceFilter(value)
                      setPage(1)
                    }
                  }}
                >
                  <SelectTrigger className='w-full sm:w-40'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>
                      {t('All invoice statuses')}
                    </SelectItem>
                    <SelectItem value='true'>
                      {t('Invoice required')}
                    </SelectItem>
                    <SelectItem value='false'>
                      {t('No invoice required')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className='flex w-full max-w-md gap-2'>
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        setKeyword(searchInput.trim())
                        setPage(1)
                      }
                    }}
                    placeholder={t('Search applicant or target user')}
                  />
                  <Button
                    variant='outline'
                    size='icon'
                    title={t('Search')}
                    onClick={() => {
                      setKeyword(searchInput.trim())
                      setPage(1)
                    }}
                  >
                    <Search />
                  </Button>
                </div>
              </div>

              <div className='hidden rounded-md border md:block'>
                <Table className='min-w-[900px]'>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Application ID')}</TableHead>
                      {isRoot && <TableHead>{t('Applicant')}</TableHead>}
                      <TableHead>{t('Target user')}</TableHead>
                      <TableHead>{t('Credit amount')}</TableHead>
                      <TableHead>{t('Payment status')}</TableHead>
                      <TableHead>{t('Invoice amount (CNY)')}</TableHead>
                      <TableHead>{t('Amount type')}</TableHead>
                      <TableHead>{t('Submitted at')}</TableHead>
                      <TableHead>{t('Status')}</TableHead>
                      <TableHead className='text-right'>
                        {t('Actions')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(isLoading || isError || items.length === 0) && (
                      <TableRow>
                        <TableCell
                          colSpan={isRoot ? 7 : 6}
                          className={
                            isError
                              ? 'text-destructive h-28 text-center'
                              : 'text-muted-foreground h-28 text-center'
                          }
                        >
                          {emptyMessage}
                        </TableCell>
                      </TableRow>
                    )}
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className='font-medium'>
                          #{item.id}
                        </TableCell>
                        {isRoot && (
                          <TableCell>{item.applicant_username}</TableCell>
                        )}
                        <TableCell>
                          <span className='block font-medium'>
                            {item.target_username}
                          </span>
                          <span className='text-muted-foreground text-xs'>
                            {item.target_display_name &&
                              `${item.target_display_name} · `}
                            ID {item.target_user_id}
                          </span>
                        </TableCell>
                        <TableCell className='font-medium'>
                          {formatQuota(item.quota_amount)}
                        </TableCell>
                        <TableCell>
                          {t(
                            item.payment_status === 'paid' ? 'Paid' : 'Unpaid'
                          )}
                        </TableCell>
                        <TableCell>
                          {item.invoice_required ||
                          item.invoice_amount_cents > 0
                            ? `CNY ${(item.invoice_amount_cents / 100).toFixed(2)}`
                            : t('No invoice required')}
                        </TableCell>
                        <TableCell>
                          {item.is_test_amount
                            ? t('Test amount')
                            : t('Formal amount')}
                        </TableCell>
                        <TableCell>
                          {formatTimestamp(item.created_at)}
                        </TableCell>
                        <TableCell>
                          <ApplicationStatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>
                          <div className='flex justify-end gap-1'>
                            <Button
                              variant='ghost'
                              size='icon'
                              title={t('View details')}
                              onClick={() => setDetails(item)}
                            >
                              <Eye />
                            </Button>
                            {isRoot && item.status === 'approved' && (
                              <Button
                                variant='ghost'
                                size='icon'
                                title={t('Edit accounting information')}
                                onClick={() => openAccountingEdit(item)}
                              >
                                ✎
                              </Button>
                            )}
                            {isRoot && item.status === 'pending' && (
                              <>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  title={t('Approve')}
                                  onClick={() => openReview(item, true)}
                                >
                                  <Check />
                                </Button>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  title={t('Reject')}
                                  onClick={() => openReview(item, false)}
                                >
                                  <X />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className='space-y-2 md:hidden'>
                {(isLoading || isError || items.length === 0) && (
                  <div
                    className={
                      isError
                        ? 'text-destructive rounded-md border px-4 py-10 text-center text-sm'
                        : 'text-muted-foreground rounded-md border px-4 py-10 text-center text-sm'
                    }
                  >
                    {emptyMessage}
                  </div>
                )}
                {items.map((item) => (
                  <div key={item.id} className='rounded-md border p-3'>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <p className='truncate font-medium'>
                          {item.target_username}
                        </p>
                        <p className='text-muted-foreground truncate text-xs'>
                          {item.target_display_name &&
                            `${item.target_display_name} · `}
                          ID {item.target_user_id}
                        </p>
                      </div>
                      <ApplicationStatusBadge status={item.status} />
                    </div>

                    <div className='mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm'>
                      <div>
                        <p className='text-muted-foreground text-xs'>
                          {t('Credit amount')}
                        </p>
                        <p className='font-medium'>
                          {formatQuota(item.quota_amount)}
                        </p>
                      </div>
                      <div>
                        <p className='text-muted-foreground text-xs'>
                          {t('Application ID')}
                        </p>
                        <p className='font-medium'>#{item.id}</p>
                      </div>
                      {isRoot && (
                        <div>
                          <p className='text-muted-foreground text-xs'>
                            {t('Applicant')}
                          </p>
                          <p className='truncate'>{item.applicant_username}</p>
                        </div>
                      )}
                      <div className={isRoot ? '' : 'col-span-2'}>
                        <p className='text-muted-foreground text-xs'>
                          {t('Submitted at')}
                        </p>
                        <p>{formatTimestamp(item.created_at)}</p>
                      </div>
                    </div>

                    <div className='mt-3 flex justify-end gap-1 border-t pt-2'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setDetails(item)}
                      >
                        <Eye />
                        {t('View details')}
                      </Button>
                      {isRoot && item.status === 'approved' && (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => openAccountingEdit(item)}
                        >
                          {t('Edit accounting information')}
                        </Button>
                      )}
                      {isRoot && item.status === 'pending' && (
                        <>
                          <Button
                            variant='ghost'
                            size='icon'
                            title={t('Approve')}
                            onClick={() => openReview(item, true)}
                          >
                            <Check />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            title={t('Reject')}
                            onClick={() => openReview(item, false)}
                          >
                            <X />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className='flex items-center justify-between text-sm'>
                <span className='text-muted-foreground'>
                  {t('{{count}} applications', { count: data?.total ?? 0 })}
                </span>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='outline'
                    size='icon'
                    title={t('Previous page')}
                    disabled={page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <span>
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant='outline'
                    size='icon'
                    title={t('Next page')}
                    disabled={page >= totalPages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <CreateApplicationDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={refresh}
        />
        <ApplicationDetails
          application={details}
          onClose={() => setDetails(null)}
        />
        <Dialog
          open={reviewing !== null}
          onOpenChange={(open) => !open && setReviewing(null)}
          title={
            approved
              ? t('Approve quota application')
              : t('Reject quota application')
          }
          description={
            reviewing
              ? `${reviewing.target_username} · ${formatQuota(reviewing.quota_amount)}`
              : undefined
          }
          contentHeight='auto'
          footer={
            <>
              <Button variant='outline' onClick={() => setReviewing(null)}>
                {t('Cancel')}
              </Button>
              <Button
                variant={approved ? 'default' : 'destructive'}
                disabled={reviewingBusy}
                onClick={submitReview}
              >
                {reviewButtonLabel}
              </Button>
            </>
          }
        >
          <div className='space-y-2'>
            <div className='grid gap-4 sm:grid-cols-3'>
              <div>
                <Label>{t('Payment status')}</Label>
                <Select
                  value={reviewPaymentStatus}
                  onValueChange={(value) =>
                    value && setReviewPaymentStatus(value as 'paid' | 'unpaid')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='unpaid'>{t('Unpaid')}</SelectItem>
                    <SelectItem value='paid'>{t('Paid')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('Invoice requirement')}</Label>
                <Select
                  value={reviewInvoiceRequired ? 'yes' : 'no'}
                  onValueChange={(value) =>
                    setReviewInvoiceRequired(value === 'yes')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='no'>
                      {t('No invoice required')}
                    </SelectItem>
                    <SelectItem value='yes'>{t('Invoice required')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex items-center justify-between rounded-md border p-3'>
                <Label>{t('Test amount')}</Label>
                <Switch
                  checked={reviewTestAmount}
                  onCheckedChange={setReviewTestAmount}
                />
              </div>
            </div>
            <div>
              <Label>{t('Invoice amount (CNY)')}</Label>
              <Input
                type='number'
                min={0}
                step={0.01}
                disabled={!reviewInvoiceRequired}
                value={reviewInvoiceAmount}
                onChange={(event) => setReviewInvoiceAmount(event.target.value)}
              />
            </div>
            <Label>
              {approved ? t('Review comment') : t('Rejection reason')}
            </Label>
            <Textarea
              rows={4}
              maxLength={500}
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
            />
          </div>
        </Dialog>
        <Dialog
          open={accountingEdit !== null}
          onOpenChange={(open) => !open && setAccountingEdit(null)}
          title={t('Edit accounting information')}
          contentHeight='auto'
          footer={
            <>
              <Button variant='outline' onClick={() => setAccountingEdit(null)}>
                {t('Cancel')}
              </Button>
              <Button disabled={reviewingBusy} onClick={submitAccountingEdit}>
                {t('Save')}
              </Button>
            </>
          }
        >
          <div className='space-y-3'>
            <div className='grid gap-4 sm:grid-cols-3'>
              <div>
                <Label>{t('Payment status')}</Label>
                <Select
                  value={reviewPaymentStatus}
                  onValueChange={(value) =>
                    value && setReviewPaymentStatus(value as 'paid' | 'unpaid')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='unpaid'>{t('Unpaid')}</SelectItem>
                    <SelectItem value='paid'>{t('Paid')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('Invoice requirement')}</Label>
                <Select
                  value={reviewInvoiceRequired ? 'yes' : 'no'}
                  onValueChange={(value) =>
                    setReviewInvoiceRequired(value === 'yes')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='no'>
                      {t('No invoice required')}
                    </SelectItem>
                    <SelectItem value='yes'>{t('Invoice required')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex items-center justify-between rounded-md border p-3'>
                <Label>{t('Test amount')}</Label>
                <Switch
                  checked={reviewTestAmount}
                  onCheckedChange={setReviewTestAmount}
                />
              </div>
            </div>
            <div>
              <Label>{t('Invoice amount (CNY)')}</Label>
              <Input
                type='number'
                min={0}
                step={0.01}
                disabled={!reviewInvoiceRequired}
                value={reviewInvoiceAmount}
                onChange={(event) => setReviewInvoiceAmount(event.target.value)}
              />
            </div>
          </div>
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
