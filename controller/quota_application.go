package controller

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type createQuotaApplicationRequest struct {
	TargetUserId       int    `json:"target_user_id"`
	QuotaAmount        int    `json:"quota_amount"`
	InvoiceAmountCents int64  `json:"invoice_amount_cents"`
	PaymentStatus      string `json:"payment_status"`
	IsTestAmount       bool   `json:"is_test_amount"`
	InvoiceRequired    bool   `json:"invoice_required"`
	ApplicationInfo    string `json:"application_info"`
	Attachments        []model.QuotaApplicationAttachment `json:"attachments"`
}

func GetQuotaApplicationR2Config(c *gin.Context) {
	cfg := service.QuotaApplicationR2ConfigFromOptions()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"enabled": cfg.Enabled, "endpoint": cfg.Endpoint, "region": cfg.Region, "bucket": cfg.Bucket, "public_base_url": cfg.PublicBaseURL, "access_key_id": cfg.AccessKeyID != "", "has_secret": cfg.AccessKeySecret != ""}})
}

func UpdateQuotaApplicationR2Config(c *gin.Context) {
	var req service.QuotaApplicationR2Config
	if err := common.DecodeJson(c.Request.Body, &req); err != nil { common.ApiError(c, err); return }
	current := service.QuotaApplicationR2ConfigFromOptions()
	if req.AccessKeyID == "" { req.AccessKeyID = current.AccessKeyID }
	if req.AccessKeySecret == "" { req.AccessKeySecret = current.AccessKeySecret }
	if req.Region == "" { req.Region = "auto" }
	err := model.UpdateOptionsBulk(map[string]string{"quota_application.r2.enabled": strconv.FormatBool(req.Enabled), "quota_application.r2.endpoint": strings.TrimRight(strings.TrimSpace(req.Endpoint), "/"), "quota_application.r2.region": req.Region, "quota_application.r2.bucket": strings.TrimSpace(req.Bucket), "quota_application.r2.public_base_url": strings.TrimRight(strings.TrimSpace(req.PublicBaseURL), "/"), "quota_application.r2.access_key_id": req.AccessKeyID, "quota_application.r2.access_key_secret": req.AccessKeySecret})
	if err != nil { common.ApiError(c, err); return }
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func PresignQuotaApplicationAttachment(c *gin.Context) {
	var req struct { FileName string `json:"file_name"`; ContentType string `json:"content_type"` }
	if err := common.DecodeJson(c.Request.Body, &req); err != nil { common.ApiError(c, err); return }
	if !strings.HasPrefix(req.ContentType, "image/") || req.FileName == "" { common.ApiErrorMsg(c, "only image uploads are allowed"); return }
	key := quotaApplicationAttachmentKey(c, req.FileName)
	url, err := service.PresignQuotaApplicationUpload(service.QuotaApplicationR2ConfigFromOptions(), key, req.ContentType)
	if err != nil { common.ApiError(c, err); return }
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"object_key": key, "upload_url": url, "public_url": service.R2ObjectURL(service.QuotaApplicationR2ConfigFromOptions(), key)}})
}

// UploadQuotaApplicationAttachment proxies the upload through new-api. This
// avoids browser-to-R2 CORS failures while keeping the object stored in R2.
func UploadQuotaApplicationAttachment(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil { common.ApiErrorMsg(c, "attachment file is required"); return }
	defer file.Close()
	fileSize := header.Size
	if fileSize <= 0 {
		if seeker, ok := file.(io.Seeker); ok {
			if end, seekErr := seeker.Seek(0, io.SeekEnd); seekErr == nil {
				fileSize = end
				_, _ = seeker.Seek(0, io.SeekStart)
			}
		}
	}
	if fileSize <= 0 || fileSize > 10*1024*1024 { common.ApiErrorMsg(c, "attachment exceeds 10 MB"); return }
	contentType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") { common.ApiErrorMsg(c, "only image uploads are allowed"); return }
	config := service.QuotaApplicationR2ConfigFromOptions()
	key := quotaApplicationAttachmentKey(c, header.Filename)
	uploadURL, err := service.PresignQuotaApplicationUpload(config, key, contentType)
	if err != nil { common.ApiError(c, err); return }
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPut, uploadURL, file)
	if err != nil { common.ApiError(c, err); return }
	req.Header.Set("Content-Type", contentType)
	if fileSize >= 0 { req.ContentLength = fileSize }
	resp, err := http.DefaultClient.Do(req)
	if err != nil { common.ApiError(c, err); return }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		common.ApiErrorMsg(c, fmt.Sprintf("R2 upload failed: %s", strings.TrimSpace(string(body))))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"object_key": key, "file_name": header.Filename, "content_type": contentType, "file_size": fileSize, "public_url": service.R2ObjectURL(config, key)}})
}

