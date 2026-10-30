package model

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	QuotaApplicationStatusPending  = "pending"
	QuotaApplicationStatusApproved = "approved"
	QuotaApplicationStatusRejected = "rejected"
)

type QuotaApplication struct {
	Id                 int    `json:"id"`
	ApplicantId        int    `json:"applicant_id" gorm:"index;not null"`
	ApplicantUsername  string `json:"applicant_username" gorm:"->;-:migration"`
	TargetUserId       int    `json:"target_user_id" gorm:"index;not null"`
	TargetUsername     string `json:"target_username" gorm:"->;-:migration"`
	TargetDisplayName  string `json:"target_display_name" gorm:"->;-:migration"`
	QuotaAmount        int    `json:"quota_amount" gorm:"not null"`
	InvoiceAmountCents int64  `json:"invoice_amount_cents" gorm:"not null"`
	ApplicationInfo    string `json:"application_info" gorm:"type:text;not null"`
	Status             string `json:"status" gorm:"type:varchar(16);index;not null"`
	ReviewedBy         int    `json:"reviewed_by" gorm:"index"`
	ReviewerUsername   string `json:"reviewer_username" gorm:"->;-:migration"`
	ReviewComment      string `json:"review_comment" gorm:"type:varchar(500)"`
	QuotaBefore        int    `json:"quota_before"`
	QuotaAfter         int    `json:"quota_after"`
	CreatedAt          int64  `json:"created_at" gorm:"autoCreateTime;index"`
	ReviewedAt         int64  `json:"reviewed_at"`
	UpdatedAt          int64  `json:"updated_at" gorm:"autoUpdateTime"`
	Attachments        []QuotaApplicationAttachment `json:"attachments,omitempty" gorm:"-"`
}

type QuotaApplicationTarget struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Quota       int    `json:"quota"`
}

type QuotaApplicationSalesSummary struct {
	ApplicantId       int    `json:"applicant_id"`
	ApplicantUsername string `json:"applicant_username"`
	QuotaAmount       int64  `json:"quota_amount"`
	ApplicationCount  int64  `json:"application_count"`
	CustomerCount     int64  `json:"customer_count"`
}

type QuotaApplicationSummary struct {
	QuotaAmount       int64                         `json:"quota_amount"`
	ApplicationCount  int64                         `json:"application_count"`
	CustomerCount     int64                         `json:"customer_count"`
	PendingQuota      int64                         `json:"pending_quota"`
	PendingCount      int64                         `json:"pending_count"`
	RejectedQuota     int64                         `json:"rejected_quota"`
	RejectedCount     int64                         `json:"rejected_count"`
	Sales             []QuotaApplicationSalesSummary `json:"sales"`
	Applications      []QuotaApplication             `json:"applications"`
}

