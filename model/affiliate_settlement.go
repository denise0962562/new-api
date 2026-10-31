package model

import (
	"errors"
	"gorm.io/gorm"
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

func CreateAffiliateSettlement(app *AffiliateSettlementApplication) error {
	if app.Status == "" { app.Status = AffiliateSettlementPending }
	return DB.Transaction(func(tx *gorm.DB) error {
		var n int64
		if err := tx.Model(&AffiliateSettlementApplication{}).Where("target_user_id = ? AND status IN ? AND start_at < ? AND end_at > ?", app.TargetUserId, []string{AffiliateSettlementPending, AffiliateSettlementApproved}, app.EndAt, app.StartAt).Count(&n).Error; err != nil { return err }
		if n > 0 { return errors.New("settlement period overlaps an existing application") }
		if err := tx.Create(app).Error; err != nil { return err }
		for i := range app.Items { app.Items[i].ApplicationId = app.Id; if err := tx.Create(&app.Items[i]).Error; err != nil { return err } }
		return nil
	})
}

func LoadAffiliateSettlement(id int) (*AffiliateSettlementApplication, error) { var a AffiliateSettlementApplication; err := DB.Preload("Items").First(&a,id).Error; return &a,err }