func quotaApplicationAttachmentKey(c *gin.Context, fileName string) string {
	return fmt.Sprintf("quota-applications/%d/%d-%d-%s", time.Now().UTC().Year(), c.GetInt("id"), time.Now().UnixNano(), strings.ReplaceAll(filepath.Base(fileName), " ", "_"))
}

type reviewQuotaApplicationRequest struct {
	Approved bool   `json:"approved"`
	Comment  string `json:"comment"`
	PaymentStatus string `json:"payment_status"`
	IsTestAmount bool `json:"is_test_amount"`
	InvoiceRequired bool `json:"invoice_required"`
	InvoiceAmountCents int64 `json:"invoice_amount_cents"`
}

func quotaApplicationScope(c *gin.Context) *int {
	if c.GetInt("role") == common.RoleRootUser {
		return nil
	}
	applicantId := c.GetInt("id")
	return &applicantId
}

func ListQuotaApplications(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && !model.IsQuotaApplicationStatus(status) {
		common.ApiError(c, strconv.ErrSyntax)
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListQuotaApplications(
		quotaApplicationScope(c),
		status,
		strings.TrimSpace(c.Query("payment_status")),
		strings.TrimSpace(c.Query("test_amount")),
		strings.TrimSpace(c.Query("invoice_required")),
		strings.TrimSpace(c.Query("keyword")),
		pageInfo.GetStartIdx(),
		pageInfo.GetPageSize(),
	)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	config := service.QuotaApplicationR2ConfigFromOptions()
	for i := range items { for j := range items[i].Attachments { items[i].Attachments[j].PublicURL = service.R2ObjectURL(config, items[i].Attachments[j].ObjectKey) } }
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"items": items, "total": total, "page": pageInfo.Page, "page_size": pageInfo.PageSize,
	}})
}