// GetQuotaApplicationSummary returns approved sales totals and the supporting
// application rows for the requested period. Approved records use reviewed_at
// (the moment the quota was credited); pending/rejected records use created_at.
func GetQuotaApplicationSummary(applicantId *int, from, to int64) (*QuotaApplicationSummary, error) {
	if to <= from {
		return &QuotaApplicationSummary{}, nil
	}
	base := DB.Table("quota_applications AS qa")
	if applicantId != nil {
		base = base.Where("qa.applicant_id = ?", *applicantId)
	}
	period := "((qa.status = ? AND qa.reviewed_at >= ? AND qa.reviewed_at < ?) OR (qa.status <> ? AND qa.created_at >= ? AND qa.created_at < ?))"
	args := []interface{}{QuotaApplicationStatusApproved, from, to, QuotaApplicationStatusApproved, from, to}
	base = base.Where(period, args...)

	var result QuotaApplicationSummary
	if err := base.Select("COALESCE(SUM(CASE WHEN qa.status = ? THEN qa.quota_amount ELSE 0 END), 0) AS quota_amount, SUM(CASE WHEN qa.status = ? THEN 1 ELSE 0 END) AS application_count, SUM(CASE WHEN qa.status = ? THEN qa.quota_amount ELSE 0 END) AS pending_quota, SUM(CASE WHEN qa.status = ? THEN 1 ELSE 0 END) AS pending_count, SUM(CASE WHEN qa.status = ? THEN qa.quota_amount ELSE 0 END) AS rejected_quota, SUM(CASE WHEN qa.status = ? THEN 1 ELSE 0 END) AS rejected_count", QuotaApplicationStatusApproved, QuotaApplicationStatusApproved, QuotaApplicationStatusPending, QuotaApplicationStatusPending, QuotaApplicationStatusRejected, QuotaApplicationStatusRejected).Scan(&result).Error; err != nil {
		return nil, err
	}
	var customerCount int64
	customerQuery := base.Where("qa.status = ?", QuotaApplicationStatusApproved).Select("COUNT(DISTINCT qa.target_user_id)").Scan(&customerCount)
	if customerQuery.Error != nil {
		return nil, customerQuery.Error
	}
	result.CustomerCount = customerCount

	salesQuery := base.Where("qa.status = ?", QuotaApplicationStatusApproved).
		Select("qa.applicant_id, applicant.username AS applicant_username, COALESCE(SUM(qa.quota_amount), 0) AS quota_amount, COUNT(*) AS application_count, COUNT(DISTINCT qa.target_user_id) AS customer_count").
		Joins("LEFT JOIN users AS applicant ON applicant.id = qa.applicant_id").
		Group("qa.applicant_id, applicant.username").Order("quota_amount DESC")
	if err := salesQuery.Scan(&result.Sales).Error; err != nil {
		return nil, err
	}

	applicationsQuery := DB.Table("quota_applications AS qa").
		Joins("LEFT JOIN users AS applicant ON applicant.id = qa.applicant_id").
		Joins("LEFT JOIN users AS target ON target.id = qa.target_user_id").
		Joins("LEFT JOIN users AS reviewer ON reviewer.id = qa.reviewed_by").
		Where(period, args...)
	if applicantId != nil {
		applicationsQuery = applicationsQuery.Where("qa.applicant_id = ?", *applicantId)
	}
	if err := applicationsQuery.Select("qa.*, applicant.username AS applicant_username, target.username AS target_username, target.display_name AS target_display_name, reviewer.username AS reviewer_username").Order("qa.reviewed_at DESC, qa.id DESC").Limit(500).Scan(&result.Applications).Error; err != nil {
		return nil, err
	}
	return &result, nil
}

func IsQuotaApplicationStatus(status string) bool {
	return status == QuotaApplicationStatusPending || status == QuotaApplicationStatusApproved || status == QuotaApplicationStatusRejected
}

func CreateQuotaApplication(application *QuotaApplication) error {
	application.ApplicationInfo = strings.TrimSpace(application.ApplicationInfo)
	if application.QuotaAmount <= 0 {
		return errors.New("quota amount must be positive")
	}
	if application.InvoiceAmountCents < 0 {
		return errors.New("invoiceable CNY amount cannot be negative")
	}
	if application.ApplicationInfo == "" || len(application.ApplicationInfo) > 2000 {
		return errors.New("application information is required and must not exceed 2000 characters")
	}

	var target User
	if err := DB.Select("id", "role", "status").Where("id = ?", application.TargetUserId).First(&target).Error; err != nil {
		return errors.New("target user not found")
	}
	if target.Role != common.RoleCommonUser || target.Status != common.UserStatusEnabled {
		return errors.New("target must be an enabled normal user")
	}

	application.Status = QuotaApplicationStatusPending
	application.ReviewedBy = 0
	application.ReviewedAt = 0
	application.QuotaBefore = 0
	application.QuotaAfter = 0
	return DB.Create(application).Error
}

func SearchQuotaApplicationTargets(keyword string, limit int) ([]QuotaApplicationTarget, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return []QuotaApplicationTarget{}, nil
	}
	if limit <= 0 || limit > 20 {
		limit = 20
	}
	like := "%" + keyword + "%"
	query := DB.Model(&User{}).
		Select("id", "username", "display_name", "quota").
		Where("role = ? AND status = ?", common.RoleCommonUser, common.UserStatusEnabled).
		Where("username LIKE ? OR display_name LIKE ?", like, like)
	if id, err := strconv.Atoi(keyword); err == nil {
		query = DB.Model(&User{}).
			Select("id", "username", "display_name", "quota").
			Where("role = ? AND status = ?", common.RoleCommonUser, common.UserStatusEnabled).
			Where("id = ? OR username LIKE ? OR display_name LIKE ?", id, like, like)
	}
	var users []QuotaApplicationTarget
	err := query.Order("id DESC").Limit(limit).Scan(&users).Error
	return users, err
}

