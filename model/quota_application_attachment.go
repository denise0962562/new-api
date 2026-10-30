package model

type QuotaApplicationAttachment struct {
	Id int `json:"id"`
	ApplicationId int `json:"application_id" gorm:"index;not null"`
	ObjectKey string `json:"object_key" gorm:"not null"`
	PublicURL string `json:"public_url,omitempty" gorm:"-"`
	FileName string `json:"file_name"`
	ContentType string `json:"content_type"`
	FileSize int64 `json:"file_size"`
	SortOrder int `json:"sort_order"`
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime"`
}

func (QuotaApplicationAttachment) TableName() string { return "quota_application_attachments" }