func QuotaApplicationSummary(c *gin.Context) {
	from, err := strconv.ParseInt(c.Query("from"), 10, 64)
	if err != nil { common.ApiError(c, err); return }
	to, err := strconv.ParseInt(c.Query("to"), 10, 64)
	if err != nil { common.ApiError(c, err); return }
	if to <= from || to-from > 366*24*60*60 { common.ApiErrorMsg(c, "invalid date range"); return }
	var applicantID *int
	if c.GetInt("role") != common.RoleRootUser {
		id := c.GetInt("id")
		applicantID = &id
	} else if raw := strings.TrimSpace(c.Query("applicant_id")); raw != "" {
		id, parseErr := strconv.Atoi(raw)
		if parseErr != nil { common.ApiError(c, parseErr); return }
		applicantID = &id
	}
	data, err := model.GetQuotaApplicationSummary(applicantID, from, to)
	if err != nil { common.ApiError(c, err); return }
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func GetQuotaApplication(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	application, err := model.GetQuotaApplication(id, quotaApplicationScope(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	config := service.QuotaApplicationR2ConfigFromOptions()
	for i := range application.Attachments { application.Attachments[i].PublicURL = service.R2ObjectURL(config, application.Attachments[i].ObjectKey) }
	c.JSON(http.StatusOK, gin.H{"success": true, "data": application})
}

func CreateQuotaApplication(c *gin.Context) {
	var req createQuotaApplicationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	application := &model.QuotaApplication{
		ApplicantId:        c.GetInt("id"),
		TargetUserId:       req.TargetUserId,
		QuotaAmount:        req.QuotaAmount,
		InvoiceAmountCents: req.InvoiceAmountCents,
		PaymentStatus: req.PaymentStatus,
		IsTestAmount: req.IsTestAmount,
		InvoiceRequired: req.InvoiceRequired,
		ApplicationInfo:    req.ApplicationInfo,
	}
	if len(req.Attachments) > 3 { common.ApiErrorMsg(c, "at most 3 attachments are allowed"); return }
	for i := range req.Attachments {
		if req.Attachments[i].FileSize <= 0 || req.Attachments[i].FileSize > 10*1024*1024 || !strings.HasPrefix(req.Attachments[i].ContentType, "image/") { common.ApiErrorMsg(c, "each attachment must be an image no larger than 10 MB"); return }
	}
	if err := model.CreateQuotaApplication(application); err != nil {
		common.ApiError(c, err)
		return
	}
	for i := range req.Attachments { req.Attachments[i].ApplicationId = application.Id; req.Attachments[i].Id = 0; if err := model.DB.Create(&req.Attachments[i]).Error; err != nil { common.ApiError(c, err); return } }
	auditApplication, _ := model.GetQuotaApplication(application.Id, nil)
	targetUsername := ""
	if auditApplication != nil { targetUsername = auditApplication.TargetUsername }
	recordManageAuditFor(c, application.TargetUserId, "quota_application.create", map[string]interface{}{
		"application_id": application.Id,
		"quota":          application.QuotaAmount,
		"target_username": targetUsername,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": application})
}

func SearchQuotaApplicationTargets(c *gin.Context) {
	users, err := model.SearchQuotaApplicationTargets(c.Query("keyword"), 20)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": users})
}

func ReviewQuotaApplication(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var req reviewQuotaApplicationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.PaymentStatus == "" { req.PaymentStatus = "unpaid" }
	application, err := model.ReviewQuotaApplicationWithAccounting(id, c.GetInt("id"), req.Approved, req.Comment, req.PaymentStatus, req.IsTestAmount, req.InvoiceRequired, req.InvoiceAmountCents)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Approved {
		if err := model.InvalidateUserCache(application.TargetUserId); err != nil {
			common.SysLog("failed to invalidate user cache after quota application approval: " + err.Error())
		}
	}
	auditApplication, _ := model.GetQuotaApplication(application.Id, nil)
	targetUsername := ""
	if auditApplication != nil { targetUsername = auditApplication.TargetUsername }
	recordManageAuditFor(c, application.TargetUserId, "quota_application.review", map[string]interface{}{
		"application_id": application.Id,
		"approved":       req.Approved,
		"quota":          application.QuotaAmount,
		"target_username": targetUsername,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": application})
}

func UpdateQuotaApplicationAccounting(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id")); if err != nil { common.ApiError(c, err); return }
	var req struct { PaymentStatus string `json:"payment_status"`; IsTestAmount bool `json:"is_test_amount"`; InvoiceRequired bool `json:"invoice_required"`; InvoiceAmountCents int64 `json:"invoice_amount_cents"` }
	if err := common.DecodeJson(c.Request.Body, &req); err != nil { common.ApiError(c, err); return }
	if req.PaymentStatus == "" { req.PaymentStatus = "unpaid" }
	application, err := model.UpdateQuotaApplicationAccounting(id, req.PaymentStatus, req.IsTestAmount, req.InvoiceRequired, req.InvoiceAmountCents)
	if err != nil { common.ApiError(c, err); return }
	if application == nil { common.ApiErrorMsg(c, "quota application not found"); return }
	config := service.QuotaApplicationR2ConfigFromOptions()
	for i := range application.Attachments { application.Attachments[i].PublicURL = service.R2ObjectURL(config, application.Attachments[i].ObjectKey) }
	recordManageAuditFor(c, application.TargetUserId, "quota_application.accounting.update", map[string]interface{}{"application_id": application.Id, "target_username": application.TargetUsername, "payment_status": application.PaymentStatus, "is_test_amount": application.IsTestAmount, "invoice_required": application.InvoiceRequired, "invoice_amount_cents": application.InvoiceAmountCents})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": application})
}
