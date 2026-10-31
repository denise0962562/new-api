package model

import (
	"errors"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AffiliateSettlementPending = "pending"
	AffiliateSettlementApproved = "approved"
	AffiliateSettlementRejected = "rejected"
	AffiliateSettlementPaid = "paid"
)

type AffiliateCommissionRule struct {
	Id int `json:"id"`
	SalesId int `json:"sales_id" gorm:"index;uniqueIndex:ux_sales_group"`
	GroupName string `json:"group_name" gorm:"size:128;uniqueIndex:ux_sales_group"`
	RateBps int `json:"rate_bps"` // basis points: 100 = 1%
	Enabled bool `json:"enabled" gorm:"index;default:true"`
	Remark string `json:"remark" gorm:"type:text"`
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime"`
}

type AffiliateSettlementApplication struct {
	Id int `json:"id"`
	SalesId int `json:"sales_id" gorm:"index;not null"`
	TargetUserId int `json:"target_user_id" gorm:"index;not null"`
	StartAt int64 `json:"start_at"`
	EndAt int64 `json:"end_at"`
	TotalQuota int64 `json:"total_quota"`
	TotalCommission int64 `json:"total_commission"`
	Currency string `json:"currency"`
	Remark string `json:"remark" gorm:"type:text"`
	PaymentType string `json:"payment_type" gorm:"size:32"`
	PaymentNote string `json:"payment_note" gorm:"type:text"`
	AttachmentKeys string `json:"attachment_keys" gorm:"type:text"`
	Status string `json:"status" gorm:"index;size:16"`
	ReviewComment string `json:"review_comment" gorm:"type:text"`
	ReviewedBy int `json:"reviewed_by"`
	ReviewedAt int64 `json:"reviewed_at"`
	PaidAt int64 `json:"paid_at"`
	PaidBy int `json:"paid_by"`
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime;index"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime"`
	Items []AffiliateSettlementItem `json:"items" gorm:"foreignKey:ApplicationId"`
}

type AffiliateSettlementItem struct {
	Id int `json:"id"`
	ApplicationId int `json:"application_id" gorm:"index;not null"`
	GroupName string `json:"group_name"`
	Quota int64 `json:"quota"`
	RateBps int `json:"rate_bps"`
	Commission int64 `json:"commission"`
}

func (AffiliateSettlementApplication) TableName() string { return "affiliate_settlement_applications" }
func (AffiliateSettlementItem) TableName() string { return "affiliate_settlement_items" }

func ValidateAffiliateRate(rateBps int) error { if rateBps < 10 || rateBps > 500 { return errors.New("rate must be between 0.1% and 5%") }; return nil }

type AffiliateSettlementQuotaRow struct {
	GroupName string `gorm:"column:use_group"`
	Quota     int64  `gorm:"column:quota"`
}

// GetAvailableAffiliateSettlementQuota returns consumption not already
// reserved by a pending, approved, or paid settlement for this target.
func GetAvailableAffiliateSettlementQuota(db *gorm.DB, targetUserID int, startAt, endAt int64) ([]AffiliateSettlementQuotaRow, error) {
	var reserved []AffiliateSettlementApplication
	if err := db.Select("start_at", "end_at").Where("target_user_id = ? AND status IN ? AND start_at < ? AND end_at > ?", targetUserID, []string{AffiliateSettlementPending, AffiliateSettlementApproved, AffiliateSettlementPaid}, endAt, startAt).Find(&reserved).Error; err != nil {
		return nil, err
	}
	query := db.Table("quota_data").Select("use_group, SUM(quota) AS quota").Where("user_id = ? AND created_at >= ? AND created_at < ?", targetUserID, startAt, endAt)
	for _, application := range reserved {
		query = query.Where("NOT (created_at >= ? AND created_at < ?)", application.StartAt, application.EndAt)
	}
	var rows []AffiliateSettlementQuotaRow
	if err := query.Group("use_group").Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func CreateAffiliateSettlement(app *AffiliateSettlementApplication) error {
	if app.Status == "" { app.Status = AffiliateSettlementPending }
	return DB.Transaction(func(tx *gorm.DB) error {
		// Serialize applications for a target and recalculate eligibility under
		// the same transaction so two concurrent requests cannot claim the same
		// consumption.
		var target User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&target, "id = ? AND deleted_at IS NULL", app.TargetUserId).Error; err != nil { return err }
		rows, err := GetAvailableAffiliateSettlementQuota(tx, app.TargetUserId, app.StartAt, app.EndAt)
		if err != nil { return err }
		var rules []AffiliateCommissionRule
		if err := tx.Where("sales_id = ? AND enabled = ?", app.SalesId, true).Find(&rules).Error; err != nil { return err }
		ruleMap := make(map[string]AffiliateCommissionRule, len(rules))
		for _, rule := range rules { ruleMap[rule.GroupName] = rule }
		available := make(map[string]int64, len(rows))
		for _, row := range rows { if _, ok := ruleMap[row.GroupName]; ok && row.Quota > 0 { available[row.GroupName] = row.Quota } }
		if len(available) != len(app.Items) { return errors.New("settlement details have changed, please refresh") }
		var totalQuota, totalCommission int64
		for _, item := range app.Items {
			rule, ok := ruleMap[item.GroupName]
			quota, exists := available[item.GroupName]
			if !ok || !exists || quota != item.Quota || rule.RateBps != item.RateBps || item.Commission != item.Quota*int64(item.RateBps)/10000 {
				return errors.New("settlement details have changed, please refresh")
			}
			delete(available, item.GroupName)
			totalQuota += item.Quota
			totalCommission += item.Commission
		}
		if len(available) != 0 || totalQuota != app.TotalQuota || totalCommission != app.TotalCommission {
			return fmt.Errorf("settlement details have changed, please refresh")
		}
		// Persist the detail rows explicitly below. GORM otherwise creates the
		// Items association as part of Create(app), and the loop would insert
		// those same rows a second time with their newly assigned IDs.
		if err := tx.Omit("Items").Create(app).Error; err != nil { return err }
		for i := range app.Items { app.Items[i].ApplicationId = app.Id; if err := tx.Create(&app.Items[i]).Error; err != nil { return err } }
		return nil
	})
}

func LoadAffiliateSettlement(id int) (*AffiliateSettlementApplication, error) { var a AffiliateSettlementApplication; err := DB.Preload("Items").First(&a,id).Error; return &a,err }