func ListQuotaApplications(applicantId *int, status, keyword string, offset, limit int) ([]QuotaApplication, int64, error) {
	query := DB.Table("quota_applications AS qa").
		Joins("LEFT JOIN users AS applicant ON applicant.id = qa.applicant_id").
		Joins("LEFT JOIN users AS target ON target.id = qa.target_user_id").
		Joins("LEFT JOIN users AS reviewer ON reviewer.id = qa.reviewed_by")
	if applicantId != nil {
		query = query.Where("qa.applicant_id = ?", *applicantId)
	}
	if status != "" {
		query = query.Where("qa.status = ?", status)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("applicant.username LIKE ? OR target.username LIKE ? OR target.display_name LIKE ?", like, like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var applications []QuotaApplication
	err := query.Select("qa.*, applicant.username AS applicant_username, target.username AS target_username, target.display_name AS target_display_name, reviewer.username AS reviewer_username").
		Order("qa.id DESC").Offset(offset).Limit(limit).Scan(&applications).Error
	for i := range applications { DB.Where("application_id = ?", applications[i].Id).Order("sort_order ASC, id ASC").Find(&applications[i].Attachments) }
	return applications, total, err
}

func GetQuotaApplication(id int, applicantId *int) (*QuotaApplication, error) {
	query := DB.Table("quota_applications AS qa").
		Select("qa.*, applicant.username AS applicant_username, target.username AS target_username, target.display_name AS target_display_name, reviewer.username AS reviewer_username").
		Joins("LEFT JOIN users AS applicant ON applicant.id = qa.applicant_id").
		Joins("LEFT JOIN users AS target ON target.id = qa.target_user_id").
		Joins("LEFT JOIN users AS reviewer ON reviewer.id = qa.reviewed_by").
		Where("qa.id = ?", id)
	if applicantId != nil {
		query = query.Where("qa.applicant_id = ?", *applicantId)
	}
	var application QuotaApplication
	if err := query.Scan(&application).Error; err != nil {
		return nil, err
	}
	if application.Id == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	DB.Where("application_id = ?", application.Id).Order("sort_order ASC, id ASC").Find(&application.Attachments)
	return &application, nil
}

func ReviewQuotaApplication(id, reviewerId int, approved bool, comment string) (*QuotaApplication, error) {
	comment = strings.TrimSpace(comment)
	if !approved && comment == "" {
		return nil, errors.New("rejection reason is required")
	}
	if len(comment) > 500 {
		return nil, errors.New("review comment must not exceed 500 characters")
	}

	var reviewed QuotaApplication
	err := DB.Transaction(func(tx *gorm.DB) error {
		var application QuotaApplication
		if err := tx.Where("id = ?", id).First(&application).Error; err != nil {
			return err
		}
		if application.Status != QuotaApplicationStatusPending {
			return errors.New("only pending applications can be reviewed")
		}

		now := common.GetTimestamp()
		updates := map[string]interface{}{
			"reviewed_by":    reviewerId,
			"reviewed_at":    now,
			"review_comment": comment,
		}
		if approved {
			var target User
			if err := tx.Select("id", "role", "status").Where("id = ?", application.TargetUserId).First(&target).Error; err != nil {
				return errors.New("target user not found")
			}
			if target.Role != common.RoleCommonUser || target.Status != common.UserStatusEnabled {
				return errors.New("target must be an enabled normal user")
			}
			before, after, err := adjustUserQuotaWithManualInvoiceCreditTx(tx, application.TargetUserId, reviewerId, "add", application.QuotaAmount, application.InvoiceAmountCents)
			if err != nil {
				return err
			}
			updates["status"] = QuotaApplicationStatusApproved
			updates["quota_before"] = before
			updates["quota_after"] = after
		} else {
			updates["status"] = QuotaApplicationStatusRejected
		}

		result := tx.Model(&QuotaApplication{}).Where("id = ? AND status = ?", id, QuotaApplicationStatusPending).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("application has already been reviewed")
		}
		return tx.First(&reviewed, id).Error
	})
	return &reviewed, err
}
